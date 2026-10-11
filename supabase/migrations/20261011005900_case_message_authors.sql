-- A case participant may see the display names of people who actually sent
-- messages in that case, including former assignees retained in its history.
-- No email, phone or staff directory is exposed by this function.
create function public.case_message_authors(p_case_id uuid)
returns table(user_id uuid, display_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_case_id is null or not private.can_read_case(p_case_id) then
    raise exception 'Not authorized';
  end if;
  return query
    select distinct m.sender_user_id,
      coalesce(nullif(s.display_name, ''), nullif(cl.full_name, ''), 'Участник дела')
    from public.messages m
    join public.cases c on c.id = m.case_id
    left join public.staff_members s on s.user_id = m.sender_user_id
    left join public.clients cl on cl.id = c.client_id and cl.user_id = m.sender_user_id
    where m.case_id = p_case_id;
end;
$$;
revoke all on function public.case_message_authors(uuid) from public, anon;
grant execute on function public.case_message_authors(uuid) to authenticated;
