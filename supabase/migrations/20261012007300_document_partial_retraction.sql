-- A partly retracted version cannot be treated as fully accepted. Only a
-- version whose every file was retracted falls back to the prior version.
create or replace function private.document_request_current_state(p_request_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  with latest as (
    select max(version_no) as version_no
    from public.document_files
    where request_id = p_request_id and status not in ('quarantine', 'retracted')
  ), current_files as (
    select df.status from public.document_files df
    join latest l on l.version_no = df.version_no
    where df.request_id = p_request_id and df.status <> 'quarantine'
  )
  select case
    when not exists (select 1 from current_files) then 'missing'
    when exists (select 1 from current_files where status = 'returned') then 'returned'
    when exists (select 1 from current_files where status = 'under_review') then 'under_review'
    when exists (select 1 from current_files where status <> 'accepted') then 'incomplete'
    else 'accepted'
  end
$$;
