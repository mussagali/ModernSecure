-- Stable keyset pagination: new messages cannot shift older pages.
create function public.staff_message_page(
  p_thread_id uuid,
  p_before_created_at timestamptz,
  p_before_id uuid,
  p_limit integer
)
returns table(id uuid, sender_user_id uuid, body text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_thread_id is null
    or not private.can_read_staff_thread(p_thread_id)
    or ((p_before_created_at is null) <> (p_before_id is null))
    or p_limit not between 1 and 101 then
    raise exception 'Not authorized or invalid page';
  end if;
  return query
    select m.id, m.sender_user_id, m.body, m.created_at
      from public.staff_messages m
      where m.thread_id = p_thread_id
        and (p_before_created_at is null
          or (m.created_at, m.id) < (p_before_created_at, p_before_id))
      order by m.created_at desc, m.id desc
      limit p_limit;
end;
$$;
revoke all on function public.staff_message_page(uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.staff_message_page(uuid, timestamptz, uuid, integer) to authenticated;
