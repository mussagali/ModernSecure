-- Contract PDFs are immutable versions. Only a finance-authorized employee may
-- register a file already present in the private bucket for the same case.
alter table public.contracts
  add column content_sha256 text,
  add column size_bytes bigint,
  add column detected_mime_type text;

create function public.staff_register_contract(
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
  if actor_id is null or not coalesce(private.can_manage_payments(p_case_id), false) then
    raise exception 'Not authorized';
  end if;
  select * into case_row from public.cases where id = p_case_id for update;
  if not found or case_row.status <> 'open' or case_row.is_suspended then
    raise exception 'Case is not active';
  end if;
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
revoke all on function public.staff_register_contract(uuid, text, date, numeric, text, text, bigint) from public, anon;
grant execute on function public.staff_register_contract(uuid, text, date, numeric, text, text, bigint) to authenticated;

create function private.block_contract_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Contract versions are immutable';
end;
$$;
create trigger modernsecure_contract_immutable before update or delete on public.contracts
  for each row execute function private.block_contract_change();
revoke all on function private.block_contract_change() from public, anon, authenticated;
