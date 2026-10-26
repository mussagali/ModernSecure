-- An existing key belongs to its original batch, even when another matching batch is pending.
-- New form keys may still resume an interrupted pending batch with identical files.
create or replace function public.resume_or_begin_document_upload(p_request_id uuid, p_idempotency_key text, p_files jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); reusable_key text;
begin
  if actor_id is null then raise exception 'Not authenticated'; end if;
  if p_files is null or jsonb_typeof(p_files) <> 'array' then raise exception 'Invalid upload batch'; end if;

  -- Serialize key selection with begin_document_upload, which locks this same request.
  perform 1 from public.document_requests where id = p_request_id for update;

  if exists (select 1 from public.upload_sessions us
    where us.request_id = p_request_id and us.uploader_user_id = actor_id
      and us.idempotency_key = p_idempotency_key) then
    return public.begin_document_upload(p_request_id, p_idempotency_key, p_files);
  end if;

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
