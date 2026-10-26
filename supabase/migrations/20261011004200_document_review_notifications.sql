-- A verified batch becomes actionable only after the session is completed.
-- Notify staff who can actually review legal files: the admin and assigned lawyers.
create function private.notify_completed_document_upload()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_case_id uuid;
begin
  if old.status = 'completed' or new.status <> 'completed' then return new; end if;

  select dr.case_id into v_case_id
  from public.document_requests dr where dr.id = new.request_id;

  insert into public.notifications
    (recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
  select sm.user_id, v_case_id, 'document_submission', 'Новые документы на проверку',
    'Загружено файлов: ' || new.file_count::text,
    '/staff/cases/' || v_case_id::text || '/documents',
    'document-submitted:' || new.id::text
  from public.staff_members sm
  where sm.active and (
    sm.role = 'admin' or (sm.role = 'lawyer' and exists (
      select 1 from public.case_assignments ca
      where ca.case_id = v_case_id and ca.staff_user_id = sm.user_id
        and ca.revoked_at is null
    ))
  )
  on conflict (recipient_user_id, dedupe_key) do nothing;
  return new;
end;
$$;

create trigger modernsecure_document_submission_notify
  after update of status on public.upload_sessions
  for each row when (old.status is distinct from new.status and new.status = 'completed')
  execute function private.notify_completed_document_upload();

revoke all on function private.notify_completed_document_upload() from public, anon, authenticated;
