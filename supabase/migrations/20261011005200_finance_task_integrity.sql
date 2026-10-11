-- Storage SDK upload metadata is persisted in storage.objects.user_metadata.
-- Refuse to deploy this guard against a Storage schema without that column.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'storage.objects'::regclass
      and attname = 'user_metadata' and atttypid = 'jsonb'::regtype
      and not attisdropped
  ) then
    raise exception 'Storage user_metadata is required for financial file registration';
  end if;
end;
$$;

-- Only files uploaded by the checked server routes carry the digest they
-- computed from the bytes. Size and MIME type alone do not bind that digest.
create or replace function private.guard_financial_file_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(new.storage_path));

  if new.size_bytes is null or new.detected_mime_type is null or new.content_sha256 is null
    or not exists (
      select 1 from storage.objects obj
      where obj.bucket_id = 'modernsecure-files' and obj.name = new.storage_path
        and obj.metadata->>'size' ~ '^[0-9]+$'
        and (obj.metadata->>'size')::bigint = new.size_bytes
        and obj.metadata->>'mimetype' = new.detected_mime_type
        and obj.user_metadata->>'sha256' = new.content_sha256
    ) then
    raise exception 'Financial file not found or metadata mismatch';
  end if;
  return new;
end;
$$;

-- Keep the public boundary and the private implementation independently safe.
create or replace function public.staff_review_task(p_task_id uuid, p_accept boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare case_id uuid; case_state public.cases%rowtype;
begin
  if p_accept is null then raise exception 'Task review decision is required'; end if;
  select t.case_id into case_id from public.tasks t where t.id = p_task_id;
  if case_id is null or not private.lock_legal_case_editor(case_id) then raise exception 'Not authorized'; end if;
  select * into case_state from public.cases where id = case_id for update;
  if not found or case_state.status <> 'open' or case_state.is_suspended then
    raise exception 'Case is not active';
  end if;
  perform private.staff_review_task(p_task_id, p_accept, p_note);
end;
$$;

create or replace function private.staff_review_task(p_task_id uuid, p_accept boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); item public.tasks%rowtype; client_user_id uuid;
  clean_note text := nullif(trim(p_note), '');
begin
  select * into item from public.tasks where id = p_task_id for update;
  if actor_id is null or not found or not private.is_staff_for_case(item.case_id) then raise exception 'Not authorized'; end if;
  if p_accept is null or item.status <> 'response_sent'
    or (not p_accept and clean_note is null) or length(coalesce(clean_note, '')) > 2000 then
    raise exception 'Invalid task review';
  end if;
  update public.tasks set status = case when p_accept then 'completed'::public.task_status else 'new'::public.task_status end,
    completed_by = case when p_accept then actor_id else null end,
    completed_at = case when p_accept then now() else null end, updated_at = now() where id = p_task_id;
  insert into public.task_events (task_id, actor_user_id, action, response_text)
  values (p_task_id, actor_id, case when p_accept then 'completed' else 'returned' end, clean_note);
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, reason)
  values (actor_id, item.case_id, 'task', p_task_id, case when p_accept then 'completed' else 'returned' end, clean_note);
  select cl.user_id into client_user_id from public.cases c join public.clients cl on cl.id = c.client_id where c.id = item.case_id;
  if client_user_id is not null then
    insert into public.notifications (recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
    values (client_user_id, item.case_id, 'task_review', case when p_accept then 'Задача выполнена' else 'Задача возвращена' end,
      clean_note, '/account/cases/' || item.case_id || '/tasks', 'task-review:' || p_task_id || ':' || gen_random_uuid());
  end if;
end;
$$;
