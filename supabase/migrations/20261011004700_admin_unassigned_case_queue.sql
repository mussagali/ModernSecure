-- Surface cases that have not yet been handed to an active employee.
create function public.admin_unassigned_cases()
returns table (case_id uuid, case_number text, title text, created_at timestamptz, total_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;

  return query
    select c.id, c.case_number, c.title, c.created_at, count(*) over ()
    from public.cases c
    where c.status = 'open' and not exists (
      select 1 from public.case_assignments ca
      join public.staff_members sm on sm.user_id = ca.staff_user_id
      where ca.case_id = c.id and ca.revoked_at is null and sm.active
    )
    order by c.created_at desc, c.id desc
    limit 5;
end;
$$;
revoke all on function public.admin_unassigned_cases() from public, anon;
grant execute on function public.admin_unassigned_cases() to authenticated;
