-- Keep message retries idempotent while preventing new correspondence after
-- a case is suspended, closed, or cancelled. The case row lock serializes a
-- send with case lifecycle changes.
create or replace function public.post_case_message(
  p_case_id uuid, p_body text, p_idempotency_key text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  new_id uuid;
  prior public.messages%rowtype;
  case_status public.case_status;
  suspended boolean;
  client_user_id uuid;
  is_client boolean;
begin
  if actor_id is null or not private.can_read_case(p_case_id) then raise exception 'Not authorized'; end if;
  if nullif(trim(p_body), '') is null or length(trim(p_body)) > 4000
    or nullif(trim(p_idempotency_key), '') is null or length(trim(p_idempotency_key)) > 100 then
    raise exception 'Invalid message';
  end if;

  -- Match the attachment wrapper and rate-limit trigger's actor lock so a
  -- concurrent request cannot turn a retry into a different message.
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text, 0));
  select c.status, c.is_suspended into case_status, suspended
    from public.cases c where c.id = p_case_id for update;
  if not found then raise exception 'Not authorized'; end if;

  select * into prior from public.messages
    where case_id = p_case_id and sender_user_id = actor_id
      and idempotency_key = trim(p_idempotency_key);
  if found then
    if prior.body <> trim(p_body) then raise exception 'Message key cannot be reused'; end if;
    return prior.id;
  end if;
  if case_status <> 'open' or suspended then raise exception 'Case is not active'; end if;

  select cl.user_id into client_user_id from public.cases c
    join public.clients cl on cl.id = c.client_id where c.id = p_case_id;
  is_client := actor_id = client_user_id;
  if not is_client and not private.is_staff_for_case(p_case_id) then raise exception 'Not authorized'; end if;
  insert into public.messages (case_id, sender_user_id, body, idempotency_key)
  values (p_case_id, actor_id, trim(p_body), trim(p_idempotency_key))
  returning id into new_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action)
  values (actor_id, p_case_id, 'message', new_id, 'sent');
  if is_client then
    perform private.notify_case_staff_or_admins(p_case_id, 'message',
      'Новое сообщение от клиента', 'messages', 'message:' || new_id::text);
  elsif client_user_id is not null then
    insert into public.notifications (recipient_user_id, case_id, kind, title, target_path, dedupe_key)
    values (client_user_id, p_case_id, 'message', 'Новое сообщение по делу',
      '/account/cases/' || p_case_id || '/messages', 'message:' || new_id);
  end if;
  return new_id;
end;
$$;
