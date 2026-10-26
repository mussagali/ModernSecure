-- Read only messages the recipient has actually received in the open dialog.
-- A timestamp set to now() could otherwise hide a message arriving between the
-- page response and the read RPC, including its notification.
alter table public.staff_thread_reads
  add column last_read_message_id uuid references public.staff_messages(id) on delete restrict;

with latest_seen as (
  select distinct on (r.thread_id, r.reader_user_id)
    r.thread_id, r.reader_user_id, m.id, m.created_at
  from public.staff_thread_reads r
  join public.staff_messages m on m.thread_id = r.thread_id and m.created_at <= r.read_at
  order by r.thread_id, r.reader_user_id, m.created_at desc, m.id desc
)
update public.staff_thread_reads r
set read_at = seen.created_at, last_read_message_id = seen.id
from latest_seen seen
where r.thread_id = seen.thread_id and r.reader_user_id = seen.reader_user_id;

alter table public.staff_thread_reads alter column read_at drop default;

drop function public.staff_mark_thread_read(uuid);
create function public.staff_mark_thread_read(p_thread_id uuid, p_through_message_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  seen_at timestamptz;
begin
  if actor_id is null or p_thread_id is null or p_through_message_id is null
    or not private.can_read_staff_thread(p_thread_id) then
    raise exception 'Not authorized';
  end if;
  select m.created_at into seen_at from public.staff_messages m
  where m.id = p_through_message_id and m.thread_id = p_thread_id;
  if not found then raise exception 'Message is not in this thread'; end if;

  insert into public.staff_thread_reads as state
    (thread_id, reader_user_id, read_at, last_read_message_id)
  values (p_thread_id, actor_id, seen_at, p_through_message_id)
  on conflict (thread_id, reader_user_id) do update
    set read_at = excluded.read_at, last_read_message_id = excluded.last_read_message_id
    where state.last_read_message_id is null
      or (state.read_at, state.last_read_message_id) <
        (excluded.read_at, excluded.last_read_message_id);

  update public.notifications n set read_at = now()
  from public.staff_messages m
  where m.thread_id = p_thread_id and m.sender_user_id <> actor_id
    and (m.created_at, m.id) <= (seen_at, p_through_message_id)
    and n.recipient_user_id = actor_id and n.kind = 'staff_message'
    and n.dedupe_key = 'staff-message:' || m.id::text and n.read_at is null;
end;
$$;
revoke all on function public.staff_mark_thread_read(uuid, uuid) from public, anon;
grant execute on function public.staff_mark_thread_read(uuid, uuid) to authenticated;

create or replace function public.staff_chat_sidebar()
returns table(
  user_id uuid,
  display_name text,
  role public.staff_role,
  active boolean,
  thread_id uuid,
  last_message_at timestamptz,
  last_message_body text,
  unread_count bigint
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.staff_role_for_current_user() is null then
    raise exception 'Not authorized';
  end if;
  return query
    select s.user_id, s.display_name, s.role, s.active, t.id,
      coalesce(last_message.created_at, t.last_message_at), last_message.body,
      coalesce(unread.count, 0)::bigint
    from public.staff_members s
    left join public.staff_threads t
      on t.user_low = least(auth.uid(), s.user_id)
      and t.user_high = greatest(auth.uid(), s.user_id)
    left join lateral (
      select m.body, m.created_at from public.staff_messages m
      where m.thread_id = t.id
      order by m.created_at desc, m.id desc limit 1
    ) last_message on true
    left join public.staff_thread_reads read_state
      on read_state.thread_id = t.id and read_state.reader_user_id = auth.uid()
    left join lateral (
      select count(*) as count from public.staff_messages m
      where m.thread_id = t.id and m.sender_user_id <> auth.uid()
        and (read_state.last_read_message_id is null
          or (m.created_at, m.id) > (read_state.read_at, read_state.last_read_message_id))
    ) unread on true
    where s.user_id <> auth.uid() and (s.active or t.id is not null)
    order by coalesce(last_message.created_at, t.last_message_at) desc nulls last,
      s.display_name, s.user_id;
end;
$$;

notify pgrst, 'reload schema';
