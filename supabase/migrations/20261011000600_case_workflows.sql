-- Case-scoped operations. The database, not a rendered form, enforces ownership.
create function public.staff_assign_case(p_case_id uuid, p_staff_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); new_id uuid;
begin
  if actor_id is null or not coalesce(private.staff_role_for_current_user() in ('manager', 'admin'), false) then
    raise exception 'Not authorized';
  end if;
  if not exists (select 1 from public.cases where id = p_case_id)
    or not exists (select 1 from public.staff_members where user_id = p_staff_user_id and active) then
    raise exception 'Case or staff member not found';
  end if;
  insert into public.case_assignments (case_id, staff_user_id, assigned_by)
  values (p_case_id, p_staff_user_id, actor_id)
  on conflict (case_id, staff_user_id) where revoked_at is null do nothing
  returning id into new_id;
  if new_id is null then raise exception 'Already assigned'; end if;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
  values (actor_id, p_case_id, 'case_assignment', new_id, 'created', jsonb_build_object('staff_user_id', p_staff_user_id));
  insert into public.notifications (recipient_user_id, case_id, kind, title, target_path, dedupe_key)
  values (p_staff_user_id, p_case_id, 'case_assignment', 'Вам назначено дело', '/staff/cases/' || p_case_id, 'assignment:' || new_id);
  return new_id;
end;
$$;

create function public.staff_create_task(p_case_id uuid, p_kind public.task_kind, p_title text, p_description text default null, p_due_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); new_id uuid; client_user_id uuid;
begin
  if actor_id is null or not private.is_staff_for_case(p_case_id) then raise exception 'Not authorized'; end if;
  if p_kind is null or p_kind = 'upload_document' or nullif(trim(p_title), '') is null
    or length(trim(p_title)) > 180 or length(coalesce(p_description, '')) > 2000 then
    raise exception 'Invalid task';
  end if;
  if not exists (select 1 from public.cases where id = p_case_id and status = 'open' and not is_suspended) then
    raise exception 'Case is not active';
  end if;
  insert into public.tasks (case_id, kind, title, description, due_at, created_by)
  values (p_case_id, p_kind, trim(p_title), nullif(trim(p_description), ''), p_due_at, actor_id)
  returning id into new_id;
  insert into public.task_events (task_id, actor_user_id, action) values (new_id, actor_id, 'created');
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action)
  values (actor_id, p_case_id, 'task', new_id, 'created');
  select cl.user_id into client_user_id from public.cases c join public.clients cl on cl.id = c.client_id where c.id = p_case_id;
  if client_user_id is not null then
    insert into public.notifications (recipient_user_id, case_id, kind, title, target_path, dedupe_key)
    values (client_user_id, p_case_id, 'task', 'Новая задача: ' || trim(p_title), '/account/cases/' || p_case_id || '/tasks', 'task:' || new_id);
  end if;
  return new_id;
end;
$$;

create function public.client_respond_task(p_task_id uuid, p_response text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); item public.tasks%rowtype; response_body text := nullif(trim(p_response), ''); staff_id uuid; event_id uuid;
begin
  select * into item from public.tasks where id = p_task_id for update;
  if actor_id is null or not found or not exists (
    select 1 from public.cases c join public.clients cl on cl.id = c.client_id
    where c.id = item.case_id and cl.user_id = actor_id and c.status = 'open' and not c.is_suspended
  ) then raise exception 'Not authorized'; end if;
  if item.status <> 'new' or item.kind = 'upload_document' or response_body is null or length(response_body) > 2000 then
    raise exception 'Invalid task response';
  end if;
  update public.tasks set status = 'response_sent', updated_at = now() where id = p_task_id;
  insert into public.task_events (task_id, actor_user_id, action, response_text)
  values (p_task_id, actor_id, case when item.kind = 'acknowledge' then 'acknowledged' else 'responded' end, response_body)
  returning id into event_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action)
  values (actor_id, item.case_id, 'task', p_task_id, 'responded');
  for staff_id in select ca.staff_user_id from public.case_assignments ca where ca.case_id = item.case_id and ca.revoked_at is null loop
    insert into public.notifications (recipient_user_id, case_id, kind, title, target_path, dedupe_key)
    values (staff_id, item.case_id, 'task_response', 'Ответ клиента на задачу', '/staff/cases/' || item.case_id || '/tasks', 'task-response:' || event_id);
  end loop;
end;
$$;

create function public.staff_review_task(p_task_id uuid, p_accept boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); item public.tasks%rowtype; client_user_id uuid; clean_note text := nullif(trim(p_note), '');
begin
  select * into item from public.tasks where id = p_task_id for update;
  if actor_id is null or not found or not private.is_staff_for_case(item.case_id) then raise exception 'Not authorized'; end if;
  if item.status <> 'response_sent' or (not p_accept and clean_note is null) or length(coalesce(clean_note, '')) > 2000 then
    raise exception 'Invalid task review';
  end if;
  update public.tasks set status = case when p_accept then 'completed'::public.task_status else 'new'::public.task_status end,
    completed_by = case when p_accept then actor_id else null end,
    completed_at = case when p_accept then now() else null end, updated_at = now() where id = p_task_id;
  insert into public.task_events (task_id, actor_user_id, action, response_text)
  values (p_task_id, actor_id, case when p_accept then 'completed' else 'returned' end, clean_note);
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, reason)
  values (actor_id, item.case_id, 'task', p_task_id, case when p_accept then 'completed' else 'returned' end, clean_note);
  select cl.user_id into client_user_id from public.cases c join public.clients cl on cl.id = c.client_id where c.id = item.case_id;
  if client_user_id is not null then
    insert into public.notifications (recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
    values (client_user_id, item.case_id, 'task_review', case when p_accept then 'Задача выполнена' else 'Задача возвращена' end,
      clean_note, '/account/cases/' || item.case_id || '/tasks', 'task-review:' || p_task_id || ':' || gen_random_uuid());
  end if;
end;
$$;

create function public.staff_create_document_request(p_case_id uuid, p_title text, p_instructions text default null, p_required boolean default true, p_due_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); new_id uuid; client_user_id uuid;
begin
  if actor_id is null or not private.is_staff_for_case(p_case_id) then raise exception 'Not authorized'; end if;
  if nullif(trim(p_title), '') is null or length(trim(p_title)) > 180 or length(coalesce(p_instructions, '')) > 2000 then
    raise exception 'Invalid document request';
  end if;
  if not exists (select 1 from public.cases where id = p_case_id and status = 'open' and not is_suspended) then
    raise exception 'Case is not active';
  end if;
  insert into public.document_requests (case_id, title, instructions, required, due_at, assigned_staff_id, created_by)
  values (p_case_id, trim(p_title), nullif(trim(p_instructions), ''), coalesce(p_required, true), p_due_at, actor_id, actor_id)
  returning id into new_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action)
  values (actor_id, p_case_id, 'document_request', new_id, 'created');
  select cl.user_id into client_user_id from public.cases c join public.clients cl on cl.id = c.client_id where c.id = p_case_id;
  if client_user_id is not null then
    insert into public.notifications (recipient_user_id, case_id, kind, title, target_path, dedupe_key)
    values (client_user_id, p_case_id, 'document_request', 'Запрошен документ: ' || trim(p_title), '/account/cases/' || p_case_id || '/documents', 'document-request:' || new_id);
  end if;
  return new_id;
end;
$$;

create function public.post_case_message(p_case_id uuid, p_body text, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); new_id uuid; client_user_id uuid; staff_id uuid; is_client boolean;
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
    for staff_id in select ca.staff_user_id from public.case_assignments ca where ca.case_id = p_case_id and ca.revoked_at is null loop
      insert into public.notifications (recipient_user_id, case_id, kind, title, target_path, dedupe_key)
      values (staff_id, p_case_id, 'message', 'Новое сообщение от клиента', '/staff/cases/' || p_case_id || '/messages', 'message:' || new_id);
    end loop;
  elsif client_user_id is not null then
    insert into public.notifications (recipient_user_id, case_id, kind, title, target_path, dedupe_key)
    values (client_user_id, p_case_id, 'message', 'Новое сообщение по делу', '/account/cases/' || p_case_id || '/messages', 'message:' || new_id);
  end if;
  return new_id;
end;
$$;

create function public.mark_case_messages_read(p_case_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); marked integer;
begin
  if actor_id is null or not private.can_read_case(p_case_id) then raise exception 'Not authorized'; end if;
  insert into public.message_reads (message_id, reader_user_id)
  select m.id, actor_id from public.messages m
  where m.case_id = p_case_id and m.sender_user_id <> actor_id
  on conflict (message_id, reader_user_id) do nothing;
  get diagnostics marked = row_count;
  update public.notifications set read_at = now()
  where recipient_user_id = actor_id and case_id = p_case_id and kind = 'message' and read_at is null;
  return marked;
end;
$$;

create function public.mark_case_notifications_read(p_case_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); marked integer;
begin
  if actor_id is null or not private.can_read_case(p_case_id) then raise exception 'Not authorized'; end if;
  update public.notifications set read_at = now()
  where recipient_user_id = actor_id and case_id = p_case_id and read_at is null;
  get diagnostics marked = row_count;
  return marked;
end;
$$;

-- Stage events must also surface in the same client inbox.
create function private.notify_case_stage()
returns trigger language plpgsql security definer set search_path = '' as $$
declare client_user_id uuid;
begin
  select cl.user_id into client_user_id from public.cases c join public.clients cl on cl.id = c.client_id where c.id = new.case_id;
  if client_user_id is not null then
    insert into public.notifications (recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
    values (client_user_id, new.case_id, 'stage', 'Этап дела обновлён', new.client_note,
      '/account/cases/' || new.case_id, 'stage:' || new.id);
  end if;
  return new;
end;
$$;
create trigger modernsecure_case_stage_notify after insert on public.case_stage_events
for each row execute function private.notify_case_stage();
revoke all on function private.notify_case_stage() from public, anon, authenticated;

revoke all on function public.staff_assign_case(uuid, uuid) from public, anon;
revoke all on function public.staff_create_task(uuid, public.task_kind, text, text, timestamptz) from public, anon;
revoke all on function public.client_respond_task(uuid, text) from public, anon;
revoke all on function public.staff_review_task(uuid, boolean, text) from public, anon;
revoke all on function public.staff_create_document_request(uuid, text, text, boolean, timestamptz) from public, anon;
revoke all on function public.post_case_message(uuid, text, text) from public, anon;
revoke all on function public.mark_case_messages_read(uuid) from public, anon;
revoke all on function public.mark_case_notifications_read(uuid) from public, anon;
grant execute on function public.staff_assign_case(uuid, uuid) to authenticated;
grant execute on function public.staff_create_task(uuid, public.task_kind, text, text, timestamptz) to authenticated;
grant execute on function public.client_respond_task(uuid, text) to authenticated;
grant execute on function public.staff_review_task(uuid, boolean, text) to authenticated;
grant execute on function public.staff_create_document_request(uuid, text, text, boolean, timestamptz) to authenticated;
grant execute on function public.post_case_message(uuid, text, text) to authenticated;
grant execute on function public.mark_case_messages_read(uuid) to authenticated;
grant execute on function public.mark_case_notifications_read(uuid) to authenticated;
