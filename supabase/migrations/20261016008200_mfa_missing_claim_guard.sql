-- Missing assurance claims must be false, including in security-definer RPC guards.
create or replace function private.staff_mfa_passed()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(not private.staff_mfa_required()
    or (auth.jwt()->>'aal' = 'aal2' and exists (
      select 1 from auth.mfa_factors factor
      where factor.user_id = auth.uid() and factor.status = 'verified'
    )), false)
$$;
