-- Document uploads enter a private bucket through a checked server endpoint.
-- No authenticated Storage policy is added: only the server secret key can move bytes.
alter table public.document_files add column content_sha256 text
  check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$');

create function public.begin_document_upload(p_request_id uuid, p_idempotency_key text, p_files jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  item public.document_requests%rowtype;
  case_row public.cases%rowtype;
  session_row public.upload_sessions%rowtype;
  file_item jsonb;
  file_id uuid;
  version_number integer;
  position_number integer := 0;
  total_size bigint := 0;
  file_size bigint;
  file_name text;
  file_mime text;
  file_hash text;
  existing_files jsonb;
begin
  if actor_id is null then raise exception 'Not authenticated'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 8 or length(p_idempotency_key) > 128
    or p_files is null or jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) not between 1 and 10 then
    raise exception 'Invalid upload batch';
  end if;
  select * into item from public.document_requests where id = p_request_id for update;
  if not found or item.status <> 'active' then raise exception 'Document request is not active'; end if;
  select * into case_row from public.cases where id = item.case_id;
  if case_row.status <> 'open' or case_row.is_suspended then raise exception 'Case is not active'; end if;
  if not exists (
    select 1 from public.clients cl where cl.id = case_row.client_id and cl.user_id = actor_id
  ) and not private.can_edit_legal_case(item.case_id) then
    raise exception 'Not authorized';
  end if;

  for file_item in select value from jsonb_array_elements(p_files) loop
    position_number := position_number + 1;
    file_name := nullif(trim(file_item->>'name'), '');
    file_mime := file_item->>'mime';
    file_hash := file_item->>'sha256';
    if file_item->>'size' !~ '^[0-9]+$' then raise exception 'Invalid file size'; end if;
    file_size := (file_item->>'size')::bigint;
    if file_name is null or length(file_name) > 180 or file_name ~ '[[:cntrl:]/\\]'
      or file_mime not in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif')
      or file_hash !~ '^[0-9a-f]{64}$' or file_size not between 1 and 20971520 then
      raise exception 'Invalid file metadata';
    end if;
    total_size := total_size + file_size;
  end loop;
  if total_size > 104857600 then raise exception 'Upload batch is too large'; end if;

  select * into session_row from public.upload_sessions
  where request_id = p_request_id and uploader_user_id = actor_id and idempotency_key = p_idempotency_key for update;
  if found then
    if session_row.status not in ('pending', 'completed') or session_row.file_count <> position_number
      or session_row.total_bytes <> total_size or (session_row.status = 'pending' and session_row.expires_at <= now()) then
      raise exception 'Upload key cannot be reused';
    end if;
    select jsonb_agg(jsonb_build_object('id', df.id, 'path', df.storage_path, 'name', df.original_name,
      'mime', df.detected_mime_type, 'size', df.size_bytes, 'sha256', df.content_sha256)
      order by df.file_position) into existing_files
    from public.document_files df where df.upload_session_id = session_row.id;
    if (select jsonb_agg(jsonb_build_object('name', value->>'name', 'mime', value->>'mime',
      'size', (value->>'size')::bigint, 'sha256', value->>'sha256') order by ordinality)
      from jsonb_array_elements(p_files) with ordinality) <>
      (select jsonb_agg(jsonb_build_object('name', df.original_name, 'mime', df.detected_mime_type,
      'size', df.size_bytes, 'sha256', df.content_sha256) order by df.file_position)
      from public.document_files df where df.upload_session_id = session_row.id) then
      raise exception 'Upload key metadata mismatch';
    end if;
    return jsonb_build_object('session_id', session_row.id, 'status', session_row.status, 'files', existing_files);
  end if;
  if (select count(*) from public.upload_sessions us
    where us.uploader_user_id = actor_id and us.status = 'pending' and us.expires_at > now()) >= 5 then
    raise exception 'Too many pending uploads';
  end if;

  select coalesce(max(version_no), 0) + 1 into version_number
  from public.document_files where request_id = p_request_id;
  insert into public.upload_sessions (request_id, uploader_user_id, idempotency_key, status,
    file_count, total_bytes, expires_at)
  values (p_request_id, actor_id, p_idempotency_key, 'pending', position_number, total_size, now() + interval '1 hour')
  returning * into session_row;
  position_number := 0;
  for file_item in select value from jsonb_array_elements(p_files) loop
    position_number := position_number + 1;
    file_id := gen_random_uuid();
    insert into public.document_files (id, request_id, upload_session_id, version_no, file_position,
      storage_path, original_name, detected_mime_type, size_bytes, content_sha256, uploaded_by)
    values (file_id, p_request_id, session_row.id, version_number, position_number,
      item.case_id::text || '/' || p_request_id::text || '/' || session_row.id::text || '/' || file_id::text,
      trim(file_item->>'name'), file_item->>'mime', (file_item->>'size')::bigint,
      file_item->>'sha256', actor_id);
  end loop;
  select jsonb_agg(jsonb_build_object('id', df.id, 'path', df.storage_path, 'name', df.original_name,
    'mime', df.detected_mime_type, 'size', df.size_bytes, 'sha256', df.content_sha256)
    order by df.file_position) into existing_files
  from public.document_files df where df.upload_session_id = session_row.id;
  return jsonb_build_object('session_id', session_row.id, 'status', 'pending', 'files', existing_files);
end;
$$;
revoke all on function public.begin_document_upload(uuid, text, jsonb) from public, anon;
grant execute on function public.begin_document_upload(uuid, text, jsonb) to authenticated;

create function public.complete_document_upload(p_session_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); session_row public.upload_sessions%rowtype;
begin
  select * into session_row from public.upload_sessions where id = p_session_id for update;
  if not found or session_row.uploader_user_id is distinct from actor_id then raise exception 'Not authorized'; end if;
  if session_row.status = 'completed' then return; end if;
  if session_row.status <> 'pending' or session_row.expires_at <= now() then raise exception 'Upload session expired'; end if;
  if (select count(*) from public.document_files df where df.upload_session_id = p_session_id
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
revoke all on function public.complete_document_upload(uuid) from public, anon;
grant execute on function public.complete_document_upload(uuid) to authenticated;

create function public.staff_review_document_file(p_file_id uuid, p_accept boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); item public.document_files%rowtype; case_id uuid; client_user_id uuid;
begin
  select * into item from public.document_files where id = p_file_id for update;
  if not found or item.status <> 'under_review' then raise exception 'File is not awaiting review'; end if;
  select dr.case_id, cl.user_id into case_id, client_user_id from public.document_requests dr
    join public.cases c on c.id = dr.case_id join public.clients cl on cl.id = c.client_id
    where dr.id = item.request_id;
  if actor_id is null or not private.can_edit_legal_case(case_id) then raise exception 'Not authorized'; end if;
  if p_accept is null or (not p_accept and nullif(trim(p_reason), '') is null)
    or length(coalesce(p_reason, '')) > 1000 then raise exception 'Invalid review'; end if;
  update public.document_files set status = case when p_accept then 'accepted'::public.document_file_status
    else 'returned'::public.document_file_status end, reviewed_by = actor_id, reviewed_at = now(),
    return_reason = case when p_accept then null else trim(p_reason) end where id = p_file_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
  values (actor_id, case_id, 'document_file', p_file_id,
    case when p_accept then 'accepted' else 'returned' end,
    jsonb_build_object('reason', case when p_accept then null else trim(p_reason) end));
  if client_user_id is not null then
    insert into public.notifications (recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
    values (client_user_id, case_id, 'document_review',
      case when p_accept then 'Документ принят' else 'Документ возвращён' end,
      case when p_accept then item.original_name else trim(p_reason) end,
      '/account/cases/' || case_id::text || '/documents', 'document-review:' || p_file_id::text)
    on conflict (recipient_user_id, dedupe_key) do nothing;
  end if;
end;
$$;
revoke all on function public.staff_review_document_file(uuid, boolean, text) from public, anon;
grant execute on function public.staff_review_document_file(uuid, boolean, text) to authenticated;

create function public.retract_document_file(p_file_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); item public.document_files%rowtype; case_id uuid;
begin
  select * into item from public.document_files where id = p_file_id for update;
  if not found or item.uploaded_by is distinct from actor_id or item.status <> 'under_review' then
    raise exception 'File cannot be retracted';
  end if;
  select dr.case_id into case_id from public.document_requests dr where dr.id = item.request_id;
  update public.document_files set status = 'retracted' where id = p_file_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action)
  values (actor_id, case_id, 'document_file', p_file_id, 'retracted');
end;
$$;
revoke all on function public.retract_document_file(uuid) from public, anon;
grant execute on function public.retract_document_file(uuid) to authenticated;
