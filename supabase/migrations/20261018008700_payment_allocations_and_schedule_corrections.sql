-- A bank transaction stays unique; its amount may cover several installments.
alter table public.payment_schedule add column cancelled_at timestamptz,
  add column cancellation_reason text,
  add constraint payment_schedule_cancellation_check check (
    (cancelled_at is null and cancellation_reason is null) or
    (cancelled_at is not null and length(trim(cancellation_reason)) between 1 and 500));
alter table public.payment_schedule add constraint payment_schedule_id_case_key unique(id, case_id);
alter table public.payments add constraint payments_id_case_key unique(id, case_id);
create table public.payment_allocations (
  payment_id uuid not null,
  schedule_id uuid not null,
  case_id uuid not null,
  amount_kzt numeric(14,2) not null check(amount_kzt > 0),
  primary key(payment_id, schedule_id),
  foreign key(payment_id, case_id) references public.payments(id, case_id) on delete restrict,
  foreign key(schedule_id, case_id) references public.payment_schedule(id, case_id) on delete restrict
);
create index payment_allocations_schedule_idx on public.payment_allocations(schedule_id);
create index payment_allocations_case_idx on public.payment_allocations(case_id);
insert into public.payment_allocations(payment_id, schedule_id, case_id, amount_kzt)
  select id, schedule_id, case_id, amount_kzt from public.payments where schedule_id is not null;
alter table public.payment_allocations enable row level security;
revoke all on public.payment_allocations from anon, authenticated;
grant select on public.payment_allocations to authenticated;
create policy payment_allocations_case_read on public.payment_allocations for select to authenticated
  using(private.can_read_case(case_id));
create policy staff_mfa_guard on public.payment_allocations as restrictive for all to authenticated
  using((select private.staff_mfa_passed())) with check((select private.staff_mfa_passed()));

create function private.lock_financial_case(p_case_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.staff_members where user_id = auth.uid() for share;
  perform 1 from public.case_assignments where case_id = p_case_id and staff_user_id = auth.uid() and revoked_at is null for share;
  if auth.uid() is null or not private.staff_mfa_passed() or not private.can_manage_payments(p_case_id) then
    raise exception 'Not authorized';
  end if;
  perform 1 from public.cases where id = p_case_id for update;
  if not found then raise exception 'Case not found'; end if;
end;
$$;
revoke all on function private.lock_financial_case(uuid) from public, anon, authenticated;

create function private.installment_paid(p_schedule_id uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(a.amount_kzt), 0) from public.payment_allocations a
  join public.payments p on p.id = a.payment_id where a.schedule_id = p_schedule_id and p.status = 'confirmed';
$$;
revoke all on function private.installment_paid(uuid) from public, anon, authenticated;

-- Prices are total prices of contract versions. Paid money plus active future
-- obligations must not silently exceed the latest agreed price.
create function private.assert_schedule_within_contract(p_case_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare price numeric; paid numeric; outstanding numeric;
begin
  select price_kzt into price from public.contracts where case_id = p_case_id order by version_no desc limit 1;
  select coalesce(sum(amount_kzt), 0) into paid from public.payments where case_id = p_case_id and status = 'confirmed';
  select coalesce(sum(greatest(0, s.amount_kzt - private.installment_paid(s.id))), 0) into outstanding
    from public.payment_schedule s where s.case_id = p_case_id and s.cancelled_at is null;
  if price is null or outstanding > greatest(0, price - paid) then raise exception 'Schedule exceeds remaining contract price'; end if;
end;
$$;
revoke all on function private.assert_schedule_within_contract(uuid) from public, anon, authenticated;

create function public.staff_record_payment(p_case_id uuid, p_amount_kzt numeric, p_paid_on date,
  p_reference text, p_client_note text, p_idempotency_key uuid, p_receipt_id uuid default null,
  p_schedule_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare existing public.payments%rowtype; receipt public.payment_receipts%rowtype;
  result_payment_id uuid; recipient uuid; installment record; remaining numeric := p_amount_kzt; allocated numeric;
begin
  perform private.lock_financial_case(p_case_id);
  if p_idempotency_key is null or p_amount_kzt is null or p_amount_kzt <= 0
    or p_amount_kzt > 999999999999.99 or p_amount_kzt <> round(p_amount_kzt, 2)
    or p_paid_on is null or p_paid_on > (now() at time zone 'Asia/Almaty')::date
    or nullif(trim(p_reference), '') is null or length(trim(p_reference)) not between 4 and 120
    or length(coalesce(p_client_note, '')) > 500 then raise exception 'Invalid payment'; end if;
  select * into existing from public.payments where case_id = p_case_id and idempotency_key = p_idempotency_key;
  if found then
    if existing.status = 'confirmed' and existing.schedule_id is not distinct from p_schedule_id
      and existing.amount_kzt = p_amount_kzt and existing.paid_on = p_paid_on
      and existing.payment_reference = trim(p_reference)
      and existing.client_note is not distinct from nullif(trim(p_client_note), '')
      and existing.receipt_id is not distinct from p_receipt_id then return existing.id; end if;
    raise exception 'Payment key cannot be reused';
  end if;
  if p_receipt_id is not null then
    select * into receipt from public.payment_receipts where id = p_receipt_id for update;
    if not found or receipt.case_id <> p_case_id or receipt.status <> 'accepted' then
      raise exception 'Accepted receipt not found for case';
    end if;
    if exists(select 1 from public.payments where receipt_id = p_receipt_id and status = 'confirmed') then
      raise exception 'Receipt already linked to payment';
    end if;
  end if;
  -- The case lock serializes allocation, voiding and schedule edits.
  insert into public.payments(case_id, schedule_id, receipt_id, amount_kzt, paid_on, status,
    confirmed_by, client_note, idempotency_key, payment_reference)
  values(p_case_id, p_schedule_id, p_receipt_id, p_amount_kzt, p_paid_on, 'confirmed', auth.uid(),
    nullif(trim(p_client_note), ''), p_idempotency_key, trim(p_reference)) returning id into result_payment_id;
  for installment in select s.*, private.installment_paid(s.id) as paid from public.payment_schedule s
    where s.case_id = p_case_id and s.cancelled_at is null
      and (p_schedule_id is null or s.id = p_schedule_id)
    order by s.due_on, s.created_at, s.id for update of s loop
    allocated := least(remaining, greatest(0, installment.amount_kzt - installment.paid));
    if allocated > 0 then
      insert into public.payment_allocations(payment_id, schedule_id, case_id, amount_kzt)
        values(result_payment_id, installment.id, p_case_id, allocated);
      remaining := remaining - allocated;
    end if;
    exit when remaining = 0;
  end loop;
  if remaining > 0 then raise exception 'Payment exceeds active schedule'; end if;
  insert into public.audit_events(actor_user_id, case_id, entity_type, entity_id, action, after_data)
  values(auth.uid(), p_case_id, 'payment', result_payment_id, 'confirmed', jsonb_build_object(
    'amount_kzt', p_amount_kzt, 'paid_on', p_paid_on, 'reference', trim(p_reference), 'receipt_id', p_receipt_id,
    'allocations', (select jsonb_agg(jsonb_build_object('schedule_id', a.schedule_id, 'amount_kzt', a.amount_kzt))
      from public.payment_allocations a where a.payment_id = result_payment_id)));
  select cl.user_id into recipient from public.clients cl join public.cases c on c.client_id = cl.id where c.id = p_case_id;
  if recipient is not null then
    insert into public.notifications(recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
    values(recipient, p_case_id, 'payment', 'Оплата подтверждена', p_amount_kzt::text || ' ₸',
      '/account/cases/' || p_case_id || '/payments', 'payment-confirmed:' || result_payment_id);
  end if;
  return result_payment_id;
end;
$$;
revoke all on function public.staff_record_payment(uuid, numeric, date, text, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.staff_record_payment(uuid, numeric, date, text, text, uuid, uuid, uuid) to authenticated;

-- Keep old API callers on the same accounting path.
create or replace function public.staff_confirm_payment(p_schedule_id uuid, p_amount_kzt numeric, p_paid_on date,
  p_reference text, p_client_note text, p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare target_case uuid;
begin
  select case_id into target_case from public.payment_schedule where id = p_schedule_id;
  return public.staff_record_payment(target_case, p_amount_kzt, p_paid_on, p_reference, p_client_note, p_idempotency_key, null, p_schedule_id);
end;
$$;
create or replace function public.staff_confirm_payment_with_receipt(p_schedule_id uuid, p_amount_kzt numeric, p_paid_on date,
  p_reference text, p_client_note text, p_idempotency_key uuid, p_receipt_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare target_case uuid;
begin
  select case_id into target_case from public.payment_schedule where id = p_schedule_id;
  return public.staff_record_payment(target_case, p_amount_kzt, p_paid_on, p_reference, p_client_note, p_idempotency_key, p_receipt_id, p_schedule_id);
end;
$$;

create function public.staff_cancel_payment_installment(p_schedule_id uuid, p_expected_updated_at timestamptz, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare item public.payment_schedule%rowtype; target_case uuid; recipient uuid; clean_reason text := nullif(trim(p_reason), '');
begin
  select case_id into target_case from public.payment_schedule where id = p_schedule_id;
  perform private.lock_financial_case(target_case);
  select * into item from public.payment_schedule where id = p_schedule_id for update;
  if item.updated_at is distinct from p_expected_updated_at or item.cancelled_at is not null then raise exception 'Installment changed by another user'; end if;
  if clean_reason is null or length(clean_reason) > 500 then raise exception 'Reason is required'; end if;
  update public.payment_schedule set cancelled_at = clock_timestamp(), cancellation_reason = clean_reason,
    updated_at = clock_timestamp() where id = p_schedule_id;
  insert into public.audit_events(actor_user_id, case_id, entity_type, entity_id, action, after_data, reason)
    values(auth.uid(), target_case, 'payment_schedule', p_schedule_id, 'installment_cancelled',
      jsonb_build_object('cancelled_outstanding_kzt', greatest(0, item.amount_kzt - private.installment_paid(item.id))), clean_reason);
  select cl.user_id into recipient from public.clients cl join public.cases c on c.client_id = cl.id where c.id = target_case;
  if recipient is not null then
    insert into public.notifications(recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
    values(recipient, target_case, 'payment', 'Срок оплаты отменён', clean_reason,
      '/account/cases/' || target_case || '/payments', 'installment-cancelled:' || p_schedule_id);
  end if;
end;
$$;
revoke all on function public.staff_cancel_payment_installment(uuid, timestamptz, text) from public, anon;
grant execute on function public.staff_cancel_payment_installment(uuid, timestamptz, text) to authenticated;


create or replace function public.staff_add_payment_installment(p_case_id uuid, p_due_on date,
  p_amount_kzt numeric, p_description text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  item public.cases%rowtype;
  contract_version public.contracts%rowtype;
  installment_id uuid;
begin
  perform private.lock_financial_case(p_case_id);
  if p_due_on is null or p_amount_kzt is null or p_amount_kzt <= 0
    or p_amount_kzt > 999999999999.99 or p_amount_kzt <> round(p_amount_kzt, 2)
    or length(coalesce(p_description, '')) > 500 then raise exception 'Invalid installment'; end if;

  select * into contract_version from public.contracts
    where case_id = p_case_id order by version_no desc limit 1;
  if not found then raise exception 'Contract version is required for a new installment'; end if;

  insert into public.payment_schedule (case_id, contract_id, due_on, amount_kzt, description)
  values (p_case_id, contract_version.id, p_due_on, p_amount_kzt, nullif(trim(p_description), ''))
  returning id into installment_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
  values (actor_id, p_case_id, 'payment_schedule', installment_id, 'installment_created',
    jsonb_build_object('due_on', p_due_on, 'amount_kzt', p_amount_kzt,
      'contract_id', contract_version.id, 'contract_version_no', contract_version.version_no));
  perform private.assert_schedule_within_contract(p_case_id);
  return installment_id;
end;
$$;

create or replace function public.staff_update_payment_installment(p_schedule_id uuid, p_expected_updated_at timestamptz,
  p_due_on date, p_amount_kzt numeric, p_description text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); item public.payment_schedule%rowtype; paid_amount numeric; target_case uuid;
begin
  select case_id into target_case from public.payment_schedule where id = p_schedule_id;
  perform private.lock_financial_case(target_case);
  select * into item from public.payment_schedule where id = p_schedule_id for update;
  if item.cancelled_at is not null then raise exception 'Installment is cancelled'; end if;
  if item.updated_at is distinct from p_expected_updated_at then raise exception 'Installment changed by another user'; end if;
  if p_due_on is null or p_amount_kzt is null or p_amount_kzt <= 0
    or p_amount_kzt > 999999999999.99 or p_amount_kzt <> round(p_amount_kzt, 2)
    or length(coalesce(p_description, '')) > 500 or nullif(trim(p_reason), '') is null
    or length(p_reason) > 500 then raise exception 'Invalid installment update'; end if;
  paid_amount := private.installment_paid(p_schedule_id);
  if p_amount_kzt < paid_amount then raise exception 'Amount is below confirmed payments'; end if;
  update public.payment_schedule set due_on = p_due_on, amount_kzt = p_amount_kzt,
    description = nullif(trim(p_description), ''), updated_at = clock_timestamp() where id = p_schedule_id;
  perform private.assert_schedule_within_contract(item.case_id);
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, before_data, after_data, reason)
  values (actor_id, item.case_id, 'payment_schedule', p_schedule_id, 'installment_updated',
    jsonb_build_object('due_on', item.due_on, 'amount_kzt', item.amount_kzt, 'description', item.description),
    jsonb_build_object('due_on', p_due_on, 'amount_kzt', p_amount_kzt, 'description', nullif(trim(p_description), '')),
    trim(p_reason));
end;
$$;

create or replace function public.staff_void_payment(p_payment_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); item public.payments%rowtype; client_user_id uuid; target_case uuid;
begin
  select case_id into target_case from public.payments where id = p_payment_id;
  perform private.lock_financial_case(target_case);
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

create or replace function public.staff_register_contract(
  p_case_id uuid, p_contract_number text, p_signed_on date, p_price_kzt numeric,
  p_storage_path text, p_content_sha256 text, p_size_bytes bigint
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  case_row public.cases%rowtype;
  existing public.contracts%rowtype;
  next_version integer;
  new_id uuid;
  clean_number text := nullif(trim(p_contract_number), '');
begin
  perform private.lock_financial_case(p_case_id);
  if clean_number is null or length(clean_number) > 120
    or p_price_kzt is null or p_price_kzt < 0 or p_price_kzt > 999999999999.99
    or p_price_kzt <> round(p_price_kzt, 2)
    or (p_signed_on is not null and p_signed_on > (now() at time zone 'Asia/Almaty')::date)
    or p_storage_path is null or p_storage_path !~ ('^contracts/' || p_case_id::text || '/[0-9a-f-]{36}\.pdf$')
    or p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-f]{64}$'
    or p_size_bytes is null or p_size_bytes not between 1 and 20971520 then
    raise exception 'Invalid contract';
  end if;
  select * into existing from public.contracts where storage_path = p_storage_path for update;
  if found then
    if existing.case_id = p_case_id and existing.contract_number = clean_number
      and existing.signed_on is not distinct from p_signed_on and existing.price_kzt = p_price_kzt
      and existing.content_sha256 = p_content_sha256 and existing.size_bytes = p_size_bytes then
      return existing.id;
    end if;
    raise exception 'Contract upload key reused';
  end if;
  if not exists (
    select 1 from storage.objects obj
    where obj.bucket_id = 'modernsecure-files' and obj.name = p_storage_path
      and (obj.metadata->>'size')::bigint = p_size_bytes
      and obj.metadata->>'mimetype' = 'application/pdf'
  ) then raise exception 'Contract file not found'; end if;
  select coalesce(max(version_no), 0) + 1 into next_version
    from public.contracts where case_id = p_case_id;
  insert into public.contracts (
    case_id, version_no, contract_number, signed_on, price_kzt,
    storage_path, created_by, content_sha256, size_bytes, detected_mime_type
  ) values (
    p_case_id, next_version, clean_number, p_signed_on, p_price_kzt,
    p_storage_path, actor_id, p_content_sha256, p_size_bytes, 'application/pdf'
  ) returning id into new_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
    values (actor_id, p_case_id, 'contract', new_id, 'uploaded',
      jsonb_build_object('version_no', next_version, 'contract_number', clean_number,
        'signed_on', p_signed_on, 'price_kzt', p_price_kzt, 'size_bytes', p_size_bytes,
        'content_sha256', p_content_sha256));
  return new_id;
end;
$$;

create or replace function public.client_register_payment_receipt(
  p_case_id uuid, p_storage_path text, p_original_name text,
  p_mime_type text, p_size_bytes bigint, p_content_sha256 text,
  p_idempotency_key uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  case_row public.cases%rowtype;
  existing public.payment_receipts%rowtype;
  receipt_id uuid;
  suffix text;
begin
  if actor_id is null then raise exception 'Not authorized'; end if;
  select * into case_row from public.cases where id = p_case_id for share;
  if not found then
    raise exception 'Case not found';
  end if;
  perform 1 from public.clients cl
    where cl.id = case_row.client_id and cl.user_id = actor_id for share;
  if not found then raise exception 'Not authorized'; end if;

  if p_idempotency_key is null or p_storage_path is null
    or p_storage_path !~ ('^receipts/' || p_case_id::text || '/' || actor_id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](pdf|jpg|png|heic|heif)$')
    or p_original_name is null or length(p_original_name) not between 1 and 180
    or p_original_name ~ '[[:cntrl:]/]' or position(chr(92) in p_original_name) > 0
    or p_original_name <> btrim(p_original_name)
    or p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif')
    or p_size_bytes is null or p_size_bytes not between 1 and 20971520
    or p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid receipt metadata';
  end if;
  suffix := lower(substring(p_storage_path from '[.][^.]+$'));
  if not ((p_mime_type = 'application/pdf' and suffix = '.pdf')
    or (p_mime_type = 'image/jpeg' and suffix = '.jpg')
    or (p_mime_type = 'image/png' and suffix = '.png')
    or (p_mime_type = 'image/heic' and suffix = '.heic')
    or (p_mime_type = 'image/heif' and suffix = '.heif')) then
    raise exception 'Receipt type does not match path';
  end if;

  select * into existing from public.payment_receipts
    where case_id = p_case_id and uploaded_by = actor_id and idempotency_key = p_idempotency_key
    for update;
  if found then
    if existing.storage_path = p_storage_path and existing.original_name = p_original_name
      and existing.detected_mime_type = p_mime_type and existing.size_bytes = p_size_bytes
      and existing.content_sha256 = p_content_sha256 then
      return existing.id;
    end if;
    raise exception 'Receipt upload key cannot be reused';
  end if;
  if not exists (
    select 1 from storage.objects obj
    where obj.bucket_id = 'modernsecure-files' and obj.name = p_storage_path
      and obj.metadata->>'size' ~ '^[0-9]+$'
      and (obj.metadata->>'size')::bigint = p_size_bytes
      and obj.metadata->>'mimetype' = p_mime_type
  ) then raise exception 'Receipt object not found or metadata mismatch'; end if;

  insert into public.payment_receipts (case_id, uploaded_by, storage_path,
    original_name, detected_mime_type, size_bytes, content_sha256, idempotency_key)
  values (p_case_id, actor_id, p_storage_path, p_original_name,
    p_mime_type, p_size_bytes, p_content_sha256, p_idempotency_key)
  returning id into receipt_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
  values (actor_id, p_case_id, 'payment_receipt', receipt_id, 'submitted',
    jsonb_build_object('storage_path', p_storage_path, 'size_bytes', p_size_bytes,
      'mime_type', p_mime_type, 'content_sha256', p_content_sha256));
  return receipt_id;
end;
$$;

create or replace function public.staff_review_payment_receipt(
  p_receipt_id uuid, p_accept boolean, p_note text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  item public.payment_receipts%rowtype;
  case_row public.cases%rowtype;
  member public.staff_members%rowtype;
  clean_note text := nullif(btrim(p_note), '');
  decision public.receipt_status; target_case uuid;
begin
  select case_id into target_case from public.payment_receipts where id = p_receipt_id;
  perform private.lock_financial_case(target_case);
  select * into item from public.payment_receipts where id = p_receipt_id for update;
  if not found then raise exception 'Receipt not found'; end if;
  if p_accept is null or clean_note is null or length(clean_note) > 1000 then
    raise exception 'Review note and decision are required';
  end if;
  decision := case when p_accept then 'accepted'::public.receipt_status
    else 'rejected'::public.receipt_status end;
  if item.status <> 'under_review' then
    if item.status = decision and item.reviewed_by = actor_id and item.review_note = clean_note then
      return;
    end if;
    raise exception 'Receipt already reviewed';
  end if;
  update public.payment_receipts set status = decision, review_note = clean_note,
    reviewed_by = actor_id, reviewed_at = clock_timestamp() where id = p_receipt_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action,
    before_data, after_data, reason)
  values (actor_id, item.case_id, 'payment_receipt', p_receipt_id,
    case when p_accept then 'accepted' else 'rejected' end,
    jsonb_build_object('status', 'under_review'),
    jsonb_build_object('status', decision, 'reviewed_by', actor_id), clean_note);
end;
$$;

create or replace function private.enqueue_payment_deadline_reminders(p_reference_day date default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare local_day date := coalesce(p_reference_day, (now() at time zone 'Asia/Almaty')::date); inserted_count integer;
begin
  insert into public.notifications(recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
  select cl.user_id, c.id, 'payment_deadline',
    case when s.due_on = local_day then 'Срок оплаты сегодня' else 'Срок оплаты завтра' end,
    'Остаток: ' || (s.amount_kzt - coalesce(p.paid, 0))::text || ' ₸. Откройте график платежей.',
    '/account/cases/' || c.id || '/payments',
    'payment-deadline:' || s.id || ':' || s.due_on || ':' || case when s.due_on = local_day then 'today' else 'tomorrow' end
  from public.payment_schedule s join public.cases c on c.id = s.case_id
  join public.clients cl on cl.id = c.client_id
  left join lateral (select private.installment_paid(s.id) as paid) p on true
  where s.due_on between local_day and local_day + 1 and s.cancelled_at is null
    and not exists (select 1 from public.payment_receipts r where r.case_id = c.id
      and (r.status = 'under_review' or (r.status = 'accepted' and not exists (
        select 1 from public.payments p2 where p2.receipt_id = r.id and p2.status = 'confirmed'))))
    and cl.user_id is not null and s.amount_kzt > coalesce(p.paid, 0)
  on conflict (recipient_user_id, dedupe_key) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

notify pgrst, 'reload schema';
