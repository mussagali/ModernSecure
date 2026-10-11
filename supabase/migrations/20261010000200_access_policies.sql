-- ModernSecure: deny-by-default client access. Application writes use audited server APIs.
-- These policies authorize reads only; no browser role may write case data directly.

create function private.staff_role_for_current_user()
returns public.staff_role
language sql stable security definer
set search_path = ''
as $$
  select sm.role from public.staff_members sm
  where sm.user_id = (select auth.uid()) and sm.active
  limit 1
$$;

create function private.is_staff_for_case(p_case_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff_members sm
    where sm.user_id = (select auth.uid()) and sm.active
      and (sm.role in ('manager', 'admin') or exists (
        select 1 from public.case_assignments ca
        where ca.case_id = p_case_id and ca.staff_user_id = sm.user_id and ca.revoked_at is null
      ))
  )
$$;

create function private.can_read_case(p_case_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.cases c
    join public.clients cl on cl.id = c.client_id
    where c.id = p_case_id and cl.user_id = (select auth.uid())
  ) or private.is_staff_for_case(p_case_id)
$$;

create function private.can_read_client(p_client_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clients cl
    where cl.id = p_client_id and cl.user_id = (select auth.uid())
  ) or exists (
    select 1 from public.cases c
    where c.client_id = p_client_id and private.is_staff_for_case(c.id)
  ) or private.staff_role_for_current_user() in ('manager', 'admin')
$$;

create function private.can_read_service_version(p_version_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.staff_role_for_current_user() is not null or exists (
    select 1 from public.cases c
    where c.service_version_id = p_version_id and private.can_read_case(c.id)
  )
$$;

create function private.can_read_staff_profile(p_staff_user_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_staff_user_id = (select auth.uid())
    or private.staff_role_for_current_user() in ('manager', 'admin')
    or exists (
      select 1 from public.case_assignments ca
      join public.cases c on c.id = ca.case_id
      join public.clients cl on cl.id = c.client_id
      where ca.staff_user_id = p_staff_user_id and ca.revoked_at is null
        and (cl.user_id = (select auth.uid()) or private.is_staff_for_case(c.id))
    )
$$;

create function private.can_read_document_request(p_request_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.document_requests dr
    where dr.id = p_request_id and private.can_read_case(dr.case_id)
  )
$$;

create function private.is_staff_for_document_request(p_request_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.document_requests dr
    where dr.id = p_request_id and private.is_staff_for_case(dr.case_id)
  )
$$;

create function private.can_read_message(p_message_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.messages m
    where m.id = p_message_id and private.can_read_case(m.case_id)
  )
$$;

create function private.can_read_task(p_task_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id and private.can_read_case(t.case_id)
  )
$$;

create function private.is_staff_for_document_file(p_file_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.document_files df
    join public.document_requests dr on dr.id = df.request_id
    where df.id = p_file_id and private.is_staff_for_case(dr.case_id)
  )
$$;

-- Supabase grants broad public-schema defaults. Explicitly revoke them for only
-- the tables created by this project, then give authenticated users SELECT.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'profiles', 'staff_members', 'clients', 'service_templates',
    'service_template_versions', 'stage_templates', 'document_templates',
    'cases', 'case_assignments', 'case_stage_events', 'case_suspensions',
    'case_internal_notes', 'document_requests', 'upload_sessions',
    'document_files', 'document_internal_notes', 'tasks', 'task_events',
    'messages', 'message_attachments', 'message_reads', 'notifications',
    'contracts', 'payment_schedule', 'payment_receipts', 'payments',
    'consent_records', 'audit_events', 'faq_entries', 'contact_settings'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant select on table public.%I to authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
  end loop;
end;
$$;

grant usage on schema private to authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.staff_role_for_current_user() to authenticated;
grant execute on function private.is_staff_for_case(uuid) to authenticated;
grant execute on function private.can_read_case(uuid) to authenticated;
grant execute on function private.can_read_client(uuid) to authenticated;
grant execute on function private.can_read_service_version(uuid) to authenticated;
grant execute on function private.can_read_staff_profile(uuid) to authenticated;
grant execute on function private.can_read_document_request(uuid) to authenticated;
grant execute on function private.is_staff_for_document_request(uuid) to authenticated;
grant execute on function private.can_read_message(uuid) to authenticated;
grant execute on function private.can_read_task(uuid) to authenticated;
grant execute on function private.is_staff_for_document_file(uuid) to authenticated;

create policy profiles_own_read on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy staff_members_case_read on public.staff_members for select to authenticated
  using (private.can_read_staff_profile(user_id));
create policy clients_case_read on public.clients for select to authenticated
  using (private.can_read_client(id));
create policy services_case_read on public.service_templates for select to authenticated
  using (private.staff_role_for_current_user() is not null or exists (
    select 1 from public.service_template_versions v
    where v.service_id = service_templates.id and private.can_read_service_version(v.id)
  ));
create policy service_versions_case_read on public.service_template_versions for select to authenticated
  using (private.can_read_service_version(id));
create policy stages_case_read on public.stage_templates for select to authenticated
  using (private.can_read_service_version(version_id));
create policy document_templates_case_read on public.document_templates for select to authenticated
  using (private.can_read_service_version(version_id));
create policy cases_authorized_read on public.cases for select to authenticated
  using (private.can_read_case(id));
create policy assignments_case_read on public.case_assignments for select to authenticated
  using (private.can_read_case(case_id));
create policy case_stage_events_case_read on public.case_stage_events for select to authenticated
  using (private.can_read_case(case_id));
create policy suspensions_case_read on public.case_suspensions for select to authenticated
  using (private.can_read_case(case_id));
create policy internal_notes_staff_read on public.case_internal_notes for select to authenticated
  using (private.is_staff_for_case(case_id));
create policy document_requests_case_read on public.document_requests for select to authenticated
  using (private.can_read_case(case_id));
create policy upload_sessions_owner_read on public.upload_sessions for select to authenticated
  using (uploader_user_id = (select auth.uid()) or private.is_staff_for_document_request(request_id));
create policy document_files_case_read on public.document_files for select to authenticated
  using (private.can_read_document_request(request_id));
create policy document_notes_staff_read on public.document_internal_notes for select to authenticated
  using (private.is_staff_for_document_file(file_id));
create policy tasks_case_read on public.tasks for select to authenticated
  using (private.can_read_case(case_id));
create policy task_events_case_read on public.task_events for select to authenticated
  using (private.can_read_task(task_id));
create policy messages_case_read on public.messages for select to authenticated
  using (private.can_read_case(case_id));
create policy message_attachments_case_read on public.message_attachments for select to authenticated
  using (private.can_read_message(message_id));
create policy message_reads_case_read on public.message_reads for select to authenticated
  using (private.can_read_message(message_id));
create policy notifications_own_read on public.notifications for select to authenticated
  using (recipient_user_id = (select auth.uid()));
create policy contracts_case_read on public.contracts for select to authenticated
  using (private.can_read_case(case_id));
create policy payment_schedule_case_read on public.payment_schedule for select to authenticated
  using (private.can_read_case(case_id));
create policy payment_receipts_case_read on public.payment_receipts for select to authenticated
  using (private.can_read_case(case_id));
create policy payments_case_read on public.payments for select to authenticated
  using (private.can_read_case(case_id));
create policy consents_own_or_admin_read on public.consent_records for select to authenticated
  using (user_id = (select auth.uid()) or private.staff_role_for_current_user() in ('manager', 'admin'));
create policy audit_admin_read on public.audit_events for select to authenticated
  using (private.staff_role_for_current_user() in ('manager', 'admin'));
create policy faq_published_read on public.faq_entries for select to authenticated
  using (published or private.staff_role_for_current_user() is not null);
create policy contact_settings_read on public.contact_settings for select to authenticated
  using (true);

-- A message and an accepted file version cannot be silently overwritten.
create function private.reject_message_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Messages are immutable';
end;
$$;
create trigger modernsecure_messages_immutable
before update or delete on public.messages
for each row execute function private.reject_message_change();

create function private.reject_accepted_document_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'accepted' then
    raise exception 'Accepted document versions are immutable';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
create trigger modernsecure_accepted_documents_immutable
before update or delete on public.document_files
for each row execute function private.reject_accepted_document_change();

create function private.reject_audit_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Audit events are append-only';
end;
$$;
create trigger modernsecure_audit_append_only
before update or delete on public.audit_events
for each row execute function private.reject_audit_change();

revoke all on function private.reject_message_change() from public, anon, authenticated;
revoke all on function private.reject_accepted_document_change() from public, anon, authenticated;
revoke all on function private.reject_audit_change() from public, anon, authenticated;

grant usage, select on sequence public.audit_events_id_seq to service_role;
