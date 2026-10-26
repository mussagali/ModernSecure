-- Receipt review records evidence only. Payment confirmation remains a separate staff action.
do $$ begin
  if exists (select 1 from public.payment_receipts) then
    raise exception 'Review existing receipts before adding required upload metadata';
  end if;
end $$;

alter table public.payment_receipts
  add column size_bytes bigint not null check (size_bytes between 1 and 20971520),
  add column detected_mime_type text not null check (detected_mime_type in
    ('application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif')),
  add column content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  add column idempotency_key uuid not null,
  add constraint payment_receipts_name_check check
    (length(original_name) between 1 and 180 and original_name !~ '[[:cntrl:]/]'
      and position(chr(92) in original_name) = 0),
  add constraint payment_receipts_review_state check
    ((status = 'under_review' and reviewed_by is null and reviewed_at is null and review_note is null)
      or (status in ('accepted', 'rejected') and reviewed_by is not null and reviewed_at is not null)),
  add constraint payment_receipts_note_check check
    (review_note is null or (length(btrim(review_note)) between 1 and 1000));

create unique index payment_receipts_idempotency_unique
  on public.payment_receipts (case_id, uploaded_by, idempotency_key);
create unique index payment_receipts_case_sha_unique
  on public.payment_receipts (case_id, content_sha256);

create function public.client_register_payment_receipt(
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
  if not found or case_row.status <> 'open' or case_row.is_suspended then
    raise exception 'Case is not active';
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
revoke all on function public.client_register_payment_receipt(uuid, text, text, text, bigint, text, uuid)
  from public, anon;
grant execute on function public.client_register_payment_receipt(uuid, text, text, text, bigint, text, uuid)
  to authenticated;

create function public.staff_review_payment_receipt(
  p_receipt_id uuid, p_accept boolean, p_note text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  item public.payment_receipts%rowtype;
  case_row public.cases%rowtype;
  member public.staff_members%rowtype;
  clean_note text := nullif(btrim(p_note), '');
  decision public.receipt_status;
begin
  if actor_id is null then raise exception 'Not authorized'; end if;
  select * into item from public.payment_receipts where id = p_receipt_id for update;
  if not found then raise exception 'Receipt not found'; end if;
  select * into case_row from public.cases where id = item.case_id for share;
  if case_row.status <> 'open' or case_row.is_suspended then
    raise exception 'Case is not active';
  end if;
  select * into member from public.staff_members where user_id = actor_id for share;
  if not found or not member.active or not member.can_confirm_payments then
    raise exception 'Not authorized';
  end if;
  if member.role <> 'admin' then
    perform 1 from public.case_assignments ca
      where ca.case_id = item.case_id and ca.staff_user_id = actor_id
        and ca.revoked_at is null for share;
    if not found then raise exception 'Not authorized'; end if;
  end if;
  if not private.can_manage_payments(item.case_id) then raise exception 'Not authorized'; end if;
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
revoke all on function public.staff_review_payment_receipt(uuid, boolean, text) from public, anon;
grant execute on function public.staff_review_payment_receipt(uuid, boolean, text) to authenticated;
