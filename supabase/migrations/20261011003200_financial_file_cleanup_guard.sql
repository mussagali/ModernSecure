-- Registration and orphan cleanup serialize on the exact Storage object path.
-- The check belongs on INSERT so it also protects callers other than the RPCs.
create function private.guard_financial_file_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(new.storage_path));

  if new.size_bytes is null or new.detected_mime_type is null or not exists (
    select 1 from storage.objects obj
    where obj.bucket_id = 'modernsecure-files' and obj.name = new.storage_path
      and obj.metadata->>'size' ~ '^[0-9]+$'
      and (obj.metadata->>'size')::bigint = new.size_bytes
      and obj.metadata->>'mimetype' = new.detected_mime_type
  ) then
    raise exception 'Financial file not found or metadata mismatch';
  end if;
  return new;
end;
$$;

create trigger modernsecure_contract_file_insert_guard
  before insert on public.contracts
  for each row execute function private.guard_financial_file_insert();

create trigger modernsecure_receipt_file_insert_guard
  before insert on public.payment_receipts
  for each row execute function private.guard_financial_file_insert();

revoke all on function private.guard_financial_file_insert() from public, anon, authenticated;
