-- The administrator needs staff email, not the rest of each private profile.
-- Keep profiles self-only under RLS and expose only these two fields through a guarded RPC.
create function public.admin_staff_emails(p_user_ids uuid[])
returns table(user_id uuid, email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  if p_user_ids is null or coalesce(array_length(p_user_ids, 1), 0) > 100 then
    raise exception 'Invalid staff lookup';
  end if;
  return query
    select sm.user_id, p.email from public.staff_members sm
    join public.profiles p on p.user_id = sm.user_id
    where sm.user_id = any(p_user_ids);
end;
$$;
revoke all on function public.admin_staff_emails(uuid[]) from public, anon;
grant execute on function public.admin_staff_emails(uuid[]) to authenticated;
