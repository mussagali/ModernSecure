-- An admin-created case can receive client activity before its first assignment.
-- Once handed off, notify active assignees only; inactive/revoked staff have no case access.
create function private.notify_case_staff_or_admins(
  p_case_id uuid, p_kind text, p_title text, p_section text, p_dedupe_key text
) returns void language sql security definer set search_path = '' as $$
  with assignees as (
    select distinct sm.user_id
    from public.case_assignments ca
    join public.staff_members sm on sm.user_id = ca.staff_user_id
    where ca.case_id = p_case_id and ca.revoked_at is null and sm.active
  ), recipients as (
    select user_id from assignees
    union
    select sm.user_id from public.staff_members sm
    where sm.active and sm.role = 'admin' and not exists (select 1 from assignees)
  )
  insert into public.notifications
    (recipient_user_id, case_id, kind, title, target_path, dedupe_key)
  select r.user_id, p_case_id, p_kind, p_title,
    '/staff/cases/' || p_case_id::text || '/' || p_section, p_dedupe_key
  from recipients r
  on conflict (recipient_user_id, dedupe_key) do nothing
$$;
revoke all on function private.notify_case_staff_or_admins(uuid, text, text, text, text)
  from public, anon, authenticated;

create or replace function public.post_case_message(p_case_id uuid, p_body text, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); new_id uuid; client_user_id uuid; is_client boolean;
begin
  if actor_id is null or not private.can_read_case(p_case_id) then raise exception 'Not authorized'; end if;
  if nullif(trim(p_body), '') is null or length(trim(p_body)) > 4000
    or nullif(trim(p_idempotency_key), '') is null or length(trim(p_idempotency_key)) > 100 then
    raise exception 'Invalid message';
  end if;
  select cl.user_id into client_user_id from public.cases c join public.clients cl on cl.id = c.client_id where c.id = p_case_id;
  is_client := actor_id = client_user_id;
  if not is_client and not private.is_staff_for_case(p_case_id) then raise exception 'Not authorized'; end if;
  insert into public.messages (case_id, sender_user_id, body, idempotency_key)
  values (p_case_id, actor_id, trim(p_body), trim(p_idempotency_key))
  on conflict (case_id, sender_user_id, idempotency_key) do nothing returning id into new_id;
  if new_id is null then
    select id into new_id from public.messages where case_id = p_case_id and sender_user_id = actor_id and idempotency_key = trim(p_idempotency_key);
    return new_id;
  end if;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action)
  values (actor_id, p_case_id, 'message', new_id, 'sent');
  if is_client then
    perform private.notify_case_staff_or_admins(p_case_id, 'message',
      'Новое сообщение от клиента', 'messages', 'message:' || new_id::text);
  elsif client_user_id is not null then
    insert into public.notifications (recipient_user_id, case_id, kind, title, target_path, dedupe_key)
    values (client_user_id, p_case_id, 'message', 'Новое сообщение по делу', '/account/cases/' || p_case_id || '/messages', 'message:' || new_id);
  end if;
  return new_id;
end;
$$;

create or replace function public.client_respond_task(p_task_id uuid, p_response text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); item public.tasks%rowtype;
  response_body text := nullif(trim(p_response), ''); event_id uuid;
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
  perform private.notify_case_staff_or_admins(item.case_id, 'task_response',
    'Ответ клиента на задачу', 'tasks', 'task-response:' || event_id::text);
end;
$$;

create or replace function public.client_acknowledge_task(p_task_id uuid, p_expected_version text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); target_case_id uuid; case_row public.cases%rowtype;
  item public.tasks%rowtype; snapshot text; version text; event_id uuid;
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
  perform private.notify_case_staff_or_admins(target_case_id, 'task_response',
    'Клиент ознакомился с задачей', 'tasks', 'task-acknowledged:' || event_id::text);
end;
$$;
