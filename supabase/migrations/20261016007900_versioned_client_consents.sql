-- No legal text is seeded. The administrator publishes an approved version explicitly.
create table public.legal_documents (
  id uuid primary key default gen_random_uuid(),
  document_type text not null check(document_type in ('terms', 'privacy', 'marketing')),
  version integer not null check(version > 0),
  title text not null check(length(title) between 1 and 180),
  body text not null check(length(body) between 1 and 60000),
  document_hash text not null,
  is_current boolean not null default true,
  published_at timestamptz not null default now(),
  published_by uuid not null references auth.users(id),
  unique(document_type, version)
);
create unique index legal_documents_current on public.legal_documents(document_type) where is_current;
alter table public.legal_documents enable row level security;
grant select on public.legal_documents to authenticated;
create policy legal_documents_read on public.legal_documents for select to authenticated using(true);
create policy staff_mfa_guard on public.legal_documents as restrictive for all to authenticated
  using ((select private.staff_mfa_passed())) with check ((select private.staff_mfa_passed()));

create function public.admin_publish_legal_document(p_type text, p_title text, p_body text, p_expected_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare current_id uuid; new_id uuid; next_version integer;
begin
  if not private.staff_mfa_passed() or private.staff_role_for_current_user() is distinct from 'admin' then raise exception 'Not authorized'; end if;
  if p_type is null or p_type not in ('terms','privacy','marketing') or nullif(trim(p_title), '') is null
    or length(p_title) > 180 or nullif(trim(p_body), '') is null or length(p_body) > 60000 then raise exception 'Invalid legal document'; end if;
  perform pg_advisory_xact_lock(791601);
  select id into current_id from public.legal_documents where document_type = p_type and is_current for update;
  if current_id is distinct from p_expected_id then raise exception 'Document changed'; end if;
  select coalesce(max(version), 0) + 1 into next_version from public.legal_documents where document_type = p_type;
  update public.legal_documents set is_current = false where id = current_id;
  insert into public.legal_documents(document_type, version, title, body, document_hash, published_by)
    values(p_type, next_version, trim(p_title), trim(p_body), encode(pg_catalog.sha256(convert_to(trim(p_body), 'UTF8')), 'hex'), auth.uid()) returning id into new_id;
  insert into public.audit_events(actor_user_id, entity_type, entity_id, action, after_data)
    values(auth.uid(), 'legal_document', new_id, 'published', jsonb_build_object('type', p_type, 'version', next_version));
  return new_id;
end; $$;
revoke all on function public.admin_publish_legal_document(text, text, text, uuid) from public, anon;
grant execute on function public.admin_publish_legal_document(text, text, text, uuid) to authenticated;

create function public.client_consent_status()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (exists(select 1 from public.staff_members where user_id = auth.uid() and active) or not exists (
    select 1 from public.legal_documents d where d.is_current and d.document_type <> 'marketing'
      and not exists(select 1 from public.consent_records r where r.user_id = auth.uid()
        and r.document_type = d.document_type and r.version = d.version::text and r.document_hash = d.document_hash)
  ));
$$;
revoke all on function public.client_consent_status() from public, anon;
grant execute on function public.client_consent_status() to authenticated;

create function public.accept_client_consents(p_document_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare doc public.legal_documents%rowtype;
begin
  if auth.uid() is null or not private.staff_mfa_passed() then raise exception 'Not authorized'; end if;
  perform pg_advisory_xact_lock(791601);
  if p_document_ids is null or cardinality(p_document_ids) > 3
    or exists(select 1 from unnest(p_document_ids) as requested(document_id) where requested.document_id is null or not exists(select 1 from public.legal_documents d where d.id = requested.document_id and d.is_current))
    or exists(select 1 from public.legal_documents d where d.is_current and d.document_type <> 'marketing' and not (d.id = any(p_document_ids)))
    then raise exception 'Documents changed or required consent missing'; end if;
  for doc in select * from public.legal_documents where id = any(p_document_ids) loop
    insert into public.consent_records(user_id, document_type, version, document_hash)
      values(auth.uid(), doc.document_type, doc.version::text, doc.document_hash)
      on conflict(user_id, document_type, version) do nothing;
  end loop;
end; $$;
revoke all on function public.accept_client_consents(uuid[]) from public, anon;
grant execute on function public.accept_client_consents(uuid[]) to authenticated;
