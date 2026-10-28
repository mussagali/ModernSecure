-- Keep the active-case rule inside the common lock, including direct RPC calls.
-- The row lock serializes these checks with suspension, closure and cancellation.
create or replace function private.lock_financial_case(p_case_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare item public.cases%rowtype;
begin
  perform 1 from public.staff_members where user_id = auth.uid() for share;
  perform 1 from public.case_assignments
    where case_id = p_case_id and staff_user_id = auth.uid() and revoked_at is null for share;
  if auth.uid() is null or not private.staff_mfa_passed() or not private.can_manage_payments(p_case_id) then
    raise exception 'Not authorized';
  end if;
  select * into item from public.cases where id = p_case_id for update;
  if not found then raise exception 'Case not found'; end if;
  if item.status <> 'open' or item.is_suspended then raise exception 'Case is not active'; end if;
end;
$$;

revoke all on function private.lock_financial_case(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
