-- Count conversations that need this employee's attention, independently of
-- notification read state. The result never includes inaccessible cases.
create function public.staff_unread_case_count()
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare
  viewer_id uuid := auth.uid();
  viewer_role public.staff_role := private.staff_role_for_current_user();
  result_count bigint;
begin
  if viewer_id is null or viewer_role is null then
    raise exception 'Not authorized';
  end if;

  select count(*) into result_count
  from public.cases c
  where (viewer_role = 'admin' or exists (
    select 1 from public.case_assignments ca
    where ca.case_id = c.id and ca.staff_user_id = viewer_id and ca.revoked_at is null
  ))
    and exists (
      select 1 from public.messages m
      where m.case_id = c.id and m.sender_user_id <> viewer_id
        and not exists (
          select 1 from public.message_reads mr
          where mr.message_id = m.id and mr.reader_user_id = viewer_id
        )
    );
  return result_count;
end;
$$;

revoke all on function public.staff_unread_case_count() from public, anon;
grant execute on function public.staff_unread_case_count() to authenticated;
