-- An acknowledgment records exactly which task text the client saw. It is not an e-signature.
alter table public.task_events add column acknowledged_text text;

create or replace function public.staff_create_task(
  p_case_id uuid, p_kind public.task_kind, p_title text,
  p_description text default null, p_due_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not private.lock_legal_case_editor(p_case_id) then raise exception 'Not authorized'; end if;
  if p_kind = 'acknowledge' and nullif(trim(p_description), '') is null then
    raise exception 'Acknowledgment text is required';
  end if;
  perform 1 from public.cases where id = p_case_id for update;
  return private.staff_create_task(p_case_id, p_kind, p_title, p_description, p_due_at);
end;
$$;

create or replace function public.client_respond_task(p_task_id uuid, p_response text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); item public.tasks%rowtype;
  response_body text := nullif(trim(p_response), ''); staff_id uuid; event_id uuid;
begin
  select * into item from public.tasks where id = p_task_id for update;
  if actor_id is null or not found or not exists (
    select 1 from public.cases c join public.clients cl on cl.id = c.client_id
    where c.id = item.case_id and cl.user_id = actor_id and c.status = 'open' and not c.is_suspended
  ) then raise exception 'Not authorized'; end if;
  if item.status <> 'new' or item.kind in ('upload_document', 'acknowledge')
    or response_body is null or length(response_body) > 2000 then
    raise exception 'Invalid task response';
  end if;
  update public.tasks set status = 'response_sent', updated_at = now() where id = p_task_id;
  insert into public.task_events (task_id, actor_user_id, action, response_text)
  values (p_task_id, actor_id, 'responded', response_body) returning id into event_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action)
  values (actor_id, item.case_id, 'task', p_task_id, 'responded');
  for staff_id in select ca.staff_user_id from public.case_assignments ca
    where ca.case_id = item.case_id and ca.revoked_at is null loop
    insert into public.notifications (recipient_user_id, case_id, kind, title, target_path, dedupe_key)
    values (staff_id, item.case_id, 'task_response', 'Ответ клиента на задачу',
      '/staff/cases/' || item.case_id || '/tasks', 'task-response:' || event_id);
  end loop;
end;
$$;

create function public.client_acknowledge_task(p_task_id uuid, p_expected_version text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); target_case_id uuid; case_row public.cases%rowtype;
  item public.tasks%rowtype; snapshot text; version text; event_id uuid; staff_id uuid;
begin
  if actor_id is null or p_task_id is null then raise exception 'Not authorized'; end if;
  select case_id into target_case_id from public.tasks where id = p_task_id;
  if target_case_id is null then raise exception 'Not authorized'; end if;
  select * into case_row from public.cases where id = target_case_id for update;
  if not found or case_row.status <> 'open' or case_row.is_suspended or not exists (
    select 1 from public.clients cl where cl.id = case_row.client_id and cl.user_id = actor_id
  ) then raise exception 'Not authorized'; end if;
  select * into item from public.tasks where id = p_task_id for update;
  if not found or item.case_id <> target_case_id or item.kind <> 'acknowledge' then
    raise exception 'Invalid acknowledgment';
  end if;
  snapshot := item.title || E'\n' || coalesce(item.description, '');
  version := encode(pg_catalog.sha256(convert_to(snapshot, 'UTF8')), 'hex');
  if p_expected_version is distinct from version then
    raise exception 'Acknowledgment text changed';
  end if;
  if item.status in ('response_sent', 'completed') and exists (
    select 1 from public.task_events te where te.task_id = p_task_id
      and te.actor_user_id = actor_id and te.action = 'acknowledged'
      and te.acknowledged_version = version
  ) then return; end if;
  if item.status <> 'new' then raise exception 'Invalid acknowledgment'; end if;
  update public.tasks set status = 'response_sent', updated_at = now() where id = p_task_id;
  insert into public.task_events (
    task_id, actor_user_id, action, acknowledged_version, acknowledged_text
  ) values (p_task_id, actor_id, 'acknowledged', version, snapshot)
    returning id into event_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
    values (actor_id, target_case_id, 'task', p_task_id, 'acknowledged',
      jsonb_build_object('version', version, 'event_id', event_id));
  for staff_id in select ca.staff_user_id from public.case_assignments ca
    where ca.case_id = target_case_id and ca.revoked_at is null loop
    insert into public.notifications (recipient_user_id, case_id, kind, title, target_path, dedupe_key)
      values (staff_id, target_case_id, 'task_response', 'Клиент ознакомился с задачей',
        '/staff/cases/' || target_case_id || '/tasks', 'task-acknowledged:' || event_id);
  end loop;
end;
$$;
revoke all on function public.client_acknowledge_task(uuid, text) from public, anon;
grant execute on function public.client_acknowledge_task(uuid, text) to authenticated;
