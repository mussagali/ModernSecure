-- A request with several pages is accepted only when every file in its latest
-- submitted, non-retracted version is accepted. Pending uploads do not replace
-- the last reviewed version; a fully retracted version falls back to the prior one.
create function private.document_request_current_state(p_request_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  with latest as (
    select max(version_no) as version_no
    from public.document_files
    where request_id = p_request_id and status not in ('quarantine', 'retracted')
  ), current_files as (
    select df.status from public.document_files df
    join latest l on l.version_no = df.version_no
    where df.request_id = p_request_id and df.status not in ('quarantine', 'retracted')
  )
  select case
    when not exists (select 1 from current_files) then 'missing'
    when exists (select 1 from current_files where status = 'returned') then 'returned'
    when exists (select 1 from current_files where status = 'under_review') then 'under_review'
    when exists (select 1 from current_files where status <> 'accepted') then 'incomplete'
    else 'accepted'
  end
$$;
revoke all on function private.document_request_current_state(uuid) from public, anon, authenticated;

-- The existing close RPC checks that at least one accepted file exists. Keep
-- its audit/notification flow, but enforce the stronger version invariant at
-- the case-row boundary too, including future close entry points.
create function private.guard_case_close_document_versions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'closed' and old.status is distinct from 'closed' and (
    exists (
      select 1 from public.document_requests dr
      where dr.case_id = new.id and dr.required and dr.status = 'active'
        and private.document_request_current_state(dr.id) <> 'accepted'
    ) or exists (
      select 1 from public.document_templates dt
      where dt.version_id = new.service_version_id and dt.required
        and not exists (
          select 1 from public.document_requests dr
          where dr.case_id = new.id and dr.template_id = dt.id and dr.status = 'active'
            and private.document_request_current_state(dr.id) = 'accepted'
        )
    )
  ) then
    raise exception 'Latest required document versions are not accepted';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_case_close_document_versions() from public, anon, authenticated;
create trigger modernsecure_case_close_document_versions
  before update of status on public.cases
  for each row execute function private.guard_case_close_document_versions();

-- A client must wait for the current version to be reviewed. To correct a
-- pending submission, retract it first; accepted documents remain immutable.
create function private.guard_client_document_resubmission()
returns trigger language plpgsql security definer set search_path = '' as $$
declare current_state text;
begin
  if exists (
    select 1 from public.document_requests dr
    join public.cases c on c.id = dr.case_id
    join public.clients cl on cl.id = c.client_id
    where dr.id = new.request_id and cl.user_id = new.uploader_user_id
  ) then
    current_state := private.document_request_current_state(new.request_id);
    if current_state in ('accepted', 'under_review') then
      raise exception 'Current document version must be reviewed or retracted first';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_client_document_resubmission() from public, anon, authenticated;
create trigger modernsecure_client_document_resubmission
  before insert on public.upload_sessions
  for each row execute function private.guard_client_document_resubmission();
