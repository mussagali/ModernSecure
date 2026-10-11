-- Two bounded cleanup passes let a late in-flight transfer be removed later.
alter table public.upload_sessions add column cleanup_passes smallint not null default 0
  check (cleanup_passes between 0 and 2);
alter table public.upload_sessions add column last_cleanup_at timestamptz;
alter table public.upload_sessions add constraint upload_cleanup_state check (
  (cleanup_passes = 0 and last_cleanup_at is null)
  or (cleanup_passes > 0 and last_cleanup_at is not null and status = 'expired')
);

create or replace function public.resume_or_begin_document_upload(p_request_id uuid, p_idempotency_key text, p_files jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); reusable_key text;
begin
  if actor_id is null then raise exception 'Not authenticated'; end if;
  if p_files is null or jsonb_typeof(p_files) <> 'array' then raise exception 'Invalid upload batch'; end if;
  select us.idempotency_key into reusable_key
  from public.upload_sessions us
  where us.request_id = p_request_id and us.uploader_user_id = actor_id
    and ((us.status = 'pending' and us.expires_at > now())
      or (us.status = 'completed' and us.created_at > now() - interval '1 hour'))
    and (select jsonb_agg(jsonb_build_object('name', df.original_name, 'mime', df.detected_mime_type,
        'size', df.size_bytes, 'sha256', df.content_sha256) order by df.file_position)
      from public.document_files df where df.upload_session_id = us.id) = p_files
  order by case when us.status = 'pending' then 0 else 1 end, us.created_at desc limit 1;
  return public.begin_document_upload(p_request_id, coalesce(reusable_key, p_idempotency_key), p_files);
end;
$$;
