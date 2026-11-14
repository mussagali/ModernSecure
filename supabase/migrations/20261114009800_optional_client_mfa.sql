-- A client who explicitly enrolls a second factor must satisfy it at the data
-- boundary too. Reuse the existing restrictive RLS policies and request hook;
-- staff enrollment requirements and bootstrap RPC exceptions remain intact.
create or replace function private.staff_mfa_required()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.mfa_factors factor
    where factor.user_id = auth.uid() and factor.status = 'verified'
  ) or exists (
    select 1 from public.staff_members sm
    where sm.user_id = auth.uid() and sm.active and sm.mfa_required
  )
$$;
