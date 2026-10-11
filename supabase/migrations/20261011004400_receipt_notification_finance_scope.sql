-- Receipt notices follow the same staff eligibility as can_manage_payments.
-- Replacing the function preserves the existing trigger and dedupe key.
create or replace function private.notify_payment_receipt_submitted()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
    select sm.user_id, new.case_id, 'payment_receipt', 'Новый чек клиента',
      'Проверьте документ. Чек сам по себе не подтверждает оплату.',
      '/staff/cases/' || new.case_id::text || '/payments', 'receipt-submitted:' || new.id::text
    from public.staff_members sm
    where sm.active and sm.can_confirm_payments
      and (sm.role = 'admin' or exists (
        select 1 from public.case_assignments ca where ca.case_id = new.case_id
          and ca.staff_user_id = sm.user_id and ca.revoked_at is null
      ))
    on conflict (recipient_user_id, dedupe_key) do nothing;
  return new;
end;
$$;
revoke all on function private.notify_payment_receipt_submitted() from public, anon, authenticated;
