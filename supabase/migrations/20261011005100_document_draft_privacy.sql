-- Pending upload metadata belongs to its uploader until the batch is submitted.
-- Preserve case-scoped reads for every later document status.
drop policy document_files_case_read on public.document_files;
create policy document_files_case_read on public.document_files for select to authenticated
  using (
    private.can_read_document_request(request_id)
    and (status <> 'quarantine' or uploaded_by = (select auth.uid()))
  );
