-- A reviewed receipt may support one confirmed payment in the same case.
-- Reviewing a receipt alone never creates a payment.
create function public.staff_confirm_payment_with_receipt(
  p_schedule_id uuid, p_amount_kzt numeric, p_paid_on date,
  p_reference text, p_client_note text, p_idempotency_key uuid,
  p_receipt_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  installment public.payment_schedule%rowtype;
  receipt public.payment_receipts%rowtype;
  result_id uuid;
  linked_receipt_id uuid;
begin
  select * into installment from public.payment_schedule where id = p_schedule_id;
  if not found or actor_id is null or not coalesce(private.can_manage_payments(installment.case_id), false) then
    raise exception 'Not authorized';
  end if;
  if p_receipt_id is not null then
    select * into receipt from public.payment_receipts where id = p_receipt_id for update;
    if not found or receipt.case_id <> installment.case_id or receipt.status <> 'accepted' then
      raise exception 'Accepted receipt not found for case';
    end if;
    if exists (select 1 from public.payments p where p.receipt_id = p_receipt_id
      and p.status = 'confirmed' and p.idempotency_key is distinct from p_idempotency_key) then
      raise exception 'Receipt already linked to payment';
    end if;
  end if;
  result_id := public.staff_confirm_payment(p_schedule_id, p_amount_kzt, p_paid_on,
    p_reference, p_client_note, p_idempotency_key);
  if p_receipt_id is not null then
    select receipt_id into linked_receipt_id from public.payments where id = result_id for update;
    if linked_receipt_id is not null and linked_receipt_id <> p_receipt_id then
      raise exception 'Payment already linked to another receipt';
    end if;
    if linked_receipt_id is null then
      update public.payments set receipt_id = p_receipt_id where id = result_id;
      insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
        values (actor_id, installment.case_id, 'payment', result_id, 'receipt_linked',
          jsonb_build_object('receipt_id', p_receipt_id));
    end if;
  end if;
  return result_id;
end;
$$;
revoke all on function public.staff_confirm_payment_with_receipt(uuid, numeric, date, text, text, uuid, uuid)
  from public, anon;
grant execute on function public.staff_confirm_payment_with_receipt(uuid, numeric, date, text, text, uuid, uuid)
  to authenticated;
