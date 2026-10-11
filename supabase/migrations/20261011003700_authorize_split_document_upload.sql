-- Authorize one byte transfer in a resumable batch. Storage itself stays server-only.
create function public.authorize_document_file_upload(p_session_id uuid, p_file_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); session_row public.upload_sessions%rowtype;
  file_row public.document_files%rowtype; request_row public.document_requests%rowtype;
  case_row public.cases%rowtype;
begin
  if actor_id is null or p_session_id is null or p_file_id is null then
    raise exception 'Not authorized';
  end if;
  select * into session_row from public.upload_sessions where id = p_session_id for share;
  if not found or session_row.uploader_user_id <> actor_id or session_row.status <> 'pending'
    or session_row.expires_at <= now() then raise exception 'Upload session is not active'; end if;
  select * into file_row from public.document_files
    where id = p_file_id and upload_session_id = p_session_id for share;
  if not found or file_row.status <> 'quarantine' or file_row.uploaded_by <> actor_id
    or file_row.request_id <> session_row.request_id then raise exception 'File is not in this upload'; end if;
  select * into request_row from public.document_requests where id = session_row.request_id for share;
  if not found or request_row.status <> 'active' then raise exception 'Document request is not active'; end if;
  select * into case_row from public.cases where id = request_row.case_id for share;
  if not found or case_row.status <> 'open' or case_row.is_suspended
    or not private.lock_document_actor_access(case_row.id, true) then
    raise exception 'Upload is no longer authorized';
  end if;
  return jsonb_build_object('path', file_row.storage_path, 'name', file_row.original_name,
    'mime', file_row.detected_mime_type, 'size', file_row.size_bytes,
    'sha256', file_row.content_sha256, 'case_id', case_row.id,
    'request_id', request_row.id);
end;
$$;
revoke all on function public.authorize_document_file_upload(uuid, uuid) from public, anon;
grant execute on function public.authorize_document_file_upload(uuid, uuid) to authenticated;

-- A completed batch must contain files that the trusted server actually verified.
alter table public.document_files add column storage_verified_at timestamptz;
alter table public.document_files add column storage_verified_sha256 text
  check (storage_verified_sha256 is null or storage_verified_sha256 = content_sha256);

create function public.server_verify_document_file(p_session_id uuid, p_file_id uuid, p_sha256 text)
returns void language plpgsql security definer set search_path = '' as $$
declare session_row public.upload_sessions%rowtype; file_row public.document_files%rowtype;
begin
  select * into session_row from public.upload_sessions where id = p_session_id for update;
  if not found or session_row.status <> 'pending' or session_row.expires_at <= now() then
    raise exception 'Upload session is not active';
  end if;
  select * into file_row from public.document_files
    where id = p_file_id and upload_session_id = p_session_id for update;
  if not found or file_row.status <> 'quarantine' or p_sha256 is distinct from file_row.content_sha256
    or not exists (select 1 from storage.objects so
      where so.bucket_id = 'modernsecure-files' and so.name = file_row.storage_path
        and (so.metadata->>'size')::bigint = file_row.size_bytes) then
    raise exception 'Uploaded file did not pass verification';
  end if;
  update public.document_files set storage_verified_at = clock_timestamp(),
    storage_verified_sha256 = p_sha256 where id = p_file_id;
end;
$$;
revoke all on function public.server_verify_document_file(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.server_verify_document_file(uuid, uuid, text) to service_role;

create or replace function public.complete_document_upload(p_session_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); session_row public.upload_sessions%rowtype;
begin
  select * into session_row from public.upload_sessions where id = p_session_id for update;
  if not found or session_row.uploader_user_id is distinct from actor_id then raise exception 'Not authorized'; end if;
  if session_row.status = 'completed' then return; end if;
  if session_row.status <> 'pending' or session_row.expires_at <= now() then raise exception 'Upload session expired'; end if;
  if (select count(*) from public.document_files df where df.upload_session_id = p_session_id
    and df.storage_verified_at is not null and df.storage_verified_sha256 = df.content_sha256
    and exists (select 1 from storage.objects so where so.bucket_id = 'modernsecure-files'
      and so.name = df.storage_path and (so.metadata->>'size')::bigint = df.size_bytes)) <> session_row.file_count then
    raise exception 'Uploaded objects are incomplete';
  end if;
  update public.document_files set status = 'under_review' where upload_session_id = p_session_id and status = 'quarantine';
  update public.upload_sessions set status = 'completed' where id = p_session_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
  select actor_id, dr.case_id, 'upload_session', p_session_id, 'documents_submitted',
    jsonb_build_object('file_count', session_row.file_count, 'total_bytes', session_row.total_bytes)
  from public.document_requests dr where dr.id = session_row.request_id;
end;
$$;

-- A new key is a new intentional submission. Only an unfinished matching batch is resumed;
-- the original key still safely replays its own completed response in begin_document_upload.
create or replace function public.resume_or_begin_document_upload(p_request_id uuid, p_idempotency_key text, p_files jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); reusable_key text;
begin
  if actor_id is null then raise exception 'Not authenticated'; end if;
  if p_files is null or jsonb_typeof(p_files) <> 'array' then raise exception 'Invalid upload batch'; end if;
  select us.idempotency_key into reusable_key
  from public.upload_sessions us
  where us.request_id = p_request_id and us.uploader_user_id = actor_id
    and us.status = 'pending' and us.expires_at > now()
    and (select jsonb_agg(jsonb_build_object('name', df.original_name, 'mime', df.detected_mime_type,
        'size', df.size_bytes, 'sha256', df.content_sha256) order by df.file_position)
      from public.document_files df where df.upload_session_id = us.id) = p_files
  order by us.created_at desc limit 1;
  return public.begin_document_upload(p_request_id, coalesce(reusable_key, p_idempotency_key), p_files);
end;
$$;
