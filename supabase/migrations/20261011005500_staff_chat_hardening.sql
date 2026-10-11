-- Keep inactive colleagues discoverable only to people who already share a thread.
create or replace function public.staff_directory()
returns table(user_id uuid, display_name text, role public.staff_role, active boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.staff_role_for_current_user() is null then
    raise exception 'Not authorized';
  end if;
  return query
    select s.user_id, s.display_name, s.role, s.active from public.staff_members s
    where s.user_id <> auth.uid() and (
      s.active or exists (
        select 1 from public.staff_threads t
        where (t.user_low = auth.uid() and t.user_high = s.user_id)
          or (t.user_high = auth.uid() and t.user_low = s.user_id)
      )
    )
    order by s.display_name, s.user_id;
end;
$$;

create or replace function public.staff_open_thread(p_recipient_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); found_id uuid;
begin
  if actor_id is null or p_recipient_user_id is null or actor_id = p_recipient_user_id
    or private.staff_role_for_current_user() is null
    or not exists (select 1 from public.staff_members s where s.user_id = p_recipient_user_id and s.active) then
    raise exception 'Not authorized';
  end if;
  insert into public.staff_threads (user_low, user_high)
    values (least(actor_id, p_recipient_user_id), greatest(actor_id, p_recipient_user_id))
    on conflict (user_low, user_high) do nothing returning id into found_id;
  if found_id is not null then
    insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
      values (actor_id, 'staff_thread', found_id, 'created',
        jsonb_build_object('recipient_user_id', p_recipient_user_id));
    return found_id;
  end if;
  select t.id into found_id from public.staff_threads t
    where t.user_low = least(actor_id, p_recipient_user_id)
      and t.user_high = greatest(actor_id, p_recipient_user_id);
  return found_id;
end;
$$;

create or replace function public.staff_send_message(p_thread_id uuid, p_body text, p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); thread_row public.staff_threads%rowtype;
  recipient_id uuid; result_id uuid; prior_body text; clean_body text := btrim(p_body);
begin
  if actor_id is null or p_thread_id is null or p_idempotency_key is null
    or clean_body is null or length(clean_body) not between 1 and 4000 then
    raise exception 'Invalid message';
  end if;
  select * into thread_row from public.staff_threads where id = p_thread_id;
  if not found or not private.can_read_staff_thread(p_thread_id) then raise exception 'Not authorized'; end if;
  recipient_id := case when thread_row.user_low = actor_id then thread_row.user_high else thread_row.user_low end;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text, 0));
  select id, body into result_id, prior_body from public.staff_messages
    where thread_id = p_thread_id and sender_user_id = actor_id and idempotency_key = p_idempotency_key;
  if result_id is not null then
    if prior_body <> clean_body then raise exception 'Message retry conflict'; end if;
    return result_id;
  end if;
  if not exists (select 1 from public.staff_members s where s.user_id = recipient_id and s.active) then
    raise exception 'Recipient inactive';
  end if;
  if (select count(*) from public.staff_messages where sender_user_id = actor_id
    and created_at >= now() - interval '1 minute') >= 20
    or (select count(*) from public.staff_messages where sender_user_id = actor_id
      and created_at >= now() - interval '1 day') >= 300 then
    raise exception 'Message rate limit exceeded';
  end if;
  insert into public.staff_messages (thread_id, sender_user_id, body, idempotency_key)
    values (p_thread_id, actor_id, clean_body, p_idempotency_key) returning id into result_id;
  update public.staff_threads set last_message_at = now() where id = p_thread_id;
  insert into public.notifications (recipient_user_id, kind, title, body, target_path, dedupe_key)
    select recipient_id, 'staff_message', 'Сообщение от коллеги', s.display_name,
      '/staff/chat?to=' || actor_id::text, 'staff-message:' || result_id::text
      from public.staff_members s where s.user_id = actor_id;
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
    values (actor_id, 'staff_message', result_id, 'sent',
      jsonb_build_object('thread_id', p_thread_id, 'recipient_user_id', recipient_id));
  return result_id;
end;
$$;
