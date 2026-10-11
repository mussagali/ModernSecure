-- New cases use only the newest published version of an active service.
create function public.available_service_versions()
returns table (version_id uuid, service_name text, version_no integer)
language sql stable security definer set search_path = '' as $$
  select distinct on (s.id) v.id, s.name, v.version_no
    from public.service_templates s
    join public.service_template_versions v on v.service_id = s.id
    where s.active and v.published_at is not null
      and private.staff_role_for_current_user() in ('manager', 'admin')
    order by s.id, v.version_no desc
$$;
revoke all on function public.available_service_versions() from public, anon;
grant execute on function public.available_service_versions() to authenticated;

create or replace function public.staff_create_case(p_client_id uuid, p_version_id uuid, p_title text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid; actor_id uuid := auth.uid(); assignment_id uuid;
  template public.document_templates%rowtype; request_id uuid; client_user_id uuid;
  target_service_id uuid; current_version_id uuid;
begin
  perform 1 from public.staff_members where user_id = actor_id for update;
  if private.staff_role_for_current_user() not in ('manager', 'admin') then raise exception 'Not authorized'; end if;
  select v.service_id into target_service_id from public.service_template_versions v where v.id = p_version_id;
  if target_service_id is null then raise exception 'Service version not found'; end if;
  perform 1 from public.service_templates s where s.id = target_service_id and s.active for update;
  if not found then raise exception 'Service is inactive'; end if;
  select v.id into current_version_id from public.service_template_versions v
    where v.service_id = target_service_id and v.published_at is not null
    order by v.version_no desc limit 1;
  if current_version_id is distinct from p_version_id then raise exception 'Service version is outdated'; end if;
  new_id := private.staff_create_case(p_client_id, p_version_id, p_title);
  if private.staff_role_for_current_user() = 'manager' then
    insert into public.case_assignments (case_id, staff_user_id, assigned_by)
      values (new_id, actor_id, actor_id) returning id into assignment_id;
    insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
      values (actor_id, new_id, 'case_assignment', assignment_id, 'created',
        jsonb_build_object('staff_user_id', actor_id));
  end if;
  for template in select * from public.document_templates
    where version_id = p_version_id order by position loop
    insert into public.document_requests (case_id, template_id, title, instructions, required, created_by)
      values (new_id, template.id, template.title, template.instructions, template.required, actor_id)
      returning id into request_id;
    insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
      values (actor_id, new_id, 'document_request', request_id, 'created_from_template',
        jsonb_build_object('template_id', template.id, 'required', template.required));
  end loop;
  if request_id is not null then
    select user_id into client_user_id from public.clients where id = p_client_id;
    if client_user_id is not null then
      insert into public.notifications (recipient_user_id, case_id, kind, title, target_path, dedupe_key)
        values (client_user_id, new_id, 'document_request', 'Документы по новому делу',
          '/account/cases/' || new_id::text || '/documents', 'service-documents:' || new_id::text)
        on conflict (recipient_user_id, dedupe_key) do nothing;
    end if;
  end if;
  return new_id;
end;
$$;

-- Existing overload is no longer callable by browser roles: a fresh version
-- must include the version the administrator actually reviewed in the form.
revoke all on function public.admin_publish_service_version(uuid, text[], jsonb) from public, anon, authenticated;
create function public.admin_publish_service_version(
  p_service_id uuid, p_expected_version_id uuid, p_stages text[], p_documents jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); service public.service_templates%rowtype;
  new_version_id uuid; current_version_id uuid; next_version integer; stage_index integer;
  clean_stage text; seen_stages text[] := array[]::text[]; document_count integer;
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  select * into service from public.service_templates where id = p_service_id for update;
  if not found or not service.active then raise exception 'Active service not found'; end if;
  select v.id into current_version_id from public.service_template_versions v
    where v.service_id = p_service_id and v.published_at is not null
    order by v.version_no desc limit 1;
  if p_expected_version_id is null or current_version_id is distinct from p_expected_version_id then
    raise exception 'Service version changed by another user';
  end if;
  if coalesce(array_length(p_stages, 1), 0) not between 1 and 12 then
    raise exception 'Invalid stages';
  end if;
  for stage_index in 1..array_length(p_stages, 1) loop
    clean_stage := nullif(trim(p_stages[stage_index]), '');
    if clean_stage is null or length(clean_stage) > 120 or lower(clean_stage) = any(seen_stages) then
      raise exception 'Invalid stage title';
    end if;
    seen_stages := array_append(seen_stages, lower(clean_stage));
  end loop;
  select coalesce(max(version_no), 0) + 1 into next_version
    from public.service_template_versions where service_id = p_service_id;
  insert into public.service_template_versions (service_id, version_no, created_by)
    values (p_service_id, next_version, actor_id) returning id into new_version_id;
  for stage_index in 1..array_length(p_stages, 1) loop
    insert into public.stage_templates (version_id, position, title)
      values (new_version_id, stage_index, trim(p_stages[stage_index]));
  end loop;
  document_count := private.insert_service_documents(new_version_id, p_documents);
  update public.service_template_versions set published_at = clock_timestamp()
    where id = new_version_id;
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
    values (actor_id, 'service_template_version', new_version_id, 'published',
      jsonb_build_object('service_id', p_service_id, 'version_no', next_version,
        'stage_count', array_length(p_stages, 1), 'document_count', document_count));
  return new_version_id;
end;
$$;
revoke all on function public.admin_publish_service_version(uuid, uuid, text[], jsonb) from public, anon;
grant execute on function public.admin_publish_service_version(uuid, uuid, text[], jsonb) to authenticated;
