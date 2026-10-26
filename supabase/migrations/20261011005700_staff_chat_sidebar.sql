-- Exact per-colleague summary; no arbitrary cap on threads, messages or unread notices.
create function public.staff_chat_sidebar()
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
        and m.created_at > coalesce(read_state.read_at, '-infinity'::timestamptz)
    ) unread on true
    where s.user_id <> auth.uid() and (s.active or t.id is not null)
    order by coalesce(last_message.created_at, t.last_message_at) desc nulls last,
      s.display_name, s.user_id;
end;
$$;
revoke all on function public.staff_chat_sidebar() from public, anon;
grant execute on function public.staff_chat_sidebar() to authenticated;
