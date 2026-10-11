-- Financial file events appear in the same in-app notification inbox as case work.
create function private.notify_contract_uploaded()
returns trigger language plpgsql security definer set search_path = '' as $$
declare client_user_id uuid;
begin
  select cl.user_id into client_user_id from public.cases c
    join public.clients cl on cl.id = c.client_id where c.id = new.case_id;
  if client_user_id is not null then
    insert into public.notifications (recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
    values (client_user_id, new.case_id, 'contract', 'Добавлен договор',
      'Версия ' || new.version_no::text || ' доступна в разделе оплат.',
      '/account/cases/' || new.case_id::text || '/payments', 'contract:' || new.id::text)
    on conflict (recipient_user_id, dedupe_key) do nothing;
  end if;
  return new;
end;
$$;
create trigger modernsecure_contract_notify after insert on public.contracts
  for each row execute function private.notify_contract_uploaded();
revoke all on function private.notify_contract_uploaded() from public, anon, authenticated;

create function private.notify_payment_receipt_submitted()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
    select sm.user_id, new.case_id, 'payment_receipt', 'Новый чек клиента',
      'Проверьте документ. Чек сам по себе не подтверждает оплату.',
      '/staff/cases/' || new.case_id::text || '/payments', 'receipt-submitted:' || new.id::text
    from public.staff_members sm
    where sm.active and (sm.role = 'admin' or (sm.can_confirm_payments and exists (
      select 1 from public.case_assignments ca where ca.case_id = new.case_id
        and ca.staff_user_id = sm.user_id and ca.revoked_at is null
    )))
    on conflict (recipient_user_id, dedupe_key) do nothing;
  return new;
end;
$$;
create trigger modernsecure_receipt_submitted_notify after insert on public.payment_receipts
  for each row execute function private.notify_payment_receipt_submitted();
revoke all on function private.notify_payment_receipt_submitted() from public, anon, authenticated;

create function private.notify_payment_receipt_reviewed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare client_user_id uuid;
begin
  if new.status is not distinct from old.status or new.status = 'under_review' then return new; end if;
  select cl.user_id into client_user_id from public.cases c
    join public.clients cl on cl.id = c.client_id where c.id = new.case_id;
  if client_user_id is not null then
    insert into public.notifications (recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
    values (client_user_id, new.case_id, 'payment_receipt',
      case when new.status = 'accepted' then 'Чек проверен' else 'Чек отклонён' end,
      case when new.status = 'accepted' then 'Проверка чека не означает подтверждение поступления денег.'
        else coalesce(new.review_note, 'Проверьте замечание сотрудника.') end,
      '/account/cases/' || new.case_id::text || '/payments', 'receipt-reviewed:' || new.id::text)
    on conflict (recipient_user_id, dedupe_key) do nothing;
  end if;
  return new;
end;
$$;
create trigger modernsecure_receipt_reviewed_notify after update of status on public.payment_receipts
  for each row execute function private.notify_payment_receipt_reviewed();
revoke all on function private.notify_payment_receipt_reviewed() from public, anon, authenticated;
