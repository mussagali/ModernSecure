-- Visitors must be able to read the current terms/privacy before signing in or consenting.
-- Keep previous editions and publisher metadata outside anonymous access.
grant select (document_type, title, body, version, published_at, is_current)
  on public.legal_documents to anon;
create policy legal_documents_public_current on public.legal_documents
  for select to anon
  using (is_current and document_type in ('terms', 'privacy'));
