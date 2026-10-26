-- Realtime only needs the parent message insert. Attachments are committed in
-- the same transaction and are fetched through the existing RLS-backed page.
-- The table already has SELECT limited by private.can_read_case(case_id).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
    ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;
