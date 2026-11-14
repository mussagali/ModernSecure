-- Hosted Supabase may grant table-wide privileges to anon by default.
-- Remove that inherited table grant before allowing only public document fields.
revoke all privileges on public.legal_documents from anon;
grant select (document_type, title, body, version, published_at, is_current)
  on public.legal_documents to anon;
notify pgrst, 'reload schema';
