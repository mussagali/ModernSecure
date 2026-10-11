-- An exact unread count for a case. PostgREST row limits must not silently
-- truncate the client's overview after a long conversation.
create function public.case_unread_message_count(p_case_id uuid)
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare
  viewer_id uuid := auth.uid();
  unread_count bigint;
begin
  if viewer_id is null or p_case_id is null or not private.can_read_case(p_case_id) then
    raise exception 'Not authorized';
  end if;

  select count(*) into unread_count
  from public.messages m
  where m.case_id = p_case_id and m.sender_user_id <> viewer_id
    and not exists (
      select 1 from public.message_reads mr
      where mr.message_id = m.id and mr.reader_user_id = viewer_id
    );
  return unread_count;
end;
$$;

revoke all on function public.case_unread_message_count(uuid) from public, anon;
grant execute on function public.case_unread_message_count(uuid) to authenticated;
