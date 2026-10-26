-- First operational staff workflows. Every mutation checks the current JWT
-- identity inside PostgreSQL and writes its audit row in the same transaction.
create sequence public.case_number_seq;

create function public.staff_create_client(
  p_full_name text, p_email text default null, p_phone text default null, p_city text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  new_id uuid;
  clean_name text := nullif(trim(p_full_name), '');
  clean_email text := nullif(lower(trim(p_email)), '');
begin
  if actor_id is null or not coalesce(private.staff_role_for_current_user() in ('manager', 'admin'), false) then
    raise exception 'Not authorized';
  end if;
  if clean_name is null or length(clean_name) > 160
    or length(coalesce(clean_email, '')) > 254
    or (clean_email is not null and clean_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
    or length(coalesce(p_phone, '')) > 40 or length(coalesce(p_city, '')) > 120 then
    raise exception 'Invalid client details';
  end if;

  insert into public.clients (full_name, email, phone, city)
  values (clean_name, clean_email, nullif(trim(p_phone), ''), nullif(trim(p_city), ''))
  returning id into new_id;
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action)
  values (actor_id, 'client', new_id, 'created');
  return new_id;
end;
$$;

create function public.admin_create_service(p_name text, p_stages text[])
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  new_service_id uuid := gen_random_uuid();
  new_version_id uuid;
  stage_title text;
  stage_index integer;
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  if nullif(trim(p_name), '') is null or length(trim(p_name)) > 160
    or coalesce(array_length(p_stages, 1), 0) not between 1 and 12 then
    raise exception 'Invalid service details';
  end if;
  for stage_index in 1..array_length(p_stages, 1) loop
    stage_title := nullif(trim(p_stages[stage_index]), '');
    if stage_title is null or length(stage_title) > 120 then
      raise exception 'Invalid stage title';
    end if;
  end loop;

  insert into public.service_templates (id, code, name)
  values (new_service_id, 'svc-' || replace(new_service_id::text, '-', ''), trim(p_name));
  insert into public.service_template_versions (service_id, version_no, published_at, created_by)
  values (new_service_id, 1, now(), actor_id) returning id into new_version_id;
  for stage_index in 1..array_length(p_stages, 1) loop
    insert into public.stage_templates (version_id, position, title)
    values (new_version_id, stage_index, trim(p_stages[stage_index]));
  end loop;
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
  values (actor_id, 'service_template', new_service_id, 'created', jsonb_build_object('version_id', new_version_id));
  return new_service_id;
end;
$$;

create function public.staff_create_case(p_client_id uuid, p_version_id uuid, p_title text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  first_stage_id uuid;
  new_id uuid;
  new_number text;
begin
  if actor_id is null or not coalesce(private.staff_role_for_current_user() in ('manager', 'admin'), false) then
    raise exception 'Not authorized';
  end if;
  if p_client_id is null or p_version_id is null
    or nullif(trim(p_title), '') is null or length(trim(p_title)) > 180 then
    raise exception 'Invalid case details';
  end if;
  if not exists (select 1 from public.clients where id = p_client_id) then
    raise exception 'Client card not found';
  end if;
  if not exists (select 1 from public.service_template_versions where id = p_version_id and published_at is not null) then
    raise exception 'Published service version not found';
  end if;
  select id into first_stage_id from public.stage_templates
  where version_id = p_version_id order by position limit 1;
  if first_stage_id is null then
    raise exception 'Service has no stages';
  end if;
  new_number := 'MS-' || to_char(now() at time zone 'Asia/Almaty', 'YYYY') || '-'
    || lpad(nextval('public.case_number_seq')::text, 6, '0');
  insert into public.cases (case_number, client_id, service_version_id, title, current_stage_id)
  values (new_number, p_client_id, p_version_id, trim(p_title), first_stage_id)
  returning id into new_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action)
  values (actor_id, new_id, 'case', new_id, 'created');
  return new_id;
end;
$$;

create function public.staff_change_case_stage(
  p_case_id uuid, p_expected_stage_id uuid, p_to_stage_id uuid,
  p_client_note text, p_change_reason text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  old_stage_id uuid;
  case_version_id uuid;
  case_status public.case_status;
  suspended boolean;
  old_position integer;
  new_position integer;
begin
  if actor_id is null or not private.is_staff_for_case(p_case_id) then
    raise exception 'Not authorized';
  end if;
  if p_case_id is null or p_to_stage_id is null
    or nullif(trim(p_client_note), '') is null or length(trim(p_client_note)) > 2000
    or length(coalesce(p_change_reason, '')) > 1000 then
    raise exception 'Invalid stage change';
  end if;

  select current_stage_id, service_version_id, status, is_suspended
  into old_stage_id, case_version_id, case_status, suspended
  from public.cases where id = p_case_id for update;
  if not found or case_status <> 'open' or suspended then
    raise exception 'Case is not active';
  end if;
  if old_stage_id is distinct from p_expected_stage_id then
    raise exception 'Case was changed by another user';
  end if;
  if old_stage_id is not distinct from p_to_stage_id then
    raise exception 'Stage is unchanged';
  end if;
  select st.position into new_position from public.stage_templates st
  where st.id = p_to_stage_id and st.version_id = case_version_id;
  if new_position is null then
    raise exception 'Stage does not belong to this service';
  end if;
  select position into old_position from public.stage_templates where id = old_stage_id;
  if old_position is not null and new_position < old_position
    and nullif(trim(p_change_reason), '') is null then
    raise exception 'Rollback reason is required';
  end if;

  update public.cases set current_stage_id = p_to_stage_id, updated_at = now()
  where id = p_case_id;
  insert into public.case_stage_events
    (case_id, from_stage_id, to_stage_id, actor_user_id, client_note, change_reason)
  values (p_case_id, old_stage_id, p_to_stage_id, actor_id, trim(p_client_note), nullif(trim(p_change_reason), ''));
  insert into public.audit_events
    (actor_user_id, case_id, entity_type, entity_id, action, before_data, after_data, reason)
  values (actor_id, p_case_id, 'case', p_case_id, 'stage_changed',
    jsonb_build_object('stage_id', old_stage_id), jsonb_build_object('stage_id', p_to_stage_id),
    nullif(trim(p_change_reason), ''));
end;
$$;

revoke all on function public.staff_create_client(text, text, text, text) from public, anon;
revoke all on function public.admin_create_service(text, text[]) from public, anon;
revoke all on function public.staff_create_case(uuid, uuid, text) from public, anon;
revoke all on function public.staff_change_case_stage(uuid, uuid, uuid, text, text) from public, anon;
grant execute on function public.staff_create_client(text, text, text, text) to authenticated;
grant execute on function public.admin_create_service(text, text[]) to authenticated;
grant execute on function public.staff_create_case(uuid, uuid, text) to authenticated;
grant execute on function public.staff_change_case_stage(uuid, uuid, uuid, text, text) to authenticated;
