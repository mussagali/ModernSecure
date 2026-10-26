-- A completed response may be replayed after a request or case becomes inactive,
-- provided the original uploader can still read the case. Pending and new uploads
-- continue to require an active request and case.
create or replace function public.begin_document_upload(p_request_id uuid, p_idempotency_key text, p_files jsonb)
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
  if not found then raise exception 'Document request is not active'; end if;
  select * into case_row from public.cases where id = item.case_id;

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
  if found and session_row.status = 'completed' then
    if not private.can_read_case(item.case_id) then raise exception 'Not authorized'; end if;
    if session_row.file_count <> position_number or session_row.total_bytes <> total_size then
      raise exception 'Upload key cannot be reused';
    end if;
    select jsonb_agg(jsonb_build_object('id', df.id, 'path', df.storage_path, 'name', df.original_name,
      'mime', df.detected_mime_type, 'size', df.size_bytes, 'sha256', df.content_sha256)
      order by df.file_position) into existing_files
    from public.document_files df where df.upload_session_id = session_row.id;
    if (select jsonb_agg(jsonb_build_object('name', value->>'name', 'mime', value->>'mime',
      'size', (value->>'size')::bigint, 'sha256', value->>'sha256') order by ordinality)
      from jsonb_array_elements(p_files) with ordinality) is distinct from
      (select jsonb_agg(jsonb_build_object('name', df.original_name, 'mime', df.detected_mime_type,
      'size', df.size_bytes, 'sha256', df.content_sha256) order by df.file_position)
      from public.document_files df where df.upload_session_id = session_row.id) then
      raise exception 'Upload key metadata mismatch';
    end if;
    return jsonb_build_object('session_id', session_row.id, 'status', session_row.status, 'files', existing_files);
  end if;

  if item.status <> 'active' then raise exception 'Document request is not active'; end if;
  if case_row.status <> 'open' or case_row.is_suspended then raise exception 'Case is not active'; end if;
  if not exists (
    select 1 from public.clients cl where cl.id = case_row.client_id and cl.user_id = actor_id
  ) and not private.can_edit_legal_case(item.case_id) then
    raise exception 'Not authorized';
  end if;
  if session_row.id is not null then
    if session_row.status <> 'pending' or session_row.file_count <> position_number
      or session_row.total_bytes <> total_size or session_row.expires_at <= now() then
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
