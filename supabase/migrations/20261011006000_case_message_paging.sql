-- Stable history for both sides of a case conversation. The case access check
-- is evaluated on every page request, so reassignment revokes history too.
create function public.case_message_page(
  p_case_id uuid,
  p_before_created_at timestamptz,
  p_before_id uuid,
  p_limit integer
)
returns table(id uuid, sender_user_id uuid, body text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_case_id is null
    or not private.can_read_case(p_case_id)
    or ((p_before_created_at is null) <> (p_before_id is null))
    or p_limit is null or p_limit not between 1 and 101 then
    raise exception 'Not authorized or invalid page';
  end if;
  return query
    select m.id, m.sender_user_id, m.body, m.created_at
    from public.messages m
    where m.case_id = p_case_id
      and (p_before_created_at is null
        or (m.created_at, m.id) < (p_before_created_at, p_before_id))
    order by m.created_at desc, m.id desc
    limit p_limit;
end;
$$;
revoke all on function public.case_message_page(uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.case_message_page(uuid, timestamptz, uuid, integer) to authenticated;
