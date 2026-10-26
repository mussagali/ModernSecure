-- Recheck document authority at the moment a pending upload or review is finalized.
-- The actor/assignment rows are locked so revocation serializes with these transitions.
do $$
begin
  if exists (select 1 from public.document_files
    where detected_mime_type is null or content_sha256 is null) then
    raise exception 'Existing document metadata requires review before hardening';
  end if;
end;
$$;
alter table public.document_files alter column detected_mime_type set not null;
alter table public.document_files alter column content_sha256 set not null;

create function private.lock_document_actor_access(p_case_id uuid, p_allow_client boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); actor_role public.staff_role; actor_active boolean;
begin
  if actor_id is null then return false; end if;
  if p_allow_client and exists (
    select 1 from public.cases c join public.clients cl on cl.id = c.client_id
    where c.id = p_case_id and cl.user_id = actor_id
  ) then return true; end if;
  select sm.role, sm.active into actor_role, actor_active
  from public.staff_members sm where sm.user_id = actor_id for share;
  if not coalesce(actor_active, false) then return false; end if;
  if actor_role = 'admin' then return true; end if;
  if actor_role <> 'lawyer' then return false; end if;
  perform 1 from public.case_assignments ca
  where ca.case_id = p_case_id and ca.staff_user_id = actor_id and ca.revoked_at is null for share;
  return found;
end;
$$;
revoke all on function private.lock_document_actor_access(uuid, boolean) from public, anon, authenticated;

create function private.guard_document_session_completion()
returns trigger language plpgsql security definer set search_path = '' as $$
declare request_status public.document_request_status; case_status public.case_status;
  suspended boolean; case_id uuid;
begin
  if old.status = 'pending' and new.status = 'completed' then
    if old.uploader_user_id is distinct from auth.uid() or old.expires_at <= now() then
      raise exception 'Upload session is no longer authorized';
    end if;
    select dr.status, c.status, c.is_suspended, c.id
      into request_status, case_status, suspended, case_id
      from public.document_requests dr join public.cases c on c.id = dr.case_id
      where dr.id = old.request_id for share of dr, c;
    if not found or request_status <> 'active' or case_status <> 'open' or suspended
      or not private.lock_document_actor_access(case_id, true) then
      raise exception 'Upload is no longer authorized';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_document_session_completion() from public, anon, authenticated;
create trigger modernsecure_guard_document_session_completion
before update of status on public.upload_sessions
for each row execute function private.guard_document_session_completion();

create function private.guard_document_decision()
returns trigger language plpgsql security definer set search_path = '' as $$
declare request_status public.document_request_status; case_status public.case_status;
  suspended boolean; case_id uuid;
begin
  if old.status = 'under_review' and new.status in ('accepted', 'returned', 'retracted') then
    select dr.status, c.status, c.is_suspended, c.id
      into request_status, case_status, suspended, case_id
      from public.document_requests dr join public.cases c on c.id = dr.case_id
      where dr.id = old.request_id for share of dr, c;
    if not found or request_status <> 'active' or case_status <> 'open' or suspended then
      raise exception 'Document request is no longer active';
    end if;
    if new.status = 'retracted' then
      if old.uploaded_by is distinct from auth.uid()
        or not private.lock_document_actor_access(case_id, true) then
        raise exception 'Retraction is not authorized';
      end if;
    elsif not private.lock_document_actor_access(case_id, false) then
      raise exception 'Review is not authorized';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_document_decision() from public, anon, authenticated;
create trigger modernsecure_guard_document_decision
before update of status on public.document_files
for each row execute function private.guard_document_decision();
