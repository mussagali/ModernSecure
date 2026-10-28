-- A terminal case cannot accept later finance corrections. Require staff to
-- settle or explicitly cancel scheduled obligations before ending the case.
create function private.guard_case_end_payment_schedule()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('closed', 'cancelled') and new.status is distinct from old.status
    and exists (
      select 1 from public.payment_schedule s
      where s.case_id = new.id and s.cancelled_at is null
        and s.amount_kzt > private.installment_paid(s.id)
    ) then
    raise exception 'Outstanding payment schedule must be resolved before ending case';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_case_end_payment_schedule() from public, anon, authenticated;

-- UPDATE already holds the case row lock used by every financial mutation.
-- A failure also rolls back task/request changes made earlier in staff_cancel_case.
create trigger modernsecure_case_end_payment_schedule
before update of status on public.cases
for each row execute function private.guard_case_end_payment_schedule();

notify pgrst, 'reload schema';
