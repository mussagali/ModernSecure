-- Global audit visibility belongs to the main administrator, not managers/lawyers.
drop policy audit_admin_read on public.audit_events;
create policy audit_admin_read on public.audit_events for select to authenticated
  using (private.staff_role_for_current_user() = 'admin');

-- An administrator may onboard an existing, email-verified Auth account as staff.
-- This does not create an Auth password or silently grant case access to lawyers.
create function public.admin_add_staff(p_email text, p_display_name text, p_role public.staff_role)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  clean_email text := nullif(lower(trim(p_email)), '');
  clean_name text := nullif(trim(p_display_name), '');
  target_id uuid;
  matches integer;
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  if clean_email is null or length(clean_email) > 254
    or clean_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or clean_name is null or length(clean_name) > 160
    or not coalesce(p_role in ('lawyer', 'manager'), false) then
    raise exception 'Invalid staff details';
  end if;
  select count(*)::integer into matches from auth.users u
  where lower(u.email) = clean_email and u.email_confirmed_at is not null;
  if matches <> 1 then raise exception 'Exactly one verified account is required'; end if;
  select u.id into target_id from auth.users u
  where lower(u.email) = clean_email and u.email_confirmed_at is not null;
  if exists (select 1 from public.clients where user_id = target_id)
    or exists (select 1 from public.staff_members where user_id = target_id) then
    raise exception 'Account already assigned';
  end if;
  insert into public.staff_members (user_id, display_name, role)
  values (target_id, clean_name, p_role);
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
  values (actor_id, 'staff_member', target_id, 'role_granted', jsonb_build_object('role', p_role));
  return target_id;
end;
$$;
revoke all on function public.admin_add_staff(text, text, public.staff_role) from public, anon;
grant execute on function public.admin_add_staff(text, text, public.staff_role) to authenticated;
