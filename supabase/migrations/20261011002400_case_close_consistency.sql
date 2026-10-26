-- A service version's document checklist is instantiated with every new case.
create or replace function public.staff_create_case(p_client_id uuid, p_version_id uuid, p_title text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid; actor_id uuid := auth.uid(); assignment_id uuid;
  template public.document_templates%rowtype; request_id uuid; client_user_id uuid;
begin
  perform 1 from public.staff_members where user_id = actor_id for update;
  if private.staff_role_for_current_user() not in ('manager', 'admin') then raise exception 'Not authorized'; end if;
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

-- Existing open cases may have been created before template instantiation existed.
with missing as (
  insert into public.document_requests (case_id, template_id, title, instructions, required)
    select c.id, dt.id, dt.title, dt.instructions, dt.required
    from public.cases c join public.document_templates dt on dt.version_id = c.service_version_id
    where c.status = 'open' and not exists (
      select 1 from public.document_requests dr where dr.case_id = c.id and dr.template_id = dt.id
    )
    returning id, case_id, template_id, required
)
insert into public.audit_events (case_id, entity_type, entity_id, action, after_data)
  select case_id, 'document_request', id, 'created_from_template_backfill',
    jsonb_build_object('template_id', template_id, 'required', required) from missing;

-- Serialize legal work on the case row with closure. Private implementations
-- recheck the open status after that lock is acquired.
create or replace function public.staff_create_document_request(
  p_case_id uuid, p_title text, p_instructions text default null,
  p_required boolean default true, p_due_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not private.lock_legal_case_editor(p_case_id) then raise exception 'Not authorized'; end if;
  perform 1 from public.cases where id = p_case_id for update;
  return private.staff_create_document_request(p_case_id, p_title, p_instructions, p_required, p_due_at);
end;
$$;

create or replace function public.staff_create_task(
  p_case_id uuid, p_kind public.task_kind, p_title text,
  p_description text default null, p_due_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not private.lock_legal_case_editor(p_case_id) then raise exception 'Not authorized'; end if;
  perform 1 from public.cases where id = p_case_id for update;
  return private.staff_create_task(p_case_id, p_kind, p_title, p_description, p_due_at);
end;
$$;

create or replace function public.staff_review_task(p_task_id uuid, p_accept boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare case_id uuid; case_state public.cases%rowtype;
begin
  select t.case_id into case_id from public.tasks t where t.id = p_task_id;
  if case_id is null or not private.lock_legal_case_editor(case_id) then raise exception 'Not authorized'; end if;
  select * into case_state from public.cases where id = case_id for update;
  if not found or case_state.status <> 'open' or case_state.is_suspended then
    raise exception 'Case is not active';
  end if;
  perform private.staff_review_task(p_task_id, p_accept, p_note);
end;
$$;

create or replace function public.staff_close_case(p_case_id uuid, p_result_summary text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); item public.cases%rowtype; pending_task record;
  clean_result text := nullif(trim(p_result_summary), ''); client_user_id uuid;
begin
  if not private.lock_legal_case_editor(p_case_id) then raise exception 'Not authorized'; end if;
  select * into item from public.cases where id = p_case_id for update;
  if not found or item.status <> 'open' or item.is_suspended then raise exception 'Case cannot be closed'; end if;
  if clean_result is null or length(clean_result) > 4000 then raise exception 'Result summary is required'; end if;
  if exists (
    select 1 from public.document_requests dr
    where dr.case_id = p_case_id and dr.required and dr.status = 'active'
      and not exists (select 1 from public.document_files df
        where df.request_id = dr.id and df.status = 'accepted')
  ) or exists (
    select 1 from public.document_templates dt
    where dt.version_id = item.service_version_id and dt.required
      and not exists (select 1 from public.document_requests dr
        join public.document_files df on df.request_id = dr.id and df.status = 'accepted'
        where dr.case_id = p_case_id and dr.template_id = dt.id and dr.status = 'active')
  ) then raise exception 'Required documents are not accepted'; end if;
  update public.cases set status = 'closed', result_summary = clean_result,
    closed_at = clock_timestamp(), next_review_at = null, updated_at = clock_timestamp()
    where id = p_case_id;
  for pending_task in select id, status from public.tasks
    where case_id = p_case_id and status in ('new', 'response_sent') for update loop
    update public.tasks set status = 'cancelled', updated_at = clock_timestamp()
      where id = pending_task.id;
    insert into public.task_events (task_id, actor_user_id, action, response_text)
      values (pending_task.id, actor_id, 'cancelled', 'Дело завершено');
    insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, before_data, after_data)
      values (actor_id, p_case_id, 'task', pending_task.id, 'cancelled_on_case_close',
        jsonb_build_object('status', pending_task.status), jsonb_build_object('status', 'cancelled'));
  end loop;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
    values (actor_id, p_case_id, 'case', p_case_id, 'closed',
      jsonb_build_object('result_summary', clean_result));
  select cl.user_id into client_user_id from public.clients cl where cl.id = item.client_id;
  if client_user_id is not null then
    insert into public.notifications (recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
      values (client_user_id, p_case_id, 'case_status', 'Дело завершено', clean_result,
        '/account/cases/' || p_case_id::text, 'case-closed:' || p_case_id::text)
      on conflict (recipient_user_id, dedupe_key) do nothing;
  end if;
end;
$$;
