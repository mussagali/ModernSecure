-- Financial mutations are separate from staff roles and always audited.
alter table public.payments add column idempotency_key uuid;
alter table public.payments add column payment_reference text
  check (payment_reference is null or length(trim(payment_reference)) between 4 and 120);
create unique index payments_case_idempotency_key on public.payments(case_id, idempotency_key)
  where idempotency_key is not null;

create function private.can_manage_payments(p_case_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff_members sm
    where sm.user_id = (select auth.uid()) and sm.active and sm.can_confirm_payments
      and (sm.role = 'admin' or exists (
        select 1 from public.case_assignments ca
        where ca.case_id = p_case_id and ca.staff_user_id = sm.user_id and ca.revoked_at is null
      ))
  )
$$;
revoke all on function private.can_manage_payments(uuid) from public, anon, authenticated;

create function public.admin_set_payment_permission(p_staff_user_id uuid, p_allowed boolean, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); target public.staff_members%rowtype;
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  if p_allowed is null or nullif(trim(p_reason), '') is null or length(p_reason) > 500 then
    raise exception 'Reason is required';
  end if;
  select * into target from public.staff_members where user_id = p_staff_user_id for update;
  if not found or not target.active then raise exception 'Active staff member not found'; end if;
  if target.can_confirm_payments = p_allowed then raise exception 'Permission is unchanged'; end if;
  update public.staff_members set can_confirm_payments = p_allowed where user_id = p_staff_user_id;
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, before_data, after_data, reason)
  values (actor_id, 'staff_member', p_staff_user_id, 'payment_permission_changed',
    jsonb_build_object('allowed', target.can_confirm_payments), jsonb_build_object('allowed', p_allowed), trim(p_reason));
end;
$$;
revoke all on function public.admin_set_payment_permission(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_payment_permission(uuid, boolean, text) to authenticated;

create function private.revoke_finance_on_deactivation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.active and not new.active and old.can_confirm_payments then
    new.can_confirm_payments := false;
    insert into public.audit_events (actor_user_id, entity_type, entity_id, action, before_data, after_data)
    values (auth.uid(), 'staff_member', old.user_id, 'payment_permission_revoked_on_deactivation',
      jsonb_build_object('allowed', true), jsonb_build_object('allowed', false));
  end if;
  return new;
end;
$$;
revoke all on function private.revoke_finance_on_deactivation() from public, anon, authenticated;
create trigger modernsecure_revoke_finance_on_deactivation
before update of active on public.staff_members
for each row execute function private.revoke_finance_on_deactivation();

create function public.staff_add_payment_installment(p_case_id uuid, p_due_on date,
  p_amount_kzt numeric, p_description text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); item public.cases%rowtype; installment_id uuid;
begin
  if actor_id is null or not private.can_manage_payments(p_case_id) then raise exception 'Not authorized'; end if;
  select * into item from public.cases where id = p_case_id for update;
  if not found or item.status <> 'open' or item.is_suspended then raise exception 'Case is not active'; end if;
  if p_due_on is null or p_amount_kzt is null or p_amount_kzt <= 0
    or p_amount_kzt > 999999999999.99 or p_amount_kzt <> round(p_amount_kzt, 2)
    or length(coalesce(p_description, '')) > 500 then raise exception 'Invalid installment'; end if;
  insert into public.payment_schedule (case_id, due_on, amount_kzt, description)
  values (p_case_id, p_due_on, p_amount_kzt, nullif(trim(p_description), '')) returning id into installment_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
  values (actor_id, p_case_id, 'payment_schedule', installment_id, 'installment_created',
    jsonb_build_object('due_on', p_due_on, 'amount_kzt', p_amount_kzt));
  return installment_id;
end;
$$;
revoke all on function public.staff_add_payment_installment(uuid, date, numeric, text) from public, anon;
grant execute on function public.staff_add_payment_installment(uuid, date, numeric, text) to authenticated;

create function public.staff_update_payment_installment(p_schedule_id uuid, p_expected_updated_at timestamptz,
  p_due_on date, p_amount_kzt numeric, p_description text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); item public.payment_schedule%rowtype; paid_amount numeric;
begin
  select * into item from public.payment_schedule where id = p_schedule_id for update;
  if not found or actor_id is null or not private.can_manage_payments(item.case_id) then raise exception 'Not authorized'; end if;
  if not exists (select 1 from public.cases c where c.id = item.case_id and c.status = 'open' and not c.is_suspended) then
    raise exception 'Case is not active';
  end if;
  if item.updated_at is distinct from p_expected_updated_at then raise exception 'Installment changed by another user'; end if;
  if p_due_on is null or p_amount_kzt is null or p_amount_kzt <= 0
    or p_amount_kzt > 999999999999.99 or p_amount_kzt <> round(p_amount_kzt, 2)
    or length(coalesce(p_description, '')) > 500 or nullif(trim(p_reason), '') is null
    or length(p_reason) > 500 then raise exception 'Invalid installment update'; end if;
  select coalesce(sum(amount_kzt), 0) into paid_amount from public.payments
  where schedule_id = p_schedule_id and status = 'confirmed';
  if p_amount_kzt < paid_amount then raise exception 'Amount is below confirmed payments'; end if;
  update public.payment_schedule set due_on = p_due_on, amount_kzt = p_amount_kzt,
    description = nullif(trim(p_description), ''), updated_at = clock_timestamp() where id = p_schedule_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, before_data, after_data, reason)
  values (actor_id, item.case_id, 'payment_schedule', p_schedule_id, 'installment_updated',
    jsonb_build_object('due_on', item.due_on, 'amount_kzt', item.amount_kzt, 'description', item.description),
    jsonb_build_object('due_on', p_due_on, 'amount_kzt', p_amount_kzt, 'description', nullif(trim(p_description), '')),
    trim(p_reason));
end;
$$;
revoke all on function public.staff_update_payment_installment(uuid, timestamptz, date, numeric, text, text) from public, anon;
grant execute on function public.staff_update_payment_installment(uuid, timestamptz, date, numeric, text, text) to authenticated;

create function public.staff_confirm_payment(p_schedule_id uuid, p_amount_kzt numeric, p_paid_on date,
  p_reference text, p_client_note text, p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); installment public.payment_schedule%rowtype; existing public.payments%rowtype;
  paid_amount numeric; payment_id uuid; client_user_id uuid;
begin
  select * into installment from public.payment_schedule where id = p_schedule_id for update;
  if not found or actor_id is null or not private.can_manage_payments(installment.case_id) then
    raise exception 'Not authorized';
  end if;
  if not exists (select 1 from public.cases c where c.id = installment.case_id and c.status = 'open' and not c.is_suspended) then
    raise exception 'Case is not active';
  end if;
  if p_idempotency_key is null or p_amount_kzt is null or p_amount_kzt <= 0
    or p_amount_kzt > 999999999999.99 or p_amount_kzt <> round(p_amount_kzt, 2)
    or p_paid_on is null or p_paid_on > (now() at time zone 'Asia/Almaty')::date
    or nullif(trim(p_reference), '') is null or length(trim(p_reference)) not between 4 and 120
    or length(coalesce(p_client_note, '')) > 500 then raise exception 'Invalid payment'; end if;
  select * into existing from public.payments where case_id = installment.case_id
    and idempotency_key = p_idempotency_key for update;
  if found then
    if existing.status = 'confirmed' and existing.schedule_id = p_schedule_id and existing.amount_kzt = p_amount_kzt
      and existing.paid_on = p_paid_on and existing.payment_reference = trim(p_reference)
      and coalesce(existing.client_note, '') = coalesce(nullif(trim(p_client_note), ''), '') then
      return existing.id;
    end if;
    raise exception 'Payment key cannot be reused';
  end if;
  select coalesce(sum(amount_kzt), 0) into paid_amount from public.payments
    where schedule_id = p_schedule_id and status = 'confirmed';
  if paid_amount + p_amount_kzt > installment.amount_kzt then raise exception 'Payment exceeds installment'; end if;
  insert into public.payments (case_id, schedule_id, amount_kzt, paid_on, status, confirmed_by,
    client_note, idempotency_key, payment_reference)
  values (installment.case_id, p_schedule_id, p_amount_kzt, p_paid_on, 'confirmed', actor_id,
    nullif(trim(p_client_note), ''), p_idempotency_key, trim(p_reference)) returning id into payment_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
  values (actor_id, installment.case_id, 'payment', payment_id, 'confirmed',
    jsonb_build_object('amount_kzt', p_amount_kzt, 'paid_on', p_paid_on,
      'schedule_id', p_schedule_id, 'reference', trim(p_reference)));
  select cl.user_id into client_user_id from public.cases c join public.clients cl on cl.id = c.client_id
    where c.id = installment.case_id;
  if client_user_id is not null then
    insert into public.notifications (recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
    values (client_user_id, installment.case_id, 'payment', 'Оплата подтверждена',
      p_amount_kzt::text || ' ₸', '/account/cases/' || installment.case_id::text || '/payments',
      'payment-confirmed:' || payment_id::text)
    on conflict (recipient_user_id, dedupe_key) do nothing;
  end if;
  return payment_id;
end;
$$;
revoke all on function public.staff_confirm_payment(uuid, numeric, date, text, text, uuid) from public, anon;
grant execute on function public.staff_confirm_payment(uuid, numeric, date, text, text, uuid) to authenticated;

create function public.staff_void_payment(p_payment_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); item public.payments%rowtype; client_user_id uuid;
begin
  select * into item from public.payments where id = p_payment_id for update;
  if not found or actor_id is null or not private.can_manage_payments(item.case_id) then raise exception 'Not authorized'; end if;
  if item.status <> 'confirmed' or nullif(trim(p_reason), '') is null or length(p_reason) > 500 then
    raise exception 'Invalid void request';
  end if;
  update public.payments set status = 'void' where id = p_payment_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, before_data, after_data, reason)
  values (actor_id, item.case_id, 'payment', p_payment_id, 'voided',
    jsonb_build_object('status', 'confirmed', 'amount_kzt', item.amount_kzt),
    jsonb_build_object('status', 'void', 'amount_kzt', item.amount_kzt), trim(p_reason));
  select cl.user_id into client_user_id from public.cases c join public.clients cl on cl.id = c.client_id
    where c.id = item.case_id;
  if client_user_id is not null then
    insert into public.notifications (recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
    values (client_user_id, item.case_id, 'payment', 'Оплата исправлена',
      'Запись об оплате отменена. Уточните информацию у сотрудника.',
      '/account/cases/' || item.case_id::text || '/payments', 'payment-voided:' || p_payment_id::text)
    on conflict (recipient_user_id, dedupe_key) do nothing;
  end if;
end;
$$;
revoke all on function public.staff_void_payment(uuid, text) from public, anon;
grant execute on function public.staff_void_payment(uuid, text) to authenticated;
