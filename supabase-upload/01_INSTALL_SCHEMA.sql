-- MODERNSECURE: установка в другой, ПУСТОЙ проект Supabase.
-- Выполнять целиком в SQL Editor от postgres. Повторный запуск запрещён.
-- Не переносит пользователей, пароли, записи или файлы старого проекта.
-- Сначала выполните 00_INSPECT.sql. Настройки Auth см. в README.md.
begin;
set local statement_timeout = '120s';
do $preflight$
begin
  if exists (select 1 from pg_tables where schemaname in ('public', 'private'))
    or exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','private') and not exists (
        select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e'))
    or exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
      where n.nspname in ('public','private') and t.typtype='e') then
    raise exception 'STOP: public/private already contains application objects. Do not delete them; prepare a migration for this database.';
  end if;
  if exists (select 1 from storage.buckets where id in ('modernsecure-files','modernsecure-previews'))
    or exists (select 1 from pg_policies where schemaname='storage' and tablename='objects') then
    raise exception 'STOP: existing Storage configuration must be reviewed before installation.';
  end if;
  if to_regclass('auth.users') is null or to_regclass('auth.mfa_factors') is null then
    raise exception 'Run this script in a Supabase project, not a plain PostgreSQL database.';
  end if;
end;
$preflight$;
create schema if not exists extensions;
do $crypto$
begin
  if exists (select 1 from pg_available_extensions where name='pgcrypto') then
    create extension if not exists pgcrypto with schema extensions;
  end if;
  if to_regprocedure('extensions.digest(text,text)') is null then
    raise exception 'pgcrypto must provide extensions.digest(text,text); review extension schema.';
  end if;
end;
$crypto$;

-- BEGIN 20261010000100_core_schema.sql
-- ModernSecure: initial data model. Apply only to an inspected, empty project.
-- No demo people or case data are inserted by this migration.

create schema if not exists private;

create type public.staff_role as enum ('lawyer', 'manager', 'admin');
create type public.case_status as enum ('open', 'closed', 'cancelled');
create type public.document_request_status as enum ('active', 'cancelled', 'not_required');
create type public.document_file_status as enum ('quarantine', 'under_review', 'accepted', 'returned', 'retracted');
create type public.task_kind as enum ('upload_document', 'answer', 'acknowledge', 'contact');
create type public.task_status as enum ('new', 'response_sent', 'completed', 'cancelled');
create type public.receipt_status as enum ('under_review', 'accepted', 'rejected');
create type public.payment_status as enum ('confirmed', 'void');

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete restrict,
  email text not null,
  display_name text,
  phone text,
  city text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.staff_members (
  user_id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null,
  work_phone text,
  role public.staff_role not null,
  can_confirm_payments boolean not null default false,
  can_bulk_export boolean not null default false,
  can_delete boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete restrict,
  full_name text not null,
  email text,
  phone text,
  iin text,
  city text,
  linked_by uuid references public.staff_members(user_id) on delete restrict,
  linked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clients_iin_format check (iin is null or iin ~ '^[0-9]{12}$'),
  constraint clients_link_audit check ((user_id is null and linked_at is null and linked_by is null) or (user_id is not null and linked_at is not null and linked_by is not null))
);

create table public.service_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.service_template_versions (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.service_templates(id) on delete restrict,
  version_no integer not null check (version_no > 0),
  published_at timestamptz,
  created_by uuid references public.staff_members(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (service_id, version_no)
);

create table public.stage_templates (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.service_template_versions(id) on delete restrict,
  position integer not null check (position > 0),
  title text not null,
  client_description text,
  unique (version_id, position)
);

create table public.document_templates (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.service_template_versions(id) on delete restrict,
  title text not null,
  instructions text,
  required boolean not null default true,
  sample_storage_path text,
  position integer not null default 1 check (position > 0),
  unique (version_id, position)
);

create table public.cases (
  id uuid primary key default gen_random_uuid(),
  case_number text not null unique,
  client_id uuid not null references public.clients(id) on delete restrict,
  service_version_id uuid not null references public.service_template_versions(id) on delete restrict,
  title text not null,
  status public.case_status not null default 'open',
  current_stage_id uuid references public.stage_templates(id) on delete restrict,
  is_suspended boolean not null default false,
  next_review_at timestamptz,
  result_summary text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cases_closed_result check (status <> 'closed' or (closed_at is not null and nullif(trim(result_summary), '') is not null))
);

create table public.case_assignments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete restrict,
  staff_user_id uuid not null references public.staff_members(user_id) on delete restrict,
  assigned_by uuid references public.staff_members(user_id) on delete restrict,
  assigned_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint case_assignments_dates check (revoked_at is null or revoked_at >= assigned_at)
);
create unique index case_assignments_active_unique on public.case_assignments(case_id, staff_user_id) where revoked_at is null;

create table public.case_stage_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete restrict,
  from_stage_id uuid references public.stage_templates(id) on delete restrict,
  to_stage_id uuid not null references public.stage_templates(id) on delete restrict,
  actor_user_id uuid not null references public.staff_members(user_id) on delete restrict,
  client_note text not null,
  change_reason text,
  occurred_at timestamptz not null default now()
);

create table public.case_suspensions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete restrict,
  reason_for_client text not null,
  control_at timestamptz,
  started_by uuid not null references public.staff_members(user_id) on delete restrict,
  started_at timestamptz not null default now(),
  ended_by uuid references public.staff_members(user_id) on delete restrict,
  ended_at timestamptz,
  constraint case_suspensions_end check ((ended_at is null and ended_by is null) or (ended_at is not null and ended_by is not null and ended_at >= started_at))
);
create unique index case_suspensions_one_active on public.case_suspensions(case_id) where ended_at is null;

create table public.case_internal_notes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete restrict,
  author_user_id uuid not null references public.staff_members(user_id) on delete restrict,
  body text not null,
  created_at timestamptz not null default now()
);

create table public.document_requests (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete restrict,
  template_id uuid references public.document_templates(id) on delete restrict,
  title text not null,
  instructions text,
  required boolean not null default true,
  due_at timestamptz,
  assigned_staff_id uuid references public.staff_members(user_id) on delete restrict,
  status public.document_request_status not null default 'active',
  created_by uuid references public.staff_members(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.upload_sessions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.document_requests(id) on delete restrict,
  uploader_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key text not null,
  status text not null default 'pending' check (status in ('pending', 'completed', 'expired', 'cancelled')),
  file_count integer not null default 0 check (file_count between 0 and 10),
  total_bytes bigint not null default 0 check (total_bytes between 0 and 104857600),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (request_id, uploader_user_id, idempotency_key)
);

create table public.document_files (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.document_requests(id) on delete restrict,
  upload_session_id uuid references public.upload_sessions(id) on delete restrict,
  version_no integer not null check (version_no > 0),
  file_position integer not null check (file_position between 1 and 10),
  storage_path text not null unique,
  original_name text not null,
  detected_mime_type text,
  size_bytes bigint not null check (size_bytes between 1 and 20971520),
  status public.document_file_status not null default 'quarantine',
  preview_storage_path text,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  uploaded_at timestamptz not null default now(),
  reviewed_by uuid references public.staff_members(user_id) on delete restrict,
  reviewed_at timestamptz,
  return_reason text,
  unique (request_id, version_no, file_position),
  constraint document_files_review_state check (
    (status in ('accepted', 'returned') and reviewed_by is not null and reviewed_at is not null)
    or (status not in ('accepted', 'returned'))
  ),
  constraint document_files_return_reason check (status <> 'returned' or nullif(trim(return_reason), '') is not null)
);

create table public.document_internal_notes (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.document_files(id) on delete restrict,
  author_user_id uuid not null references public.staff_members(user_id) on delete restrict,
  body text not null,
  created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete restrict,
  document_request_id uuid references public.document_requests(id) on delete restrict,
  kind public.task_kind not null,
  title text not null,
  description text,
  status public.task_status not null default 'new',
  due_at timestamptz,
  created_by uuid references public.staff_members(user_id) on delete restrict,
  completed_by uuid references public.staff_members(user_id) on delete restrict,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_completion check (status <> 'completed' or completed_at is not null)
);

create table public.task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('created', 'responded', 'acknowledged', 'completed', 'returned', 'cancelled')),
  response_text text,
  acknowledged_version text,
  occurred_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete restrict,
  sender_user_id uuid not null references auth.users(id) on delete restrict,
  body text not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (case_id, sender_user_id, idempotency_key)
);

create table public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete restrict,
  storage_path text not null unique,
  original_name text not null,
  detected_mime_type text,
  size_bytes bigint not null check (size_bytes between 1 and 20971520),
  created_at timestamptz not null default now()
);

create table public.message_reads (
  message_id uuid not null references public.messages(id) on delete restrict,
  reader_user_id uuid not null references auth.users(id) on delete restrict,
  read_at timestamptz not null default now(),
  primary key (message_id, reader_user_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users(id) on delete restrict,
  case_id uuid references public.cases(id) on delete restrict,
  kind text not null,
  title text not null,
  body text,
  target_path text,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (recipient_user_id, dedupe_key)
);

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete restrict,
  version_no integer not null check (version_no > 0),
  contract_number text not null,
  signed_on date,
  price_kzt numeric(14, 2) not null check (price_kzt >= 0),
  storage_path text not null unique,
  created_by uuid references public.staff_members(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (case_id, version_no)
);

create table public.payment_schedule (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete restrict,
  due_on date not null,
  amount_kzt numeric(14, 2) not null check (amount_kzt > 0),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete restrict,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  storage_path text not null unique,
  original_name text not null,
  status public.receipt_status not null default 'under_review',
  review_note text,
  reviewed_by uuid references public.staff_members(user_id) on delete restrict,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete restrict,
  schedule_id uuid references public.payment_schedule(id) on delete restrict,
  receipt_id uuid references public.payment_receipts(id) on delete restrict,
  amount_kzt numeric(14, 2) not null check (amount_kzt > 0),
  paid_on date not null,
  status public.payment_status not null default 'confirmed',
  confirmed_by uuid not null references public.staff_members(user_id) on delete restrict,
  client_note text,
  created_at timestamptz not null default now()
);

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  document_type text not null,
  version text not null,
  document_hash text not null,
  accepted_at timestamptz not null default now(),
  unique (user_id, document_type, version)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete restrict,
  case_id uuid references public.cases(id) on delete restrict,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  reason text,
  request_id text,
  occurred_at timestamptz not null default now()
);

create table public.faq_entries (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer text not null,
  position integer not null default 1,
  published boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.contact_settings (
  id boolean primary key default true check (id),
  phone text,
  whatsapp_url text,
  email text,
  business_hours text,
  response_expectation text,
  updated_at timestamptz not null default now()
);

-- Lookup and timeline indexes. A later migration may add indexes from measured queries.
create index cases_client_idx on public.cases(client_id);
create index cases_status_idx on public.cases(status);
create index case_assignments_staff_idx on public.case_assignments(staff_user_id, revoked_at);
create index case_stage_events_case_time_idx on public.case_stage_events(case_id, occurred_at desc);
create index case_suspensions_case_idx on public.case_suspensions(case_id, started_at desc);
create index document_requests_case_idx on public.document_requests(case_id, status);
create index document_files_request_idx on public.document_files(request_id, uploaded_at desc);
create index tasks_case_status_idx on public.tasks(case_id, status, due_at);
create index messages_case_time_idx on public.messages(case_id, created_at desc);
create index notifications_recipient_time_idx on public.notifications(recipient_user_id, created_at desc);
create index contracts_case_idx on public.contracts(case_id, version_no desc);
create index payment_schedule_case_idx on public.payment_schedule(case_id, due_on);
create index payment_receipts_case_idx on public.payment_receipts(case_id, created_at desc);
create index payments_case_idx on public.payments(case_id, paid_on desc) where status = 'confirmed';
create index audit_events_case_time_idx on public.audit_events(case_id, occurred_at desc);
create index audit_events_actor_time_idx on public.audit_events(actor_user_id, occurred_at desc);

-- Auth creates a limited profile. It does NOT link a user to a client or case.
create function private.sync_auth_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (user_id) do update
    set email = excluded.email, updated_at = now();
  return new;
end;
$$;

create trigger modernsecure_auth_profile_sync
after insert or update of email on auth.users
for each row execute function private.sync_auth_profile();

revoke all on function private.sync_auth_profile() from public, anon, authenticated;
-- END 20261010000100_core_schema.sql

-- BEGIN 20261010000200_access_policies.sql
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
-- END 20261010000200_access_policies.sql

-- BEGIN 20261010000300_private_storage.sql
-- Private objects only. No authenticated/anon storage.objects policy is created:
-- file transfer is intentionally reserved for checked server endpoints.
-- Inspect existing storage.objects policies before deploying to a reused project.

do $$
begin
  if exists (select 1 from storage.buckets where id in ('modernsecure-files', 'modernsecure-previews')) then
    raise exception 'ModernSecure bucket already exists; inspect it before applying migration';
  end if;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'modernsecure-files',
    'modernsecure-files',
    false,
    20971520,
    array['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif']
  ),
  (
    'modernsecure-previews',
    'modernsecure-previews',
    false,
    20971520,
    array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
  );
-- END 20261010000300_private_storage.sql

-- BEGIN 20261010000400_client_account_link.sql
-- A verified account may be linked to an existing client card only by an active
-- manager or administrator. The operation and audit row share one transaction.
create function public.link_client_account(p_client_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_id uuid;
  existing_user_id uuid;
begin
  if actor_id is null or not coalesce(private.staff_role_for_current_user() in ('manager', 'admin'), false) then
    raise exception 'Not authorized';
  end if;

  if p_client_id is null or p_email is null or length(trim(p_email)) > 254 or length(trim(p_email)) < 3 then
    raise exception 'Invalid input';
  end if;

  select cl.user_id into existing_user_id
  from public.clients cl where cl.id = p_client_id for update;
  if not found or existing_user_id is not null then
    raise exception 'Client card is unavailable';
  end if;

  select u.id into target_id
  from auth.users u
  where lower(u.email) = lower(trim(p_email)) and u.email_confirmed_at is not null;
  if target_id is null then
    raise exception 'Verified account not found';
  end if;
  if exists (select 1 from public.clients cl where cl.user_id = target_id) then
    raise exception 'Account is already linked';
  end if;

  update public.clients
  set user_id = target_id, linked_by = actor_id, linked_at = now(), updated_at = now()
  where id = p_client_id;

  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
  values (actor_id, 'client', p_client_id, 'account_linked', jsonb_build_object('user_id', target_id));
end;
$$;

revoke all on function public.link_client_account(uuid, text) from public, anon;
grant execute on function public.link_client_account(uuid, text) to authenticated;
-- END 20261010000400_client_account_link.sql

-- BEGIN 20261010000500_staff_workflows.sql
-- First operational staff workflows. Every mutation checks the current JWT
-- identity inside PostgreSQL and writes its audit row in the same transaction.
create sequence public.case_number_seq;

create function public.staff_create_client(
  p_full_name text, p_email text default null, p_phone text default null, p_city text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  new_id uuid;
  clean_name text := nullif(trim(p_full_name), '');
  clean_email text := nullif(lower(trim(p_email)), '');
begin
  if actor_id is null or not coalesce(private.staff_role_for_current_user() in ('manager', 'admin'), false) then
    raise exception 'Not authorized';
  end if;
  if clean_name is null or length(clean_name) > 160
    or length(coalesce(clean_email, '')) > 254
    or (clean_email is not null and clean_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
    or length(coalesce(p_phone, '')) > 40 or length(coalesce(p_city, '')) > 120 then
    raise exception 'Invalid client details';
  end if;

  insert into public.clients (full_name, email, phone, city)
  values (clean_name, clean_email, nullif(trim(p_phone), ''), nullif(trim(p_city), ''))
  returning id into new_id;
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action)
  values (actor_id, 'client', new_id, 'created');
  return new_id;
end;
$$;

create function public.admin_create_service(p_name text, p_stages text[])
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  new_service_id uuid := gen_random_uuid();
  new_version_id uuid;
  stage_title text;
  stage_index integer;
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  if nullif(trim(p_name), '') is null or length(trim(p_name)) > 160
    or coalesce(array_length(p_stages, 1), 0) not between 1 and 12 then
    raise exception 'Invalid service details';
  end if;
  for stage_index in 1..array_length(p_stages, 1) loop
    stage_title := nullif(trim(p_stages[stage_index]), '');
    if stage_title is null or length(stage_title) > 120 then
      raise exception 'Invalid stage title';
    end if;
  end loop;

  insert into public.service_templates (id, code, name)
  values (new_service_id, 'svc-' || replace(new_service_id::text, '-', ''), trim(p_name));
  insert into public.service_template_versions (service_id, version_no, published_at, created_by)
  values (new_service_id, 1, now(), actor_id) returning id into new_version_id;
  for stage_index in 1..array_length(p_stages, 1) loop
    insert into public.stage_templates (version_id, position, title)
    values (new_version_id, stage_index, trim(p_stages[stage_index]));
  end loop;
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
  values (actor_id, 'service_template', new_service_id, 'created', jsonb_build_object('version_id', new_version_id));
  return new_service_id;
end;
$$;

create function public.staff_create_case(p_client_id uuid, p_version_id uuid, p_title text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  first_stage_id uuid;
  new_id uuid;
  new_number text;
begin
  if actor_id is null or not coalesce(private.staff_role_for_current_user() in ('manager', 'admin'), false) then
    raise exception 'Not authorized';
  end if;
  if p_client_id is null or p_version_id is null
    or nullif(trim(p_title), '') is null or length(trim(p_title)) > 180 then
    raise exception 'Invalid case details';
  end if;
  if not exists (select 1 from public.clients where id = p_client_id) then
    raise exception 'Client card not found';
  end if;
  if not exists (select 1 from public.service_template_versions where id = p_version_id and published_at is not null) then
    raise exception 'Published service version not found';
  end if;
  select id into first_stage_id from public.stage_templates
  where version_id = p_version_id order by position limit 1;
  if first_stage_id is null then
    raise exception 'Service has no stages';
  end if;
  new_number := 'MS-' || to_char(now() at time zone 'Asia/Almaty', 'YYYY') || '-'
    || lpad(nextval('public.case_number_seq')::text, 6, '0');
  insert into public.cases (case_number, client_id, service_version_id, title, current_stage_id)
  values (new_number, p_client_id, p_version_id, trim(p_title), first_stage_id)
  returning id into new_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action)
  values (actor_id, new_id, 'case', new_id, 'created');
  return new_id;
end;
$$;

create function public.staff_change_case_stage(
  p_case_id uuid, p_expected_stage_id uuid, p_to_stage_id uuid,
  p_client_note text, p_change_reason text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  old_stage_id uuid;
  case_version_id uuid;
  case_status public.case_status;
  suspended boolean;
  old_position integer;
  new_position integer;
begin
  if actor_id is null or not private.is_staff_for_case(p_case_id) then
    raise exception 'Not authorized';
  end if;
  if p_case_id is null or p_to_stage_id is null
    or nullif(trim(p_client_note), '') is null or length(trim(p_client_note)) > 2000
    or length(coalesce(p_change_reason, '')) > 1000 then
    raise exception 'Invalid stage change';
  end if;

  select current_stage_id, service_version_id, status, is_suspended
  into old_stage_id, case_version_id, case_status, suspended
  from public.cases where id = p_case_id for update;
  if not found or case_status <> 'open' or suspended then
    raise exception 'Case is not active';
  end if;
  if old_stage_id is distinct from p_expected_stage_id then
    raise exception 'Case was changed by another user';
  end if;
  if old_stage_id is not distinct from p_to_stage_id then
    raise exception 'Stage is unchanged';
  end if;
  select st.position into new_position from public.stage_templates st
  where st.id = p_to_stage_id and st.version_id = case_version_id;
  if new_position is null then
    raise exception 'Stage does not belong to this service';
  end if;
  select position into old_position from public.stage_templates where id = old_stage_id;
  if old_position is not null and new_position < old_position
    and nullif(trim(p_change_reason), '') is null then
    raise exception 'Rollback reason is required';
  end if;

  update public.cases set current_stage_id = p_to_stage_id, updated_at = now()
  where id = p_case_id;
  insert into public.case_stage_events
    (case_id, from_stage_id, to_stage_id, actor_user_id, client_note, change_reason)
  values (p_case_id, old_stage_id, p_to_stage_id, actor_id, trim(p_client_note), nullif(trim(p_change_reason), ''));
  insert into public.audit_events
    (actor_user_id, case_id, entity_type, entity_id, action, before_data, after_data, reason)
  values (actor_id, p_case_id, 'case', p_case_id, 'stage_changed',
    jsonb_build_object('stage_id', old_stage_id), jsonb_build_object('stage_id', p_to_stage_id),
    nullif(trim(p_change_reason), ''));
end;
$$;

revoke all on function public.staff_create_client(text, text, text, text) from public, anon;
revoke all on function public.admin_create_service(text, text[]) from public, anon;
revoke all on function public.staff_create_case(uuid, uuid, text) from public, anon;
revoke all on function public.staff_change_case_stage(uuid, uuid, uuid, text, text) from public, anon;
grant execute on function public.staff_create_client(text, text, text, text) to authenticated;
grant execute on function public.admin_create_service(text, text[]) to authenticated;
grant execute on function public.staff_create_case(uuid, uuid, text) to authenticated;
grant execute on function public.staff_change_case_stage(uuid, uuid, uuid, text, text) to authenticated;
-- END 20261010000500_staff_workflows.sql

-- BEGIN 20261011000600_case_workflows.sql
-- Case-scoped operations. The database, not a rendered form, enforces ownership.
create function public.staff_assign_case(p_case_id uuid, p_staff_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); new_id uuid;
begin
  if actor_id is null or not coalesce(private.staff_role_for_current_user() in ('manager', 'admin'), false) then
    raise exception 'Not authorized';
  end if;
  if not exists (select 1 from public.cases where id = p_case_id)
    or not exists (select 1 from public.staff_members where user_id = p_staff_user_id and active) then
    raise exception 'Case or staff member not found';
  end if;
  insert into public.case_assignments (case_id, staff_user_id, assigned_by)
  values (p_case_id, p_staff_user_id, actor_id)
  on conflict (case_id, staff_user_id) where revoked_at is null do nothing
  returning id into new_id;
  if new_id is null then raise exception 'Already assigned'; end if;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
  values (actor_id, p_case_id, 'case_assignment', new_id, 'created', jsonb_build_object('staff_user_id', p_staff_user_id));
  insert into public.notifications (recipient_user_id, case_id, kind, title, target_path, dedupe_key)
  values (p_staff_user_id, p_case_id, 'case_assignment', 'Вам назначено дело', '/staff/cases/' || p_case_id, 'assignment:' || new_id);
  return new_id;
end;
$$;

create function public.staff_create_task(p_case_id uuid, p_kind public.task_kind, p_title text, p_description text default null, p_due_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); new_id uuid; client_user_id uuid;
begin
  if actor_id is null or not private.is_staff_for_case(p_case_id) then raise exception 'Not authorized'; end if;
  if p_kind is null or p_kind = 'upload_document' or nullif(trim(p_title), '') is null
    or length(trim(p_title)) > 180 or length(coalesce(p_description, '')) > 2000 then
    raise exception 'Invalid task';
  end if;
  if not exists (select 1 from public.cases where id = p_case_id and status = 'open' and not is_suspended) then
    raise exception 'Case is not active';
  end if;
  insert into public.tasks (case_id, kind, title, description, due_at, created_by)
  values (p_case_id, p_kind, trim(p_title), nullif(trim(p_description), ''), p_due_at, actor_id)
  returning id into new_id;
  insert into public.task_events (task_id, actor_user_id, action) values (new_id, actor_id, 'created');
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action)
  values (actor_id, p_case_id, 'task', new_id, 'created');
  select cl.user_id into client_user_id from public.cases c join public.clients cl on cl.id = c.client_id where c.id = p_case_id;
  if client_user_id is not null then
    insert into public.notifications (recipient_user_id, case_id, kind, title, target_path, dedupe_key)
    values (client_user_id, p_case_id, 'task', 'Новая задача: ' || trim(p_title), '/account/cases/' || p_case_id || '/tasks', 'task:' || new_id);
  end if;
  return new_id;
end;
$$;

create function public.client_respond_task(p_task_id uuid, p_response text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); item public.tasks%rowtype; response_body text := nullif(trim(p_response), ''); staff_id uuid; event_id uuid;
begin
  select * into item from public.tasks where id = p_task_id for update;
  if actor_id is null or not found or not exists (
    select 1 from public.cases c join public.clients cl on cl.id = c.client_id
    where c.id = item.case_id and cl.user_id = actor_id and c.status = 'open' and not c.is_suspended
  ) then raise exception 'Not authorized'; end if;
  if item.status <> 'new' or item.kind = 'upload_document' or response_body is null or length(response_body) > 2000 then
    raise exception 'Invalid task response';
  end if;
  update public.tasks set status = 'response_sent', updated_at = now() where id = p_task_id;
  insert into public.task_events (task_id, actor_user_id, action, response_text)
  values (p_task_id, actor_id, case when item.kind = 'acknowledge' then 'acknowledged' else 'responded' end, response_body)
  returning id into event_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action)
  values (actor_id, item.case_id, 'task', p_task_id, 'responded');
  for staff_id in select ca.staff_user_id from public.case_assignments ca where ca.case_id = item.case_id and ca.revoked_at is null loop
    insert into public.notifications (recipient_user_id, case_id, kind, title, target_path, dedupe_key)
    values (staff_id, item.case_id, 'task_response', 'Ответ клиента на задачу', '/staff/cases/' || item.case_id || '/tasks', 'task-response:' || event_id);
  end loop;
end;
$$;

create function public.staff_review_task(p_task_id uuid, p_accept boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); item public.tasks%rowtype; client_user_id uuid; clean_note text := nullif(trim(p_note), '');
begin
  select * into item from public.tasks where id = p_task_id for update;
  if actor_id is null or not found or not private.is_staff_for_case(item.case_id) then raise exception 'Not authorized'; end if;
  if item.status <> 'response_sent' or (not p_accept and clean_note is null) or length(coalesce(clean_note, '')) > 2000 then
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

create function public.staff_create_document_request(p_case_id uuid, p_title text, p_instructions text default null, p_required boolean default true, p_due_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); new_id uuid; client_user_id uuid;
begin
  if actor_id is null or not private.is_staff_for_case(p_case_id) then raise exception 'Not authorized'; end if;
  if nullif(trim(p_title), '') is null or length(trim(p_title)) > 180 or length(coalesce(p_instructions, '')) > 2000 then
    raise exception 'Invalid document request';
  end if;
  if not exists (select 1 from public.cases where id = p_case_id and status = 'open' and not is_suspended) then
    raise exception 'Case is not active';
  end if;
  insert into public.document_requests (case_id, title, instructions, required, due_at, assigned_staff_id, created_by)
  values (p_case_id, trim(p_title), nullif(trim(p_instructions), ''), coalesce(p_required, true), p_due_at, actor_id, actor_id)
  returning id into new_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action)
  values (actor_id, p_case_id, 'document_request', new_id, 'created');
  select cl.user_id into client_user_id from public.cases c join public.clients cl on cl.id = c.client_id where c.id = p_case_id;
  if client_user_id is not null then
    insert into public.notifications (recipient_user_id, case_id, kind, title, target_path, dedupe_key)
    values (client_user_id, p_case_id, 'document_request', 'Запрошен документ: ' || trim(p_title), '/account/cases/' || p_case_id || '/documents', 'document-request:' || new_id);
  end if;
  return new_id;
end;
$$;

create function public.post_case_message(p_case_id uuid, p_body text, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); new_id uuid; client_user_id uuid; staff_id uuid; is_client boolean;
begin
  if actor_id is null or not private.can_read_case(p_case_id) then raise exception 'Not authorized'; end if;
  if nullif(trim(p_body), '') is null or length(trim(p_body)) > 4000
    or nullif(trim(p_idempotency_key), '') is null or length(trim(p_idempotency_key)) > 100 then
    raise exception 'Invalid message';
  end if;
  select cl.user_id into client_user_id from public.cases c join public.clients cl on cl.id = c.client_id where c.id = p_case_id;
  is_client := actor_id = client_user_id;
  if not is_client and not private.is_staff_for_case(p_case_id) then raise exception 'Not authorized'; end if;
  insert into public.messages (case_id, sender_user_id, body, idempotency_key)
  values (p_case_id, actor_id, trim(p_body), trim(p_idempotency_key))
  on conflict (case_id, sender_user_id, idempotency_key) do nothing returning id into new_id;
  if new_id is null then
    select id into new_id from public.messages where case_id = p_case_id and sender_user_id = actor_id and idempotency_key = trim(p_idempotency_key);
    return new_id;
  end if;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action)
  values (actor_id, p_case_id, 'message', new_id, 'sent');
  if is_client then
    for staff_id in select ca.staff_user_id from public.case_assignments ca where ca.case_id = p_case_id and ca.revoked_at is null loop
      insert into public.notifications (recipient_user_id, case_id, kind, title, target_path, dedupe_key)
      values (staff_id, p_case_id, 'message', 'Новое сообщение от клиента', '/staff/cases/' || p_case_id || '/messages', 'message:' || new_id);
    end loop;
  elsif client_user_id is not null then
    insert into public.notifications (recipient_user_id, case_id, kind, title, target_path, dedupe_key)
    values (client_user_id, p_case_id, 'message', 'Новое сообщение по делу', '/account/cases/' || p_case_id || '/messages', 'message:' || new_id);
  end if;
  return new_id;
end;
$$;

create function public.mark_case_messages_read(p_case_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); marked integer;
begin
  if actor_id is null or not private.can_read_case(p_case_id) then raise exception 'Not authorized'; end if;
  insert into public.message_reads (message_id, reader_user_id)
  select m.id, actor_id from public.messages m
  where m.case_id = p_case_id and m.sender_user_id <> actor_id
  on conflict (message_id, reader_user_id) do nothing;
  get diagnostics marked = row_count;
  update public.notifications set read_at = now()
  where recipient_user_id = actor_id and case_id = p_case_id and kind = 'message' and read_at is null;
  return marked;
end;
$$;

create function public.mark_case_notifications_read(p_case_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); marked integer;
begin
  if actor_id is null or not private.can_read_case(p_case_id) then raise exception 'Not authorized'; end if;
  update public.notifications set read_at = now()
  where recipient_user_id = actor_id and case_id = p_case_id and read_at is null;
  get diagnostics marked = row_count;
  return marked;
end;
$$;

-- Stage events must also surface in the same client inbox.
create function private.notify_case_stage()
returns trigger language plpgsql security definer set search_path = '' as $$
declare client_user_id uuid;
begin
  select cl.user_id into client_user_id from public.cases c join public.clients cl on cl.id = c.client_id where c.id = new.case_id;
  if client_user_id is not null then
    insert into public.notifications (recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
    values (client_user_id, new.case_id, 'stage', 'Этап дела обновлён', new.client_note,
      '/account/cases/' || new.case_id, 'stage:' || new.id);
  end if;
  return new;
end;
$$;
create trigger modernsecure_case_stage_notify after insert on public.case_stage_events
for each row execute function private.notify_case_stage();
revoke all on function private.notify_case_stage() from public, anon, authenticated;

revoke all on function public.staff_assign_case(uuid, uuid) from public, anon;
revoke all on function public.staff_create_task(uuid, public.task_kind, text, text, timestamptz) from public, anon;
revoke all on function public.client_respond_task(uuid, text) from public, anon;
revoke all on function public.staff_review_task(uuid, boolean, text) from public, anon;
revoke all on function public.staff_create_document_request(uuid, text, text, boolean, timestamptz) from public, anon;
revoke all on function public.post_case_message(uuid, text, text) from public, anon;
revoke all on function public.mark_case_messages_read(uuid) from public, anon;
revoke all on function public.mark_case_notifications_read(uuid) from public, anon;
grant execute on function public.staff_assign_case(uuid, uuid) to authenticated;
grant execute on function public.staff_create_task(uuid, public.task_kind, text, text, timestamptz) to authenticated;
grant execute on function public.client_respond_task(uuid, text) to authenticated;
grant execute on function public.staff_review_task(uuid, boolean, text) to authenticated;
grant execute on function public.staff_create_document_request(uuid, text, text, boolean, timestamptz) to authenticated;
grant execute on function public.post_case_message(uuid, text, text) to authenticated;
grant execute on function public.mark_case_messages_read(uuid) to authenticated;
grant execute on function public.mark_case_notifications_read(uuid) to authenticated;
-- END 20261011000600_case_workflows.sql

-- BEGIN 20261011000700_admin_scope.sql
-- Global audit visibility belongs to the main administrator, not managers/lawyers.
drop policy audit_admin_read on public.audit_events;
create policy audit_admin_read on public.audit_events for select to authenticated
  using (private.staff_role_for_current_user() = 'admin');

-- An administrator may onboard an existing, email-verified Auth account as staff.
-- This does not create an Auth password or silently grant case access to lawyers.
create function public.admin_add_staff(p_email text, p_display_name text, p_role public.staff_role)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  clean_email text := nullif(lower(trim(p_email)), '');
  clean_name text := nullif(trim(p_display_name), '');
  target_id uuid;
  matches integer;
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  if clean_email is null or length(clean_email) > 254
    or clean_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or clean_name is null or length(clean_name) > 160
    or not coalesce(p_role in ('lawyer', 'manager'), false) then
    raise exception 'Invalid staff details';
  end if;
  select count(*)::integer into matches from auth.users u
  where lower(u.email) = clean_email and u.email_confirmed_at is not null;
  if matches <> 1 then raise exception 'Exactly one verified account is required'; end if;
  select u.id into target_id from auth.users u
  where lower(u.email) = clean_email and u.email_confirmed_at is not null;
  if exists (select 1 from public.clients where user_id = target_id)
    or exists (select 1 from public.staff_members where user_id = target_id) then
    raise exception 'Account already assigned';
  end if;
  insert into public.staff_members (user_id, display_name, role)
  values (target_id, clean_name, p_role);
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
  values (actor_id, 'staff_member', target_id, 'role_granted', jsonb_build_object('role', p_role));
  return target_id;
end;
$$;
revoke all on function public.admin_add_staff(text, text, public.staff_role) from public, anon;
grant execute on function public.admin_add_staff(text, text, public.staff_role) to authenticated;
-- END 20261011000700_admin_scope.sql

-- BEGIN 20261011000800_role_boundaries.sql
-- Portable installation: owner provisioning is a separate explicit step.
create unique index staff_one_primary_admin on public.staff_members ((role)) where role = 'admin';

-- Admin sees every case; lawyers and managers see only active assignments.
create or replace function private.is_staff_for_case(p_case_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff_members sm
    where sm.user_id = (select auth.uid()) and sm.active
      and (sm.role = 'admin' or exists (
        select 1 from public.case_assignments ca
        where ca.case_id = p_case_id and ca.staff_user_id = sm.user_id and ca.revoked_at is null
      ))
  )
$$;

-- Legal changes are made by the admin or an assigned lawyer, not by a manager.
create function private.can_edit_legal_case(p_case_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff_members sm
    where sm.user_id = (select auth.uid()) and sm.active
      and (sm.role = 'admin' or (sm.role = 'lawyer' and exists (
        select 1 from public.case_assignments ca
        where ca.case_id = p_case_id and ca.staff_user_id = sm.user_id and ca.revoked_at is null
      )))
  )
$$;
revoke all on function private.can_edit_legal_case(uuid) from public, anon, authenticated;

-- Managers no longer get a global list of staff through a direct select.
create or replace function private.can_read_staff_profile(p_staff_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_staff_user_id = (select auth.uid())
    or private.staff_role_for_current_user() = 'admin'
    or exists (
      select 1 from public.case_assignments ca
      join public.cases c on c.id = ca.case_id
      join public.clients cl on cl.id = c.client_id
      where ca.staff_user_id = p_staff_user_id and ca.revoked_at is null
        and (cl.user_id = (select auth.uid()) or private.is_staff_for_case(c.id))
    )
$$;

drop policy consents_own_or_admin_read on public.consent_records;
create policy consents_own_or_admin_read on public.consent_records for select to authenticated
  using (user_id = (select auth.uid()) or private.staff_role_for_current_user() = 'admin');

-- Keep the existing validated implementations, but make them inaccessible to
-- authenticated users directly. Public wrappers enforce the narrower role.
alter function public.staff_assign_case(uuid, uuid) set schema private;
revoke all on function private.staff_assign_case(uuid, uuid) from public, anon, authenticated;
create function public.staff_assign_case(p_case_id uuid, p_staff_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if private.staff_role_for_current_user() is distinct from 'admin' then raise exception 'Not authorized'; end if;
  return private.staff_assign_case(p_case_id, p_staff_user_id);
end;
$$;
revoke all on function public.staff_assign_case(uuid, uuid) from public, anon;
grant execute on function public.staff_assign_case(uuid, uuid) to authenticated;

alter function public.staff_create_case(uuid, uuid, text) set schema private;
revoke all on function private.staff_create_case(uuid, uuid, text) from public, anon, authenticated;
create function public.staff_create_case(p_client_id uuid, p_version_id uuid, p_title text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid; actor_id uuid := auth.uid(); assignment_id uuid;
begin
  new_id := private.staff_create_case(p_client_id, p_version_id, p_title);
  if private.staff_role_for_current_user() = 'manager' then
    insert into public.case_assignments (case_id, staff_user_id, assigned_by)
    values (new_id, actor_id, actor_id) returning id into assignment_id;
    insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
    values (actor_id, new_id, 'case_assignment', assignment_id, 'created', jsonb_build_object('staff_user_id', actor_id));
  end if;
  return new_id;
end;
$$;
revoke all on function public.staff_create_case(uuid, uuid, text) from public, anon;
grant execute on function public.staff_create_case(uuid, uuid, text) to authenticated;

alter function public.staff_change_case_stage(uuid, uuid, uuid, text, text) set schema private;
revoke all on function private.staff_change_case_stage(uuid, uuid, uuid, text, text) from public, anon, authenticated;
create function public.staff_change_case_stage(
  p_case_id uuid, p_expected_stage_id uuid, p_to_stage_id uuid,
  p_client_note text, p_change_reason text default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_edit_legal_case(p_case_id) then raise exception 'Not authorized'; end if;
  perform private.staff_change_case_stage(p_case_id, p_expected_stage_id, p_to_stage_id, p_client_note, p_change_reason);
end;
$$;
revoke all on function public.staff_change_case_stage(uuid, uuid, uuid, text, text) from public, anon;
grant execute on function public.staff_change_case_stage(uuid, uuid, uuid, text, text) to authenticated;

alter function public.staff_create_task(uuid, public.task_kind, text, text, timestamptz) set schema private;
revoke all on function private.staff_create_task(uuid, public.task_kind, text, text, timestamptz) from public, anon, authenticated;
create function public.staff_create_task(
  p_case_id uuid, p_kind public.task_kind, p_title text,
  p_description text default null, p_due_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_edit_legal_case(p_case_id) then raise exception 'Not authorized'; end if;
  return private.staff_create_task(p_case_id, p_kind, p_title, p_description, p_due_at);
end;
$$;
revoke all on function public.staff_create_task(uuid, public.task_kind, text, text, timestamptz) from public, anon;
grant execute on function public.staff_create_task(uuid, public.task_kind, text, text, timestamptz) to authenticated;

alter function public.staff_review_task(uuid, boolean, text) set schema private;
revoke all on function private.staff_review_task(uuid, boolean, text) from public, anon, authenticated;
create function public.staff_review_task(p_task_id uuid, p_accept boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare case_id uuid;
begin
  select t.case_id into case_id from public.tasks t where t.id = p_task_id;
  if case_id is null or not private.can_edit_legal_case(case_id) then raise exception 'Not authorized'; end if;
  perform private.staff_review_task(p_task_id, p_accept, p_note);
end;
$$;
revoke all on function public.staff_review_task(uuid, boolean, text) from public, anon;
grant execute on function public.staff_review_task(uuid, boolean, text) to authenticated;

alter function public.staff_create_document_request(uuid, text, text, boolean, timestamptz) set schema private;
revoke all on function private.staff_create_document_request(uuid, text, text, boolean, timestamptz) from public, anon, authenticated;
create function public.staff_create_document_request(
  p_case_id uuid, p_title text, p_instructions text default null,
  p_required boolean default true, p_due_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_edit_legal_case(p_case_id) then raise exception 'Not authorized'; end if;
  return private.staff_create_document_request(p_case_id, p_title, p_instructions, p_required, p_due_at);
end;
$$;
revoke all on function public.staff_create_document_request(uuid, text, text, boolean, timestamptz) from public, anon;
grant execute on function public.staff_create_document_request(uuid, text, text, boolean, timestamptz) to authenticated;
-- END 20261011000800_role_boundaries.sql

-- BEGIN 20261011000900_staff_access_management.sql
-- Administrative changes to staff access are explicit, audited and reversible.
create function public.admin_set_staff_access(
  p_staff_user_id uuid, p_role public.staff_role, p_active boolean, p_reason text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  before_staff public.staff_members%rowtype;
  assignment record;
  clean_reason text := nullif(trim(p_reason), '');
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  if p_staff_user_id is null or p_staff_user_id = actor_id
    or not coalesce(p_role in ('lawyer', 'manager'), false) or p_active is null
    or clean_reason is null or length(clean_reason) > 500 then
    raise exception 'Invalid staff access change';
  end if;
  select * into before_staff from public.staff_members where user_id = p_staff_user_id for update;
  if not found or before_staff.role = 'admin' then raise exception 'Protected administrator'; end if;
  if before_staff.role = p_role and before_staff.active = p_active then raise exception 'Access is unchanged'; end if;
  update public.staff_members set role = p_role, active = p_active where user_id = p_staff_user_id;
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, before_data, after_data, reason)
  values (actor_id, 'staff_member', p_staff_user_id, 'access_changed',
    jsonb_build_object('role', before_staff.role, 'active', before_staff.active),
    jsonb_build_object('role', p_role, 'active', p_active), clean_reason);
  if not p_active then
    for assignment in select id, case_id from public.case_assignments
      where staff_user_id = p_staff_user_id and revoked_at is null for update loop
      update public.case_assignments set revoked_at = now() where id = assignment.id;
      insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, reason)
      values (actor_id, assignment.case_id, 'case_assignment', assignment.id, 'revoked', clean_reason);
    end loop;
  end if;
end;
$$;

create function public.admin_revoke_case_assignment(p_assignment_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); assignment public.case_assignments%rowtype; clean_reason text := nullif(trim(p_reason), '');
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  if p_assignment_id is null or clean_reason is null or length(clean_reason) > 500 then
    raise exception 'Reason is required';
  end if;
  select * into assignment from public.case_assignments where id = p_assignment_id for update;
  if not found or assignment.revoked_at is not null then raise exception 'Active assignment not found'; end if;
  update public.case_assignments set revoked_at = now() where id = p_assignment_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, reason, before_data)
  values (actor_id, assignment.case_id, 'case_assignment', assignment.id, 'revoked', clean_reason,
    jsonb_build_object('staff_user_id', assignment.staff_user_id));
end;
$$;

revoke all on function public.admin_set_staff_access(uuid, public.staff_role, boolean, text) from public, anon;
revoke all on function public.admin_revoke_case_assignment(uuid, text) from public, anon;
grant execute on function public.admin_set_staff_access(uuid, public.staff_role, boolean, text) to authenticated;
grant execute on function public.admin_revoke_case_assignment(uuid, text) to authenticated;
-- END 20261011000900_staff_access_management.sql

-- BEGIN 20261011001000_staff_invitations.sql
-- Admin may prepare a role before the employee has an Auth account.
-- The role is activated only after the matching email is verified.
create type public.staff_invite_status as enum ('pending', 'accepted', 'cancelled');

create table public.staff_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(trim(email))),
  display_name text not null,
  role public.staff_role not null check (role in ('lawyer', 'manager')),
  status public.staff_invite_status not null default 'pending',
  created_by uuid not null references public.staff_members(user_id) on delete restrict,
  accepted_user_id uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  constraint staff_invite_accept_state check (
    (status = 'accepted' and accepted_user_id is not null and accepted_at is not null)
    or (status <> 'accepted' and accepted_user_id is null and accepted_at is null)
  )
);
create unique index staff_invites_one_pending_email on public.staff_invites(email) where status = 'pending';
create index staff_invites_status_time_idx on public.staff_invites(status, created_at desc);

alter table public.staff_invites enable row level security;
revoke all on table public.staff_invites from public, anon, authenticated;
grant select on table public.staff_invites to authenticated;
grant all on table public.staff_invites to service_role;
create policy staff_invites_admin_read on public.staff_invites for select to authenticated
  using (private.staff_role_for_current_user() = 'admin');

create function private.claim_staff_invite_for_user(p_user_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare verified_email text; invite public.staff_invites%rowtype;
begin
  select lower(u.email) into verified_email from auth.users u
  where u.id = p_user_id and u.email_confirmed_at is not null;
  if verified_email is null then return false; end if;
  select * into invite from public.staff_invites
  where email = verified_email and status = 'pending' and expires_at > now()
  for update;
  if not found then return false; end if;
  if exists (select 1 from public.clients where user_id = p_user_id)
    or exists (select 1 from public.staff_members where user_id = p_user_id) then
    return false;
  end if;
  insert into public.staff_members (user_id, display_name, role)
  values (p_user_id, invite.display_name, invite.role);
  update public.staff_invites set status = 'accepted', accepted_user_id = p_user_id,
    accepted_at = now(), updated_at = now() where id = invite.id;
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
  values (invite.created_by, 'staff_member', p_user_id, 'role_granted',
    jsonb_build_object('role', invite.role, 'invite_id', invite.id));
  return true;
end;
$$;
revoke all on function private.claim_staff_invite_for_user(uuid) from public, anon, authenticated;

create function public.claim_staff_invite()
returns boolean language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null then raise exception 'Not authenticated'; end if;
  return private.claim_staff_invite_for_user(actor_id);
end;
$$;
revoke all on function public.claim_staff_invite() from public, anon;
grant execute on function public.claim_staff_invite() to authenticated;

create function public.admin_invite_staff(p_email text, p_display_name text, p_role public.staff_role)
returns text language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  clean_email text := nullif(lower(trim(p_email)), '');
  clean_name text := nullif(trim(p_display_name), '');
  target_id uuid;
  matches integer;
  invite_id uuid;
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  if clean_email is null or length(clean_email) > 254
    or clean_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or clean_name is null or length(clean_name) > 160
    or not coalesce(p_role in ('lawyer', 'manager'), false) then
    raise exception 'Invalid staff invitation';
  end if;
  select count(*)::integer into matches from auth.users u where lower(u.email) = clean_email;
  if matches > 1 then raise exception 'Duplicate Auth email'; end if;
  if matches = 1 then
    select u.id into target_id from auth.users u where lower(u.email) = clean_email;
    if exists (select 1 from public.clients where user_id = target_id)
      or exists (select 1 from public.staff_members where user_id = target_id) then
      raise exception 'Account already has a role';
    end if;
  end if;
  insert into public.staff_invites (email, display_name, role, created_by)
  values (clean_email, clean_name, p_role, actor_id)
  on conflict (email) where status = 'pending' do update
    set display_name = excluded.display_name, role = excluded.role, created_by = excluded.created_by,
      expires_at = now() + interval '14 days', updated_at = now()
  returning id into invite_id;
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
  values (actor_id, 'staff_invite', invite_id, 'invited',
    jsonb_build_object('email', clean_email, 'role', p_role));
  if target_id is not null and private.claim_staff_invite_for_user(target_id) then
    return 'granted';
  end if;
  return 'pending';
end;
$$;
revoke all on function public.admin_invite_staff(text, text, public.staff_role) from public, anon;
grant execute on function public.admin_invite_staff(text, text, public.staff_role) to authenticated;

create function public.admin_cancel_staff_invite(p_invite_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); invite public.staff_invites%rowtype;
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  select * into invite from public.staff_invites where id = p_invite_id for update;
  if not found or invite.status <> 'pending' then raise exception 'Pending invitation not found'; end if;
  update public.staff_invites set status = 'cancelled', updated_at = now() where id = p_invite_id;
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action)
  values (actor_id, 'staff_invite', p_invite_id, 'cancelled');
end;
$$;
revoke all on function public.admin_cancel_staff_invite(uuid) from public, anon;
grant execute on function public.admin_cancel_staff_invite(uuid) to authenticated;
-- END 20261011001000_staff_invitations.sql

-- BEGIN 20261011001100_exclusive_account_roles.sql
-- A single Auth user cannot be both a staff member and a linked client.
-- Lock the Auth row so concurrent staff/client assignments cannot pass independently.
do $$
begin
  if exists (select 1 from public.clients cl join public.staff_members sm on sm.user_id = cl.user_id) then
    raise exception 'Existing staff/client role conflict requires manual review';
  end if;
end;
$$;

create function private.reject_dual_account_role()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is null then return new; end if;
  perform 1 from auth.users where id = new.user_id for update;
  if tg_table_name = 'clients' then
    if exists (select 1 from public.staff_members sm where sm.user_id = new.user_id) then
      raise exception 'Account is already staff';
    end if;
  elsif exists (select 1 from public.clients cl where cl.user_id = new.user_id) then
    raise exception 'Account is already a client';
  end if;
  return new;
end;
$$;
revoke all on function private.reject_dual_account_role() from public, anon, authenticated;
create trigger modernsecure_clients_exclusive_role
before insert or update of user_id on public.clients
for each row execute function private.reject_dual_account_role();
create trigger modernsecure_staff_exclusive_role
before insert or update of user_id on public.staff_members
for each row execute function private.reject_dual_account_role();

create or replace function public.link_client_account(p_client_id uuid, p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  target_id uuid;
  existing_user_id uuid;
begin
  if actor_id is null or not coalesce(private.staff_role_for_current_user() in ('manager', 'admin'), false) then
    raise exception 'Not authorized';
  end if;
  if p_client_id is null or p_email is null or length(trim(p_email)) > 254 or length(trim(p_email)) < 3 then
    raise exception 'Invalid input';
  end if;
  select cl.user_id into existing_user_id from public.clients cl where cl.id = p_client_id for update;
  if not found or existing_user_id is not null then raise exception 'Client card is unavailable'; end if;
  select u.id into target_id from auth.users u
    where lower(u.email) = lower(trim(p_email)) and u.email_confirmed_at is not null;
  if target_id is null then raise exception 'Verified account not found'; end if;
  if exists (select 1 from public.staff_members sm where sm.user_id = target_id) then
    raise exception 'Account is already staff';
  end if;
  if exists (select 1 from public.clients cl where cl.user_id = target_id) then
    raise exception 'Account is already linked';
  end if;
  update public.clients set user_id = target_id, linked_by = actor_id, linked_at = now(), updated_at = now()
    where id = p_client_id;
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
  values (actor_id, 'client', p_client_id, 'account_linked', jsonb_build_object('user_id', target_id));
end;
$$;
-- END 20261011001100_exclusive_account_roles.sql

-- BEGIN 20261011001200_document_uploads.sql
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
-- END 20261011001200_document_uploads.sql

-- BEGIN 20261011001300_payment_workflows.sql
-- Financial mutations are separate from staff roles and always audited.
alter table public.payments add column idempotency_key uuid;
alter table public.payments add column payment_reference text
  check (payment_reference is null or length(trim(payment_reference)) between 4 and 120);
create unique index payments_case_idempotency_key on public.payments(case_id, idempotency_key)
  where idempotency_key is not null;

create function private.can_manage_payments(p_case_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff_members sm
    where sm.user_id = (select auth.uid()) and sm.active and sm.can_confirm_payments
      and (sm.role = 'admin' or exists (
        select 1 from public.case_assignments ca
        where ca.case_id = p_case_id and ca.staff_user_id = sm.user_id and ca.revoked_at is null
      ))
  )
$$;
revoke all on function private.can_manage_payments(uuid) from public, anon, authenticated;

create function public.admin_set_payment_permission(p_staff_user_id uuid, p_allowed boolean, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); target public.staff_members%rowtype;
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  if p_allowed is null or nullif(trim(p_reason), '') is null or length(p_reason) > 500 then
    raise exception 'Reason is required';
  end if;
  select * into target from public.staff_members where user_id = p_staff_user_id for update;
  if not found or not target.active then raise exception 'Active staff member not found'; end if;
  if target.can_confirm_payments = p_allowed then raise exception 'Permission is unchanged'; end if;
  update public.staff_members set can_confirm_payments = p_allowed where user_id = p_staff_user_id;
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, before_data, after_data, reason)
  values (actor_id, 'staff_member', p_staff_user_id, 'payment_permission_changed',
    jsonb_build_object('allowed', target.can_confirm_payments), jsonb_build_object('allowed', p_allowed), trim(p_reason));
end;
$$;
revoke all on function public.admin_set_payment_permission(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_payment_permission(uuid, boolean, text) to authenticated;

create function private.revoke_finance_on_deactivation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.active and not new.active and old.can_confirm_payments then
    new.can_confirm_payments := false;
    insert into public.audit_events (actor_user_id, entity_type, entity_id, action, before_data, after_data)
    values (auth.uid(), 'staff_member', old.user_id, 'payment_permission_revoked_on_deactivation',
      jsonb_build_object('allowed', true), jsonb_build_object('allowed', false));
  end if;
  return new;
end;
$$;
revoke all on function private.revoke_finance_on_deactivation() from public, anon, authenticated;
create trigger modernsecure_revoke_finance_on_deactivation
before update of active on public.staff_members
for each row execute function private.revoke_finance_on_deactivation();

create function public.staff_add_payment_installment(p_case_id uuid, p_due_on date,
  p_amount_kzt numeric, p_description text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); item public.cases%rowtype; installment_id uuid;
begin
  if actor_id is null or not private.can_manage_payments(p_case_id) then raise exception 'Not authorized'; end if;
  select * into item from public.cases where id = p_case_id for update;
  if not found or item.status <> 'open' or item.is_suspended then raise exception 'Case is not active'; end if;
  if p_due_on is null or p_amount_kzt is null or p_amount_kzt <= 0
    or p_amount_kzt > 999999999999.99 or p_amount_kzt <> round(p_amount_kzt, 2)
    or length(coalesce(p_description, '')) > 500 then raise exception 'Invalid installment'; end if;
  insert into public.payment_schedule (case_id, due_on, amount_kzt, description)
  values (p_case_id, p_due_on, p_amount_kzt, nullif(trim(p_description), '')) returning id into installment_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
  values (actor_id, p_case_id, 'payment_schedule', installment_id, 'installment_created',
    jsonb_build_object('due_on', p_due_on, 'amount_kzt', p_amount_kzt));
  return installment_id;
end;
$$;
revoke all on function public.staff_add_payment_installment(uuid, date, numeric, text) from public, anon;
grant execute on function public.staff_add_payment_installment(uuid, date, numeric, text) to authenticated;

create function public.staff_update_payment_installment(p_schedule_id uuid, p_expected_updated_at timestamptz,
  p_due_on date, p_amount_kzt numeric, p_description text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); item public.payment_schedule%rowtype; paid_amount numeric;
begin
  select * into item from public.payment_schedule where id = p_schedule_id for update;
  if not found or actor_id is null or not private.can_manage_payments(item.case_id) then raise exception 'Not authorized'; end if;
  if not exists (select 1 from public.cases c where c.id = item.case_id and c.status = 'open' and not c.is_suspended) then
    raise exception 'Case is not active';
  end if;
  if item.updated_at is distinct from p_expected_updated_at then raise exception 'Installment changed by another user'; end if;
  if p_due_on is null or p_amount_kzt is null or p_amount_kzt <= 0
    or p_amount_kzt > 999999999999.99 or p_amount_kzt <> round(p_amount_kzt, 2)
    or length(coalesce(p_description, '')) > 500 or nullif(trim(p_reason), '') is null
    or length(p_reason) > 500 then raise exception 'Invalid installment update'; end if;
  select coalesce(sum(amount_kzt), 0) into paid_amount from public.payments
  where schedule_id = p_schedule_id and status = 'confirmed';
  if p_amount_kzt < paid_amount then raise exception 'Amount is below confirmed payments'; end if;
  update public.payment_schedule set due_on = p_due_on, amount_kzt = p_amount_kzt,
    description = nullif(trim(p_description), ''), updated_at = clock_timestamp() where id = p_schedule_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, before_data, after_data, reason)
  values (actor_id, item.case_id, 'payment_schedule', p_schedule_id, 'installment_updated',
    jsonb_build_object('due_on', item.due_on, 'amount_kzt', item.amount_kzt, 'description', item.description),
    jsonb_build_object('due_on', p_due_on, 'amount_kzt', p_amount_kzt, 'description', nullif(trim(p_description), '')),
    trim(p_reason));
end;
$$;
revoke all on function public.staff_update_payment_installment(uuid, timestamptz, date, numeric, text, text) from public, anon;
grant execute on function public.staff_update_payment_installment(uuid, timestamptz, date, numeric, text, text) to authenticated;

create function public.staff_confirm_payment(p_schedule_id uuid, p_amount_kzt numeric, p_paid_on date,
  p_reference text, p_client_note text, p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); installment public.payment_schedule%rowtype; existing public.payments%rowtype;
  paid_amount numeric; payment_id uuid; client_user_id uuid;
begin
  select * into installment from public.payment_schedule where id = p_schedule_id for update;
  if not found or actor_id is null or not private.can_manage_payments(installment.case_id) then
    raise exception 'Not authorized';
  end if;
  if not exists (select 1 from public.cases c where c.id = installment.case_id and c.status = 'open' and not c.is_suspended) then
    raise exception 'Case is not active';
  end if;
  if p_idempotency_key is null or p_amount_kzt is null or p_amount_kzt <= 0
    or p_amount_kzt > 999999999999.99 or p_amount_kzt <> round(p_amount_kzt, 2)
    or p_paid_on is null or p_paid_on > (now() at time zone 'Asia/Almaty')::date
    or nullif(trim(p_reference), '') is null or length(trim(p_reference)) not between 4 and 120
    or length(coalesce(p_client_note, '')) > 500 then raise exception 'Invalid payment'; end if;
  select * into existing from public.payments where case_id = installment.case_id
    and idempotency_key = p_idempotency_key for update;
  if found then
    if existing.status = 'confirmed' and existing.schedule_id = p_schedule_id and existing.amount_kzt = p_amount_kzt
      and existing.paid_on = p_paid_on and existing.payment_reference = trim(p_reference)
      and coalesce(existing.client_note, '') = coalesce(nullif(trim(p_client_note), ''), '') then
      return existing.id;
    end if;
    raise exception 'Payment key cannot be reused';
  end if;
  select coalesce(sum(amount_kzt), 0) into paid_amount from public.payments
    where schedule_id = p_schedule_id and status = 'confirmed';
  if paid_amount + p_amount_kzt > installment.amount_kzt then raise exception 'Payment exceeds installment'; end if;
  insert into public.payments (case_id, schedule_id, amount_kzt, paid_on, status, confirmed_by,
    client_note, idempotency_key, payment_reference)
  values (installment.case_id, p_schedule_id, p_amount_kzt, p_paid_on, 'confirmed', actor_id,
    nullif(trim(p_client_note), ''), p_idempotency_key, trim(p_reference)) returning id into payment_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
  values (actor_id, installment.case_id, 'payment', payment_id, 'confirmed',
    jsonb_build_object('amount_kzt', p_amount_kzt, 'paid_on', p_paid_on,
      'schedule_id', p_schedule_id, 'reference', trim(p_reference)));
  select cl.user_id into client_user_id from public.cases c join public.clients cl on cl.id = c.client_id
    where c.id = installment.case_id;
  if client_user_id is not null then
    insert into public.notifications (recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
    values (client_user_id, installment.case_id, 'payment', 'Оплата подтверждена',
      p_amount_kzt::text || ' ₸', '/account/cases/' || installment.case_id::text || '/payments',
      'payment-confirmed:' || payment_id::text)
    on conflict (recipient_user_id, dedupe_key) do nothing;
  end if;
  return payment_id;
end;
$$;
revoke all on function public.staff_confirm_payment(uuid, numeric, date, text, text, uuid) from public, anon;
grant execute on function public.staff_confirm_payment(uuid, numeric, date, text, text, uuid) to authenticated;

create function public.staff_void_payment(p_payment_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); item public.payments%rowtype; client_user_id uuid;
begin
  select * into item from public.payments where id = p_payment_id for update;
  if not found or actor_id is null or not private.can_manage_payments(item.case_id) then raise exception 'Not authorized'; end if;
  if item.status <> 'confirmed' or nullif(trim(p_reason), '') is null or length(p_reason) > 500 then
    raise exception 'Invalid void request';
  end if;
  update public.payments set status = 'void' where id = p_payment_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, before_data, after_data, reason)
  values (actor_id, item.case_id, 'payment', p_payment_id, 'voided',
    jsonb_build_object('status', 'confirmed', 'amount_kzt', item.amount_kzt),
    jsonb_build_object('status', 'void', 'amount_kzt', item.amount_kzt), trim(p_reason));
  select cl.user_id into client_user_id from public.cases c join public.clients cl on cl.id = c.client_id
    where c.id = item.case_id;
  if client_user_id is not null then
    insert into public.notifications (recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
    values (client_user_id, item.case_id, 'payment', 'Оплата исправлена',
      'Запись об оплате отменена. Уточните информацию у сотрудника.',
      '/account/cases/' || item.case_id::text || '/payments', 'payment-voided:' || p_payment_id::text)
    on conflict (recipient_user_id, dedupe_key) do nothing;
  end if;
end;
$$;
revoke all on function public.staff_void_payment(uuid, text) from public, anon;
grant execute on function public.staff_void_payment(uuid, text) to authenticated;
-- END 20261011001300_payment_workflows.sql

-- BEGIN 20261011001400_document_access_hardening.sql
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
-- END 20261011001400_document_access_hardening.sql

-- BEGIN 20261011001500_payment_reference_uniqueness.sql
-- Technical retries and real-world bank operations have different identifiers.
-- A confirmed bank/ledger reference may be counted only once within a case.
create unique index payments_confirmed_reference_unique
  on public.payments (case_id, lower(btrim(payment_reference)))
  where status = 'confirmed' and payment_reference is not null;
-- END 20261011001500_payment_reference_uniqueness.sql

-- BEGIN 20261011001600_own_profile.sql
-- Profile edits belong to the signed-in account, not to a caller-supplied user id.
create function public.update_own_profile(p_display_name text, p_phone text, p_city text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  previous public.profiles%rowtype;
  clean_name text := nullif(trim(p_display_name), '');
  clean_phone text := nullif(trim(p_phone), '');
  clean_city text := nullif(trim(p_city), '');
  changed_fields text[] := array[]::text[];
begin
  if actor_id is null then raise exception 'Not authenticated'; end if;
  if length(coalesce(clean_name, '')) > 160 or length(coalesce(clean_city, '')) > 100
    or (clean_phone is not null and (length(clean_phone) > 30
      or clean_phone !~ '^\+?[0-9 ()-]{7,30}$'))
    or coalesce(clean_name, '') ~ '[[:cntrl:]]'
    or coalesce(clean_city, '') ~ '[[:cntrl:]]' then
    raise exception 'Invalid profile';
  end if;
  select * into previous from public.profiles where user_id = actor_id for update;
  if not found then raise exception 'Profile not found'; end if;
  if previous.display_name is distinct from clean_name then changed_fields := array_append(changed_fields, 'display_name'); end if;
  if previous.phone is distinct from clean_phone then changed_fields := array_append(changed_fields, 'phone'); end if;
  if previous.city is distinct from clean_city then changed_fields := array_append(changed_fields, 'city'); end if;
  if cardinality(changed_fields) = 0 then return; end if;
  update public.profiles set display_name = clean_name, phone = clean_phone, city = clean_city,
    updated_at = clock_timestamp() where user_id = actor_id;
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
  values (actor_id, 'profile', actor_id, 'profile_updated', jsonb_build_object('changed_fields', changed_fields));
end;
$$;
revoke all on function public.update_own_profile(text, text, text) from public, anon;
grant execute on function public.update_own_profile(text, text, text) to authenticated;
-- END 20261011001600_own_profile.sql

-- BEGIN 20261011001700_message_rate_limit.sql
-- Prevent a signed-in account from flooding case correspondence and notifications.
-- Retries of an existing idempotency key remain possible after the limit is reached.
create index messages_sender_time_idx on public.messages(sender_user_id, created_at desc);

create function private.guard_message_rate()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null then return new; end if;
  if new.sender_user_id is distinct from actor_id then raise exception 'Message sender mismatch'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text, 0));
  if exists (select 1 from public.messages m where m.case_id = new.case_id
    and m.sender_user_id = actor_id and m.idempotency_key = new.idempotency_key) then
    return new;
  end if;
  if (select count(*) from public.messages m where m.sender_user_id = actor_id
    and m.created_at >= now() - interval '1 minute') >= 20
    or (select count(*) from public.messages m where m.sender_user_id = actor_id
      and m.created_at >= now() - interval '1 day') >= 300 then
    raise exception 'Message rate limit exceeded';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_message_rate() from public, anon, authenticated;
create trigger modernsecure_guard_message_rate before insert on public.messages
for each row execute function private.guard_message_rate();
-- END 20261011001700_message_rate_limit.sql

-- BEGIN 20261011001800_help_settings.sql
-- Only the principal administrator publishes client-facing support details.
create function public.admin_save_contact_settings(p_phone text, p_email text, p_whatsapp_url text,
  p_business_hours text, p_response_expectation text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  previous public.contact_settings%rowtype;
  clean_phone text := nullif(trim(p_phone), '');
  clean_email text := nullif(lower(trim(p_email)), '');
  clean_whatsapp text := nullif(trim(p_whatsapp_url), '');
  clean_hours text := nullif(trim(p_business_hours), '');
  clean_response text := nullif(trim(p_response_expectation), '');
  changed_fields text[] := array[]::text[];
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  if length(coalesce(clean_phone, '')) > 40 or (clean_phone is not null and clean_phone !~ '^\+?[0-9 ()-]{6,40}$')
    or length(coalesce(clean_email, '')) > 254 or (clean_email is not null and clean_email !~ '^[^[:space:]@/?#]+@[^[:space:]@/?#]+\.[^[:space:]@/?#]+$')
    or length(coalesce(clean_whatsapp, '')) > 300
    or (clean_whatsapp is not null and clean_whatsapp !~ '^https://(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)/[^[:space:]]+$')
    or length(coalesce(clean_hours, '')) > 300 or length(coalesce(clean_response, '')) > 500
    or coalesce(clean_hours, '') ~ '[[:cntrl:]]' or coalesce(clean_response, '') ~ '[[:cntrl:]]' then
    raise exception 'Invalid contact settings';
  end if;
  select * into previous from public.contact_settings where id = true for update;
  if previous.phone is distinct from clean_phone then changed_fields := array_append(changed_fields, 'phone'); end if;
  if previous.email is distinct from clean_email then changed_fields := array_append(changed_fields, 'email'); end if;
  if previous.whatsapp_url is distinct from clean_whatsapp then changed_fields := array_append(changed_fields, 'whatsapp_url'); end if;
  if previous.business_hours is distinct from clean_hours then changed_fields := array_append(changed_fields, 'business_hours'); end if;
  if previous.response_expectation is distinct from clean_response then changed_fields := array_append(changed_fields, 'response_expectation'); end if;
  if cardinality(changed_fields) = 0 then return; end if;
  insert into public.contact_settings (id, phone, email, whatsapp_url, business_hours, response_expectation)
  values (true, clean_phone, clean_email, clean_whatsapp, clean_hours, clean_response)
  on conflict (id) do update set phone = excluded.phone, email = excluded.email,
    whatsapp_url = excluded.whatsapp_url, business_hours = excluded.business_hours,
    response_expectation = excluded.response_expectation, updated_at = clock_timestamp();
  insert into public.audit_events (actor_user_id, entity_type, action, after_data)
  values (actor_id, 'contact_settings', 'contact_settings_updated', jsonb_build_object('changed_fields', changed_fields));
end;
$$;
revoke all on function public.admin_save_contact_settings(text, text, text, text, text) from public, anon;
grant execute on function public.admin_save_contact_settings(text, text, text, text, text) to authenticated;

create function public.admin_upsert_faq(p_id uuid, p_question text, p_answer text,
  p_position integer, p_published boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); previous public.faq_entries%rowtype; faq_id uuid;
  clean_question text := nullif(trim(p_question), ''); clean_answer text := nullif(trim(p_answer), '');
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  if clean_question is null or length(clean_question) > 180 or clean_answer is null or length(clean_answer) > 4000
    or p_position is null or p_position not between 1 and 1000 or p_published is null then
    raise exception 'Invalid FAQ entry';
  end if;
  if p_id is null then
    insert into public.faq_entries (question, answer, position, published)
    values (clean_question, clean_answer, p_position, p_published) returning id into faq_id;
    insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
    values (actor_id, 'faq_entry', faq_id, 'faq_created', jsonb_build_object('published', p_published));
  else
    select * into previous from public.faq_entries where id = p_id for update;
    if not found then raise exception 'FAQ entry not found'; end if;
    faq_id := p_id;
    if previous.question = clean_question and previous.answer = clean_answer
      and previous.position = p_position and previous.published = p_published then return faq_id; end if;
    update public.faq_entries set question = clean_question, answer = clean_answer,
      position = p_position, published = p_published, updated_at = clock_timestamp() where id = p_id;
    insert into public.audit_events (actor_user_id, entity_type, entity_id, action, before_data, after_data)
    values (actor_id, 'faq_entry', faq_id, 'faq_updated',
      jsonb_build_object('published', previous.published, 'position', previous.position),
      jsonb_build_object('published', p_published, 'position', p_position));
  end if;
  return faq_id;
end;
$$;
revoke all on function public.admin_upsert_faq(uuid, text, text, integer, boolean) from public, anon;
grant execute on function public.admin_upsert_faq(uuid, text, text, integer, boolean) to authenticated;
-- END 20261011001800_help_settings.sql

-- BEGIN 20261011001900_notification_inbox.sql
-- A notification recipient may clear their own inbox across all cases.
create function public.mark_own_notifications_read()
returns integer language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); marked integer;
begin
  if actor_id is null then raise exception 'Not authenticated'; end if;
  update public.notifications set read_at = clock_timestamp()
  where recipient_user_id = actor_id and read_at is null;
  get diagnostics marked = row_count;
  return marked;
end;
$$;
revoke all on function public.mark_own_notifications_read() from public, anon;
grant execute on function public.mark_own_notifications_read() to authenticated;
-- END 20261011001900_notification_inbox.sql

-- BEGIN 20261011002000_resume_document_upload.sql
-- A browser reload creates a fresh form key. Reuse the matching pending batch
-- so an interrupted transfer can be retried without consuming a new version.
create function public.resume_or_begin_document_upload(p_request_id uuid, p_idempotency_key text, p_files jsonb)
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
revoke all on function public.resume_or_begin_document_upload(uuid, text, jsonb) from public, anon;
grant execute on function public.resume_or_begin_document_upload(uuid, text, jsonb) to authenticated;
-- END 20261011002000_resume_document_upload.sql

-- BEGIN 20261011002100_upload_cleanup_safety.sql
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
-- END 20261011002100_upload_cleanup_safety.sql

-- BEGIN 20261011002200_assignment_deactivation_race.sql
-- Serialize assignment creation with staff deactivation. The private implementation
-- rechecks active after the wrapper has acquired the target row lock.
create or replace function public.staff_assign_case(p_case_id uuid, p_staff_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if private.staff_role_for_current_user() is distinct from 'admin' then raise exception 'Not authorized'; end if;
  perform 1 from public.staff_members where user_id = p_staff_user_id for update;
  return private.staff_assign_case(p_case_id, p_staff_user_id);
end;
$$;

-- The manager's automatic assignment on a newly created case needs the same
-- lock on the manager's own staff row.
create or replace function public.staff_create_case(p_client_id uuid, p_version_id uuid, p_title text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid; actor_id uuid := auth.uid(); assignment_id uuid;
begin
  perform 1 from public.staff_members where user_id = actor_id for update;
  if private.staff_role_for_current_user() not in ('manager', 'admin') then raise exception 'Not authorized'; end if;
  new_id := private.staff_create_case(p_client_id, p_version_id, p_title);
  if private.staff_role_for_current_user() = 'manager' then
    insert into public.case_assignments (case_id, staff_user_id, assigned_by)
    values (new_id, actor_id, actor_id) returning id into assignment_id;
    insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
    values (actor_id, new_id, 'case_assignment', assignment_id, 'created', jsonb_build_object('staff_user_id', actor_id));
  end if;
  return new_id;
end;
$$;

create or replace function public.admin_set_staff_access(
  p_staff_user_id uuid, p_role public.staff_role, p_active boolean, p_reason text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  before_staff public.staff_members%rowtype;
  assignment record;
  clean_reason text := nullif(trim(p_reason), '');
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  if p_staff_user_id is null or p_staff_user_id = actor_id
    or not coalesce(p_role in ('lawyer', 'manager'), false) or p_active is null
    or clean_reason is null or length(clean_reason) > 500 then
    raise exception 'Invalid staff access change';
  end if;
  select * into before_staff from public.staff_members where user_id = p_staff_user_id for update;
  if not found or before_staff.role = 'admin' then raise exception 'Protected administrator'; end if;
  if before_staff.role = p_role and before_staff.active = p_active then raise exception 'Access is unchanged'; end if;
  update public.staff_members set role = p_role, active = p_active where user_id = p_staff_user_id;
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, before_data, after_data, reason)
  values (actor_id, 'staff_member', p_staff_user_id, 'access_changed',
    jsonb_build_object('role', before_staff.role, 'active', before_staff.active),
    jsonb_build_object('role', p_role, 'active', p_active), clean_reason);
  if not p_active then
    for assignment in select id, case_id, assigned_at from public.case_assignments
      where staff_user_id = p_staff_user_id and revoked_at is null for update loop
      update public.case_assignments
        set revoked_at = greatest(clock_timestamp(), assignment.assigned_at)
        where id = assignment.id;
      insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, reason)
      values (actor_id, assignment.case_id, 'case_assignment', assignment.id, 'revoked', clean_reason);
    end loop;
  end if;
end;
$$;

create or replace function public.admin_revoke_case_assignment(p_assignment_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); assignment public.case_assignments%rowtype; clean_reason text := nullif(trim(p_reason), '');
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  if p_assignment_id is null or clean_reason is null or length(clean_reason) > 500 then
    raise exception 'Reason is required';
  end if;
  select * into assignment from public.case_assignments where id = p_assignment_id for update;
  if not found or assignment.revoked_at is not null then raise exception 'Active assignment not found'; end if;
  update public.case_assignments
    set revoked_at = greatest(clock_timestamp(), assignment.assigned_at)
    where id = p_assignment_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, reason, before_data)
  values (actor_id, assignment.case_id, 'case_assignment', assignment.id, 'revoked', clean_reason,
    jsonb_build_object('staff_user_id', assignment.staff_user_id));
end;
$$;
-- END 20261011002200_assignment_deactivation_race.sql

-- BEGIN 20261011002300_case_lifecycle.sql
-- Case lifecycle transitions are explicit, authorized and audited.
create function private.lock_legal_case_editor(p_case_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); member public.staff_members%rowtype;
begin
  if actor_id is null then return false; end if;
  select * into member from public.staff_members where user_id = actor_id for update;
  if not found or not member.active then return false; end if;
  if member.role = 'admin' then return true; end if;
  if member.role <> 'lawyer' then return false; end if;
  perform 1 from public.case_assignments
    where case_id = p_case_id and staff_user_id = actor_id and revoked_at is null for update;
  return found;
end;
$$;
revoke all on function private.lock_legal_case_editor(uuid) from public, anon, authenticated;

create function public.staff_suspend_case(p_case_id uuid, p_reason_for_client text, p_control_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); item public.cases%rowtype; suspension_id uuid;
  clean_reason text := nullif(trim(p_reason_for_client), ''); client_user_id uuid;
begin
  if not private.lock_legal_case_editor(p_case_id) then raise exception 'Not authorized'; end if;
  select * into item from public.cases where id = p_case_id for update;
  if not found or item.status <> 'open' or item.is_suspended then raise exception 'Case cannot be suspended'; end if;
  if clean_reason is null or length(clean_reason) > 2000 or p_control_at is null or p_control_at <= clock_timestamp()
    then raise exception 'Reason and future control date are required'; end if;
  insert into public.case_suspensions (case_id, reason_for_client, control_at, started_by)
    values (p_case_id, clean_reason, p_control_at, actor_id) returning id into suspension_id;
  update public.cases set is_suspended = true, next_review_at = p_control_at,
    updated_at = clock_timestamp() where id = p_case_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
    values (actor_id, p_case_id, 'case_suspension', suspension_id, 'started',
      jsonb_build_object('reason_for_client', clean_reason, 'control_at', p_control_at));
  select cl.user_id into client_user_id from public.clients cl where cl.id = item.client_id;
  if client_user_id is not null then
    insert into public.notifications (recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
      values (client_user_id, p_case_id, 'case_status', 'Дело приостановлено', clean_reason,
        '/account/cases/' || p_case_id::text, 'case-suspended:' || suspension_id::text)
      on conflict (recipient_user_id, dedupe_key) do nothing;
  end if;
end;
$$;

create function public.staff_resume_case(p_case_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); item public.cases%rowtype; suspension public.case_suspensions%rowtype;
  client_user_id uuid;
begin
  if not private.lock_legal_case_editor(p_case_id) then raise exception 'Not authorized'; end if;
  select * into item from public.cases where id = p_case_id for update;
  if not found or item.status <> 'open' or not item.is_suspended then raise exception 'Case is not suspended'; end if;
  select * into suspension from public.case_suspensions
    where case_id = p_case_id and ended_at is null for update;
  if not found then raise exception 'Active suspension not found'; end if;
  update public.case_suspensions set ended_by = actor_id,
    ended_at = greatest(clock_timestamp(), suspension.started_at) where id = suspension.id;
  update public.cases set is_suspended = false, next_review_at = null,
    updated_at = clock_timestamp() where id = p_case_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action)
    values (actor_id, p_case_id, 'case_suspension', suspension.id, 'ended');
  select cl.user_id into client_user_id from public.clients cl where cl.id = item.client_id;
  if client_user_id is not null then
    insert into public.notifications (recipient_user_id, case_id, kind, title, target_path, dedupe_key)
      values (client_user_id, p_case_id, 'case_status', 'Работа по делу возобновлена',
        '/account/cases/' || p_case_id::text, 'case-resumed:' || suspension.id::text)
      on conflict (recipient_user_id, dedupe_key) do nothing;
  end if;
end;
$$;

create function public.staff_close_case(p_case_id uuid, p_result_summary text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); item public.cases%rowtype;
  clean_result text := nullif(trim(p_result_summary), ''); client_user_id uuid;
begin
  if not private.lock_legal_case_editor(p_case_id) then raise exception 'Not authorized'; end if;
  select * into item from public.cases where id = p_case_id for update;
  if not found or item.status <> 'open' or item.is_suspended then raise exception 'Case cannot be closed'; end if;
  if clean_result is null or length(clean_result) > 4000 then raise exception 'Result summary is required'; end if;
  if exists (
    select 1 from public.document_requests dr
    where dr.case_id = p_case_id and dr.required and dr.status = 'active'
      and not exists (select 1 from public.document_files df
        where df.request_id = dr.id and df.status = 'accepted')
  ) then raise exception 'Required documents are not accepted'; end if;
  update public.cases set status = 'closed', result_summary = clean_result,
    closed_at = clock_timestamp(), next_review_at = null, updated_at = clock_timestamp()
    where id = p_case_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
    values (actor_id, p_case_id, 'case', p_case_id, 'closed',
      jsonb_build_object('result_summary', clean_result));
  select cl.user_id into client_user_id from public.clients cl where cl.id = item.client_id;
  if client_user_id is not null then
    insert into public.notifications (recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
      values (client_user_id, p_case_id, 'case_status', 'Дело завершено', clean_result,
        '/account/cases/' || p_case_id::text, 'case-closed:' || p_case_id::text)
      on conflict (recipient_user_id, dedupe_key) do nothing;
  end if;
end;
$$;

revoke all on function public.staff_suspend_case(uuid, text, timestamptz) from public, anon;
revoke all on function public.staff_resume_case(uuid) from public, anon;
revoke all on function public.staff_close_case(uuid, text) from public, anon;
grant execute on function public.staff_suspend_case(uuid, text, timestamptz) to authenticated;
grant execute on function public.staff_resume_case(uuid) to authenticated;
grant execute on function public.staff_close_case(uuid, text) to authenticated;
-- END 20261011002300_case_lifecycle.sql

-- BEGIN 20261011002400_case_close_consistency.sql
-- A service version's document checklist is instantiated with every new case.
create or replace function public.staff_create_case(p_client_id uuid, p_version_id uuid, p_title text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid; actor_id uuid := auth.uid(); assignment_id uuid;
  template public.document_templates%rowtype; request_id uuid; client_user_id uuid;
begin
  perform 1 from public.staff_members where user_id = actor_id for update;
  if private.staff_role_for_current_user() not in ('manager', 'admin') then raise exception 'Not authorized'; end if;
  new_id := private.staff_create_case(p_client_id, p_version_id, p_title);
  if private.staff_role_for_current_user() = 'manager' then
    insert into public.case_assignments (case_id, staff_user_id, assigned_by)
      values (new_id, actor_id, actor_id) returning id into assignment_id;
    insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
      values (actor_id, new_id, 'case_assignment', assignment_id, 'created',
        jsonb_build_object('staff_user_id', actor_id));
  end if;
  for template in select * from public.document_templates
    where version_id = p_version_id order by position loop
    insert into public.document_requests (case_id, template_id, title, instructions, required, created_by)
      values (new_id, template.id, template.title, template.instructions, template.required, actor_id)
      returning id into request_id;
    insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
      values (actor_id, new_id, 'document_request', request_id, 'created_from_template',
        jsonb_build_object('template_id', template.id, 'required', template.required));
  end loop;
  if request_id is not null then
    select user_id into client_user_id from public.clients where id = p_client_id;
    if client_user_id is not null then
      insert into public.notifications (recipient_user_id, case_id, kind, title, target_path, dedupe_key)
        values (client_user_id, new_id, 'document_request', 'Документы по новому делу',
          '/account/cases/' || new_id::text || '/documents', 'service-documents:' || new_id::text)
        on conflict (recipient_user_id, dedupe_key) do nothing;
    end if;
  end if;
  return new_id;
end;
$$;

-- Existing open cases may have been created before template instantiation existed.
with missing as (
  insert into public.document_requests (case_id, template_id, title, instructions, required)
    select c.id, dt.id, dt.title, dt.instructions, dt.required
    from public.cases c join public.document_templates dt on dt.version_id = c.service_version_id
    where c.status = 'open' and not exists (
      select 1 from public.document_requests dr where dr.case_id = c.id and dr.template_id = dt.id
    )
    returning id, case_id, template_id, required
)
insert into public.audit_events (case_id, entity_type, entity_id, action, after_data)
  select case_id, 'document_request', id, 'created_from_template_backfill',
    jsonb_build_object('template_id', template_id, 'required', required) from missing;

-- Serialize legal work on the case row with closure. Private implementations
-- recheck the open status after that lock is acquired.
create or replace function public.staff_create_document_request(
  p_case_id uuid, p_title text, p_instructions text default null,
  p_required boolean default true, p_due_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not private.lock_legal_case_editor(p_case_id) then raise exception 'Not authorized'; end if;
  perform 1 from public.cases where id = p_case_id for update;
  return private.staff_create_document_request(p_case_id, p_title, p_instructions, p_required, p_due_at);
end;
$$;

create or replace function public.staff_create_task(
  p_case_id uuid, p_kind public.task_kind, p_title text,
  p_description text default null, p_due_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not private.lock_legal_case_editor(p_case_id) then raise exception 'Not authorized'; end if;
  perform 1 from public.cases where id = p_case_id for update;
  return private.staff_create_task(p_case_id, p_kind, p_title, p_description, p_due_at);
end;
$$;

create or replace function public.staff_review_task(p_task_id uuid, p_accept boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare case_id uuid; case_state public.cases%rowtype;
begin
  select t.case_id into case_id from public.tasks t where t.id = p_task_id;
  if case_id is null or not private.lock_legal_case_editor(case_id) then raise exception 'Not authorized'; end if;
  select * into case_state from public.cases where id = case_id for update;
  if not found or case_state.status <> 'open' or case_state.is_suspended then
    raise exception 'Case is not active';
  end if;
  perform private.staff_review_task(p_task_id, p_accept, p_note);
end;
$$;

create or replace function public.staff_close_case(p_case_id uuid, p_result_summary text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); item public.cases%rowtype; pending_task record;
  clean_result text := nullif(trim(p_result_summary), ''); client_user_id uuid;
begin
  if not private.lock_legal_case_editor(p_case_id) then raise exception 'Not authorized'; end if;
  select * into item from public.cases where id = p_case_id for update;
  if not found or item.status <> 'open' or item.is_suspended then raise exception 'Case cannot be closed'; end if;
  if clean_result is null or length(clean_result) > 4000 then raise exception 'Result summary is required'; end if;
  if exists (
    select 1 from public.document_requests dr
    where dr.case_id = p_case_id and dr.required and dr.status = 'active'
      and not exists (select 1 from public.document_files df
        where df.request_id = dr.id and df.status = 'accepted')
  ) or exists (
    select 1 from public.document_templates dt
    where dt.version_id = item.service_version_id and dt.required
      and not exists (select 1 from public.document_requests dr
        join public.document_files df on df.request_id = dr.id and df.status = 'accepted'
        where dr.case_id = p_case_id and dr.template_id = dt.id and dr.status = 'active')
  ) then raise exception 'Required documents are not accepted'; end if;
  update public.cases set status = 'closed', result_summary = clean_result,
    closed_at = clock_timestamp(), next_review_at = null, updated_at = clock_timestamp()
    where id = p_case_id;
  for pending_task in select id, status from public.tasks
    where case_id = p_case_id and status in ('new', 'response_sent') for update loop
    update public.tasks set status = 'cancelled', updated_at = clock_timestamp()
      where id = pending_task.id;
    insert into public.task_events (task_id, actor_user_id, action, response_text)
      values (pending_task.id, actor_id, 'cancelled', 'Дело завершено');
    insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, before_data, after_data)
      values (actor_id, p_case_id, 'task', pending_task.id, 'cancelled_on_case_close',
        jsonb_build_object('status', pending_task.status), jsonb_build_object('status', 'cancelled'));
  end loop;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
    values (actor_id, p_case_id, 'case', p_case_id, 'closed',
      jsonb_build_object('result_summary', clean_result));
  select cl.user_id into client_user_id from public.clients cl where cl.id = item.client_id;
  if client_user_id is not null then
    insert into public.notifications (recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
      values (client_user_id, p_case_id, 'case_status', 'Дело завершено', clean_result,
        '/account/cases/' || p_case_id::text, 'case-closed:' || p_case_id::text)
      on conflict (recipient_user_id, dedupe_key) do nothing;
  end if;
end;
$$;
-- END 20261011002400_case_close_consistency.sql

-- BEGIN 20261011002500_service_document_versions.sql
-- Publish complete service versions atomically; active cases stay on their
-- original version when the administrator creates a newer checklist.
create function private.insert_service_documents(p_version_id uuid, p_documents jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare doc record; clean_title text; clean_instructions text;
  needed boolean; seen_titles text[] := array[]::text[]; created_count integer := 0;
begin
  if p_documents is null or jsonb_typeof(p_documents) <> 'array'
    or jsonb_array_length(p_documents) > 20 then raise exception 'Invalid document templates'; end if;
  for doc in select value, ordinality from jsonb_array_elements(p_documents) with ordinality loop
    if jsonb_typeof(doc.value) <> 'object'
      or jsonb_typeof(doc.value->'title') is distinct from 'string'
      or (doc.value ? 'instructions' and jsonb_typeof(doc.value->'instructions') is distinct from 'string')
      or (doc.value ? 'required' and jsonb_typeof(doc.value->'required') is distinct from 'boolean') then
      raise exception 'Invalid document template';
    end if;
    clean_title := nullif(trim(doc.value->>'title'), '');
    clean_instructions := nullif(trim(doc.value->>'instructions'), '');
    needed := coalesce((doc.value->>'required')::boolean, true);
    if clean_title is null or length(clean_title) > 180
      or length(coalesce(clean_instructions, '')) > 2000
      or lower(clean_title) = any(seen_titles) then raise exception 'Invalid document template'; end if;
    seen_titles := array_append(seen_titles, lower(clean_title));
    insert into public.document_templates (version_id, title, instructions, required, position)
      values (p_version_id, clean_title, clean_instructions, needed, doc.ordinality::integer);
    created_count := created_count + 1;
  end loop;
  return created_count;
end;
$$;
revoke all on function private.insert_service_documents(uuid, jsonb) from public, anon, authenticated;

create function public.admin_create_service_with_documents(
  p_name text, p_stages text[], p_documents jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); new_service_id uuid; version_id uuid; document_count integer;
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  new_service_id := public.admin_create_service(p_name, p_stages);
  select id into version_id from public.service_template_versions
    where service_id = new_service_id and version_no = 1;
  document_count := private.insert_service_documents(version_id, p_documents);
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
    values (actor_id, 'service_template_version', version_id, 'document_checklist_published',
      jsonb_build_object('document_count', document_count));
  return new_service_id;
end;
$$;

create function public.admin_publish_service_version(
  p_service_id uuid, p_stages text[], p_documents jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); service public.service_templates%rowtype;
  new_version_id uuid; next_version integer; stage_index integer;
  clean_stage text; seen_stages text[] := array[]::text[]; document_count integer;
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  select * into service from public.service_templates where id = p_service_id for update;
  if not found or not service.active then raise exception 'Active service not found'; end if;
  if coalesce(array_length(p_stages, 1), 0) not between 1 and 12 then
    raise exception 'Invalid stages';
  end if;
  for stage_index in 1..array_length(p_stages, 1) loop
    clean_stage := nullif(trim(p_stages[stage_index]), '');
    if clean_stage is null or length(clean_stage) > 120 or lower(clean_stage) = any(seen_stages) then
      raise exception 'Invalid stage title';
    end if;
    seen_stages := array_append(seen_stages, lower(clean_stage));
  end loop;
  select coalesce(max(version_no), 0) + 1 into next_version
    from public.service_template_versions where service_id = p_service_id;
  insert into public.service_template_versions (service_id, version_no, created_by)
    values (p_service_id, next_version, actor_id) returning id into new_version_id;
  for stage_index in 1..array_length(p_stages, 1) loop
    insert into public.stage_templates (version_id, position, title)
      values (new_version_id, stage_index, trim(p_stages[stage_index]));
  end loop;
  document_count := private.insert_service_documents(new_version_id, p_documents);
  update public.service_template_versions set published_at = clock_timestamp()
    where id = new_version_id;
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
    values (actor_id, 'service_template_version', new_version_id, 'published',
      jsonb_build_object('service_id', p_service_id, 'version_no', next_version,
        'stage_count', array_length(p_stages, 1), 'document_count', document_count));
  return new_version_id;
end;
$$;

revoke all on function public.admin_create_service_with_documents(text, text[], jsonb) from public, anon;
revoke all on function public.admin_publish_service_version(uuid, text[], jsonb) from public, anon;
grant execute on function public.admin_create_service_with_documents(text, text[], jsonb) to authenticated;
grant execute on function public.admin_publish_service_version(uuid, text[], jsonb) to authenticated;
-- END 20261011002500_service_document_versions.sql

-- BEGIN 20261011002600_current_service_version.sql
-- New cases use only the newest published version of an active service.
create function public.available_service_versions()
returns table (version_id uuid, service_name text, version_no integer)
language sql stable security definer set search_path = '' as $$
  select distinct on (s.id) v.id, s.name, v.version_no
    from public.service_templates s
    join public.service_template_versions v on v.service_id = s.id
    where s.active and v.published_at is not null
      and private.staff_role_for_current_user() in ('manager', 'admin')
    order by s.id, v.version_no desc
$$;
revoke all on function public.available_service_versions() from public, anon;
grant execute on function public.available_service_versions() to authenticated;

create or replace function public.staff_create_case(p_client_id uuid, p_version_id uuid, p_title text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid; actor_id uuid := auth.uid(); assignment_id uuid;
  template public.document_templates%rowtype; request_id uuid; client_user_id uuid;
  target_service_id uuid; current_version_id uuid;
begin
  perform 1 from public.staff_members where user_id = actor_id for update;
  if private.staff_role_for_current_user() not in ('manager', 'admin') then raise exception 'Not authorized'; end if;
  select v.service_id into target_service_id from public.service_template_versions v where v.id = p_version_id;
  if target_service_id is null then raise exception 'Service version not found'; end if;
  perform 1 from public.service_templates s where s.id = target_service_id and s.active for update;
  if not found then raise exception 'Service is inactive'; end if;
  select v.id into current_version_id from public.service_template_versions v
    where v.service_id = target_service_id and v.published_at is not null
    order by v.version_no desc limit 1;
  if current_version_id is distinct from p_version_id then raise exception 'Service version is outdated'; end if;
  new_id := private.staff_create_case(p_client_id, p_version_id, p_title);
  if private.staff_role_for_current_user() = 'manager' then
    insert into public.case_assignments (case_id, staff_user_id, assigned_by)
      values (new_id, actor_id, actor_id) returning id into assignment_id;
    insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
      values (actor_id, new_id, 'case_assignment', assignment_id, 'created',
        jsonb_build_object('staff_user_id', actor_id));
  end if;
  for template in select * from public.document_templates
    where version_id = p_version_id order by position loop
    insert into public.document_requests (case_id, template_id, title, instructions, required, created_by)
      values (new_id, template.id, template.title, template.instructions, template.required, actor_id)
      returning id into request_id;
    insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
      values (actor_id, new_id, 'document_request', request_id, 'created_from_template',
        jsonb_build_object('template_id', template.id, 'required', template.required));
  end loop;
  if request_id is not null then
    select user_id into client_user_id from public.clients where id = p_client_id;
    if client_user_id is not null then
      insert into public.notifications (recipient_user_id, case_id, kind, title, target_path, dedupe_key)
        values (client_user_id, new_id, 'document_request', 'Документы по новому делу',
          '/account/cases/' || new_id::text || '/documents', 'service-documents:' || new_id::text)
        on conflict (recipient_user_id, dedupe_key) do nothing;
    end if;
  end if;
  return new_id;
end;
$$;

-- Existing overload is no longer callable by browser roles: a fresh version
-- must include the version the administrator actually reviewed in the form.
revoke all on function public.admin_publish_service_version(uuid, text[], jsonb) from public, anon, authenticated;
create function public.admin_publish_service_version(
  p_service_id uuid, p_expected_version_id uuid, p_stages text[], p_documents jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); service public.service_templates%rowtype;
  new_version_id uuid; current_version_id uuid; next_version integer; stage_index integer;
  clean_stage text; seen_stages text[] := array[]::text[]; document_count integer;
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  select * into service from public.service_templates where id = p_service_id for update;
  if not found or not service.active then raise exception 'Active service not found'; end if;
  select v.id into current_version_id from public.service_template_versions v
    where v.service_id = p_service_id and v.published_at is not null
    order by v.version_no desc limit 1;
  if p_expected_version_id is null or current_version_id is distinct from p_expected_version_id then
    raise exception 'Service version changed by another user';
  end if;
  if coalesce(array_length(p_stages, 1), 0) not between 1 and 12 then
    raise exception 'Invalid stages';
  end if;
  for stage_index in 1..array_length(p_stages, 1) loop
    clean_stage := nullif(trim(p_stages[stage_index]), '');
    if clean_stage is null or length(clean_stage) > 120 or lower(clean_stage) = any(seen_stages) then
      raise exception 'Invalid stage title';
    end if;
    seen_stages := array_append(seen_stages, lower(clean_stage));
  end loop;
  select coalesce(max(version_no), 0) + 1 into next_version
    from public.service_template_versions where service_id = p_service_id;
  insert into public.service_template_versions (service_id, version_no, created_by)
    values (p_service_id, next_version, actor_id) returning id into new_version_id;
  for stage_index in 1..array_length(p_stages, 1) loop
    insert into public.stage_templates (version_id, position, title)
      values (new_version_id, stage_index, trim(p_stages[stage_index]));
  end loop;
  document_count := private.insert_service_documents(new_version_id, p_documents);
  update public.service_template_versions set published_at = clock_timestamp()
    where id = new_version_id;
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
    values (actor_id, 'service_template_version', new_version_id, 'published',
      jsonb_build_object('service_id', p_service_id, 'version_no', next_version,
        'stage_count', array_length(p_stages, 1), 'document_count', document_count));
  return new_version_id;
end;
$$;
revoke all on function public.admin_publish_service_version(uuid, uuid, text[], jsonb) from public, anon;
grant execute on function public.admin_publish_service_version(uuid, uuid, text[], jsonb) to authenticated;
-- END 20261011002600_current_service_version.sql

-- BEGIN 20261011002700_client_search.sql
-- Staff search stays on the server and returns one bounded page at a time.
create function public.staff_search_clients(p_query text default '', p_page integer default 1)
returns table (
  id uuid, full_name text, email text, phone text, city text,
  user_id uuid, created_at timestamptz, total_count bigint
) language plpgsql stable security definer set search_path = '' as $$
declare clean_query text := lower(trim(coalesce(p_query, '')));
begin
  if private.staff_role_for_current_user() not in ('manager', 'admin') then
    raise exception 'Not authorized';
  end if;
  if length(clean_query) > 120 or p_page is null or p_page not between 1 and 10000 then
    raise exception 'Invalid client search';
  end if;
  return query
    select cl.id, cl.full_name, cl.email, cl.phone, cl.city, cl.user_id, cl.created_at,
      count(*) over() as total_count
    from public.clients cl
    where clean_query = '' or position(clean_query in lower(cl.full_name)) > 0
      or position(clean_query in lower(coalesce(cl.email, ''))) > 0
      or position(clean_query in lower(coalesce(cl.phone, ''))) > 0
    order by cl.created_at desc, cl.id desc
    limit 25 offset (p_page - 1) * 25;
end;
$$;
revoke all on function public.staff_search_clients(text, integer) from public, anon;
grant execute on function public.staff_search_clients(text, integer) to authenticated;
-- END 20261011002700_client_search.sql

-- BEGIN 20261011002800_client_search_role_guard.sql
-- A NULL staff role must deny access; PL/pgSQL IF does not treat NULL as true.
create or replace function public.staff_search_clients(p_query text default '', p_page integer default 1)
returns table (
  id uuid, full_name text, email text, phone text, city text,
  user_id uuid, created_at timestamptz, total_count bigint
) language plpgsql stable security definer set search_path = '' as $$
declare clean_query text := lower(trim(coalesce(p_query, '')));
begin
  if not coalesce(private.staff_role_for_current_user() in ('manager', 'admin'), false) then
    raise exception 'Not authorized';
  end if;
  if length(clean_query) > 120 or p_page is null or p_page not between 1 and 10000 then
    raise exception 'Invalid client search';
  end if;
  return query
    select cl.id, cl.full_name, cl.email, cl.phone, cl.city, cl.user_id, cl.created_at,
      count(*) over() as total_count
    from public.clients cl
    where clean_query = '' or position(clean_query in lower(cl.full_name)) > 0
      or position(clean_query in lower(coalesce(cl.email, ''))) > 0
      or position(clean_query in lower(coalesce(cl.phone, ''))) > 0
    order by cl.created_at desc, cl.id desc
    limit 25 offset (p_page - 1) * 25;
end;
$$;
-- END 20261011002800_client_search_role_guard.sql

-- BEGIN 20261011002900_contract_files.sql
-- Contract PDFs are immutable versions. Only a finance-authorized employee may
-- register a file already present in the private bucket for the same case.
alter table public.contracts
  add column content_sha256 text,
  add column size_bytes bigint,
  add column detected_mime_type text;

create function public.staff_register_contract(
  p_case_id uuid, p_contract_number text, p_signed_on date, p_price_kzt numeric,
  p_storage_path text, p_content_sha256 text, p_size_bytes bigint
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  case_row public.cases%rowtype;
  existing public.contracts%rowtype;
  next_version integer;
  new_id uuid;
  clean_number text := nullif(trim(p_contract_number), '');
begin
  if actor_id is null or not coalesce(private.can_manage_payments(p_case_id), false) then
    raise exception 'Not authorized';
  end if;
  select * into case_row from public.cases where id = p_case_id for update;
  if not found or case_row.status <> 'open' or case_row.is_suspended then
    raise exception 'Case is not active';
  end if;
  if clean_number is null or length(clean_number) > 120
    or p_price_kzt is null or p_price_kzt < 0 or p_price_kzt > 999999999999.99
    or p_price_kzt <> round(p_price_kzt, 2)
    or (p_signed_on is not null and p_signed_on > (now() at time zone 'Asia/Almaty')::date)
    or p_storage_path is null or p_storage_path !~ ('^contracts/' || p_case_id::text || '/[0-9a-f-]{36}\.pdf$')
    or p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-f]{64}$'
    or p_size_bytes is null or p_size_bytes not between 1 and 20971520 then
    raise exception 'Invalid contract';
  end if;
  select * into existing from public.contracts where storage_path = p_storage_path for update;
  if found then
    if existing.case_id = p_case_id and existing.contract_number = clean_number
      and existing.signed_on is not distinct from p_signed_on and existing.price_kzt = p_price_kzt
      and existing.content_sha256 = p_content_sha256 and existing.size_bytes = p_size_bytes then
      return existing.id;
    end if;
    raise exception 'Contract upload key reused';
  end if;
  if not exists (
    select 1 from storage.objects obj
    where obj.bucket_id = 'modernsecure-files' and obj.name = p_storage_path
      and (obj.metadata->>'size')::bigint = p_size_bytes
      and obj.metadata->>'mimetype' = 'application/pdf'
  ) then raise exception 'Contract file not found'; end if;
  select coalesce(max(version_no), 0) + 1 into next_version
    from public.contracts where case_id = p_case_id;
  insert into public.contracts (
    case_id, version_no, contract_number, signed_on, price_kzt,
    storage_path, created_by, content_sha256, size_bytes, detected_mime_type
  ) values (
    p_case_id, next_version, clean_number, p_signed_on, p_price_kzt,
    p_storage_path, actor_id, p_content_sha256, p_size_bytes, 'application/pdf'
  ) returning id into new_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
    values (actor_id, p_case_id, 'contract', new_id, 'uploaded',
      jsonb_build_object('version_no', next_version, 'contract_number', clean_number,
        'signed_on', p_signed_on, 'price_kzt', p_price_kzt, 'size_bytes', p_size_bytes,
        'content_sha256', p_content_sha256));
  return new_id;
end;
$$;
revoke all on function public.staff_register_contract(uuid, text, date, numeric, text, text, bigint) from public, anon;
grant execute on function public.staff_register_contract(uuid, text, date, numeric, text, text, bigint) to authenticated;

create function private.block_contract_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Contract versions are immutable';
end;
$$;
create trigger modernsecure_contract_immutable before update or delete on public.contracts
  for each row execute function private.block_contract_change();
revoke all on function private.block_contract_change() from public, anon, authenticated;
-- END 20261011002900_contract_files.sql

-- BEGIN 20261011003000_receipt_workflow.sql
-- Receipt review records evidence only. Payment confirmation remains a separate staff action.
do $$ begin
  if exists (select 1 from public.payment_receipts) then
    raise exception 'Review existing receipts before adding required upload metadata';
  end if;
end $$;

alter table public.payment_receipts
  add column size_bytes bigint not null check (size_bytes between 1 and 20971520),
  add column detected_mime_type text not null check (detected_mime_type in
    ('application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif')),
  add column content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  add column idempotency_key uuid not null,
  add constraint payment_receipts_name_check check
    (length(original_name) between 1 and 180 and original_name !~ '[[:cntrl:]/]'
      and position(chr(92) in original_name) = 0),
  add constraint payment_receipts_review_state check
    ((status = 'under_review' and reviewed_by is null and reviewed_at is null and review_note is null)
      or (status in ('accepted', 'rejected') and reviewed_by is not null and reviewed_at is not null)),
  add constraint payment_receipts_note_check check
    (review_note is null or (length(btrim(review_note)) between 1 and 1000));

create unique index payment_receipts_idempotency_unique
  on public.payment_receipts (case_id, uploaded_by, idempotency_key);
create unique index payment_receipts_case_sha_unique
  on public.payment_receipts (case_id, content_sha256);

create function public.client_register_payment_receipt(
  p_case_id uuid, p_storage_path text, p_original_name text,
  p_mime_type text, p_size_bytes bigint, p_content_sha256 text,
  p_idempotency_key uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  case_row public.cases%rowtype;
  existing public.payment_receipts%rowtype;
  receipt_id uuid;
  suffix text;
begin
  if actor_id is null then raise exception 'Not authorized'; end if;
  select * into case_row from public.cases where id = p_case_id for share;
  if not found or case_row.status <> 'open' or case_row.is_suspended then
    raise exception 'Case is not active';
  end if;
  perform 1 from public.clients cl
    where cl.id = case_row.client_id and cl.user_id = actor_id for share;
  if not found then raise exception 'Not authorized'; end if;

  if p_idempotency_key is null or p_storage_path is null
    or p_storage_path !~ ('^receipts/' || p_case_id::text || '/' || actor_id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](pdf|jpg|png|heic|heif)$')
    or p_original_name is null or length(p_original_name) not between 1 and 180
    or p_original_name ~ '[[:cntrl:]/]' or position(chr(92) in p_original_name) > 0
    or p_original_name <> btrim(p_original_name)
    or p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif')
    or p_size_bytes is null or p_size_bytes not between 1 and 20971520
    or p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid receipt metadata';
  end if;
  suffix := lower(substring(p_storage_path from '[.][^.]+$'));
  if not ((p_mime_type = 'application/pdf' and suffix = '.pdf')
    or (p_mime_type = 'image/jpeg' and suffix = '.jpg')
    or (p_mime_type = 'image/png' and suffix = '.png')
    or (p_mime_type = 'image/heic' and suffix = '.heic')
    or (p_mime_type = 'image/heif' and suffix = '.heif')) then
    raise exception 'Receipt type does not match path';
  end if;

  select * into existing from public.payment_receipts
    where case_id = p_case_id and uploaded_by = actor_id and idempotency_key = p_idempotency_key
    for update;
  if found then
    if existing.storage_path = p_storage_path and existing.original_name = p_original_name
      and existing.detected_mime_type = p_mime_type and existing.size_bytes = p_size_bytes
      and existing.content_sha256 = p_content_sha256 then
      return existing.id;
    end if;
    raise exception 'Receipt upload key cannot be reused';
  end if;
  if not exists (
    select 1 from storage.objects obj
    where obj.bucket_id = 'modernsecure-files' and obj.name = p_storage_path
      and obj.metadata->>'size' ~ '^[0-9]+$'
      and (obj.metadata->>'size')::bigint = p_size_bytes
      and obj.metadata->>'mimetype' = p_mime_type
  ) then raise exception 'Receipt object not found or metadata mismatch'; end if;

  insert into public.payment_receipts (case_id, uploaded_by, storage_path,
    original_name, detected_mime_type, size_bytes, content_sha256, idempotency_key)
  values (p_case_id, actor_id, p_storage_path, p_original_name,
    p_mime_type, p_size_bytes, p_content_sha256, p_idempotency_key)
  returning id into receipt_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
  values (actor_id, p_case_id, 'payment_receipt', receipt_id, 'submitted',
    jsonb_build_object('storage_path', p_storage_path, 'size_bytes', p_size_bytes,
      'mime_type', p_mime_type, 'content_sha256', p_content_sha256));
  return receipt_id;
end;
$$;
revoke all on function public.client_register_payment_receipt(uuid, text, text, text, bigint, text, uuid)
  from public, anon;
grant execute on function public.client_register_payment_receipt(uuid, text, text, text, bigint, text, uuid)
  to authenticated;

create function public.staff_review_payment_receipt(
  p_receipt_id uuid, p_accept boolean, p_note text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  item public.payment_receipts%rowtype;
  case_row public.cases%rowtype;
  member public.staff_members%rowtype;
  clean_note text := nullif(btrim(p_note), '');
  decision public.receipt_status;
begin
  if actor_id is null then raise exception 'Not authorized'; end if;
  select * into item from public.payment_receipts where id = p_receipt_id for update;
  if not found then raise exception 'Receipt not found'; end if;
  select * into case_row from public.cases where id = item.case_id for share;
  if case_row.status <> 'open' or case_row.is_suspended then
    raise exception 'Case is not active';
  end if;
  select * into member from public.staff_members where user_id = actor_id for share;
  if not found or not member.active or not member.can_confirm_payments then
    raise exception 'Not authorized';
  end if;
  if member.role <> 'admin' then
    perform 1 from public.case_assignments ca
      where ca.case_id = item.case_id and ca.staff_user_id = actor_id
        and ca.revoked_at is null for share;
    if not found then raise exception 'Not authorized'; end if;
  end if;
  if not private.can_manage_payments(item.case_id) then raise exception 'Not authorized'; end if;
  if p_accept is null or clean_note is null or length(clean_note) > 1000 then
    raise exception 'Review note and decision are required';
  end if;
  decision := case when p_accept then 'accepted'::public.receipt_status
    else 'rejected'::public.receipt_status end;
  if item.status <> 'under_review' then
    if item.status = decision and item.reviewed_by = actor_id and item.review_note = clean_note then
      return;
    end if;
    raise exception 'Receipt already reviewed';
  end if;
  update public.payment_receipts set status = decision, review_note = clean_note,
    reviewed_by = actor_id, reviewed_at = clock_timestamp() where id = p_receipt_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action,
    before_data, after_data, reason)
  values (actor_id, item.case_id, 'payment_receipt', p_receipt_id,
    case when p_accept then 'accepted' else 'rejected' end,
    jsonb_build_object('status', 'under_review'),
    jsonb_build_object('status', decision, 'reviewed_by', actor_id), clean_note);
end;
$$;
revoke all on function public.staff_review_payment_receipt(uuid, boolean, text) from public, anon;
grant execute on function public.staff_review_payment_receipt(uuid, boolean, text) to authenticated;
-- END 20261011003000_receipt_workflow.sql

-- BEGIN 20261011003100_payment_receipt_link.sql
-- A reviewed receipt may support one confirmed payment in the same case.
-- Reviewing a receipt alone never creates a payment.
create function public.staff_confirm_payment_with_receipt(
  p_schedule_id uuid, p_amount_kzt numeric, p_paid_on date,
  p_reference text, p_client_note text, p_idempotency_key uuid,
  p_receipt_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  installment public.payment_schedule%rowtype;
  receipt public.payment_receipts%rowtype;
  result_id uuid;
  linked_receipt_id uuid;
begin
  select * into installment from public.payment_schedule where id = p_schedule_id;
  if not found or actor_id is null or not coalesce(private.can_manage_payments(installment.case_id), false) then
    raise exception 'Not authorized';
  end if;
  if p_receipt_id is not null then
    select * into receipt from public.payment_receipts where id = p_receipt_id for update;
    if not found or receipt.case_id <> installment.case_id or receipt.status <> 'accepted' then
      raise exception 'Accepted receipt not found for case';
    end if;
    if exists (select 1 from public.payments p where p.receipt_id = p_receipt_id
      and p.status = 'confirmed' and p.idempotency_key is distinct from p_idempotency_key) then
      raise exception 'Receipt already linked to payment';
    end if;
  end if;
  result_id := public.staff_confirm_payment(p_schedule_id, p_amount_kzt, p_paid_on,
    p_reference, p_client_note, p_idempotency_key);
  if p_receipt_id is not null then
    select receipt_id into linked_receipt_id from public.payments where id = result_id for update;
    if linked_receipt_id is not null and linked_receipt_id <> p_receipt_id then
      raise exception 'Payment already linked to another receipt';
    end if;
    if linked_receipt_id is null then
      update public.payments set receipt_id = p_receipt_id where id = result_id;
      insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
        values (actor_id, installment.case_id, 'payment', result_id, 'receipt_linked',
          jsonb_build_object('receipt_id', p_receipt_id));
    end if;
  end if;
  return result_id;
end;
$$;
revoke all on function public.staff_confirm_payment_with_receipt(uuid, numeric, date, text, text, uuid, uuid)
  from public, anon;
grant execute on function public.staff_confirm_payment_with_receipt(uuid, numeric, date, text, text, uuid, uuid)
  to authenticated;
-- END 20261011003100_payment_receipt_link.sql

-- BEGIN 20261011003200_financial_file_cleanup_guard.sql
-- Registration and orphan cleanup serialize on the exact Storage object path.
-- The check belongs on INSERT so it also protects callers other than the RPCs.
create function private.guard_financial_file_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(new.storage_path));

  if new.size_bytes is null or new.detected_mime_type is null or not exists (
    select 1 from storage.objects obj
    where obj.bucket_id = 'modernsecure-files' and obj.name = new.storage_path
      and obj.metadata->>'size' ~ '^[0-9]+$'
      and (obj.metadata->>'size')::bigint = new.size_bytes
      and obj.metadata->>'mimetype' = new.detected_mime_type
  ) then
    raise exception 'Financial file not found or metadata mismatch';
  end if;
  return new;
end;
$$;

create trigger modernsecure_contract_file_insert_guard
  before insert on public.contracts
  for each row execute function private.guard_financial_file_insert();

create trigger modernsecure_receipt_file_insert_guard
  before insert on public.payment_receipts
  for each row execute function private.guard_financial_file_insert();

revoke all on function private.guard_financial_file_insert() from public, anon, authenticated;
-- END 20261011003200_financial_file_cleanup_guard.sql

-- BEGIN 20261011003300_financial_notifications.sql
-- Financial file events appear in the same in-app notification inbox as case work.
create function private.notify_contract_uploaded()
returns trigger language plpgsql security definer set search_path = '' as $$
declare client_user_id uuid;
begin
  select cl.user_id into client_user_id from public.cases c
    join public.clients cl on cl.id = c.client_id where c.id = new.case_id;
  if client_user_id is not null then
    insert into public.notifications (recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
    values (client_user_id, new.case_id, 'contract', 'Добавлен договор',
      'Версия ' || new.version_no::text || ' доступна в разделе оплат.',
      '/account/cases/' || new.case_id::text || '/payments', 'contract:' || new.id::text)
    on conflict (recipient_user_id, dedupe_key) do nothing;
  end if;
  return new;
end;
$$;
create trigger modernsecure_contract_notify after insert on public.contracts
  for each row execute function private.notify_contract_uploaded();
revoke all on function private.notify_contract_uploaded() from public, anon, authenticated;

create function private.notify_payment_receipt_submitted()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
    select sm.user_id, new.case_id, 'payment_receipt', 'Новый чек клиента',
      'Проверьте документ. Чек сам по себе не подтверждает оплату.',
      '/staff/cases/' || new.case_id::text || '/payments', 'receipt-submitted:' || new.id::text
    from public.staff_members sm
    where sm.active and (sm.role = 'admin' or (sm.can_confirm_payments and exists (
      select 1 from public.case_assignments ca where ca.case_id = new.case_id
        and ca.staff_user_id = sm.user_id and ca.revoked_at is null
    )))
    on conflict (recipient_user_id, dedupe_key) do nothing;
  return new;
end;
$$;
create trigger modernsecure_receipt_submitted_notify after insert on public.payment_receipts
  for each row execute function private.notify_payment_receipt_submitted();
revoke all on function private.notify_payment_receipt_submitted() from public, anon, authenticated;

create function private.notify_payment_receipt_reviewed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare client_user_id uuid;
begin
  if new.status is not distinct from old.status or new.status = 'under_review' then return new; end if;
  select cl.user_id into client_user_id from public.cases c
    join public.clients cl on cl.id = c.client_id where c.id = new.case_id;
  if client_user_id is not null then
    insert into public.notifications (recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
    values (client_user_id, new.case_id, 'payment_receipt',
      case when new.status = 'accepted' then 'Чек проверен' else 'Чек отклонён' end,
      case when new.status = 'accepted' then 'Проверка чека не означает подтверждение поступления денег.'
        else coalesce(new.review_note, 'Проверьте замечание сотрудника.') end,
      '/account/cases/' || new.case_id::text || '/payments', 'receipt-reviewed:' || new.id::text)
    on conflict (recipient_user_id, dedupe_key) do nothing;
  end if;
  return new;
end;
$$;
create trigger modernsecure_receipt_reviewed_notify after update of status on public.payment_receipts
  for each row execute function private.notify_payment_receipt_reviewed();
revoke all on function private.notify_payment_receipt_reviewed() from public, anon, authenticated;
-- END 20261011003300_financial_notifications.sql

-- BEGIN 20261011003400_versioned_task_acknowledgment.sql
-- An acknowledgment records exactly which task text the client saw. It is not an e-signature.
alter table public.task_events add column acknowledged_text text;

create or replace function public.staff_create_task(
  p_case_id uuid, p_kind public.task_kind, p_title text,
  p_description text default null, p_due_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not private.lock_legal_case_editor(p_case_id) then raise exception 'Not authorized'; end if;
  if p_kind = 'acknowledge' and nullif(trim(p_description), '') is null then
    raise exception 'Acknowledgment text is required';
  end if;
  perform 1 from public.cases where id = p_case_id for update;
  return private.staff_create_task(p_case_id, p_kind, p_title, p_description, p_due_at);
end;
$$;

create or replace function public.client_respond_task(p_task_id uuid, p_response text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); item public.tasks%rowtype;
  response_body text := nullif(trim(p_response), ''); staff_id uuid; event_id uuid;
begin
  select * into item from public.tasks where id = p_task_id for update;
  if actor_id is null or not found or not exists (
    select 1 from public.cases c join public.clients cl on cl.id = c.client_id
    where c.id = item.case_id and cl.user_id = actor_id and c.status = 'open' and not c.is_suspended
  ) then raise exception 'Not authorized'; end if;
  if item.status <> 'new' or item.kind in ('upload_document', 'acknowledge')
    or response_body is null or length(response_body) > 2000 then
    raise exception 'Invalid task response';
  end if;
  update public.tasks set status = 'response_sent', updated_at = now() where id = p_task_id;
  insert into public.task_events (task_id, actor_user_id, action, response_text)
  values (p_task_id, actor_id, 'responded', response_body) returning id into event_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action)
  values (actor_id, item.case_id, 'task', p_task_id, 'responded');
  for staff_id in select ca.staff_user_id from public.case_assignments ca
    where ca.case_id = item.case_id and ca.revoked_at is null loop
    insert into public.notifications (recipient_user_id, case_id, kind, title, target_path, dedupe_key)
    values (staff_id, item.case_id, 'task_response', 'Ответ клиента на задачу',
      '/staff/cases/' || item.case_id || '/tasks', 'task-response:' || event_id);
  end loop;
end;
$$;

create function public.client_acknowledge_task(p_task_id uuid, p_expected_version text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); target_case_id uuid; case_row public.cases%rowtype;
  item public.tasks%rowtype; snapshot text; version text; event_id uuid; staff_id uuid;
begin
  if actor_id is null or p_task_id is null then raise exception 'Not authorized'; end if;
  select case_id into target_case_id from public.tasks where id = p_task_id;
  if target_case_id is null then raise exception 'Not authorized'; end if;
  select * into case_row from public.cases where id = target_case_id for update;
  if not found or case_row.status <> 'open' or case_row.is_suspended or not exists (
    select 1 from public.clients cl where cl.id = case_row.client_id and cl.user_id = actor_id
  ) then raise exception 'Not authorized'; end if;
  select * into item from public.tasks where id = p_task_id for update;
  if not found or item.case_id <> target_case_id or item.kind <> 'acknowledge' then
    raise exception 'Invalid acknowledgment';
  end if;
  snapshot := item.title || E'\n' || coalesce(item.description, '');
  version := encode(pg_catalog.sha256(convert_to(snapshot, 'UTF8')), 'hex');
  if p_expected_version is distinct from version then
    raise exception 'Acknowledgment text changed';
  end if;
  if item.status in ('response_sent', 'completed') and exists (
    select 1 from public.task_events te where te.task_id = p_task_id
      and te.actor_user_id = actor_id and te.action = 'acknowledged'
      and te.acknowledged_version = version
  ) then return; end if;
  if item.status <> 'new' then raise exception 'Invalid acknowledgment'; end if;
  update public.tasks set status = 'response_sent', updated_at = now() where id = p_task_id;
  insert into public.task_events (
    task_id, actor_user_id, action, acknowledged_version, acknowledged_text
  ) values (p_task_id, actor_id, 'acknowledged', version, snapshot)
    returning id into event_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
    values (actor_id, target_case_id, 'task', p_task_id, 'acknowledged',
      jsonb_build_object('version', version, 'event_id', event_id));
  for staff_id in select ca.staff_user_id from public.case_assignments ca
    where ca.case_id = target_case_id and ca.revoked_at is null loop
    insert into public.notifications (recipient_user_id, case_id, kind, title, target_path, dedupe_key)
      values (staff_id, target_case_id, 'task_response', 'Клиент ознакомился с задачей',
        '/staff/cases/' || target_case_id || '/tasks', 'task-acknowledged:' || event_id);
  end loop;
end;
$$;
revoke all on function public.client_acknowledge_task(uuid, text) from public, anon;
grant execute on function public.client_acknowledge_task(uuid, text) to authenticated;
-- END 20261011003400_versioned_task_acknowledgment.sql

-- BEGIN 20261011003500_task_deadline_reminders.sql
-- Hourly job, deduplicated by task and local due date. Kazakhstan uses Asia/Almaty.
create index tasks_open_deadline_idx on public.tasks (due_at)
  where status = 'new' and due_at is not null;

create function private.enqueue_task_deadline_reminders(p_reference_day date default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare local_day date := coalesce(p_reference_day, (now() at time zone 'Asia/Almaty')::date);
  inserted_count integer;
begin
  with upcoming as (
    select t.id, t.case_id, t.title, cl.user_id,
      (t.due_at at time zone 'Asia/Almaty')::date as due_day
    from public.tasks t
    join public.cases c on c.id = t.case_id
    join public.clients cl on cl.id = c.client_id
    where t.status = 'new' and t.due_at is not null
      and c.status = 'open' and not c.is_suspended and cl.user_id is not null
      and t.due_at >= (local_day::timestamp at time zone 'Asia/Almaty')
      and t.due_at < ((local_day + 2)::timestamp at time zone 'Asia/Almaty')
  )
  insert into public.notifications (recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
  select u.user_id, u.case_id, 'task_deadline',
    case when u.due_day = local_day then 'Срок задачи сегодня' else 'Срок задачи завтра' end,
    left(u.title, 180), '/account/cases/' || u.case_id || '/tasks',
    'task-deadline:' || u.id || ':' || u.due_day || ':' ||
      case when u.due_day = local_day then 'today' else 'tomorrow' end
  from upcoming u
  on conflict (recipient_user_id, dedupe_key) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;
revoke all on function private.enqueue_task_deadline_reminders(date) from public, anon, authenticated;

-- pg_cron is available on Supabase; local PGlite tests do not ship this extension.
do $$
begin
  if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('modernsecure-task-deadlines', '0 * * * *',
      'select private.enqueue_task_deadline_reminders()');
  end if;
end;
$$;
-- END 20261011003500_task_deadline_reminders.sql

-- BEGIN 20261011003600_unread_notifications_index.sql
-- Unread badges query by recipient frequently; do not scan read history.
create index notifications_recipient_unread_idx
  on public.notifications (recipient_user_id, created_at desc)
  where read_at is null;
-- END 20261011003600_unread_notifications_index.sql

-- BEGIN 20261011003700_authorize_split_document_upload.sql
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
-- END 20261011003700_authorize_split_document_upload.sql

-- BEGIN 20261011003800_revoke_assignments_on_role_change.sql
-- A manager's existing assignments must not become lawyer authority after a role switch.
-- Revoke them transactionally; the administrator can explicitly reassign suitable cases.
create or replace function public.admin_set_staff_access(
  p_staff_user_id uuid, p_role public.staff_role, p_active boolean, p_reason text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  before_staff public.staff_members%rowtype;
  assignment record;
  clean_reason text := nullif(trim(p_reason), '');
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  if p_staff_user_id is null or p_staff_user_id = actor_id
    or not coalesce(p_role in ('lawyer', 'manager'), false) or p_active is null
    or clean_reason is null or length(clean_reason) > 500 then
    raise exception 'Invalid staff access change';
  end if;
  select * into before_staff from public.staff_members where user_id = p_staff_user_id for update;
  if not found or before_staff.role = 'admin' then raise exception 'Protected administrator'; end if;
  if before_staff.role = p_role and before_staff.active = p_active then raise exception 'Access is unchanged'; end if;
  update public.staff_members set role = p_role, active = p_active where user_id = p_staff_user_id;
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, before_data, after_data, reason)
  values (actor_id, 'staff_member', p_staff_user_id, 'access_changed',
    jsonb_build_object('role', before_staff.role, 'active', before_staff.active),
    jsonb_build_object('role', p_role, 'active', p_active), clean_reason);
  if before_staff.role <> p_role or not p_active then
    for assignment in select id, case_id, assigned_at from public.case_assignments
      where staff_user_id = p_staff_user_id and revoked_at is null for update loop
      update public.case_assignments
        set revoked_at = greatest(clock_timestamp(), assignment.assigned_at)
        where id = assignment.id;
      insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, reason)
      values (actor_id, assignment.case_id, 'case_assignment', assignment.id, 'revoked', clean_reason);
    end loop;
  end if;
end;
$$;
-- END 20261011003800_revoke_assignments_on_role_change.sql

-- BEGIN 20261011003900_admin_staff_email_read.sql
-- The administrator needs staff email, not the rest of each private profile.
-- Keep profiles self-only under RLS and expose only these two fields through a guarded RPC.
create function public.admin_staff_emails(p_user_ids uuid[])
returns table(user_id uuid, email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  if p_user_ids is null or coalesce(array_length(p_user_ids, 1), 0) > 100 then
    raise exception 'Invalid staff lookup';
  end if;
  return query
    select sm.user_id, p.email from public.staff_members sm
    join public.profiles p on p.user_id = sm.user_id
    where sm.user_id = any(p_user_ids);
end;
$$;
revoke all on function public.admin_staff_emails(uuid[]) from public, anon;
grant execute on function public.admin_staff_emails(uuid[]) to authenticated;
-- END 20261011003900_admin_staff_email_read.sql

-- BEGIN 20261011004000_document_upload_retry_idempotency.sql
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
-- END 20261011004000_document_upload_retry_idempotency.sql

-- BEGIN 20261011004100_completed_document_upload_replay.sql
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
-- END 20261011004100_completed_document_upload_replay.sql

-- BEGIN 20261011004200_document_review_notifications.sql
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
-- END 20261011004200_document_review_notifications.sql

-- BEGIN 20261011004300_unassigned_case_client_notifications.sql
-- An admin-created case can receive client activity before its first assignment.
-- Once handed off, notify active assignees only; inactive/revoked staff have no case access.
create function private.notify_case_staff_or_admins(
  p_case_id uuid, p_kind text, p_title text, p_section text, p_dedupe_key text
) returns void language sql security definer set search_path = '' as $$
  with assignees as (
    select distinct sm.user_id
    from public.case_assignments ca
    join public.staff_members sm on sm.user_id = ca.staff_user_id
    where ca.case_id = p_case_id and ca.revoked_at is null and sm.active
  ), recipients as (
    select user_id from assignees
    union
    select sm.user_id from public.staff_members sm
    where sm.active and sm.role = 'admin' and not exists (select 1 from assignees)
  )
  insert into public.notifications
    (recipient_user_id, case_id, kind, title, target_path, dedupe_key)
  select r.user_id, p_case_id, p_kind, p_title,
    '/staff/cases/' || p_case_id::text || '/' || p_section, p_dedupe_key
  from recipients r
  on conflict (recipient_user_id, dedupe_key) do nothing
$$;
revoke all on function private.notify_case_staff_or_admins(uuid, text, text, text, text)
  from public, anon, authenticated;

create or replace function public.post_case_message(p_case_id uuid, p_body text, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); new_id uuid; client_user_id uuid; is_client boolean;
begin
  if actor_id is null or not private.can_read_case(p_case_id) then raise exception 'Not authorized'; end if;
  if nullif(trim(p_body), '') is null or length(trim(p_body)) > 4000
    or nullif(trim(p_idempotency_key), '') is null or length(trim(p_idempotency_key)) > 100 then
    raise exception 'Invalid message';
  end if;
  select cl.user_id into client_user_id from public.cases c join public.clients cl on cl.id = c.client_id where c.id = p_case_id;
  is_client := actor_id = client_user_id;
  if not is_client and not private.is_staff_for_case(p_case_id) then raise exception 'Not authorized'; end if;
  insert into public.messages (case_id, sender_user_id, body, idempotency_key)
  values (p_case_id, actor_id, trim(p_body), trim(p_idempotency_key))
  on conflict (case_id, sender_user_id, idempotency_key) do nothing returning id into new_id;
  if new_id is null then
    select id into new_id from public.messages where case_id = p_case_id and sender_user_id = actor_id and idempotency_key = trim(p_idempotency_key);
    return new_id;
  end if;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action)
  values (actor_id, p_case_id, 'message', new_id, 'sent');
  if is_client then
    perform private.notify_case_staff_or_admins(p_case_id, 'message',
      'Новое сообщение от клиента', 'messages', 'message:' || new_id::text);
  elsif client_user_id is not null then
    insert into public.notifications (recipient_user_id, case_id, kind, title, target_path, dedupe_key)
    values (client_user_id, p_case_id, 'message', 'Новое сообщение по делу', '/account/cases/' || p_case_id || '/messages', 'message:' || new_id);
  end if;
  return new_id;
end;
$$;

create or replace function public.client_respond_task(p_task_id uuid, p_response text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); item public.tasks%rowtype;
  response_body text := nullif(trim(p_response), ''); event_id uuid;
begin
  select * into item from public.tasks where id = p_task_id for update;
  if actor_id is null or not found or not exists (
    select 1 from public.cases c join public.clients cl on cl.id = c.client_id
    where c.id = item.case_id and cl.user_id = actor_id and c.status = 'open' and not c.is_suspended
  ) then raise exception 'Not authorized'; end if;
  if item.status <> 'new' or item.kind in ('upload_document', 'acknowledge')
    or response_body is null or length(response_body) > 2000 then
    raise exception 'Invalid task response';
  end if;
  update public.tasks set status = 'response_sent', updated_at = now() where id = p_task_id;
  insert into public.task_events (task_id, actor_user_id, action, response_text)
  values (p_task_id, actor_id, 'responded', response_body) returning id into event_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action)
  values (actor_id, item.case_id, 'task', p_task_id, 'responded');
  perform private.notify_case_staff_or_admins(item.case_id, 'task_response',
    'Ответ клиента на задачу', 'tasks', 'task-response:' || event_id::text);
end;
$$;

create or replace function public.client_acknowledge_task(p_task_id uuid, p_expected_version text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); target_case_id uuid; case_row public.cases%rowtype;
  item public.tasks%rowtype; snapshot text; version text; event_id uuid;
begin
  if actor_id is null or p_task_id is null then raise exception 'Not authorized'; end if;
  select case_id into target_case_id from public.tasks where id = p_task_id;
  if target_case_id is null then raise exception 'Not authorized'; end if;
  select * into case_row from public.cases where id = target_case_id for update;
  if not found or case_row.status <> 'open' or case_row.is_suspended or not exists (
    select 1 from public.clients cl where cl.id = case_row.client_id and cl.user_id = actor_id
  ) then raise exception 'Not authorized'; end if;
  select * into item from public.tasks where id = p_task_id for update;
  if not found or item.case_id <> target_case_id or item.kind <> 'acknowledge' then
    raise exception 'Invalid acknowledgment';
  end if;
  snapshot := item.title || E'\n' || coalesce(item.description, '');
  version := encode(pg_catalog.sha256(convert_to(snapshot, 'UTF8')), 'hex');
  if p_expected_version is distinct from version then
    raise exception 'Acknowledgment text changed';
  end if;
  if item.status in ('response_sent', 'completed') and exists (
    select 1 from public.task_events te where te.task_id = p_task_id
      and te.actor_user_id = actor_id and te.action = 'acknowledged'
      and te.acknowledged_version = version
  ) then return; end if;
  if item.status <> 'new' then raise exception 'Invalid acknowledgment'; end if;
  update public.tasks set status = 'response_sent', updated_at = now() where id = p_task_id;
  insert into public.task_events (
    task_id, actor_user_id, action, acknowledged_version, acknowledged_text
  ) values (p_task_id, actor_id, 'acknowledged', version, snapshot)
    returning id into event_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
    values (actor_id, target_case_id, 'task', p_task_id, 'acknowledged',
      jsonb_build_object('version', version, 'event_id', event_id));
  perform private.notify_case_staff_or_admins(target_case_id, 'task_response',
    'Клиент ознакомился с задачей', 'tasks', 'task-acknowledged:' || event_id::text);
end;
$$;
-- END 20261011004300_unassigned_case_client_notifications.sql

-- BEGIN 20261011004400_receipt_notification_finance_scope.sql
-- Receipt notices follow the same staff eligibility as can_manage_payments.
-- Replacing the function preserves the existing trigger and dedupe key.
create or replace function private.notify_payment_receipt_submitted()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
    select sm.user_id, new.case_id, 'payment_receipt', 'Новый чек клиента',
      'Проверьте документ. Чек сам по себе не подтверждает оплату.',
      '/staff/cases/' || new.case_id::text || '/payments', 'receipt-submitted:' || new.id::text
    from public.staff_members sm
    where sm.active and sm.can_confirm_payments
      and (sm.role = 'admin' or exists (
        select 1 from public.case_assignments ca where ca.case_id = new.case_id
          and ca.staff_user_id = sm.user_id and ca.revoked_at is null
      ))
    on conflict (recipient_user_id, dedupe_key) do nothing;
  return new;
end;
$$;
revoke all on function private.notify_payment_receipt_submitted() from public, anon, authenticated;
-- END 20261011004400_receipt_notification_finance_scope.sql

-- BEGIN 20261011004500_payment_schedule_contract_version.sql
-- A legacy installment without any registered contract is an invalid financial
-- chain. Abort the migration so these rows can be reviewed before deployment.
do $$
begin
  if exists (
    select 1 from public.payment_schedule ps
    where not exists (select 1 from public.contracts c where c.case_id = ps.case_id)
  ) then
    raise exception 'Legacy payment schedule contains a case without a contract';
  end if;
end;
$$;

-- Keep the remaining historical schedules unassigned: their original contract
-- version cannot be inferred safely, even when a case has only one today.
alter table public.payment_schedule add column contract_id uuid;

-- The pair makes it impossible to attach an installment to another case's
-- contract, while nullable legacy rows continue to be editable.
alter table public.contracts add constraint contracts_id_case_id_key unique (id, case_id);
alter table public.payment_schedule add constraint payment_schedule_contract_case_fk
  foreign key (contract_id, case_id) references public.contracts (id, case_id)
  on update restrict on delete restrict;

create function private.require_installment_contract()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.contract_id is null then
    raise exception 'Contract version is required for a new installment';
  end if;
  return new;
end;
$$;
revoke all on function private.require_installment_contract() from public, anon, authenticated;
create trigger modernsecure_installment_contract_required
  before insert on public.payment_schedule
  for each row execute function private.require_installment_contract();

create function private.keep_installment_contract()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.contract_id is distinct from old.contract_id or new.case_id is distinct from old.case_id then
    raise exception 'Installment contract version and case are immutable';
  end if;
  return new;
end;
$$;
revoke all on function private.keep_installment_contract() from public, anon, authenticated;
create trigger modernsecure_installment_contract_immutable
  before update of contract_id, case_id on public.payment_schedule
  for each row execute function private.keep_installment_contract();

-- Preserve the RPC signature used by the existing server action.
create or replace function public.staff_add_payment_installment(p_case_id uuid, p_due_on date,
  p_amount_kzt numeric, p_description text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  item public.cases%rowtype;
  contract_version public.contracts%rowtype;
  installment_id uuid;
begin
  if actor_id is null or not private.can_manage_payments(p_case_id) then raise exception 'Not authorized'; end if;
  select * into item from public.cases where id = p_case_id for update;
  if not found or item.status <> 'open' or item.is_suspended then raise exception 'Case is not active'; end if;
  if p_due_on is null or p_amount_kzt is null or p_amount_kzt <= 0
    or p_amount_kzt > 999999999999.99 or p_amount_kzt <> round(p_amount_kzt, 2)
    or length(coalesce(p_description, '')) > 500 then raise exception 'Invalid installment'; end if;

  select * into contract_version from public.contracts
    where case_id = p_case_id order by version_no desc limit 1;
  if not found then raise exception 'Contract version is required for a new installment'; end if;

  insert into public.payment_schedule (case_id, contract_id, due_on, amount_kzt, description)
  values (p_case_id, contract_version.id, p_due_on, p_amount_kzt, nullif(trim(p_description), ''))
  returning id into installment_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
  values (actor_id, p_case_id, 'payment_schedule', installment_id, 'installment_created',
    jsonb_build_object('due_on', p_due_on, 'amount_kzt', p_amount_kzt,
      'contract_id', contract_version.id, 'contract_version_no', contract_version.version_no));
  return installment_id;
end;
$$;
-- END 20261011004500_payment_schedule_contract_version.sql

-- BEGIN 20261011004600_message_attachments.sql
-- Message files live in the existing private bucket. Only the checked server route
-- may write objects; authenticated users may read metadata through case RLS.
do $$ begin
  if exists (select 1 from public.message_attachments) then
    raise exception 'Review existing message_attachments before adding required verified metadata';
  end if;
end $$;

alter table public.message_attachments
  add column content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  add column position integer not null check (position between 0 and 4),
  add constraint message_attachments_position_unique unique (message_id, position),
  add constraint message_attachments_mime_check check (detected_mime_type in
    ('application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif')),
  add constraint message_attachments_name_check check
    (length(original_name) between 1 and 180 and original_name !~ '[[:cntrl:]/]'
      and position(chr(92) in original_name) = 0 and original_name = btrim(original_name));

create index message_attachments_message_position_idx
  on public.message_attachments (message_id, position);

create trigger modernsecure_message_attachments_immutable
before update or delete on public.message_attachments
for each row execute function private.reject_message_change();

-- Share a path lock with the aged-orphan sweeper. Either registration wins and
-- the sweeper sees the reference, or deletion wins and registration fails.
create function private.guard_message_attachment_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.storage_path, 0));
  if not exists (select 1 from storage.objects obj
    where obj.bucket_id = 'modernsecure-files' and obj.name = new.storage_path
      and obj.metadata->>'size' ~ '^[0-9]+$'
      and (obj.metadata->>'size')::bigint = new.size_bytes
      and obj.metadata->>'mimetype' = new.detected_mime_type) then
    raise exception 'Message object not found or metadata mismatch';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_message_attachment_insert() from public, anon, authenticated;
create trigger modernsecure_message_attachment_insert_guard
before insert on public.message_attachments
for each row execute function private.guard_message_attachment_insert();

create function public.post_case_message_with_attachments(
  p_case_id uuid, p_body text, p_idempotency_key uuid, p_files jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  prior public.messages%rowtype;
  message_id uuid;
  item jsonb;
  ordinal integer;
  total_bytes bigint := 0;
  expected_files jsonb := '[]'::jsonb;
  saved_files jsonb;
  file_path text;
  suffix text;
  file_mime text;
  file_size bigint;
begin
  if actor_id is null or p_case_id is null or p_idempotency_key is null
    or not private.can_read_case(p_case_id) then raise exception 'Not authorized'; end if;
  if nullif(btrim(p_body), '') is null or length(btrim(p_body)) > 4000
    or p_files is null or jsonb_typeof(p_files) <> 'array'
    or jsonb_array_length(p_files) > 5 then raise exception 'Invalid message files'; end if;

  -- Serialize retries before inspecting the message key. The original message RPC
  -- also takes this actor lock in its rate-limit trigger.
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text, 0));
  for item, ordinal in select value, ordinality::integer - 1
    from jsonb_array_elements(p_files) with ordinality loop
    if jsonb_typeof(item) <> 'object' or not (item ?& array['id','path','name','mime','size','sha256'])
      or (item->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (item->>'sha256') !~ '^[0-9a-f]{64}$'
      or (item->>'size') !~ '^[0-9]+$' then raise exception 'Invalid message file'; end if;
    file_path := item->>'path';
    file_mime := item->>'mime';
    file_size := (item->>'size')::bigint;
    if file_path !~ ('^messages/' || p_case_id::text || '/' || actor_id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' ||
      (item->>'id') || '$')
      or length(item->>'name') not between 1 and 180
      or (item->>'name') ~ '[[:cntrl:]/]'
      or position(chr(92) in item->>'name') > 0
      or (item->>'name') <> btrim(item->>'name')
      or file_mime not in ('application/pdf','image/jpeg','image/png','image/heic','image/heif')
      or file_size not between 1 and 20971520 then raise exception 'Invalid message file'; end if;
    suffix := lower(substring(item->>'name' from '[.][^.]+$'));
    if not ((file_mime = 'application/pdf' and suffix = '.pdf')
      or (file_mime = 'image/jpeg' and suffix in ('.jpg','.jpeg'))
      or (file_mime = 'image/png' and suffix = '.png')
      or (file_mime = 'image/heic' and suffix = '.heic')
      or (file_mime = 'image/heif' and suffix = '.heif')) then
      raise exception 'Invalid message file type';
    end if;
    total_bytes := total_bytes + file_size;
    expected_files := expected_files || jsonb_build_array(jsonb_build_object(
      'name', item->>'name', 'mime', file_mime, 'size', file_size,
      'sha256', item->>'sha256'));
  end loop;
  if total_bytes > 41943040 then raise exception 'Message files too large'; end if;

  select * into prior from public.messages
    where case_id = p_case_id and sender_user_id = actor_id
      and idempotency_key = p_idempotency_key::text;
  if found then
    select coalesce(jsonb_agg(jsonb_build_object('name', ma.original_name,
      'mime', ma.detected_mime_type, 'size', ma.size_bytes,
      'sha256', ma.content_sha256) order by ma.position), '[]'::jsonb)
      into saved_files from public.message_attachments ma where ma.message_id = prior.id;
    if prior.body <> btrim(p_body) or saved_files <> expected_files then
      raise exception 'Message key cannot be reused';
    end if;
    return jsonb_build_object('id', prior.id, 'created', false);
  end if;

  if jsonb_array_length(p_files) > 0 then
    for item in select value from jsonb_array_elements(p_files) loop
      if not exists (select 1 from storage.objects obj
        where obj.bucket_id = 'modernsecure-files' and obj.name = item->>'path'
          and obj.metadata->>'size' ~ '^[0-9]+$'
          and (obj.metadata->>'size')::bigint = (item->>'size')::bigint
          and obj.metadata->>'mimetype' = item->>'mime') then
        raise exception 'Message object not found or metadata mismatch';
      end if;
    end loop;
  end if;

  message_id := public.post_case_message(p_case_id, p_body, p_idempotency_key::text);
  for item, ordinal in select value, ordinality::integer - 1
    from jsonb_array_elements(p_files) with ordinality loop
    insert into public.message_attachments
      (id, message_id, storage_path, original_name, detected_mime_type,
       size_bytes, content_sha256, position)
    values ((item->>'id')::uuid, message_id, item->>'path', item->>'name',
      item->>'mime', (item->>'size')::bigint, item->>'sha256', ordinal);
  end loop;
  return jsonb_build_object('id', message_id, 'created', true);
end;
$$;

revoke all on function public.post_case_message_with_attachments(uuid, text, uuid, jsonb)
  from public, anon;
grant execute on function public.post_case_message_with_attachments(uuid, text, uuid, jsonb)
  to authenticated;
-- END 20261011004600_message_attachments.sql

-- BEGIN 20261011004700_admin_unassigned_case_queue.sql
-- Surface cases that have not yet been handed to an active employee.
create function public.admin_unassigned_cases()
returns table (case_id uuid, case_number text, title text, created_at timestamptz, total_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;

  return query
    select c.id, c.case_number, c.title, c.created_at, count(*) over ()
    from public.cases c
    where c.status = 'open' and not exists (
      select 1 from public.case_assignments ca
      join public.staff_members sm on sm.user_id = ca.staff_user_id
      where ca.case_id = c.id and ca.revoked_at is null and sm.active
    )
    order by c.created_at desc, c.id desc
    limit 5;
end;
$$;
revoke all on function public.admin_unassigned_cases() from public, anon;
grant execute on function public.admin_unassigned_cases() to authenticated;
-- END 20261011004700_admin_unassigned_case_queue.sql

-- BEGIN 20261011004800_message_realtime.sql
-- Realtime only needs the parent message insert. Attachments are committed in
-- the same transaction and are fetched through the existing RLS-backed page.
-- The table already has SELECT limited by private.can_read_case(case_id).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
    ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;
-- END 20261011004800_message_realtime.sql

-- BEGIN 20261011004900_staff_case_worklist.sql
-- One bounded, role-scoped source for the staff case list and conversation inbox.
create index if not exists messages_case_recent_idx on public.messages(case_id, created_at desc, id desc);
create index if not exists tasks_case_open_due_idx on public.tasks(case_id, due_at)
  where status = 'new' and due_at is not null;
create index if not exists document_files_review_request_idx on public.document_files(request_id)
  where status = 'under_review';

create function public.staff_case_worklist(
  p_query text default '',
  p_status text default 'all',
  p_attention text default 'all',
  p_staff uuid default null,
  p_service uuid default null,
  p_stage uuid default null,
  p_client uuid default null,
  p_page integer default 1,
  p_sort text default 'activity'
)
returns table (
  case_id uuid, case_number text, title text, client_name text,
  status public.case_status, is_suspended boolean, stage_name text,
  service_name text, updated_at timestamptz, last_message_at timestamptz,
  last_message_body text, unread_count bigint, overdue_count bigint,
  review_count bigint, total_count bigint
)
language plpgsql stable security definer set search_path = '' as $$
declare
  viewer_id uuid := auth.uid();
  viewer_role public.staff_role := private.staff_role_for_current_user();
  clean_query text := lower(trim(coalesce(p_query, '')));
begin
  if viewer_role is null or viewer_id is null then
    raise exception 'Not authorized';
  end if;
  if length(clean_query) > 120 or p_page is null or p_page not between 1 and 10000
    or p_status is null or p_status not in ('all', 'open', 'closed', 'suspended')
    or p_attention is null or p_attention not in ('all', 'unread', 'overdue', 'documents', 'messages')
    or p_sort is null or p_sort not in ('activity', 'message') then
    raise exception 'Invalid worklist filter';
  end if;

  return query
    with visible as (
      select c.id, c.case_number, c.title, cl.full_name,
        c.status, c.is_suspended, st.title as stage_title,
        sv.name as service_title, c.updated_at
      from public.cases c
      join public.clients cl on cl.id = c.client_id
      join public.service_template_versions v on v.id = c.service_version_id
      join public.service_templates sv on sv.id = v.service_id
      left join public.stage_templates st on st.id = c.current_stage_id
      where (viewer_role = 'admin' or exists (
        select 1 from public.case_assignments ca
        where ca.case_id = c.id and ca.staff_user_id = viewer_id and ca.revoked_at is null
      ))
        and (p_staff is null or exists (
          select 1 from public.case_assignments ca
          join public.staff_members sm on sm.user_id = ca.staff_user_id
          where ca.case_id = c.id and ca.staff_user_id = p_staff
            and ca.revoked_at is null and sm.active
        ))
        and (p_service is null or sv.id = p_service)
        and (p_stage is null or c.current_stage_id = p_stage)
        and (p_client is null or c.client_id = p_client)
        and (p_status = 'all'
          or (p_status = 'open' and c.status = 'open' and not c.is_suspended)
          or (p_status = 'closed' and c.status = 'closed')
          or (p_status = 'suspended' and c.status = 'open' and c.is_suspended))
        and (clean_query = ''
          or position(clean_query in lower(c.case_number)) > 0
          or position(clean_query in lower(c.title)) > 0
          or position(clean_query in lower(cl.full_name)) > 0
          or exists (
            select 1 from public.contracts ct
            where ct.case_id = c.id and position(clean_query in lower(ct.contract_number)) > 0
          ))
    ), enriched as (
      select v.*, latest.created_at as latest_at,
        latest.preview as latest_body,
        coalesce(unread.items, 0)::bigint as unread_items,
        coalesce(overdue.items, 0)::bigint as overdue_items,
        coalesce(reviews.items, 0)::bigint as review_items
      from visible v
      left join lateral (
        select m.created_at,
          coalesce(nullif(left(trim(m.body), 160), ''), 'Вложение') as preview
        from public.messages m where m.case_id = v.id
        order by m.created_at desc, m.id desc limit 1
      ) latest on true
      left join lateral (
        select count(*) as items from public.messages m
        where m.case_id = v.id and m.sender_user_id <> viewer_id
          and not exists (
            select 1 from public.message_reads mr
            where mr.message_id = m.id and mr.reader_user_id = viewer_id
          )
      ) unread on true
      left join lateral (
        select count(*) as items from public.tasks t
        where t.case_id = v.id and t.status = 'new' and t.due_at < now()
          and v.status = 'open' and not v.is_suspended
      ) overdue on true
      left join lateral (
        select count(*) as items from public.document_requests dr
        join public.document_files df on df.request_id = dr.id
        where dr.case_id = v.id and df.status = 'under_review'
      ) reviews on true
    )
    select e.id, e.case_number, e.title, e.full_name, e.status, e.is_suspended,
      e.stage_title, e.service_title, e.updated_at, e.latest_at, e.latest_body,
      e.unread_items, e.overdue_items, e.review_items, count(*) over ()
    from enriched e
    where p_attention = 'all'
      or (p_attention = 'unread' and e.unread_items > 0)
      or (p_attention = 'overdue' and e.overdue_items > 0)
      or (p_attention = 'documents' and e.review_items > 0)
      or (p_attention = 'messages' and e.latest_at is not null)
    order by
      case when p_sort = 'message' then e.latest_at else e.updated_at end desc nulls last,
      e.id desc
    limit 25 offset (p_page - 1) * 25;
end;
$$;

revoke all on function public.staff_case_worklist(text, text, text, uuid, uuid, uuid, uuid, integer, text) from public, anon;
grant execute on function public.staff_case_worklist(text, text, text, uuid, uuid, uuid, uuid, integer, text) to authenticated;
-- END 20261011004900_staff_case_worklist.sql

-- BEGIN 20261011005000_case_message_state.sql
-- Keep message retries idempotent while preventing new correspondence after
-- a case is suspended, closed, or cancelled. The case row lock serializes a
-- send with case lifecycle changes.
create or replace function public.post_case_message(
  p_case_id uuid, p_body text, p_idempotency_key text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  new_id uuid;
  prior public.messages%rowtype;
  case_status public.case_status;
  suspended boolean;
  client_user_id uuid;
  is_client boolean;
begin
  if actor_id is null or not private.can_read_case(p_case_id) then raise exception 'Not authorized'; end if;
  if nullif(trim(p_body), '') is null or length(trim(p_body)) > 4000
    or nullif(trim(p_idempotency_key), '') is null or length(trim(p_idempotency_key)) > 100 then
    raise exception 'Invalid message';
  end if;

  -- Match the attachment wrapper and rate-limit trigger's actor lock so a
  -- concurrent request cannot turn a retry into a different message.
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text, 0));
  select c.status, c.is_suspended into case_status, suspended
    from public.cases c where c.id = p_case_id for update;
  if not found then raise exception 'Not authorized'; end if;

  select * into prior from public.messages
    where case_id = p_case_id and sender_user_id = actor_id
      and idempotency_key = trim(p_idempotency_key);
  if found then
    if prior.body <> trim(p_body) then raise exception 'Message key cannot be reused'; end if;
    return prior.id;
  end if;
  if case_status <> 'open' or suspended then raise exception 'Case is not active'; end if;

  select cl.user_id into client_user_id from public.cases c
    join public.clients cl on cl.id = c.client_id where c.id = p_case_id;
  is_client := actor_id = client_user_id;
  if not is_client and not private.is_staff_for_case(p_case_id) then raise exception 'Not authorized'; end if;
  insert into public.messages (case_id, sender_user_id, body, idempotency_key)
  values (p_case_id, actor_id, trim(p_body), trim(p_idempotency_key))
  returning id into new_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action)
  values (actor_id, p_case_id, 'message', new_id, 'sent');
  if is_client then
    perform private.notify_case_staff_or_admins(p_case_id, 'message',
      'Новое сообщение от клиента', 'messages', 'message:' || new_id::text);
  elsif client_user_id is not null then
    insert into public.notifications (recipient_user_id, case_id, kind, title, target_path, dedupe_key)
    values (client_user_id, p_case_id, 'message', 'Новое сообщение по делу',
      '/account/cases/' || p_case_id || '/messages', 'message:' || new_id);
  end if;
  return new_id;
end;
$$;
-- END 20261011005000_case_message_state.sql

-- BEGIN 20261011005100_document_draft_privacy.sql
-- Pending upload metadata belongs to its uploader until the batch is submitted.
-- Preserve case-scoped reads for every later document status.
drop policy document_files_case_read on public.document_files;
create policy document_files_case_read on public.document_files for select to authenticated
  using (
    private.can_read_document_request(request_id)
    and (status <> 'quarantine' or uploaded_by = (select auth.uid()))
  );
-- END 20261011005100_document_draft_privacy.sql

-- BEGIN 20261011005200_finance_task_integrity.sql
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
-- END 20261011005200_finance_task_integrity.sql

-- BEGIN 20261011005300_account_link_and_stage_privacy.sql
-- Managers may only link a verified account matching the card's contact email.
-- Administrators retain the explicit override for exceptional identity checks.
create or replace function public.link_client_account(p_client_id uuid, p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  actor_role public.staff_role := private.staff_role_for_current_user();
  target_id uuid;
  existing_user_id uuid;
  card_email text;
begin
  if actor_id is null or not coalesce(actor_role in ('manager', 'admin'), false) then
    raise exception 'Not authorized';
  end if;
  if p_client_id is null or p_email is null or length(trim(p_email)) > 254 or length(trim(p_email)) < 3 then
    raise exception 'Invalid input';
  end if;
  select cl.user_id, cl.email into existing_user_id, card_email
    from public.clients cl where cl.id = p_client_id for update;
  if not found or existing_user_id is not null then raise exception 'Client card is unavailable'; end if;
  if actor_role = 'manager' and (card_email is null or lower(trim(card_email)) <> lower(trim(p_email))) then
    raise exception 'Account email must match client card';
  end if;
  select u.id into target_id from auth.users u
    where lower(u.email) = lower(trim(p_email)) and u.email_confirmed_at is not null;
  if target_id is null then raise exception 'Verified account not found'; end if;
  if exists (select 1 from public.staff_members sm where sm.user_id = target_id) then
    raise exception 'Account is already staff';
  end if;
  if exists (select 1 from public.clients cl where cl.user_id = target_id) then
    raise exception 'Account is already linked';
  end if;
  update public.clients set user_id = target_id, linked_by = actor_id, linked_at = now(), updated_at = now()
    where id = p_client_id;
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
  values (actor_id, 'client', p_client_id, 'account_linked',
    jsonb_build_object('user_id', target_id, 'email_match', card_email is not null and lower(trim(card_email)) = lower(trim(p_email))));
end;
$$;

-- Column grants, not UI field selection, protect staff-only change_reason.
revoke select on public.case_stage_events from authenticated;
grant select (id, case_id, from_stage_id, to_stage_id, actor_user_id, client_note, occurred_at)
  on public.case_stage_events to authenticated;

create function public.staff_case_stage_events(p_case_id uuid)
returns setof public.case_stage_events language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_staff_for_case(p_case_id) then
    raise exception 'Not authorized';
  end if;
  return query select e.* from public.case_stage_events e
    where e.case_id = p_case_id order by e.occurred_at desc limit 20;
end;
$$;
revoke all on function public.staff_case_stage_events(uuid) from public, anon;
grant execute on function public.staff_case_stage_events(uuid) to authenticated;
-- END 20261011005300_account_link_and_stage_privacy.sql

-- BEGIN 20261011005400_staff_direct_messages.sql
-- Staff-to-staff correspondence is separate from case/client messages.
-- Participants alone can read content; the audit log records metadata, not body text.
create table public.staff_threads (
  id uuid primary key default gen_random_uuid(),
  user_low uuid not null references public.staff_members(user_id) on delete restrict,
  user_high uuid not null references public.staff_members(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  constraint staff_threads_order_check check (user_low < user_high),
  constraint staff_threads_pair_unique unique (user_low, user_high)
);

create table public.staff_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.staff_threads(id) on delete restrict,
  sender_user_id uuid not null references public.staff_members(user_id) on delete restrict,
  body text not null check (length(body) between 1 and 4000 and body = btrim(body)),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  constraint staff_messages_retry_unique unique (thread_id, sender_user_id, idempotency_key)
);

create table public.staff_thread_reads (
  thread_id uuid not null references public.staff_threads(id) on delete restrict,
  reader_user_id uuid not null references public.staff_members(user_id) on delete restrict,
  read_at timestamptz not null default now(),
  primary key (thread_id, reader_user_id)
);

create index staff_threads_low_recent_idx on public.staff_threads(user_low, last_message_at desc);
create index staff_threads_high_recent_idx on public.staff_threads(user_high, last_message_at desc);
create index staff_messages_thread_recent_idx on public.staff_messages(thread_id, created_at desc, id desc);
create index staff_messages_sender_recent_idx on public.staff_messages(sender_user_id, created_at desc);

create function private.can_read_staff_thread(p_thread_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff_threads t
    join public.staff_members me on me.user_id = auth.uid() and me.active
    where t.id = p_thread_id and auth.uid() in (t.user_low, t.user_high)
  )
$$;
revoke all on function private.can_read_staff_thread(uuid) from public, anon, authenticated;
grant execute on function private.can_read_staff_thread(uuid) to authenticated;

alter table public.staff_threads enable row level security;
alter table public.staff_messages enable row level security;
alter table public.staff_thread_reads enable row level security;
revoke all on public.staff_threads, public.staff_messages, public.staff_thread_reads from public, anon, authenticated;
grant select on public.staff_threads, public.staff_messages, public.staff_thread_reads to authenticated;
grant all on public.staff_threads, public.staff_messages, public.staff_thread_reads to service_role;

create policy staff_threads_participant_read on public.staff_threads for select to authenticated
  using (private.can_read_staff_thread(id));
create policy staff_messages_participant_read on public.staff_messages for select to authenticated
  using (private.can_read_staff_thread(thread_id));
create policy staff_thread_reads_participant_read on public.staff_thread_reads for select to authenticated
  using (reader_user_id = auth.uid() and private.can_read_staff_thread(thread_id));

create function public.staff_directory()
returns table(user_id uuid, display_name text, role public.staff_role, active boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.staff_role_for_current_user() is null then
    raise exception 'Not authorized';
  end if;
  return query
    select s.user_id, s.display_name, s.role, s.active from public.staff_members s
    where s.user_id <> auth.uid()
    order by s.display_name, s.user_id;
end;
$$;
revoke all on function public.staff_directory() from public, anon;
grant execute on function public.staff_directory() to authenticated;

create function public.staff_open_thread(p_recipient_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); found_id uuid;
begin
  if actor_id is null or p_recipient_user_id is null or actor_id = p_recipient_user_id
    or private.staff_role_for_current_user() is null
    or not exists (select 1 from public.staff_members s where s.user_id = p_recipient_user_id and s.active) then
    raise exception 'Not authorized';
  end if;
  insert into public.staff_threads (user_low, user_high)
    values (least(actor_id, p_recipient_user_id), greatest(actor_id, p_recipient_user_id))
    on conflict (user_low, user_high) do nothing;
  select t.id into found_id from public.staff_threads t
    where t.user_low = least(actor_id, p_recipient_user_id)
      and t.user_high = greatest(actor_id, p_recipient_user_id);
  return found_id;
end;
$$;
revoke all on function public.staff_open_thread(uuid) from public, anon;
grant execute on function public.staff_open_thread(uuid) to authenticated;

create function public.staff_send_message(p_thread_id uuid, p_body text, p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); thread_row public.staff_threads%rowtype;
  recipient_id uuid; result_id uuid; clean_body text := btrim(p_body);
begin
  if actor_id is null or p_thread_id is null or p_idempotency_key is null
    or clean_body is null or length(clean_body) not between 1 and 4000 then
    raise exception 'Invalid message';
  end if;
  select * into thread_row from public.staff_threads where id = p_thread_id;
  if not found or not private.can_read_staff_thread(p_thread_id) then raise exception 'Not authorized'; end if;
  recipient_id := case when thread_row.user_low = actor_id then thread_row.user_high else thread_row.user_low end;
  if not exists (select 1 from public.staff_members s where s.user_id = recipient_id and s.active) then
    raise exception 'Recipient inactive';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text, 0));
  select id into result_id from public.staff_messages
    where thread_id = p_thread_id and sender_user_id = actor_id and idempotency_key = p_idempotency_key;
  if result_id is not null then return result_id; end if;
  if (select count(*) from public.staff_messages where sender_user_id = actor_id
    and created_at >= now() - interval '1 minute') >= 20
    or (select count(*) from public.staff_messages where sender_user_id = actor_id
      and created_at >= now() - interval '1 day') >= 300 then
    raise exception 'Message rate limit exceeded';
  end if;
  insert into public.staff_messages (thread_id, sender_user_id, body, idempotency_key)
    values (p_thread_id, actor_id, clean_body, p_idempotency_key) returning id into result_id;
  update public.staff_threads set last_message_at = now() where id = p_thread_id;
  insert into public.notifications (recipient_user_id, kind, title, body, target_path, dedupe_key)
    select recipient_id, 'staff_message', 'Сообщение от коллеги', s.display_name,
      '/staff/chat?to=' || actor_id::text, 'staff-message:' || result_id::text
      from public.staff_members s where s.user_id = actor_id;
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
    values (actor_id, 'staff_message', result_id, 'sent',
      jsonb_build_object('thread_id', p_thread_id, 'recipient_user_id', recipient_id));
  return result_id;
end;
$$;
revoke all on function public.staff_send_message(uuid, text, uuid) from public, anon;
grant execute on function public.staff_send_message(uuid, text, uuid) to authenticated;

create function public.staff_mark_thread_read(p_thread_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); other_id uuid;
begin
  if actor_id is null or not private.can_read_staff_thread(p_thread_id) then
    raise exception 'Not authorized';
  end if;
  insert into public.staff_thread_reads (thread_id, reader_user_id, read_at)
    values (p_thread_id, actor_id, now())
    on conflict (thread_id, reader_user_id) do update set read_at = excluded.read_at;
  select case when t.user_low = actor_id then t.user_high else t.user_low end into other_id
    from public.staff_threads t where t.id = p_thread_id;
  update public.notifications set read_at = now()
    where recipient_user_id = actor_id and kind = 'staff_message'
      and target_path = '/staff/chat?to=' || other_id::text and read_at is null;
end;
$$;
revoke all on function public.staff_mark_thread_read(uuid) from public, anon;
grant execute on function public.staff_mark_thread_read(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'staff_messages') then
    alter publication supabase_realtime add table public.staff_messages;
  end if;
end;
$$;
-- END 20261011005400_staff_direct_messages.sql

-- BEGIN 20261011005500_staff_chat_hardening.sql
-- Keep inactive colleagues discoverable only to people who already share a thread.
create or replace function public.staff_directory()
returns table(user_id uuid, display_name text, role public.staff_role, active boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.staff_role_for_current_user() is null then
    raise exception 'Not authorized';
  end if;
  return query
    select s.user_id, s.display_name, s.role, s.active from public.staff_members s
    where s.user_id <> auth.uid() and (
      s.active or exists (
        select 1 from public.staff_threads t
        where (t.user_low = auth.uid() and t.user_high = s.user_id)
          or (t.user_high = auth.uid() and t.user_low = s.user_id)
      )
    )
    order by s.display_name, s.user_id;
end;
$$;

create or replace function public.staff_open_thread(p_recipient_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); found_id uuid;
begin
  if actor_id is null or p_recipient_user_id is null or actor_id = p_recipient_user_id
    or private.staff_role_for_current_user() is null
    or not exists (select 1 from public.staff_members s where s.user_id = p_recipient_user_id and s.active) then
    raise exception 'Not authorized';
  end if;
  insert into public.staff_threads (user_low, user_high)
    values (least(actor_id, p_recipient_user_id), greatest(actor_id, p_recipient_user_id))
    on conflict (user_low, user_high) do nothing returning id into found_id;
  if found_id is not null then
    insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
      values (actor_id, 'staff_thread', found_id, 'created',
        jsonb_build_object('recipient_user_id', p_recipient_user_id));
    return found_id;
  end if;
  select t.id into found_id from public.staff_threads t
    where t.user_low = least(actor_id, p_recipient_user_id)
      and t.user_high = greatest(actor_id, p_recipient_user_id);
  return found_id;
end;
$$;

create or replace function public.staff_send_message(p_thread_id uuid, p_body text, p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); thread_row public.staff_threads%rowtype;
  recipient_id uuid; result_id uuid; prior_body text; clean_body text := btrim(p_body);
begin
  if actor_id is null or p_thread_id is null or p_idempotency_key is null
    or clean_body is null or length(clean_body) not between 1 and 4000 then
    raise exception 'Invalid message';
  end if;
  select * into thread_row from public.staff_threads where id = p_thread_id;
  if not found or not private.can_read_staff_thread(p_thread_id) then raise exception 'Not authorized'; end if;
  recipient_id := case when thread_row.user_low = actor_id then thread_row.user_high else thread_row.user_low end;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text, 0));
  select id, body into result_id, prior_body from public.staff_messages
    where thread_id = p_thread_id and sender_user_id = actor_id and idempotency_key = p_idempotency_key;
  if result_id is not null then
    if prior_body <> clean_body then raise exception 'Message retry conflict'; end if;
    return result_id;
  end if;
  if not exists (select 1 from public.staff_members s where s.user_id = recipient_id and s.active) then
    raise exception 'Recipient inactive';
  end if;
  if (select count(*) from public.staff_messages where sender_user_id = actor_id
    and created_at >= now() - interval '1 minute') >= 20
    or (select count(*) from public.staff_messages where sender_user_id = actor_id
      and created_at >= now() - interval '1 day') >= 300 then
    raise exception 'Message rate limit exceeded';
  end if;
  insert into public.staff_messages (thread_id, sender_user_id, body, idempotency_key)
    values (p_thread_id, actor_id, clean_body, p_idempotency_key) returning id into result_id;
  update public.staff_threads set last_message_at = now() where id = p_thread_id;
  insert into public.notifications (recipient_user_id, kind, title, body, target_path, dedupe_key)
    select recipient_id, 'staff_message', 'Сообщение от коллеги', s.display_name,
      '/staff/chat?to=' || actor_id::text, 'staff-message:' || result_id::text
      from public.staff_members s where s.user_id = actor_id;
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
    values (actor_id, 'staff_message', result_id, 'sent',
      jsonb_build_object('thread_id', p_thread_id, 'recipient_user_id', recipient_id));
  return result_id;
end;
$$;
-- END 20261011005500_staff_chat_hardening.sql

-- BEGIN 20261011005600_staff_chat_paging.sql
-- Stable keyset pagination: new messages cannot shift older pages.
create function public.staff_message_page(
  p_thread_id uuid,
  p_before_created_at timestamptz,
  p_before_id uuid,
  p_limit integer
)
returns table(id uuid, sender_user_id uuid, body text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_thread_id is null
    or not private.can_read_staff_thread(p_thread_id)
    or ((p_before_created_at is null) <> (p_before_id is null))
    or p_limit not between 1 and 101 then
    raise exception 'Not authorized or invalid page';
  end if;
  return query
    select m.id, m.sender_user_id, m.body, m.created_at
      from public.staff_messages m
      where m.thread_id = p_thread_id
        and (p_before_created_at is null
          or (m.created_at, m.id) < (p_before_created_at, p_before_id))
      order by m.created_at desc, m.id desc
      limit p_limit;
end;
$$;
revoke all on function public.staff_message_page(uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.staff_message_page(uuid, timestamptz, uuid, integer) to authenticated;
-- END 20261011005600_staff_chat_paging.sql

-- BEGIN 20261011005700_staff_chat_sidebar.sql
-- Exact per-colleague summary; no arbitrary cap on threads, messages or unread notices.
create function public.staff_chat_sidebar()
returns table(
  user_id uuid,
  display_name text,
  role public.staff_role,
  active boolean,
  thread_id uuid,
  last_message_at timestamptz,
  last_message_body text,
  unread_count bigint
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.staff_role_for_current_user() is null then
    raise exception 'Not authorized';
  end if;
  return query
    select s.user_id, s.display_name, s.role, s.active, t.id,
      coalesce(last_message.created_at, t.last_message_at), last_message.body,
      coalesce(unread.count, 0)::bigint
    from public.staff_members s
    left join public.staff_threads t
      on t.user_low = least(auth.uid(), s.user_id)
      and t.user_high = greatest(auth.uid(), s.user_id)
    left join lateral (
      select m.body, m.created_at from public.staff_messages m
      where m.thread_id = t.id
      order by m.created_at desc, m.id desc limit 1
    ) last_message on true
    left join public.staff_thread_reads read_state
      on read_state.thread_id = t.id and read_state.reader_user_id = auth.uid()
    left join lateral (
      select count(*) as count from public.staff_messages m
      where m.thread_id = t.id and m.sender_user_id <> auth.uid()
        and m.created_at > coalesce(read_state.read_at, '-infinity'::timestamptz)
    ) unread on true
    where s.user_id <> auth.uid() and (s.active or t.id is not null)
    order by coalesce(last_message.created_at, t.last_message_at) desc nulls last,
      s.display_name, s.user_id;
end;
$$;
revoke all on function public.staff_chat_sidebar() from public, anon;
grant execute on function public.staff_chat_sidebar() to authenticated;
-- END 20261011005700_staff_chat_sidebar.sql

-- BEGIN 20261011005800_staff_chat_attachments.sql
-- Attachments in staff direct messages never share case-message rows or paths.
create table public.staff_message_attachments (
  id uuid primary key,
  message_id uuid not null references public.staff_messages(id) on delete restrict,
  storage_path text not null unique,
  original_name text not null check (length(original_name) between 1 and 180
    and original_name !~ '[[:cntrl:]/]' and position(chr(92) in original_name) = 0
    and original_name = btrim(original_name)),
  detected_mime_type text not null check (detected_mime_type in
    ('application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif')),
  size_bytes bigint not null check (size_bytes between 1 and 20971520),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  position integer not null check (position between 0 and 4),
  created_at timestamptz not null default now(),
  constraint staff_message_attachment_position_unique unique (message_id, position),
  constraint staff_message_attachment_path_check check (storage_path ~
    '^staff-messages/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
);
create index staff_message_attachments_message_idx on public.staff_message_attachments(message_id, position);

create function private.can_read_staff_attachment(p_attachment_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff_message_attachments a
    join public.staff_messages m on m.id = a.message_id
    where a.id = p_attachment_id and private.can_read_staff_thread(m.thread_id)
  )
$$;
revoke all on function private.can_read_staff_attachment(uuid) from public, anon, authenticated;
grant execute on function private.can_read_staff_attachment(uuid) to authenticated;

alter table public.staff_message_attachments enable row level security;
revoke all on public.staff_message_attachments from public, anon, authenticated;
grant select on public.staff_message_attachments to authenticated;
grant all on public.staff_message_attachments to service_role;
create policy staff_message_attachments_participant_read
  on public.staff_message_attachments for select to authenticated
  using (private.can_read_staff_attachment(id));

create function private.guard_staff_message_attachment_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.storage_path, 0));
  if not exists (select 1 from storage.objects obj
    where obj.bucket_id = 'modernsecure-files' and obj.name = new.storage_path
      and obj.metadata->>'size' ~ '^[0-9]+$'
      and (obj.metadata->>'size')::bigint = new.size_bytes
      and obj.metadata->>'mimetype' = new.detected_mime_type) then
    raise exception 'Staff message object not found or metadata mismatch';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_staff_message_attachment_insert() from public, anon, authenticated;
create trigger modernsecure_staff_message_attachment_insert_guard
  before insert on public.staff_message_attachments
  for each row execute function private.guard_staff_message_attachment_insert();
create trigger modernsecure_staff_message_attachments_immutable
  before update or delete on public.staff_message_attachments
  for each row execute function private.reject_message_change();
create trigger modernsecure_staff_messages_immutable
  before update or delete on public.staff_messages
  for each row execute function private.reject_message_change();

create function public.staff_send_message_with_attachments(
  p_thread_id uuid, p_body text, p_idempotency_key uuid, p_files jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  prior public.staff_messages%rowtype;
  message_id uuid;
  item jsonb;
  ordinal integer;
  total_bytes bigint := 0;
  expected_files jsonb := '[]'::jsonb;
  saved_files jsonb;
  file_path text;
  suffix text;
  file_mime text;
  file_size bigint;
begin
  if actor_id is null or p_thread_id is null or p_idempotency_key is null
    or not private.can_read_staff_thread(p_thread_id) then raise exception 'Not authorized'; end if;
  if nullif(btrim(p_body), '') is null or length(btrim(p_body)) > 4000
    or p_files is null or jsonb_typeof(p_files) <> 'array'
    or jsonb_array_length(p_files) not between 1 and 5 then
    raise exception 'Invalid staff message files';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text, 0));
  for item, ordinal in select value, ordinality::integer - 1
    from jsonb_array_elements(p_files) with ordinality loop
    if jsonb_typeof(item) <> 'object' or not (item ?& array['id','path','name','mime','size','sha256'])
      or (item->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (item->>'sha256') !~ '^[0-9a-f]{64}$'
      or (item->>'size') !~ '^[0-9]+$' then raise exception 'Invalid staff message file'; end if;
    file_path := item->>'path';
    file_mime := item->>'mime';
    file_size := (item->>'size')::bigint;
    if file_path !~ ('^staff-messages/' || p_thread_id::text || '/' || actor_id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' ||
      (item->>'id') || '$')
      or length(item->>'name') not between 1 and 180
      or (item->>'name') ~ '[[:cntrl:]/]'
      or position(chr(92) in item->>'name') > 0
      or (item->>'name') <> btrim(item->>'name')
      or file_mime not in ('application/pdf','image/jpeg','image/png','image/heic','image/heif')
      or file_size not between 1 and 20971520 then raise exception 'Invalid staff message file'; end if;
    suffix := lower(substring(item->>'name' from '[.][^.]+$'));
    if not ((file_mime = 'application/pdf' and suffix = '.pdf')
      or (file_mime = 'image/jpeg' and suffix in ('.jpg','.jpeg'))
      or (file_mime = 'image/png' and suffix = '.png')
      or (file_mime = 'image/heic' and suffix = '.heic')
      or (file_mime = 'image/heif' and suffix = '.heif')) then
      raise exception 'Invalid staff message file type';
    end if;
    total_bytes := total_bytes + file_size;
    expected_files := expected_files || jsonb_build_array(jsonb_build_object(
      'name', item->>'name', 'mime', file_mime, 'size', file_size,
      'sha256', item->>'sha256'));
  end loop;
  if total_bytes > 41943040 then raise exception 'Staff message files too large'; end if;

  select * into prior from public.staff_messages
    where thread_id = p_thread_id and sender_user_id = actor_id
      and idempotency_key = p_idempotency_key;
  if found then
    select coalesce(jsonb_agg(jsonb_build_object('name', a.original_name,
      'mime', a.detected_mime_type, 'size', a.size_bytes,
      'sha256', a.content_sha256) order by a.position), '[]'::jsonb)
      into saved_files from public.staff_message_attachments a where a.message_id = prior.id;
    if prior.body <> btrim(p_body) or saved_files <> expected_files then
      raise exception 'Staff message key cannot be reused';
    end if;
    return jsonb_build_object('id', prior.id, 'created', false);
  end if;

  for item in select value from jsonb_array_elements(p_files) loop
    if not exists (select 1 from storage.objects obj
      where obj.bucket_id = 'modernsecure-files' and obj.name = item->>'path'
        and obj.metadata->>'size' ~ '^[0-9]+$'
        and (obj.metadata->>'size')::bigint = (item->>'size')::bigint
        and obj.metadata->>'mimetype' = item->>'mime') then
      raise exception 'Staff message object not found or metadata mismatch';
    end if;
  end loop;
  message_id := public.staff_send_message(p_thread_id, p_body, p_idempotency_key);
  for item, ordinal in select value, ordinality::integer - 1
    from jsonb_array_elements(p_files) with ordinality loop
    insert into public.staff_message_attachments
      (id, message_id, storage_path, original_name, detected_mime_type,
       size_bytes, content_sha256, position)
    values ((item->>'id')::uuid, message_id, item->>'path', item->>'name',
      item->>'mime', (item->>'size')::bigint, item->>'sha256', ordinal);
  end loop;
  return jsonb_build_object('id', message_id, 'created', true);
end;
$$;
revoke all on function public.staff_send_message_with_attachments(uuid, text, uuid, jsonb)
  from public, anon;
grant execute on function public.staff_send_message_with_attachments(uuid, text, uuid, jsonb)
  to authenticated;
-- END 20261011005800_staff_chat_attachments.sql

-- BEGIN 20261011005900_case_message_authors.sql
-- A case participant may see the display names of people who actually sent
-- messages in that case, including former assignees retained in its history.
-- No email, phone or staff directory is exposed by this function.
create function public.case_message_authors(p_case_id uuid)
returns table(user_id uuid, display_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_case_id is null or not private.can_read_case(p_case_id) then
    raise exception 'Not authorized';
  end if;
  return query
    select distinct m.sender_user_id,
      coalesce(nullif(s.display_name, ''), nullif(cl.full_name, ''), 'Участник дела')
    from public.messages m
    join public.cases c on c.id = m.case_id
    left join public.staff_members s on s.user_id = m.sender_user_id
    left join public.clients cl on cl.id = c.client_id and cl.user_id = m.sender_user_id
    where m.case_id = p_case_id;
end;
$$;
revoke all on function public.case_message_authors(uuid) from public, anon;
grant execute on function public.case_message_authors(uuid) to authenticated;
-- END 20261011005900_case_message_authors.sql

-- BEGIN 20261011006000_case_message_paging.sql
-- Stable history for both sides of a case conversation. The case access check
-- is evaluated on every page request, so reassignment revokes history too.
create function public.case_message_page(
  p_case_id uuid,
  p_before_created_at timestamptz,
  p_before_id uuid,
  p_limit integer
)
returns table(id uuid, sender_user_id uuid, body text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_case_id is null
    or not private.can_read_case(p_case_id)
    or ((p_before_created_at is null) <> (p_before_id is null))
    or p_limit is null or p_limit not between 1 and 101 then
    raise exception 'Not authorized or invalid page';
  end if;
  return query
    select m.id, m.sender_user_id, m.body, m.created_at
    from public.messages m
    where m.case_id = p_case_id
      and (p_before_created_at is null
        or (m.created_at, m.id) < (p_before_created_at, p_before_id))
    order by m.created_at desc, m.id desc
    limit p_limit;
end;
$$;
revoke all on function public.case_message_page(uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.case_message_page(uuid, timestamptz, uuid, integer) to authenticated;
-- END 20261011006000_case_message_paging.sql

-- BEGIN 20261011006100_case_internal_notes.sql
-- Internal case notes are separate from the client conversation. Only an
-- active administrator or an actively assigned employee may write/read them.
alter table public.case_internal_notes
  add column idempotency_key uuid;

create unique index case_internal_notes_replay_idx
  on public.case_internal_notes(case_id, author_user_id, idempotency_key)
  where idempotency_key is not null;

create index case_internal_notes_history_idx
  on public.case_internal_notes(case_id, created_at desc, id desc);

create function public.staff_add_case_note(
  p_case_id uuid, p_body text, p_idempotency_key uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  actor_role public.staff_role;
  clean_body text := nullif(trim(p_body), '');
  note_id uuid;
  existing_body text;
begin
  if actor_id is null or p_case_id is null or p_idempotency_key is null
    or clean_body is null or length(clean_body) > 4000 then
    raise exception 'Invalid note';
  end if;

  -- The row locks order this write against deactivation and reassignment.
  select sm.role into actor_role from public.staff_members sm
    where sm.user_id = actor_id and sm.active for share;
  if actor_role is null then raise exception 'Not authorized'; end if;
  if actor_role <> 'admin' then
    perform 1 from public.case_assignments ca
      where ca.case_id = p_case_id and ca.staff_user_id = actor_id
        and ca.revoked_at is null for share;
    if not found then raise exception 'Not authorized'; end if;
  end if;

  insert into public.case_internal_notes(case_id, author_user_id, body, idempotency_key)
    values (p_case_id, actor_id, clean_body, p_idempotency_key)
    on conflict (case_id, author_user_id, idempotency_key)
      where idempotency_key is not null do nothing
    returning id into note_id;
  if note_id is null then
    select n.id, n.body into note_id, existing_body from public.case_internal_notes n
      where n.case_id = p_case_id and n.author_user_id = actor_id
        and n.idempotency_key = p_idempotency_key;
    if existing_body is distinct from clean_body then
      raise exception 'Note retry conflict';
    end if;
  else
    insert into public.audit_events(actor_user_id, case_id, entity_type, entity_id, action)
      values (actor_id, p_case_id, 'case_internal_note', note_id, 'created');
  end if;
  return note_id;
end;
$$;

create function public.staff_case_note_page(
  p_case_id uuid, p_before_created_at timestamptz, p_before_id uuid, p_limit integer
)
returns table(id uuid, author_user_id uuid, author_name text, body text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_case_id is null
    or not private.is_staff_for_case(p_case_id)
    or ((p_before_created_at is null) <> (p_before_id is null))
    or p_limit is null or p_limit not between 1 and 51 then
    raise exception 'Not authorized or invalid page';
  end if;
  return query
    select n.id, n.author_user_id, sm.display_name, n.body, n.created_at
      from public.case_internal_notes n
      join public.staff_members sm on sm.user_id = n.author_user_id
      where n.case_id = p_case_id
        and (p_before_created_at is null
          or (n.created_at, n.id) < (p_before_created_at, p_before_id))
      order by n.created_at desc, n.id desc
      limit p_limit;
end;
$$;

revoke all on function public.staff_add_case_note(uuid, text, uuid) from public, anon;
grant execute on function public.staff_add_case_note(uuid, text, uuid) to authenticated;
revoke all on function public.staff_case_note_page(uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.staff_case_note_page(uuid, timestamptz, uuid, integer) to authenticated;
-- END 20261011006100_case_internal_notes.sql

-- BEGIN 20261011006200_staff_mfa_gate.sql
-- Existing staff can enroll without being locked out during the rollout.
-- New employees must complete TOTP before accessing staff data.
alter table public.staff_members
  add column mfa_required boolean not null default true;
update public.staff_members set mfa_required = false;

create function private.staff_mfa_required()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff_members sm
    where sm.user_id = auth.uid() and sm.active
      and (sm.mfa_required or exists (
        select 1 from auth.mfa_factors factor
        where factor.user_id = sm.user_id and factor.status = 'verified'
      ))
  )
$$;

create function private.staff_mfa_passed()
returns boolean language sql stable security definer set search_path = '' as $$
  select not private.staff_mfa_required()
    or (auth.jwt()->>'aal' = 'aal2' and exists (
      select 1 from auth.mfa_factors factor
      where factor.user_id = auth.uid() and factor.status = 'verified'
    ))
$$;

revoke all on function private.staff_mfa_required() from public, anon, authenticated;
revoke all on function private.staff_mfa_passed() from public, anon, authenticated;
grant execute on function private.staff_mfa_passed() to authenticated;

-- This narrow bootstrap RPC is the only staff-data read available at AAL1.
create function public.staff_mfa_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'role', sm.role,
    'active', sm.active,
    'display_name', sm.display_name,
    'mfa_required', private.staff_mfa_required(),
    'mfa_passed', private.staff_mfa_passed()
  )
  from public.staff_members sm where sm.user_id = auth.uid()
$$;
revoke all on function public.staff_mfa_status() from public, anon;
grant execute on function public.staff_mfa_status() to authenticated;

-- RLS also protects Realtime and future authenticated Storage policies. It
-- does not by itself constrain SECURITY DEFINER RPCs, hence the request hook.
do $$
declare item record;
begin
  for item in select tablename from pg_tables where schemaname = 'public' loop
    execute format(
      'create policy staff_mfa_guard on public.%I as restrictive for all to authenticated '
      || 'using ((select private.staff_mfa_passed())) '
      || 'with check ((select private.staff_mfa_passed()))',
      item.tablename
    );
  end loop;
end;
$$;

create policy modernsecure_storage_mfa_guard on storage.objects
  as restrictive for all to authenticated
  using (bucket_id not in ('modernsecure-files', 'modernsecure-previews')
    or (select private.staff_mfa_passed()))
  with check (bucket_id not in ('modernsecure-files', 'modernsecure-previews')
    or (select private.staff_mfa_passed()));

-- PostgREST calls this before tables and RPCs. The two exceptions disclose
-- only the caller's own staff state or claim a verified-email invitation.
create function public.enforce_staff_mfa_request()
returns void language plpgsql stable security definer set search_path = '' as $$
declare request_path text := current_setting('request.path', true);
begin
  if auth.jwt()->>'role' = 'service_role'
    or private.staff_mfa_passed()
    or request_path in ('rpc/staff_mfa_status', 'rpc/claim_staff_invite') then
    return;
  end if;
  raise sqlstate 'PGRST' using
    message = '{"code":"MFA_REQUIRED","message":"Complete staff two-factor authentication"}',
    detail = '{"status":403}';
end;
$$;
revoke all on function public.enforce_staff_mfa_request() from public, anon, authenticated, service_role;
grant execute on function public.enforce_staff_mfa_request() to anon, authenticated, service_role;

-- This project previously had no pre-request hook. Do not silently replace
-- any hook added independently after this migration was reviewed.
do $$
begin
  if exists (
    select 1 from pg_roles
    where rolname = 'authenticator'
      and exists (select 1 from unnest(coalesce(rolconfig, array[]::text[])) option
        where option like 'pgrst.db_pre_request=%')
  ) then
    raise exception 'Existing Data API pre-request hook must be reviewed before MFA rollout';
  end if;
end;
$$;
alter role authenticator set pgrst.db_pre_request = 'public.enforce_staff_mfa_request';
notify pgrst, 'reload config';
-- END 20261011006200_staff_mfa_gate.sql

-- BEGIN 20261011006300_staff_mfa_api_error.sql
-- PostgREST requires both status and headers in a PGRST exception detail.
-- Normalize the path because hosted API deployments can include a leading /.
create or replace function public.enforce_staff_mfa_request()
returns void language plpgsql stable security definer set search_path = '' as $$
declare request_path text := trim(both '/' from coalesce(current_setting('request.path', true), ''));
begin
  if auth.jwt()->>'role' = 'service_role'
    or private.staff_mfa_passed()
    or request_path in ('rpc/staff_mfa_status', 'rpc/claim_staff_invite') then
    return;
  end if;
  raise sqlstate 'PGRST' using
    message = '{"code":"MFA_REQUIRED","message":"Complete staff two-factor authentication"}',
    detail = '{"status":403,"headers":{}}';
end;
$$;
-- END 20261011006300_staff_mfa_api_error.sql

-- BEGIN 20261012006400_open_notification.sql
-- A notification becomes read when its recipient opens it, without clearing
-- unrelated work. The path comes from the database, never from form input.
create function public.open_own_notification(p_notification_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); destination text;
begin
  if actor_id is null then raise exception 'Not authenticated'; end if;
  select n.target_path into destination from public.notifications n
    where n.id = p_notification_id and n.recipient_user_id = actor_id;
  if not found then return null; end if;
  update public.notifications set read_at = clock_timestamp()
    where id = p_notification_id and recipient_user_id = actor_id and read_at is null;
  return destination;
end;
$$;
revoke all on function public.open_own_notification(uuid) from public, anon;
grant execute on function public.open_own_notification(uuid) to authenticated;
-- END 20261012006400_open_notification.sql

-- BEGIN 20261012006500_file_access_audit.sql
-- Only the server's service role may record a file response. A browser cannot
-- manufacture a "download" event without going through the authenticated route.
create function public.server_record_file_access(
  p_actor_user_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_action text
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  related_case_id uuid;
  related_thread_id uuid;
  permitted boolean := false;
begin
  if p_actor_user_id is null or p_entity_id is null
    or p_action not in ('preview_issued', 'download_issued') then
    raise exception 'Invalid file access event';
  end if;

  case p_entity_type
    when 'document_file' then
      select dr.case_id into related_case_id
      from public.document_files df
      join public.document_requests dr on dr.id = df.request_id
      where df.id = p_entity_id and df.status in ('under_review', 'accepted', 'returned');
    when 'contract' then
      select c.case_id into related_case_id from public.contracts c where c.id = p_entity_id;
    when 'payment_receipt' then
      select r.case_id into related_case_id from public.payment_receipts r where r.id = p_entity_id;
    when 'message_attachment' then
      select m.case_id into related_case_id
      from public.message_attachments a
      join public.messages m on m.id = a.message_id
      where a.id = p_entity_id;
    when 'staff_message_attachment' then
      select m.thread_id into related_thread_id
      from public.staff_message_attachments a
      join public.staff_messages m on m.id = a.message_id
      where a.id = p_entity_id;
    else
      raise exception 'Invalid file access entity';
  end case;

  if related_case_id is not null then
    select exists (
      select 1 from public.cases c
      join public.clients cl on cl.id = c.client_id
      where c.id = related_case_id and cl.user_id = p_actor_user_id
    ) or exists (
      select 1 from public.staff_members sm
      where sm.user_id = p_actor_user_id and sm.active
        and (sm.role in ('manager', 'admin') or exists (
          select 1 from public.case_assignments ca
          where ca.case_id = related_case_id and ca.staff_user_id = p_actor_user_id
            and ca.revoked_at is null
        ))
    ) into permitted;
  elsif related_thread_id is not null then
    select exists (
      select 1 from public.staff_threads t
      join public.staff_members sm on sm.user_id = p_actor_user_id and sm.active
      where t.id = related_thread_id and p_actor_user_id in (t.user_low, t.user_high)
    ) into permitted;
  end if;

  if not permitted then raise exception 'File access is no longer authorized'; end if;

  insert into public.audit_events
    (actor_user_id, case_id, entity_type, entity_id, action, after_data)
  values
    (p_actor_user_id, related_case_id, p_entity_type, p_entity_id, p_action,
      case when related_thread_id is null then null
        else jsonb_build_object('thread_id', related_thread_id) end);
end;
$$;

revoke all on function public.server_record_file_access(uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.server_record_file_access(uuid, text, uuid, text)
  to service_role;
-- END 20261012006500_file_access_audit.sql

-- BEGIN 20261012006600_admin_audit_history.sql
-- A stable, bounded view of the complete audit history for the chief admin.
create index audit_events_time_id_idx on public.audit_events (occurred_at desc, id desc);

create function public.admin_audit_page(
  p_before_at timestamptz default null,
  p_before_id bigint default null,
  p_case_id uuid default null,
  p_actor_user_id uuid default null,
  p_limit integer default 50
)
returns table (
  id bigint,
  case_id uuid,
  entity_type text,
  entity_id uuid,
  action text,
  reason text,
  occurred_at timestamptz,
  actor_user_id uuid
)
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.staff_members sm
    where sm.user_id = auth.uid() and sm.role = 'admin' and sm.active
  ) then
    raise exception 'Not authorized';
  end if;
  if p_limit not between 1 and 100
    or (p_before_at is null) <> (p_before_id is null)
    or (p_before_id is not null and p_before_id < 1) then
    raise exception 'Invalid audit page request';
  end if;

  return query
  select ae.id, ae.case_id, ae.entity_type, ae.entity_id, ae.action,
    ae.reason, ae.occurred_at, ae.actor_user_id
  from public.audit_events ae
  where (p_case_id is null or ae.case_id = p_case_id)
    and (p_actor_user_id is null or ae.actor_user_id = p_actor_user_id)
    and (p_before_at is null or (ae.occurred_at, ae.id) < (p_before_at, p_before_id))
  order by ae.occurred_at desc, ae.id desc
  limit p_limit + 1;
end;
$$;

revoke all on function public.admin_audit_page(timestamptz, bigint, uuid, uuid, integer)
  from public, anon;
grant execute on function public.admin_audit_page(timestamptz, bigint, uuid, uuid, integer)
  to authenticated;
-- END 20261012006600_admin_audit_history.sql

-- BEGIN 20261012006700_admin_audit_limit_guard.sql
-- A caller may explicitly send JSON null, which does not use the default.
-- Without this guard, LIMIT NULL would turn a bounded audit query into a full scan.
create or replace function public.admin_audit_page(
  p_before_at timestamptz default null,
  p_before_id bigint default null,
  p_case_id uuid default null,
  p_actor_user_id uuid default null,
  p_limit integer default 50
)
returns table (
  id bigint,
  case_id uuid,
  entity_type text,
  entity_id uuid,
  action text,
  reason text,
  occurred_at timestamptz,
  actor_user_id uuid
)
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.staff_members sm
    where sm.user_id = auth.uid() and sm.role = 'admin' and sm.active
  ) then
    raise exception 'Not authorized';
  end if;
  if p_limit is null or p_limit not between 1 and 100
    or (p_before_at is null) <> (p_before_id is null)
    or (p_before_id is not null and p_before_id < 1) then
    raise exception 'Invalid audit page request';
  end if;

  return query
  select ae.id, ae.case_id, ae.entity_type, ae.entity_id, ae.action,
    ae.reason, ae.occurred_at, ae.actor_user_id
  from public.audit_events ae
  where (p_case_id is null or ae.case_id = p_case_id)
    and (p_actor_user_id is null or ae.actor_user_id = p_actor_user_id)
    and (p_before_at is null or (ae.occurred_at, ae.id) < (p_before_at, p_before_id))
  order by ae.occurred_at desc, ae.id desc
  limit p_limit + 1;
end;
$$;
-- END 20261012006700_admin_audit_limit_guard.sql

-- BEGIN 20261012006800_admin_auth_audit.sql
-- Supabase Auth owns the source table. Expose only bounded, sanitized events
-- to the active chief admin; never return IP, user-agent, or the raw payload.

create function public.admin_auth_audit_page(
  p_before_at timestamptz default null,
  p_before_id uuid default null,
  p_actor_user_id uuid default null,
  p_limit integer default 50
)
returns table (
  id uuid,
  occurred_at timestamptz,
  action text,
  actor_user_id uuid,
  actor_email text,
  provider text
)
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.staff_members sm
    where sm.user_id = auth.uid() and sm.role = 'admin' and sm.active
  ) then
    raise exception 'Not authorized';
  end if;
  if p_limit is null or p_limit not between 1 and 100
    or (p_before_at is null) <> (p_before_id is null) then
    raise exception 'Invalid auth audit page request';
  end if;

  return query
  select log.id, log.created_at, left(log.payload->>'action', 80),
    actor.user_id, user_record.email::text,
    left(log.payload->'traits'->>'provider', 40)
  from auth.audit_log_entries log
  cross join lateral (
    select case
      when log.payload->>'actor_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (log.payload->>'actor_id')::uuid
      else null::uuid
    end as user_id
  ) actor
  left join auth.users user_record on user_record.id = actor.user_id
  where (p_actor_user_id is null or actor.user_id = p_actor_user_id)
    and (p_before_at is null or (log.created_at, log.id) < (p_before_at, p_before_id))
  order by log.created_at desc, log.id desc
  limit p_limit + 1;
end;
$$;

revoke all on function public.admin_auth_audit_page(timestamptz, uuid, uuid, integer)
  from public, anon;
grant execute on function public.admin_auth_audit_page(timestamptz, uuid, uuid, integer)
  to authenticated;
-- END 20261012006800_admin_auth_audit.sql

-- BEGIN 20261012006900_staff_mfa_entry_audit.sql
-- A provider's verification_attempted event is not proof that MFA succeeded.
-- Record the first authorized panel entry for each real AAL2 Auth session.
create unique index audit_staff_mfa_entry_once_idx
  on public.audit_events (action, request_id)
  where action = 'staff_mfa_verified' and request_id is not null;

create function public.record_staff_mfa_entry()
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  session_text text := auth.jwt()->>'session_id';
  session_id uuid;
  audit_key text;
begin
  if actor_id is null or auth.jwt()->>'aal' is distinct from 'aal2'
    or session_text is null
    or session_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Not authorized';
  end if;
  session_id := session_text::uuid;
  if not exists (
    select 1 from public.staff_members sm
    where sm.user_id = actor_id and sm.active
  ) or not private.staff_mfa_passed()
    or not exists (
      select 1 from auth.sessions session_record
      where session_record.id = session_id
        and session_record.user_id = actor_id
        and session_record.aal::text = 'aal2'
        and (session_record.not_after is null or session_record.not_after > now())
    )
    or not exists (
      select 1 from auth.mfa_factors factor
      where factor.user_id = actor_id and factor.status = 'verified'
    ) then
    raise exception 'Not authorized';
  end if;

  -- A one-way digest avoids storing the Auth session identifier in audit_events.
  audit_key := encode(extensions.digest(session_id::text, 'sha256'), 'hex');
  insert into public.audit_events
    (actor_user_id, entity_type, entity_id, action, request_id, after_data)
  values
    (actor_id, 'staff_session', actor_id, 'staff_mfa_verified', audit_key,
      jsonb_build_object('aal', 'aal2'))
  on conflict do nothing;
  return found;
end;
$$;

revoke all on function public.record_staff_mfa_entry() from public, anon;
grant execute on function public.record_staff_mfa_entry() to authenticated;
-- END 20261012006900_staff_mfa_entry_audit.sql

-- BEGIN 20261012007000_staff_unread_case_count.sql
-- Count conversations that need this employee's attention, independently of
-- notification read state. The result never includes inaccessible cases.
create function public.staff_unread_case_count()
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare
  viewer_id uuid := auth.uid();
  viewer_role public.staff_role := private.staff_role_for_current_user();
  result_count bigint;
begin
  if viewer_id is null or viewer_role is null then
    raise exception 'Not authorized';
  end if;

  select count(*) into result_count
  from public.cases c
  where (viewer_role = 'admin' or exists (
    select 1 from public.case_assignments ca
    where ca.case_id = c.id and ca.staff_user_id = viewer_id and ca.revoked_at is null
  ))
    and exists (
      select 1 from public.messages m
      where m.case_id = c.id and m.sender_user_id <> viewer_id
        and not exists (
          select 1 from public.message_reads mr
          where mr.message_id = m.id and mr.reader_user_id = viewer_id
        )
    );
  return result_count;
end;
$$;

revoke all on function public.staff_unread_case_count() from public, anon;
grant execute on function public.staff_unread_case_count() to authenticated;
-- END 20261012007000_staff_unread_case_count.sql

-- BEGIN 20261012007100_staff_case_message_links.sql
-- A case link belongs to one private staff message, not to the whole thread.
create table public.staff_message_case_refs (
  message_id uuid primary key references public.staff_messages(id) on delete restrict,
  case_id uuid not null references public.cases(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index staff_message_case_refs_case_idx on public.staff_message_case_refs(case_id);

create function private.staff_user_can_reference_case(p_user_id uuid, p_case_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff_members sm
    where sm.user_id = p_user_id and sm.active
      and exists (select 1 from public.cases c where c.id = p_case_id)
      and (sm.role = 'admin' or exists (
        select 1 from public.case_assignments ca
        where ca.case_id = p_case_id and ca.staff_user_id = sm.user_id
          and ca.revoked_at is null
      ))
  )
$$;
revoke all on function private.staff_user_can_reference_case(uuid, uuid) from public, anon, authenticated;
grant execute on function private.staff_user_can_reference_case(uuid, uuid) to authenticated;

create function private.can_reference_staff_case(p_thread_id uuid, p_case_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff_threads t
    where t.id = p_thread_id
      and auth.uid() in (t.user_low, t.user_high)
      and private.staff_user_can_reference_case(t.user_low, p_case_id)
      and private.staff_user_can_reference_case(t.user_high, p_case_id)
  )
$$;
revoke all on function private.can_reference_staff_case(uuid, uuid) from public, anon, authenticated;

alter table public.staff_message_case_refs enable row level security;
revoke all on public.staff_message_case_refs from public, anon, authenticated;
grant select on public.staff_message_case_refs to authenticated;
grant all on public.staff_message_case_refs to service_role;
create policy staff_message_case_refs_participant_read
  on public.staff_message_case_refs for select to authenticated
  using (exists (
    select 1 from public.staff_messages m
    where m.id = message_id and private.can_read_staff_thread(m.thread_id)
      and private.staff_user_can_reference_case(auth.uid(), case_id)
  ));
create policy staff_mfa_guard on public.staff_message_case_refs
  as restrictive for all to authenticated
  using ((select private.staff_mfa_passed()))
  with check ((select private.staff_mfa_passed()));
create trigger modernsecure_staff_message_case_refs_immutable
  before update or delete on public.staff_message_case_refs
  for each row execute function private.reject_message_change();

create function public.staff_can_reference_case(p_thread_id uuid, p_case_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_reference_staff_case(p_thread_id, p_case_id)
$$;
revoke all on function public.staff_can_reference_case(uuid, uuid) from public, anon;
grant execute on function public.staff_can_reference_case(uuid, uuid) to authenticated;

create function public.staff_send_case_message(
  p_thread_id uuid, p_body text, p_idempotency_key uuid, p_case_id uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); prior_id uuid; result_id uuid;
begin
  if actor_id is null or p_idempotency_key is null
    or not private.can_reference_staff_case(p_thread_id, p_case_id) then
    raise exception 'Case link unavailable';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text, 0));
  select id into prior_id from public.staff_messages
    where thread_id = p_thread_id and sender_user_id = actor_id
      and idempotency_key = p_idempotency_key;
  if prior_id is not null and not exists (
    select 1 from public.staff_message_case_refs r
    where r.message_id = prior_id and r.case_id = p_case_id
  ) then raise exception 'Staff message key cannot be reused'; end if;
  result_id := public.staff_send_message(p_thread_id, p_body, p_idempotency_key);
  if prior_id is null then
    insert into public.staff_message_case_refs(message_id, case_id)
      values (result_id, p_case_id);
  end if;
  return result_id;
end;
$$;
revoke all on function public.staff_send_case_message(uuid, text, uuid, uuid) from public, anon;
grant execute on function public.staff_send_case_message(uuid, text, uuid, uuid) to authenticated;

create function public.staff_send_case_message_with_attachments(
  p_thread_id uuid, p_body text, p_idempotency_key uuid, p_files jsonb, p_case_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); prior_id uuid; result jsonb;
begin
  if actor_id is null or p_idempotency_key is null
    or not private.can_reference_staff_case(p_thread_id, p_case_id) then
    raise exception 'Case link unavailable';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text, 0));
  select id into prior_id from public.staff_messages
    where thread_id = p_thread_id and sender_user_id = actor_id
      and idempotency_key = p_idempotency_key;
  if prior_id is not null and not exists (
    select 1 from public.staff_message_case_refs r
    where r.message_id = prior_id and r.case_id = p_case_id
  ) then raise exception 'Staff message key cannot be reused'; end if;
  result := public.staff_send_message_with_attachments(p_thread_id, p_body, p_idempotency_key, p_files);
  if (result->>'created')::boolean then
    insert into public.staff_message_case_refs(message_id, case_id)
      values ((result->>'id')::uuid, p_case_id);
  end if;
  return result;
end;
$$;
revoke all on function public.staff_send_case_message_with_attachments(uuid, text, uuid, jsonb, uuid)
  from public, anon;
grant execute on function public.staff_send_case_message_with_attachments(uuid, text, uuid, jsonb, uuid)
  to authenticated;
-- END 20261012007100_staff_case_message_links.sql

-- BEGIN 20261012007200_document_request_version_state.sql
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
-- END 20261012007200_document_request_version_state.sql

-- BEGIN 20261012007300_document_partial_retraction.sql
-- A partly retracted version cannot be treated as fully accepted. Only a
-- version whose every file was retracted falls back to the prior version.
create or replace function private.document_request_current_state(p_request_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  with latest as (
    select max(version_no) as version_no
    from public.document_files
    where request_id = p_request_id and status not in ('quarantine', 'retracted')
  ), current_files as (
    select df.status from public.document_files df
    join latest l on l.version_no = df.version_no
    where df.request_id = p_request_id and df.status <> 'quarantine'
  )
  select case
    when not exists (select 1 from current_files) then 'missing'
    when exists (select 1 from current_files where status = 'returned') then 'returned'
    when exists (select 1 from current_files where status = 'under_review') then 'under_review'
    when exists (select 1 from current_files where status <> 'accepted') then 'incomplete'
    else 'accepted'
  end
$$;
-- END 20261012007300_document_partial_retraction.sql

-- BEGIN 20261012007400_case_unread_message_count.sql
-- An exact unread count for a case. PostgREST row limits must not silently
-- truncate the client's overview after a long conversation.
create function public.case_unread_message_count(p_case_id uuid)
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare
  viewer_id uuid := auth.uid();
  unread_count bigint;
begin
  if viewer_id is null or p_case_id is null or not private.can_read_case(p_case_id) then
    raise exception 'Not authorized';
  end if;

  select count(*) into unread_count
  from public.messages m
  where m.case_id = p_case_id and m.sender_user_id <> viewer_id
    and not exists (
      select 1 from public.message_reads mr
      where mr.message_id = m.id and mr.reader_user_id = viewer_id
    );
  return unread_count;
end;
$$;

revoke all on function public.case_unread_message_count(uuid) from public, anon;
grant execute on function public.case_unread_message_count(uuid) to authenticated;
-- END 20261012007400_case_unread_message_count.sql

-- BEGIN 20261012007500_staff_read_cursor.sql
-- Read only messages the recipient has actually received in the open dialog.
-- A timestamp set to now() could otherwise hide a message arriving between the
-- page response and the read RPC, including its notification.
alter table public.staff_thread_reads
  add column last_read_message_id uuid references public.staff_messages(id) on delete restrict;

with latest_seen as (
  select distinct on (r.thread_id, r.reader_user_id)
    r.thread_id, r.reader_user_id, m.id, m.created_at
  from public.staff_thread_reads r
  join public.staff_messages m on m.thread_id = r.thread_id and m.created_at <= r.read_at
  order by r.thread_id, r.reader_user_id, m.created_at desc, m.id desc
)
update public.staff_thread_reads r
set read_at = seen.created_at, last_read_message_id = seen.id
from latest_seen seen
where r.thread_id = seen.thread_id and r.reader_user_id = seen.reader_user_id;

alter table public.staff_thread_reads alter column read_at drop default;

drop function public.staff_mark_thread_read(uuid);
create function public.staff_mark_thread_read(p_thread_id uuid, p_through_message_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  seen_at timestamptz;
begin
  if actor_id is null or p_thread_id is null or p_through_message_id is null
    or not private.can_read_staff_thread(p_thread_id) then
    raise exception 'Not authorized';
  end if;
  select m.created_at into seen_at from public.staff_messages m
  where m.id = p_through_message_id and m.thread_id = p_thread_id;
  if not found then raise exception 'Message is not in this thread'; end if;

  insert into public.staff_thread_reads as state
    (thread_id, reader_user_id, read_at, last_read_message_id)
  values (p_thread_id, actor_id, seen_at, p_through_message_id)
  on conflict (thread_id, reader_user_id) do update
    set read_at = excluded.read_at, last_read_message_id = excluded.last_read_message_id
    where state.last_read_message_id is null
      or (state.read_at, state.last_read_message_id) <
        (excluded.read_at, excluded.last_read_message_id);

  update public.notifications n set read_at = now()
  from public.staff_messages m
  where m.thread_id = p_thread_id and m.sender_user_id <> actor_id
    and (m.created_at, m.id) <= (seen_at, p_through_message_id)
    and n.recipient_user_id = actor_id and n.kind = 'staff_message'
    and n.dedupe_key = 'staff-message:' || m.id::text and n.read_at is null;
end;
$$;
revoke all on function public.staff_mark_thread_read(uuid, uuid) from public, anon;
grant execute on function public.staff_mark_thread_read(uuid, uuid) to authenticated;

create or replace function public.staff_chat_sidebar()
returns table(
  user_id uuid,
  display_name text,
  role public.staff_role,
  active boolean,
  thread_id uuid,
  last_message_at timestamptz,
  last_message_body text,
  unread_count bigint
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.staff_role_for_current_user() is null then
    raise exception 'Not authorized';
  end if;
  return query
    select s.user_id, s.display_name, s.role, s.active, t.id,
      coalesce(last_message.created_at, t.last_message_at), last_message.body,
      coalesce(unread.count, 0)::bigint
    from public.staff_members s
    left join public.staff_threads t
      on t.user_low = least(auth.uid(), s.user_id)
      and t.user_high = greatest(auth.uid(), s.user_id)
    left join lateral (
      select m.body, m.created_at from public.staff_messages m
      where m.thread_id = t.id
      order by m.created_at desc, m.id desc limit 1
    ) last_message on true
    left join public.staff_thread_reads read_state
      on read_state.thread_id = t.id and read_state.reader_user_id = auth.uid()
    left join lateral (
      select count(*) as count from public.staff_messages m
      where m.thread_id = t.id and m.sender_user_id <> auth.uid()
        and (read_state.last_read_message_id is null
          or (m.created_at, m.id) > (read_state.read_at, read_state.last_read_message_id))
    ) unread on true
    where s.user_id <> auth.uid() and (s.active or t.id is not null)
    order by coalesce(last_message.created_at, t.last_message_at) desc nulls last,
      s.display_name, s.user_id;
end;
$$;

notify pgrst, 'reload schema';
-- END 20261012007500_staff_read_cursor.sql

-- BEGIN 20261012007600_case_message_seen_cursor.sql
-- Automatic chat reading is limited to the newest message actually displayed.
-- Keep mark_case_messages_read(uuid) for the explicit "mark all" action.
create function public.mark_case_messages_seen(p_case_id uuid, p_through_message_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  seen_at timestamptz;
  marked integer;
  cleared integer;
begin
  if actor_id is null or p_case_id is null or p_through_message_id is null
    or not private.can_read_case(p_case_id) then
    raise exception 'Not authorized';
  end if;
  select m.created_at into seen_at from public.messages m
  where m.id = p_through_message_id and m.case_id = p_case_id;
  if not found then raise exception 'Message is not in this case'; end if;

  insert into public.message_reads (message_id, reader_user_id)
  select m.id, actor_id from public.messages m
  where m.case_id = p_case_id and m.sender_user_id <> actor_id
    and (m.created_at, m.id) <= (seen_at, p_through_message_id)
  on conflict (message_id, reader_user_id) do nothing;
  get diagnostics marked = row_count;

  update public.notifications n set read_at = now()
  from public.messages m
  where m.case_id = p_case_id and m.sender_user_id <> actor_id
    and (m.created_at, m.id) <= (seen_at, p_through_message_id)
    and n.recipient_user_id = actor_id and n.case_id = p_case_id
    and n.kind = 'message' and n.dedupe_key = 'message:' || m.id::text
    and n.read_at is null;
  get diagnostics cleared = row_count;
  return marked + cleared;
end;
$$;
revoke all on function public.mark_case_messages_seen(uuid, uuid) from public, anon;
grant execute on function public.mark_case_messages_seen(uuid, uuid) to authenticated;
-- END 20261012007600_case_message_seen_cursor.sql

-- BEGIN 20261012007700_stale_case_queue.sql
-- Staff attention queue for open cases without a client-visible stage update.
-- This internal setting is not exposed through the Data API as a table.
create table private.staff_work_settings (
  id boolean primary key default true check (id),
  stale_case_days integer not null default 14 check (stale_case_days between 1 and 365),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff_members(user_id) on delete restrict
);
insert into private.staff_work_settings (id, stale_case_days) values (true, 14);

create function public.staff_stale_case_days()
returns integer language plpgsql stable security definer set search_path = '' as $$
declare days integer;
begin
  if auth.uid() is null or private.staff_role_for_current_user() is null then
    raise exception 'Not authorized';
  end if;
  select s.stale_case_days into days from private.staff_work_settings s where s.id = true;
  return days;
end;
$$;
revoke all on function public.staff_stale_case_days() from public, anon;
grant execute on function public.staff_stale_case_days() to authenticated;

create function public.admin_set_stale_case_days(p_days integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare previous_days integer; actor_id uuid := auth.uid();
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  if p_days is null or p_days not between 1 and 365 then
    raise exception 'Invalid stale case threshold';
  end if;
  select s.stale_case_days into previous_days from private.staff_work_settings s
    where s.id = true for update;
  if previous_days is null then raise exception 'Staff work settings are missing'; end if;
  if previous_days <> p_days then
    update private.staff_work_settings
      set stale_case_days = p_days, updated_at = now(), updated_by = actor_id
      where id = true;
    insert into public.audit_events
      (actor_user_id, entity_type, action, before_data, after_data)
    values (actor_id, 'staff_work_settings', 'stale_threshold_changed',
      jsonb_build_object('stale_case_days', previous_days),
      jsonb_build_object('stale_case_days', p_days));
  end if;
  return p_days;
end;
$$;
revoke all on function public.admin_set_stale_case_days(integer) from public, anon;
grant execute on function public.admin_set_stale_case_days(integer) to authenticated;

create function public.staff_stale_case_page(p_page integer default 1)
returns table(
  case_id uuid, case_number text, title text, client_name text,
  last_update_at timestamptz, days_without_update integer,
  is_suspended boolean, total_count bigint
)
language plpgsql stable security definer set search_path = '' as $$
declare viewer_id uuid := auth.uid(); viewer_role public.staff_role := private.staff_role_for_current_user();
  threshold_days integer;
begin
  if viewer_id is null or viewer_role is null then raise exception 'Not authorized'; end if;
  if p_page is null or p_page not between 1 and 10000 then raise exception 'Invalid page'; end if;
  select s.stale_case_days into threshold_days from private.staff_work_settings s where s.id = true;
  if threshold_days is null then raise exception 'Staff work settings are missing'; end if;

  return query
    with visible as (
      select c.id, c.case_number, c.title, cl.full_name,
        coalesce((select max(e.occurred_at) from public.case_stage_events e
          where e.case_id = c.id), c.created_at) as latest_at,
        c.is_suspended
      from public.cases c
      join public.clients cl on cl.id = c.client_id
      where c.status = 'open'
        and (viewer_role = 'admin' or exists (
          select 1 from public.case_assignments ca
          where ca.case_id = c.id and ca.staff_user_id = viewer_id and ca.revoked_at is null
        ))
    )
    select v.id, v.case_number, v.title, v.full_name, v.latest_at,
      floor(extract(epoch from now() - v.latest_at) / 86400)::integer,
      v.is_suspended, count(*) over ()
    from visible v
    where v.latest_at < now() - make_interval(days => threshold_days)
    order by v.latest_at asc, v.id
    limit 25 offset (p_page - 1) * 25;
end;
$$;
revoke all on function public.staff_stale_case_page(integer) from public, anon;
grant execute on function public.staff_stale_case_page(integer) to authenticated;
-- END 20261012007700_stale_case_queue.sql

-- BEGIN 20261016007800_audit_workflow_fixes.sql
-- Reminders use confirmed money, not uploaded receipts. Retries are idempotent.
create function private.enqueue_payment_deadline_reminders(p_reference_day date default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare local_day date := coalesce(p_reference_day, (now() at time zone 'Asia/Almaty')::date); inserted_count integer;
begin
  insert into public.notifications(recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
  select cl.user_id, c.id, 'payment_deadline',
    case when s.due_on = local_day then 'Срок оплаты сегодня' else 'Срок оплаты завтра' end,
    'Остаток: ' || (s.amount_kzt - coalesce(p.paid, 0))::text || ' ₸. Откройте график платежей.',
    '/account/cases/' || c.id || '/payments',
    'payment-deadline:' || s.id || ':' || s.due_on || ':' || case when s.due_on = local_day then 'today' else 'tomorrow' end
  from public.payment_schedule s join public.cases c on c.id = s.case_id
  join public.clients cl on cl.id = c.client_id
  left join lateral (select sum(amount_kzt) as paid from public.payments where schedule_id = s.id and status = 'confirmed') p on true
  where s.due_on between local_day and local_day + 1 and c.status = 'open' and not c.is_suspended
    and cl.user_id is not null and s.amount_kzt > coalesce(p.paid, 0)
  on conflict (recipient_user_id, dedupe_key) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;
revoke all on function private.enqueue_payment_deadline_reminders(date) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    perform cron.schedule('modernsecure-payment-deadlines', '5 * * * *', 'select private.enqueue_payment_deadline_reminders()');
  end if;
end; $$;

alter table public.document_requests add column closure_reason text;

create function public.staff_cancel_task(p_task_id uuid, p_expected_status public.task_status, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare item public.tasks%rowtype; target_case uuid; recipient uuid; clean_reason text := nullif(trim(p_reason), '');
begin
  select case_id into target_case from public.tasks where id = p_task_id;
  if not private.staff_mfa_passed() or not private.lock_legal_case_editor(target_case) then raise exception 'Not authorized'; end if;
  perform 1 from public.cases where id = target_case and status = 'open' for update;
  if not found then raise exception 'Case is not active'; end if;
  select * into item from public.tasks where id = p_task_id for update;
  if not found or item.status is distinct from p_expected_status or item.status not in ('new', 'response_sent') then raise exception 'Task changed'; end if;
  if clean_reason is null or length(clean_reason) > 1000 then raise exception 'Reason is required'; end if;
  update public.tasks set status = 'cancelled', updated_at = clock_timestamp() where id = p_task_id;
  insert into public.task_events(task_id, actor_user_id, action, response_text) values(p_task_id, auth.uid(), 'cancelled', clean_reason);
  insert into public.audit_events(actor_user_id, case_id, entity_type, entity_id, action, reason)
    values(auth.uid(), target_case, 'task', p_task_id, 'cancelled', clean_reason);
  select cl.user_id into recipient from public.clients cl join public.cases c on c.client_id = cl.id where c.id = target_case;
  if recipient is not null then
    insert into public.notifications(recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
      values(recipient, target_case, 'task_cancelled', 'Задача отменена: ' || item.title, clean_reason,
        '/account/cases/' || target_case || '/tasks#task-' || p_task_id, 'task-cancelled:' || p_task_id);
  end if;
end; $$;
revoke all on function public.staff_cancel_task(uuid, public.task_status, text) from public, anon;
grant execute on function public.staff_cancel_task(uuid, public.task_status, text) to authenticated;

create function public.staff_close_document_request(p_request_id uuid, p_status public.document_request_status, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare item public.document_requests%rowtype; target_case uuid; recipient uuid; clean_reason text := nullif(trim(p_reason), '');
begin
  select case_id into target_case from public.document_requests where id = p_request_id;
  if not private.staff_mfa_passed() or not private.lock_legal_case_editor(target_case) then raise exception 'Not authorized'; end if;
  perform 1 from public.cases where id = target_case and status = 'open' for update;
  if not found then raise exception 'Case is not active'; end if;
  select * into item from public.document_requests where id = p_request_id for update;
  if not found or item.status <> 'active' then raise exception 'Request changed'; end if;
  if p_status is null or p_status not in ('cancelled', 'not_required') or clean_reason is null or length(clean_reason) > 1000 then raise exception 'Reason is required'; end if;
  update public.document_requests set status = p_status, closure_reason = clean_reason, updated_at = clock_timestamp() where id = p_request_id;
  insert into public.audit_events(actor_user_id, case_id, entity_type, entity_id, action, reason, after_data)
    values(auth.uid(), target_case, 'document_request', p_request_id, 'closed', clean_reason, jsonb_build_object('status', p_status));
  select cl.user_id into recipient from public.clients cl join public.cases c on c.client_id = cl.id where c.id = target_case;
  if recipient is not null then
    insert into public.notifications(recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
      values(recipient, target_case, 'document_request_closed', 'Документ больше не требуется: ' || item.title, clean_reason,
        '/account/cases/' || target_case || '/documents#request-' || p_request_id, 'document-request-closed:' || p_request_id);
  end if;
end; $$;
revoke all on function public.staff_close_document_request(uuid, public.document_request_status, text) from public, anon;
grant execute on function public.staff_close_document_request(uuid, public.document_request_status, text) to authenticated;

-- Keep validated implementations private. Old clients cannot bypass the revision check.
alter function public.admin_save_contact_settings(text, text, text, text, text) set schema private;
revoke all on function private.admin_save_contact_settings(text, text, text, text, text) from public, anon, authenticated;
alter function public.admin_upsert_faq(uuid, text, text, integer, boolean) set schema private;
revoke all on function private.admin_upsert_faq(uuid, text, text, integer, boolean) from public, anon, authenticated;
alter table public.contact_settings add column payment_details text check (length(payment_details) <= 4000);

create function public.admin_save_contact_settings(p_phone text, p_email text, p_whatsapp_url text,
 p_business_hours text, p_response_expectation text, p_expected_updated_at timestamptz, p_payment_details text)
returns void language plpgsql security definer set search_path = '' as $$
declare previous public.contact_settings%rowtype;
begin
  if not private.staff_mfa_passed() or private.staff_role_for_current_user() is distinct from 'admin' then raise exception 'Not authorized'; end if;
  perform pg_advisory_xact_lock(781601);
  select * into previous from public.contact_settings where id = true for update;
  if previous.updated_at is distinct from p_expected_updated_at then raise exception 'Settings changed'; end if;
  if length(coalesce(p_payment_details, '')) > 4000 then raise exception 'Invalid payment details'; end if;
  perform private.admin_save_contact_settings(p_phone, p_email, p_whatsapp_url, p_business_hours, p_response_expectation);
  if previous.payment_details is distinct from nullif(trim(p_payment_details), '') then
    insert into public.contact_settings(id, payment_details) values(true, nullif(trim(p_payment_details), ''))
    on conflict(id) do update set payment_details = excluded.payment_details, updated_at = clock_timestamp();
    insert into public.audit_events(actor_user_id, entity_type, action) values(auth.uid(), 'contact_settings', 'payment_details_updated');
  end if;
end; $$;
revoke all on function public.admin_save_contact_settings(text, text, text, text, text, timestamptz, text) from public, anon;
grant execute on function public.admin_save_contact_settings(text, text, text, text, text, timestamptz, text) to authenticated;

create function public.admin_upsert_faq(p_id uuid, p_question text, p_answer text, p_position integer, p_published boolean, p_expected_updated_at timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare revision timestamptz;
begin
  if not private.staff_mfa_passed() or private.staff_role_for_current_user() is distinct from 'admin' then raise exception 'Not authorized'; end if;
  if p_id is not null then
    select updated_at into revision from public.faq_entries where id = p_id for update;
    if not found or revision is distinct from p_expected_updated_at then raise exception 'Settings changed'; end if;
  end if;
  return private.admin_upsert_faq(p_id, p_question, p_answer, p_position, p_published);
end; $$;
revoke all on function public.admin_upsert_faq(uuid, text, text, integer, boolean, timestamptz) from public, anon;
grant execute on function public.admin_upsert_faq(uuid, text, text, integer, boolean, timestamptz) to authenticated;
-- END 20261016007800_audit_workflow_fixes.sql

-- BEGIN 20261016007900_versioned_client_consents.sql
-- No legal text is seeded. The administrator publishes an approved version explicitly.
create table public.legal_documents (
  id uuid primary key default gen_random_uuid(),
  document_type text not null check(document_type in ('terms', 'privacy', 'marketing')),
  version integer not null check(version > 0),
  title text not null check(length(title) between 1 and 180),
  body text not null check(length(body) between 1 and 60000),
  document_hash text not null,
  is_current boolean not null default true,
  published_at timestamptz not null default now(),
  published_by uuid not null references auth.users(id),
  unique(document_type, version)
);
create unique index legal_documents_current on public.legal_documents(document_type) where is_current;
alter table public.legal_documents enable row level security;
grant select on public.legal_documents to authenticated;
create policy legal_documents_read on public.legal_documents for select to authenticated using(true);
create policy staff_mfa_guard on public.legal_documents as restrictive for all to authenticated
  using ((select private.staff_mfa_passed())) with check ((select private.staff_mfa_passed()));

create function public.admin_publish_legal_document(p_type text, p_title text, p_body text, p_expected_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare current_id uuid; new_id uuid; next_version integer;
begin
  if not private.staff_mfa_passed() or private.staff_role_for_current_user() is distinct from 'admin' then raise exception 'Not authorized'; end if;
  if p_type is null or p_type not in ('terms','privacy','marketing') or nullif(trim(p_title), '') is null
    or length(p_title) > 180 or nullif(trim(p_body), '') is null or length(p_body) > 60000 then raise exception 'Invalid legal document'; end if;
  perform pg_advisory_xact_lock(791601);
  select id into current_id from public.legal_documents where document_type = p_type and is_current for update;
  if current_id is distinct from p_expected_id then raise exception 'Document changed'; end if;
  select coalesce(max(version), 0) + 1 into next_version from public.legal_documents where document_type = p_type;
  update public.legal_documents set is_current = false where id = current_id;
  insert into public.legal_documents(document_type, version, title, body, document_hash, published_by)
    values(p_type, next_version, trim(p_title), trim(p_body), encode(pg_catalog.sha256(convert_to(trim(p_body), 'UTF8')), 'hex'), auth.uid()) returning id into new_id;
  insert into public.audit_events(actor_user_id, entity_type, entity_id, action, after_data)
    values(auth.uid(), 'legal_document', new_id, 'published', jsonb_build_object('type', p_type, 'version', next_version));
  return new_id;
end; $$;
revoke all on function public.admin_publish_legal_document(text, text, text, uuid) from public, anon;
grant execute on function public.admin_publish_legal_document(text, text, text, uuid) to authenticated;

create function public.client_consent_status()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (exists(select 1 from public.staff_members where user_id = auth.uid() and active) or not exists (
    select 1 from public.legal_documents d where d.is_current and d.document_type <> 'marketing'
      and not exists(select 1 from public.consent_records r where r.user_id = auth.uid()
        and r.document_type = d.document_type and r.version = d.version::text and r.document_hash = d.document_hash)
  ));
$$;
revoke all on function public.client_consent_status() from public, anon;
grant execute on function public.client_consent_status() to authenticated;

create function public.accept_client_consents(p_document_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare doc public.legal_documents%rowtype;
begin
  if auth.uid() is null or not private.staff_mfa_passed() then raise exception 'Not authorized'; end if;
  perform pg_advisory_xact_lock(791601);
  if p_document_ids is null or cardinality(p_document_ids) > 3
    or exists(select 1 from unnest(p_document_ids) as requested(document_id) where requested.document_id is null or not exists(select 1 from public.legal_documents d where d.id = requested.document_id and d.is_current))
    or exists(select 1 from public.legal_documents d where d.is_current and d.document_type <> 'marketing' and not (d.id = any(p_document_ids)))
    then raise exception 'Documents changed or required consent missing'; end if;
  for doc in select * from public.legal_documents where id = any(p_document_ids) loop
    insert into public.consent_records(user_id, document_type, version, document_hash)
      values(auth.uid(), doc.document_type, doc.version::text, doc.document_hash)
      on conflict(user_id, document_type, version) do nothing;
  end loop;
end; $$;
revoke all on function public.accept_client_consents(uuid[]) from public, anon;
grant execute on function public.accept_client_consents(uuid[]) to authenticated;
-- END 20261016007900_versioned_client_consents.sql

-- BEGIN 20261016008000_document_tasks.sql
-- Upload tasks own a document request; file review remains the source of truth.
create or replace function public.staff_create_task(p_case_id uuid, p_kind public.task_kind, p_title text,
 p_description text default null, p_due_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare request_id uuid; task_id uuid;
begin
  if not private.staff_mfa_passed() or not private.lock_legal_case_editor(p_case_id) then raise exception 'Not authorized'; end if;
  perform 1 from public.cases where id = p_case_id and status = 'open' and not is_suspended for update;
  if not found then raise exception 'Case is not active'; end if;
  if p_kind = 'acknowledge' and nullif(trim(p_description), '') is null then raise exception 'Acknowledgment text is required'; end if;
  if p_kind is distinct from 'upload_document' then
    return private.staff_create_task(p_case_id, p_kind, p_title, p_description, p_due_at);
  end if;
  request_id := public.staff_create_document_request(p_case_id, p_title, p_description, true, p_due_at);
  insert into public.tasks(case_id, document_request_id, kind, title, description, due_at, created_by)
    values(p_case_id, request_id, p_kind, trim(p_title), nullif(trim(p_description), ''), p_due_at, auth.uid()) returning id into task_id;
  insert into public.task_events(task_id, actor_user_id, action) values(task_id, auth.uid(), 'created');
  insert into public.audit_events(actor_user_id, case_id, entity_type, entity_id, action, after_data)
    values(auth.uid(), p_case_id, 'task', task_id, 'created', jsonb_build_object('document_request_id', request_id));
  return task_id;
end; $$;

create function private.sync_document_tasks()
returns trigger language plpgsql security definer set search_path = '' as $$
declare request_id uuid; request_status public.document_request_status; reason text; state text;
  next_status public.task_status; task public.tasks%rowtype; actor uuid;
begin
  if tg_table_name = 'document_files' then request_id := new.request_id; actor := coalesce(auth.uid(), new.reviewed_by, new.uploaded_by);
  else request_id := new.id; actor := coalesce(auth.uid(), new.created_by); end if;
  select status, closure_reason into request_status, reason from public.document_requests where id = request_id;
  state := private.document_request_current_state(request_id);
  next_status := case when request_status <> 'active' then 'cancelled'::public.task_status
    when state = 'accepted' then 'completed'::public.task_status
    when state = 'under_review' then 'response_sent'::public.task_status else 'new'::public.task_status end;
  for task in select * from public.tasks where document_request_id = request_id and kind = 'upload_document' and status <> 'cancelled' for update loop
    if task.status = next_status then continue; end if;
    update public.tasks set status = next_status, updated_at = clock_timestamp(),
      completed_at = case when next_status = 'completed' then clock_timestamp() end,
      completed_by = case when next_status = 'completed' then actor end where id = task.id;
    insert into public.task_events(task_id, actor_user_id, action, response_text)
      values(task.id, actor, case next_status when 'completed' then 'completed' when 'response_sent' then 'responded' when 'cancelled' then 'cancelled' else 'returned' end,
      case next_status when 'completed' then 'Все файлы документа приняты' when 'response_sent' then 'Документ отправлен на проверку' when 'cancelled' then coalesce(reason, 'Запрос закрыт') else 'Нужно отправить исправленный или полный набор файлов' end);
    insert into public.audit_events(actor_user_id, case_id, entity_type, entity_id, action, after_data)
      values(actor, task.case_id, 'task', task.id, 'document_status_synced', jsonb_build_object('status', next_status, 'document_request_id', request_id));
  end loop;
  return new;
end; $$;
revoke all on function private.sync_document_tasks() from public, anon, authenticated;
create trigger modernsecure_document_task_files after insert or update of status on public.document_files for each row execute function private.sync_document_tasks();
create trigger modernsecure_document_task_closed after update of status on public.document_requests for each row when(old.status is distinct from new.status) execute function private.sync_document_tasks();

-- A linked task is cancelled by closing its request, and reviewed through its files.
create function private.guard_linked_document_task()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.kind = 'upload_document' and old.document_request_id is not null and new.status is distinct from old.status
    and pg_trigger_depth() = 1 then raise exception 'Review or close the linked document request'; end if;
  return new;
end; $$;
revoke all on function private.guard_linked_document_task() from public, anon, authenticated;
create trigger modernsecure_linked_document_task_guard before update of status on public.tasks for each row execute function private.guard_linked_document_task();
-- END 20261016008000_document_tasks.sql

-- BEGIN 20261016008100_require_existing_staff_mfa.sql
-- Existing staff use the same enrollment gate as newly invited employees.
-- The /staff-security route and Supabase Auth enrollment remain available at AAL1.
with changed as (
  update public.staff_members set mfa_required = true where not mfa_required returning user_id
)
insert into public.audit_events(entity_type, entity_id, action, after_data)
select 'staff_member', user_id, 'mfa_required_enabled', jsonb_build_object('mfa_required', true) from changed;
-- END 20261016008100_require_existing_staff_mfa.sql

-- BEGIN 20261016008200_mfa_missing_claim_guard.sql
-- Missing assurance claims must be false, including in security-definer RPC guards.
create or replace function private.staff_mfa_passed()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(not private.staff_mfa_required()
    or (auth.jwt()->>'aal' = 'aal2' and exists (
      select 1 from auth.mfa_factors factor
      where factor.user_id = auth.uid() and factor.status = 'verified'
    )), false)
$$;
-- END 20261016008200_mfa_missing_claim_guard.sql

-- BEGIN 20261016008300_optional_staff_mfa.sql
-- The owner requested password-only access. MFA remains available by opt-in.
-- Keep enrolled factors and the existing role/RLS checks intact.
alter table public.staff_members alter column mfa_required set default false;

with changed as (
  update public.staff_members set mfa_required = false where mfa_required returning user_id
)
insert into public.audit_events(entity_type, entity_id, action, after_data)
select 'staff_member', user_id, 'mfa_required_disabled',
  jsonb_build_object('mfa_required', false, 'reason', 'Owner requested optional MFA')
from changed;
-- END 20261016008300_optional_staff_mfa.sql

-- BEGIN 20261017008400_primary_administrator.sql
-- Separate the protected primary administrator from ordinary administrators.
alter table public.staff_members add column is_primary_admin boolean not null default false;
update public.staff_members set is_primary_admin = true where role = 'admin';
alter table public.staff_members add constraint staff_primary_admin_role check (not is_primary_admin or (role = 'admin' and active));
drop index public.staff_one_primary_admin;
create unique index staff_one_primary_admin on public.staff_members (is_primary_admin) where is_primary_admin;
alter table public.staff_invites drop constraint staff_invites_role_check;
alter table public.staff_invites add constraint staff_invites_role_check check (role in ('lawyer', 'manager', 'admin'));

create function private.is_primary_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff_members where user_id = auth.uid() and active and role = 'admin' and is_primary_admin)
$$;
revoke all on function private.is_primary_admin() from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.staff_mfa_status()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'role', sm.role,
    'is_primary_admin', sm.is_primary_admin,
    'active', sm.active,
    'display_name', sm.display_name,
    'mfa_required', private.staff_mfa_required(),
    'mfa_passed', private.staff_mfa_passed()
  )
  from public.staff_members sm where sm.user_id = auth.uid()
$function$
;

CREATE OR REPLACE FUNCTION public.admin_add_staff(p_email text, p_display_name text, p_role public.staff_role)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid();
  clean_email text := nullif(lower(trim(p_email)), '');
  clean_name text := nullif(trim(p_display_name), '');
  target_id uuid;
  matches integer;
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  if clean_email is null or length(clean_email) > 254
    or clean_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or clean_name is null or length(clean_name) > 160
    or not coalesce((p_role in ('lawyer', 'manager') or (p_role = 'admin' and private.is_primary_admin())), false) then
    raise exception 'Invalid staff details';
  end if;
  select count(*)::integer into matches from auth.users u
  where lower(u.email) = clean_email and u.email_confirmed_at is not null;
  if matches <> 1 then raise exception 'Exactly one verified account is required'; end if;
  select u.id into target_id from auth.users u
  where lower(u.email) = clean_email and u.email_confirmed_at is not null;
  if exists (select 1 from public.clients where user_id = target_id)
    or exists (select 1 from public.staff_members where user_id = target_id) then
    raise exception 'Account already assigned';
  end if;
  insert into public.staff_members (user_id, display_name, role)
  values (target_id, clean_name, p_role);
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
  values (actor_id, 'staff_member', target_id, 'role_granted', jsonb_build_object('role', p_role));
  return target_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_invite_staff(p_email text, p_display_name text, p_role public.staff_role)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid();
  clean_email text := nullif(lower(trim(p_email)), '');
  clean_name text := nullif(trim(p_display_name), '');
  target_id uuid;
  matches integer;
  invite_id uuid;
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  if clean_email is null or length(clean_email) > 254
    or clean_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or clean_name is null or length(clean_name) > 160
    or not coalesce((p_role in ('lawyer', 'manager') or (p_role = 'admin' and private.is_primary_admin())), false) then
    raise exception 'Invalid staff invitation';
  end if;
  -- Serialize invitations to the same address, including an upsert of a pending invite.
  perform pg_advisory_xact_lock(hashtextextended(clean_email, 0));
  perform 1 from public.staff_invites where email = clean_email and status = 'pending' for update;
  if not private.is_primary_admin() and exists (
    select 1 from public.staff_invites where email = clean_email and status = 'pending' and role = 'admin'
  ) then raise exception 'Protected administrator'; end if;
  select count(*)::integer into matches from auth.users u where lower(u.email) = clean_email;
  if matches > 1 then raise exception 'Duplicate Auth email'; end if;
  if matches = 1 then
    select u.id into target_id from auth.users u where lower(u.email) = clean_email;
    if exists (select 1 from public.clients where user_id = target_id)
      or exists (select 1 from public.staff_members where user_id = target_id) then
      raise exception 'Account already has a role';
    end if;
  end if;
  insert into public.staff_invites (email, display_name, role, created_by)
  values (clean_email, clean_name, p_role, actor_id)
  on conflict (email) where status = 'pending' do update
    set display_name = excluded.display_name, role = excluded.role, created_by = excluded.created_by,
      expires_at = now() + interval '14 days', updated_at = now()
  returning id into invite_id;
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
  values (actor_id, 'staff_invite', invite_id, 'invited',
    jsonb_build_object('email', clean_email, 'role', p_role));
  if target_id is not null and private.claim_staff_invite_for_user(target_id) then
    return 'granted';
  end if;
  return 'pending';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_cancel_staff_invite(p_invite_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor_id uuid := auth.uid(); invite public.staff_invites%rowtype;
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  select * into invite from public.staff_invites where id = p_invite_id for update;
  if not found or invite.status <> 'pending' then raise exception 'Pending invitation not found'; end if;
  if invite.role = 'admin' and not private.is_primary_admin() then raise exception 'Protected administrator'; end if;
  update public.staff_invites set status = 'cancelled', updated_at = now() where id = p_invite_id;
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action)
  values (actor_id, 'staff_invite', p_invite_id, 'cancelled');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_set_staff_access(p_staff_user_id uuid, p_role public.staff_role, p_active boolean, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid();
  before_staff public.staff_members%rowtype;
  assignment record;
  clean_reason text := nullif(trim(p_reason), '');
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  if p_staff_user_id is null or p_staff_user_id = actor_id
    or not coalesce((p_role in ('lawyer', 'manager') or (p_role = 'admin' and private.is_primary_admin())), false) or p_active is null
    or clean_reason is null or length(clean_reason) > 500 then
    raise exception 'Invalid staff access change';
  end if;
  select * into before_staff from public.staff_members where user_id = p_staff_user_id for update;
  if not found or before_staff.is_primary_admin or (before_staff.role = 'admin' and not private.is_primary_admin()) then raise exception 'Protected administrator'; end if;
  if before_staff.role = p_role and before_staff.active = p_active then raise exception 'Access is unchanged'; end if;
  update public.staff_members set role = p_role, active = p_active where user_id = p_staff_user_id;
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, before_data, after_data, reason)
  values (actor_id, 'staff_member', p_staff_user_id, 'access_changed',
    jsonb_build_object('role', before_staff.role, 'active', before_staff.active),
    jsonb_build_object('role', p_role, 'active', p_active), clean_reason);
  if before_staff.role <> p_role or not p_active then
    for assignment in select id, case_id, assigned_at from public.case_assignments
      where staff_user_id = p_staff_user_id and revoked_at is null for update loop
      update public.case_assignments
        set revoked_at = greatest(clock_timestamp(), assignment.assigned_at)
        where id = assignment.id;
      insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, reason)
      values (actor_id, assignment.case_id, 'case_assignment', assignment.id, 'revoked', clean_reason);
    end loop;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_set_payment_permission(p_staff_user_id uuid, p_allowed boolean, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor_id uuid := auth.uid(); target public.staff_members%rowtype;
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  if p_allowed is null or nullif(trim(p_reason), '') is null or length(p_reason) > 500 then
    raise exception 'Reason is required';
  end if;
  select * into target from public.staff_members where user_id = p_staff_user_id for update;
  if not found or not target.active then raise exception 'Active staff member not found'; end if;
  if target.role = 'admin' and not private.is_primary_admin() then raise exception 'Protected administrator'; end if;
  if target.can_confirm_payments = p_allowed then raise exception 'Permission is unchanged'; end if;
  update public.staff_members set can_confirm_payments = p_allowed where user_id = p_staff_user_id;
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, before_data, after_data, reason)
  values (actor_id, 'staff_member', p_staff_user_id, 'payment_permission_changed',
    jsonb_build_object('allowed', target.can_confirm_payments), jsonb_build_object('allowed', p_allowed), trim(p_reason));
end;
$function$
;

CREATE OR REPLACE FUNCTION private.claim_staff_invite_for_user(p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare verified_email text; invite public.staff_invites%rowtype;
begin
  select lower(u.email) into verified_email from auth.users u
  where u.id = p_user_id and u.email_confirmed_at is not null;
  if verified_email is null then return false; end if;
  select * into invite from public.staff_invites
  where email = verified_email and status = 'pending' and expires_at > now()
  for update;
  if not found then return false; end if;
  -- A pending administrator invitation cannot outlive its issuer's authority.
  if invite.role = 'admin' and not exists (
    select 1 from public.staff_members where user_id = invite.created_by and active and is_primary_admin
  ) then return false; end if;
  if exists (select 1 from public.clients where user_id = p_user_id)
    or exists (select 1 from public.staff_members where user_id = p_user_id) then
    return false;
  end if;
  insert into public.staff_members (user_id, display_name, role)
  values (p_user_id, invite.display_name, invite.role);
  update public.staff_invites set status = 'accepted', accepted_user_id = p_user_id,
    accepted_at = now(), updated_at = now() where id = invite.id;
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
  values (invite.created_by, 'staff_member', p_user_id, 'role_granted',
    jsonb_build_object('role', invite.role, 'invite_id', invite.id));
  return true;
end;
$function$
;

notify pgrst, 'reload schema';
-- END 20261017008400_primary_administrator.sql

-- BEGIN 20261018008500_client_registration_approval.sql
-- Registration already creates a private profile. Use those profiles as the
-- review queue, including existing accounts, without making signup depend on
-- another trigger or granting administrators direct access to auth.users.
alter table public.profiles
  add column full_name text,
  add column iin text,
  add constraint profiles_full_name_format check (
    full_name is null or (length(trim(full_name)) between 1 and 160 and full_name !~ '[[:cntrl:]]')
  ),
  add constraint profiles_iin_format check (iin is null or iin ~ '^[0-9]{12}$');

create function public.admin_client_registrations(p_query text default '', p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  clean_query text := lower(trim(coalesce(p_query, '')));
  result jsonb;
begin
  if auth.uid() is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  if length(clean_query) > 120 or p_page is null or p_page not between 1 and 10000 then
    raise exception 'Invalid registration search';
  end if;
  with pending as (
    select p.user_id, u.email, coalesce(p.full_name, p.display_name) as full_name,
      p.phone, p.city, p.created_at, u.email_confirmed_at is not null as email_confirmed,
      p.iin is not null as has_iin
    from public.profiles p join auth.users u on u.id = p.user_id
    where nullif(trim(u.email), '') is not null
      and not exists (select 1 from public.clients cl where cl.user_id = p.user_id)
      and not exists (select 1 from public.staff_members sm where sm.user_id = p.user_id)
      and not exists (select 1 from public.staff_invites si where si.email = lower(u.email)
        and si.status = 'pending' and si.expires_at > now())
      and (clean_query = '' or position(clean_query in lower(u.email)) > 0
        or position(clean_query in lower(coalesce(p.full_name, p.display_name, ''))) > 0
        or position(clean_query in lower(coalesce(p.phone, ''))) > 0)
  ), totals as (
    select count(*) as total_count,
      least(p_page, greatest(1, ceil(count(*) / 25.0)::integer)) as page from pending
  ), items as (
    select p.*, matches.matching_client_count, matches.matching_client_id
    from pending p
    cross join lateral (
      select count(*) as matching_client_count,
        case when count(*) = 1 and bool_and(cl.user_id is null) then (array_agg(cl.id))[1] end as matching_client_id
      from public.clients cl where lower(trim(cl.email)) = lower(p.email)
    ) matches
    order by p.created_at desc, p.user_id desc
    limit 25 offset ((select page from totals) - 1) * 25
  )
  select jsonb_build_object('total_count', t.total_count, 'page', t.page,
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at desc, i.user_id desc) from items i), '[]'::jsonb))
    into result from totals t;
  return result;
end;
$$;

-- Only a fresh card can be approved before email confirmation. Linking an
-- existing card (and its cases) still requires the existing verified-email RPC.
create function public.admin_approve_client_registration(p_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  target_email text;
  profile public.profiles%rowtype;
  client_id uuid;
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  select u.email into target_email from auth.users u where u.id = p_user_id for update;
  if not found or nullif(trim(target_email), '') is null then raise exception 'Account not found'; end if;
  if exists (select 1 from public.staff_members sm where sm.user_id = p_user_id) then
    raise exception 'Account is already staff';
  end if;
  if exists (select 1 from public.staff_invites si where si.email = lower(target_email)
    and si.status = 'pending' and si.expires_at > now()) then
    raise exception 'Account has a staff invitation';
  end if;
  select cl.id into client_id from public.clients cl where cl.user_id = p_user_id;
  if found then return client_id; end if;
  if exists (select 1 from public.clients cl where lower(trim(cl.email)) = lower(target_email)) then
    raise exception 'Existing client card';
  end if;
  select * into profile from public.profiles where user_id = p_user_id for update;
  if not found then raise exception 'Profile not found'; end if;
  insert into public.clients (user_id, full_name, email, phone, city, iin, linked_by, linked_at)
  values (p_user_id, coalesce(profile.full_name, profile.display_name, target_email),
    lower(target_email), profile.phone, profile.city, profile.iin, actor_id, now())
  returning id into client_id;
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
  values (actor_id, 'client', client_id, 'registration_approved', jsonb_build_object('user_id', p_user_id));
  return client_id;
end;
$$;

-- A client can complete identity before review or fill the missing IIN later.
-- Once an approved card has an IIN, corrections remain a staff workflow.
create function public.complete_own_client_identity(p_full_name text, p_iin text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  clean_name text := nullif(trim(p_full_name), '');
  clean_iin text := nullif(trim(p_iin), '');
  profile public.profiles%rowtype;
  card public.clients%rowtype;
begin
  if actor_id is null then raise exception 'Not authenticated'; end if;
  if clean_name is null or length(clean_name) > 160 or clean_name ~ '[[:cntrl:]]'
    or (clean_iin is not null and clean_iin !~ '^[0-9]{12}$') then
    raise exception 'Invalid identity';
  end if;
  -- The same account lock serializes profile completion, approval and role changes.
  perform 1 from auth.users where id = actor_id for update;
  if exists (select 1 from public.staff_members where user_id = actor_id) then
    raise exception 'Account is already staff';
  end if;
  select * into profile from public.profiles where user_id = actor_id for update;
  if not found then raise exception 'Profile not found'; end if;
  select * into card from public.clients where user_id = actor_id for update;
  if card.iin is not null then raise exception 'Identity is already completed'; end if;
  if profile.full_name is not distinct from clean_name and profile.iin is not distinct from clean_iin
    and (card.id is null or (card.full_name = clean_name and card.iin is not distinct from clean_iin)) then
    return;
  end if;
  update public.profiles set full_name = clean_name, iin = clean_iin, updated_at = now()
    where user_id = actor_id;
  if card.id is not null then
    update public.clients set full_name = clean_name, iin = clean_iin, updated_at = now() where id = card.id;
  end if;
  -- Do not duplicate government identifiers in audit payloads.
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
  values (actor_id, case when card.id is null then 'profile' else 'client' end,
    coalesce(card.id, actor_id), 'identity_completed', jsonb_build_object('iin_provided', clean_iin is not null));
end;
$$;

revoke all on function public.admin_client_registrations(text, integer) from public, anon;

revoke all on function public.admin_approve_client_registration(uuid) from public, anon;

revoke all on function public.complete_own_client_identity(text, text) from public, anon;

grant execute on function public.admin_client_registrations(text, integer) to authenticated;

grant execute on function public.admin_approve_client_registration(uuid) to authenticated;

grant execute on function public.complete_own_client_identity(text, text) to authenticated;

-- Contacts entered after approval must also reach the card staff work with.
create function private.sync_client_profile_contacts()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.clients set phone = new.phone, city = new.city, updated_at = now()
    where user_id = new.user_id;
  return new;
end;
$$;

revoke all on function private.sync_client_profile_contacts() from public, anon, authenticated;

create trigger modernsecure_client_profile_contacts
after update of phone, city on public.profiles
for each row when (old.phone is distinct from new.phone or old.city is distinct from new.city)
execute function private.sync_client_profile_contacts();

notify pgrst, 'reload schema';
-- END 20261018008500_client_registration_approval.sql

-- BEGIN 20261018008600_profile_and_document_corrections.sql
-- Contact synchronization changes only the fields actually edited.
create or replace function private.sync_client_profile_contacts()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.clients set
    phone = case when old.phone is distinct from new.phone then new.phone else phone end,
    city = case when old.city is distinct from new.city then new.city else city end,
    updated_at = clock_timestamp()
  where user_id = new.user_id;
  return new;
end;
$$;

-- Populate the form from existing card contacts, including cards linked later.
create function private.seed_linked_profile_contacts()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is not null then
    update public.profiles set phone = coalesce(phone, new.phone), city = coalesce(city, new.city),
      updated_at = clock_timestamp()
      where user_id = new.user_id and ((phone is null and new.phone is not null) or (city is null and new.city is not null));
  end if;
  return new;
end;
$$;

revoke all on function private.seed_linked_profile_contacts() from public, anon, authenticated;

create trigger modernsecure_seed_linked_profile_contacts
after insert or update of user_id on public.clients
for each row execute function private.seed_linked_profile_contacts();

update public.profiles p set phone = coalesce(p.phone, cl.phone), city = coalesce(p.city, cl.city),
  updated_at = clock_timestamp()
from public.clients cl where cl.user_id = p.user_id
  and ((p.phone is null and cl.phone is not null) or (p.city is null and cl.city is not null));

create function public.save_own_profile(p_display_name text, p_phone text, p_city text, p_expected_updated_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare previous public.profiles%rowtype;
begin
  select * into previous from public.profiles where user_id = auth.uid() for update;
  if not found then raise exception 'Not authenticated'; end if;
  if previous.updated_at is distinct from p_expected_updated_at then raise exception 'Profile changed'; end if;
  perform public.update_own_profile(p_display_name, p_phone, p_city);
end;
$$;

revoke all on function public.save_own_profile(text, text, text, timestamptz) from public, anon;

grant execute on function public.save_own_profile(text, text, text, timestamptz) to authenticated;

-- Identity corrections are explicit, version checked, and never copy IINs into audit history.
create function public.staff_correct_client_identity(p_client_id uuid, p_expected_updated_at timestamptz,
  p_full_name text, p_iin text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare card public.clients%rowtype; linked_user uuid; clean_name text := nullif(trim(p_full_name), '');
  clean_iin text := nullif(trim(p_iin), ''); clean_reason text := nullif(trim(p_reason), '');
begin
  if not private.staff_mfa_passed() or coalesce(private.staff_role_for_current_user() not in ('admin', 'manager'), true)
    or auth.uid() is null then raise exception 'Not authorized'; end if;
  if clean_name is null or length(clean_name) > 160 or clean_name ~ '[[:cntrl:]]'
    or (clean_iin is not null and clean_iin !~ '^[0-9]{12}$')
    or clean_reason is null or length(clean_reason) > 500 then raise exception 'Invalid identity correction'; end if;
  select user_id into linked_user from public.clients where id = p_client_id;
  if linked_user is not null then
    perform 1 from auth.users where id = linked_user for update;
    perform 1 from public.profiles where user_id = linked_user for update;
  end if;
  select * into card from public.clients where id = p_client_id for update;
  if not found then raise exception 'Client not found'; end if;
  if card.user_id is distinct from linked_user or card.updated_at is distinct from p_expected_updated_at then
    raise exception 'Client changed';
  end if;
  if card.full_name = clean_name and card.iin is not distinct from clean_iin then return; end if;
  update public.clients set full_name = clean_name, iin = clean_iin, updated_at = clock_timestamp() where id = p_client_id;
  update public.profiles set full_name = clean_name, iin = clean_iin, updated_at = clock_timestamp() where user_id = linked_user;
  insert into public.audit_events(actor_user_id, entity_type, entity_id, action, after_data, reason)
  values(auth.uid(), 'client', p_client_id, 'identity_corrected',
    jsonb_build_object('name_changed', card.full_name is distinct from clean_name,
      'iin_changed', card.iin is distinct from clean_iin, 'iin_provided', clean_iin is not null), clean_reason);
end;
$$;

revoke all on function public.staff_correct_client_identity(uuid, timestamptz, text, text, text) from public, anon;

grant execute on function public.staff_correct_client_identity(uuid, timestamptz, text, text, text) to authenticated;

-- A reasoned waiver satisfies a template. Cancelling a mistaken request does not.
create function private.case_required_documents_complete(p_case_id uuid, p_version_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.document_requests dr where dr.case_id = p_case_id and dr.required and dr.status = 'active'
      and private.document_request_current_state(dr.id) <> 'accepted'
  ) and not exists (
    select 1 from public.document_templates dt where dt.version_id = p_version_id and dt.required
    and not exists (
      select 1 from public.document_requests dr where dr.case_id = p_case_id and dr.template_id = dt.id
        and ((dr.status = 'active' and private.document_request_current_state(dr.id) = 'accepted')
          or (dr.status = 'not_required' and nullif(trim(dr.closure_reason), '') is not null))
    )
  );
$$;

revoke all on function private.case_required_documents_complete(uuid, uuid) from public, anon, authenticated;

create or replace function private.guard_case_close_document_versions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'closed' and old.status is distinct from 'closed'
    and not private.case_required_documents_complete(new.id, new.service_version_id) then
    raise exception 'Latest required document versions are not accepted';
  end if;
  return new;
end;
$$;

create or replace function public.staff_close_case(p_case_id uuid, p_result_summary text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); item public.cases%rowtype; pending_task record;
  clean_result text := nullif(trim(p_result_summary), ''); client_user_id uuid;
begin
  if not private.lock_legal_case_editor(p_case_id) then raise exception 'Not authorized'; end if;
  select * into item from public.cases where id = p_case_id for update;
  if not found or item.status <> 'open' or item.is_suspended then raise exception 'Case cannot be closed'; end if;
  if clean_result is null or length(clean_result) > 4000 then raise exception 'Result summary is required'; end if;
  if not private.case_required_documents_complete(p_case_id, item.service_version_id) then
    raise exception 'Required documents are not accepted';
  end if;
  update public.cases set status = 'closed', result_summary = clean_result,
    closed_at = clock_timestamp(), next_review_at = null, updated_at = clock_timestamp()
    where id = p_case_id;
  for pending_task in select id, status from public.tasks
    where case_id = p_case_id and status in ('new', 'response_sent') for update loop
    update public.tasks set status = 'cancelled', updated_at = clock_timestamp()
      where id = pending_task.id;
    insert into public.task_events (task_id, actor_user_id, action, response_text)
      values (pending_task.id, actor_id, 'cancelled', 'Дело завершено');
    insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, before_data, after_data)
      values (actor_id, p_case_id, 'task', pending_task.id, 'cancelled_on_case_close',
        jsonb_build_object('status', pending_task.status), jsonb_build_object('status', 'cancelled'));
  end loop;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
    values (actor_id, p_case_id, 'case', p_case_id, 'closed',
      jsonb_build_object('result_summary', clean_result));
  select cl.user_id into client_user_id from public.clients cl where cl.id = item.client_id;
  if client_user_id is not null then
    insert into public.notifications (recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
      values (client_user_id, p_case_id, 'case_status', 'Дело завершено', clean_result,
        '/account/cases/' || p_case_id::text, 'case-closed:' || p_case_id::text)
      on conflict (recipient_user_id, dedupe_key) do nothing;
  end if;
end;
$$;

notify pgrst, 'reload schema';
-- END 20261018008600_profile_and_document_corrections.sql

-- BEGIN 20261018008700_payment_allocations_and_schedule_corrections.sql
-- A bank transaction stays unique; its amount may cover several installments.
alter table public.payment_schedule add column cancelled_at timestamptz,
  add column cancellation_reason text,
  add constraint payment_schedule_cancellation_check check (
    (cancelled_at is null and cancellation_reason is null) or
    (cancelled_at is not null and length(trim(cancellation_reason)) between 1 and 500));

alter table public.payment_schedule add constraint payment_schedule_id_case_key unique(id, case_id);

alter table public.payments add constraint payments_id_case_key unique(id, case_id);

create table public.payment_allocations (
  payment_id uuid not null,
  schedule_id uuid not null,
  case_id uuid not null,
  amount_kzt numeric(14,2) not null check(amount_kzt > 0),
  primary key(payment_id, schedule_id),
  foreign key(payment_id, case_id) references public.payments(id, case_id) on delete restrict,
  foreign key(schedule_id, case_id) references public.payment_schedule(id, case_id) on delete restrict
);

create index payment_allocations_schedule_idx on public.payment_allocations(schedule_id);

create index payment_allocations_case_idx on public.payment_allocations(case_id);

insert into public.payment_allocations(payment_id, schedule_id, case_id, amount_kzt)
  select id, schedule_id, case_id, amount_kzt from public.payments where schedule_id is not null;

alter table public.payment_allocations enable row level security;

revoke all on public.payment_allocations from anon, authenticated;

grant select on public.payment_allocations to authenticated;

create policy payment_allocations_case_read on public.payment_allocations for select to authenticated
  using(private.can_read_case(case_id));

create policy staff_mfa_guard on public.payment_allocations as restrictive for all to authenticated
  using((select private.staff_mfa_passed())) with check((select private.staff_mfa_passed()));

create function private.lock_financial_case(p_case_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.staff_members where user_id = auth.uid() for share;
  perform 1 from public.case_assignments where case_id = p_case_id and staff_user_id = auth.uid() and revoked_at is null for share;
  if auth.uid() is null or not private.staff_mfa_passed() or not private.can_manage_payments(p_case_id) then
    raise exception 'Not authorized';
  end if;
  perform 1 from public.cases where id = p_case_id for update;
  if not found then raise exception 'Case not found'; end if;
end;
$$;

revoke all on function private.lock_financial_case(uuid) from public, anon, authenticated;

create function private.installment_paid(p_schedule_id uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(a.amount_kzt), 0) from public.payment_allocations a
  join public.payments p on p.id = a.payment_id where a.schedule_id = p_schedule_id and p.status = 'confirmed';
$$;

revoke all on function private.installment_paid(uuid) from public, anon, authenticated;

-- Prices are total prices of contract versions. Paid money plus active future
-- obligations must not silently exceed the latest agreed price.
create function private.assert_schedule_within_contract(p_case_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare price numeric; paid numeric; outstanding numeric;
begin
  select price_kzt into price from public.contracts where case_id = p_case_id order by version_no desc limit 1;
  select coalesce(sum(amount_kzt), 0) into paid from public.payments where case_id = p_case_id and status = 'confirmed';
  select coalesce(sum(greatest(0, s.amount_kzt - private.installment_paid(s.id))), 0) into outstanding
    from public.payment_schedule s where s.case_id = p_case_id and s.cancelled_at is null;
  if price is null or outstanding > greatest(0, price - paid) then raise exception 'Schedule exceeds remaining contract price'; end if;
end;
$$;

revoke all on function private.assert_schedule_within_contract(uuid) from public, anon, authenticated;

create function public.staff_record_payment(p_case_id uuid, p_amount_kzt numeric, p_paid_on date,
  p_reference text, p_client_note text, p_idempotency_key uuid, p_receipt_id uuid default null,
  p_schedule_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare existing public.payments%rowtype; receipt public.payment_receipts%rowtype;
  result_payment_id uuid; recipient uuid; installment record; remaining numeric := p_amount_kzt; allocated numeric;
begin
  perform private.lock_financial_case(p_case_id);
  if p_idempotency_key is null or p_amount_kzt is null or p_amount_kzt <= 0
    or p_amount_kzt > 999999999999.99 or p_amount_kzt <> round(p_amount_kzt, 2)
    or p_paid_on is null or p_paid_on > (now() at time zone 'Asia/Almaty')::date
    or nullif(trim(p_reference), '') is null or length(trim(p_reference)) not between 4 and 120
    or length(coalesce(p_client_note, '')) > 500 then raise exception 'Invalid payment'; end if;
  select * into existing from public.payments where case_id = p_case_id and idempotency_key = p_idempotency_key;
  if found then
    if existing.status = 'confirmed' and existing.schedule_id is not distinct from p_schedule_id
      and existing.amount_kzt = p_amount_kzt and existing.paid_on = p_paid_on
      and existing.payment_reference = trim(p_reference)
      and existing.client_note is not distinct from nullif(trim(p_client_note), '')
      and existing.receipt_id is not distinct from p_receipt_id then return existing.id; end if;
    raise exception 'Payment key cannot be reused';
  end if;
  if p_receipt_id is not null then
    select * into receipt from public.payment_receipts where id = p_receipt_id for update;
    if not found or receipt.case_id <> p_case_id or receipt.status <> 'accepted' then
      raise exception 'Accepted receipt not found for case';
    end if;
    if exists(select 1 from public.payments where receipt_id = p_receipt_id and status = 'confirmed') then
      raise exception 'Receipt already linked to payment';
    end if;
  end if;
  -- The case lock serializes allocation, voiding and schedule edits.
  insert into public.payments(case_id, schedule_id, receipt_id, amount_kzt, paid_on, status,
    confirmed_by, client_note, idempotency_key, payment_reference)
  values(p_case_id, p_schedule_id, p_receipt_id, p_amount_kzt, p_paid_on, 'confirmed', auth.uid(),
    nullif(trim(p_client_note), ''), p_idempotency_key, trim(p_reference)) returning id into result_payment_id;
  for installment in select s.*, private.installment_paid(s.id) as paid from public.payment_schedule s
    where s.case_id = p_case_id and s.cancelled_at is null
      and (p_schedule_id is null or s.id = p_schedule_id)
    order by s.due_on, s.created_at, s.id for update of s loop
    allocated := least(remaining, greatest(0, installment.amount_kzt - installment.paid));
    if allocated > 0 then
      insert into public.payment_allocations(payment_id, schedule_id, case_id, amount_kzt)
        values(result_payment_id, installment.id, p_case_id, allocated);
      remaining := remaining - allocated;
    end if;
    exit when remaining = 0;
  end loop;
  if remaining > 0 then raise exception 'Payment exceeds active schedule'; end if;
  insert into public.audit_events(actor_user_id, case_id, entity_type, entity_id, action, after_data)
  values(auth.uid(), p_case_id, 'payment', result_payment_id, 'confirmed', jsonb_build_object(
    'amount_kzt', p_amount_kzt, 'paid_on', p_paid_on, 'reference', trim(p_reference), 'receipt_id', p_receipt_id,
    'allocations', (select jsonb_agg(jsonb_build_object('schedule_id', a.schedule_id, 'amount_kzt', a.amount_kzt))
      from public.payment_allocations a where a.payment_id = result_payment_id)));
  select cl.user_id into recipient from public.clients cl join public.cases c on c.client_id = cl.id where c.id = p_case_id;
  if recipient is not null then
    insert into public.notifications(recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
    values(recipient, p_case_id, 'payment', 'Оплата подтверждена', p_amount_kzt::text || ' ₸',
      '/account/cases/' || p_case_id || '/payments', 'payment-confirmed:' || result_payment_id);
  end if;
  return result_payment_id;
end;
$$;

revoke all on function public.staff_record_payment(uuid, numeric, date, text, text, uuid, uuid, uuid) from public, anon;

grant execute on function public.staff_record_payment(uuid, numeric, date, text, text, uuid, uuid, uuid) to authenticated;

-- Keep old API callers on the same accounting path.
create or replace function public.staff_confirm_payment(p_schedule_id uuid, p_amount_kzt numeric, p_paid_on date,
  p_reference text, p_client_note text, p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare target_case uuid;
begin
  select case_id into target_case from public.payment_schedule where id = p_schedule_id;
  return public.staff_record_payment(target_case, p_amount_kzt, p_paid_on, p_reference, p_client_note, p_idempotency_key, null, p_schedule_id);
end;
$$;

create or replace function public.staff_confirm_payment_with_receipt(p_schedule_id uuid, p_amount_kzt numeric, p_paid_on date,
  p_reference text, p_client_note text, p_idempotency_key uuid, p_receipt_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare target_case uuid;
begin
  select case_id into target_case from public.payment_schedule where id = p_schedule_id;
  return public.staff_record_payment(target_case, p_amount_kzt, p_paid_on, p_reference, p_client_note, p_idempotency_key, p_receipt_id, p_schedule_id);
end;
$$;

create function public.staff_cancel_payment_installment(p_schedule_id uuid, p_expected_updated_at timestamptz, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare item public.payment_schedule%rowtype; target_case uuid; recipient uuid; clean_reason text := nullif(trim(p_reason), '');
begin
  select case_id into target_case from public.payment_schedule where id = p_schedule_id;
  perform private.lock_financial_case(target_case);
  select * into item from public.payment_schedule where id = p_schedule_id for update;
  if item.updated_at is distinct from p_expected_updated_at or item.cancelled_at is not null then raise exception 'Installment changed by another user'; end if;
  if clean_reason is null or length(clean_reason) > 500 then raise exception 'Reason is required'; end if;
  update public.payment_schedule set cancelled_at = clock_timestamp(), cancellation_reason = clean_reason,
    updated_at = clock_timestamp() where id = p_schedule_id;
  insert into public.audit_events(actor_user_id, case_id, entity_type, entity_id, action, after_data, reason)
    values(auth.uid(), target_case, 'payment_schedule', p_schedule_id, 'installment_cancelled',
      jsonb_build_object('cancelled_outstanding_kzt', greatest(0, item.amount_kzt - private.installment_paid(item.id))), clean_reason);
  select cl.user_id into recipient from public.clients cl join public.cases c on c.client_id = cl.id where c.id = target_case;
  if recipient is not null then
    insert into public.notifications(recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
    values(recipient, target_case, 'payment', 'Срок оплаты отменён', clean_reason,
      '/account/cases/' || target_case || '/payments', 'installment-cancelled:' || p_schedule_id);
  end if;
end;
$$;

revoke all on function public.staff_cancel_payment_installment(uuid, timestamptz, text) from public, anon;

grant execute on function public.staff_cancel_payment_installment(uuid, timestamptz, text) to authenticated;

create or replace function public.staff_add_payment_installment(p_case_id uuid, p_due_on date,
  p_amount_kzt numeric, p_description text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  item public.cases%rowtype;
  contract_version public.contracts%rowtype;
  installment_id uuid;
begin
  perform private.lock_financial_case(p_case_id);
  if p_due_on is null or p_amount_kzt is null or p_amount_kzt <= 0
    or p_amount_kzt > 999999999999.99 or p_amount_kzt <> round(p_amount_kzt, 2)
    or length(coalesce(p_description, '')) > 500 then raise exception 'Invalid installment'; end if;

  select * into contract_version from public.contracts
    where case_id = p_case_id order by version_no desc limit 1;
  if not found then raise exception 'Contract version is required for a new installment'; end if;

  insert into public.payment_schedule (case_id, contract_id, due_on, amount_kzt, description)
  values (p_case_id, contract_version.id, p_due_on, p_amount_kzt, nullif(trim(p_description), ''))
  returning id into installment_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
  values (actor_id, p_case_id, 'payment_schedule', installment_id, 'installment_created',
    jsonb_build_object('due_on', p_due_on, 'amount_kzt', p_amount_kzt,
      'contract_id', contract_version.id, 'contract_version_no', contract_version.version_no));
  perform private.assert_schedule_within_contract(p_case_id);
  return installment_id;
end;
$$;

create or replace function public.staff_update_payment_installment(p_schedule_id uuid, p_expected_updated_at timestamptz,
  p_due_on date, p_amount_kzt numeric, p_description text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); item public.payment_schedule%rowtype; paid_amount numeric; target_case uuid;
begin
  select case_id into target_case from public.payment_schedule where id = p_schedule_id;
  perform private.lock_financial_case(target_case);
  select * into item from public.payment_schedule where id = p_schedule_id for update;
  if item.cancelled_at is not null then raise exception 'Installment is cancelled'; end if;
  if item.updated_at is distinct from p_expected_updated_at then raise exception 'Installment changed by another user'; end if;
  if p_due_on is null or p_amount_kzt is null or p_amount_kzt <= 0
    or p_amount_kzt > 999999999999.99 or p_amount_kzt <> round(p_amount_kzt, 2)
    or length(coalesce(p_description, '')) > 500 or nullif(trim(p_reason), '') is null
    or length(p_reason) > 500 then raise exception 'Invalid installment update'; end if;
  paid_amount := private.installment_paid(p_schedule_id);
  if p_amount_kzt < paid_amount then raise exception 'Amount is below confirmed payments'; end if;
  update public.payment_schedule set due_on = p_due_on, amount_kzt = p_amount_kzt,
    description = nullif(trim(p_description), ''), updated_at = clock_timestamp() where id = p_schedule_id;
  perform private.assert_schedule_within_contract(item.case_id);
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, before_data, after_data, reason)
  values (actor_id, item.case_id, 'payment_schedule', p_schedule_id, 'installment_updated',
    jsonb_build_object('due_on', item.due_on, 'amount_kzt', item.amount_kzt, 'description', item.description),
    jsonb_build_object('due_on', p_due_on, 'amount_kzt', p_amount_kzt, 'description', nullif(trim(p_description), '')),
    trim(p_reason));
end;
$$;

create or replace function public.staff_void_payment(p_payment_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); item public.payments%rowtype; client_user_id uuid; target_case uuid;
begin
  select case_id into target_case from public.payments where id = p_payment_id;
  perform private.lock_financial_case(target_case);
  select * into item from public.payments where id = p_payment_id for update;
  if not found or actor_id is null or not private.can_manage_payments(item.case_id) then raise exception 'Not authorized'; end if;
  if item.status <> 'confirmed' or nullif(trim(p_reason), '') is null or length(p_reason) > 500 then
    raise exception 'Invalid void request';
  end if;
  update public.payments set status = 'void' where id = p_payment_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, before_data, after_data, reason)
  values (actor_id, item.case_id, 'payment', p_payment_id, 'voided',
    jsonb_build_object('status', 'confirmed', 'amount_kzt', item.amount_kzt),
    jsonb_build_object('status', 'void', 'amount_kzt', item.amount_kzt), trim(p_reason));
  select cl.user_id into client_user_id from public.cases c join public.clients cl on cl.id = c.client_id
    where c.id = item.case_id;
  if client_user_id is not null then
    insert into public.notifications (recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
    values (client_user_id, item.case_id, 'payment', 'Оплата исправлена',
      'Запись об оплате отменена. Уточните информацию у сотрудника.',
      '/account/cases/' || item.case_id::text || '/payments', 'payment-voided:' || p_payment_id::text)
    on conflict (recipient_user_id, dedupe_key) do nothing;
  end if;
end;
$$;

create or replace function public.staff_register_contract(
  p_case_id uuid, p_contract_number text, p_signed_on date, p_price_kzt numeric,
  p_storage_path text, p_content_sha256 text, p_size_bytes bigint
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  case_row public.cases%rowtype;
  existing public.contracts%rowtype;
  next_version integer;
  new_id uuid;
  clean_number text := nullif(trim(p_contract_number), '');
begin
  perform private.lock_financial_case(p_case_id);
  if clean_number is null or length(clean_number) > 120
    or p_price_kzt is null or p_price_kzt < 0 or p_price_kzt > 999999999999.99
    or p_price_kzt <> round(p_price_kzt, 2)
    or (p_signed_on is not null and p_signed_on > (now() at time zone 'Asia/Almaty')::date)
    or p_storage_path is null or p_storage_path !~ ('^contracts/' || p_case_id::text || '/[0-9a-f-]{36}\.pdf$')
    or p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-f]{64}$'
    or p_size_bytes is null or p_size_bytes not between 1 and 20971520 then
    raise exception 'Invalid contract';
  end if;
  select * into existing from public.contracts where storage_path = p_storage_path for update;
  if found then
    if existing.case_id = p_case_id and existing.contract_number = clean_number
      and existing.signed_on is not distinct from p_signed_on and existing.price_kzt = p_price_kzt
      and existing.content_sha256 = p_content_sha256 and existing.size_bytes = p_size_bytes then
      return existing.id;
    end if;
    raise exception 'Contract upload key reused';
  end if;
  if not exists (
    select 1 from storage.objects obj
    where obj.bucket_id = 'modernsecure-files' and obj.name = p_storage_path
      and (obj.metadata->>'size')::bigint = p_size_bytes
      and obj.metadata->>'mimetype' = 'application/pdf'
  ) then raise exception 'Contract file not found'; end if;
  select coalesce(max(version_no), 0) + 1 into next_version
    from public.contracts where case_id = p_case_id;
  insert into public.contracts (
    case_id, version_no, contract_number, signed_on, price_kzt,
    storage_path, created_by, content_sha256, size_bytes, detected_mime_type
  ) values (
    p_case_id, next_version, clean_number, p_signed_on, p_price_kzt,
    p_storage_path, actor_id, p_content_sha256, p_size_bytes, 'application/pdf'
  ) returning id into new_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
    values (actor_id, p_case_id, 'contract', new_id, 'uploaded',
      jsonb_build_object('version_no', next_version, 'contract_number', clean_number,
        'signed_on', p_signed_on, 'price_kzt', p_price_kzt, 'size_bytes', p_size_bytes,
        'content_sha256', p_content_sha256));
  return new_id;
end;
$$;

create or replace function public.client_register_payment_receipt(
  p_case_id uuid, p_storage_path text, p_original_name text,
  p_mime_type text, p_size_bytes bigint, p_content_sha256 text,
  p_idempotency_key uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  case_row public.cases%rowtype;
  existing public.payment_receipts%rowtype;
  receipt_id uuid;
  suffix text;
begin
  if actor_id is null then raise exception 'Not authorized'; end if;
  select * into case_row from public.cases where id = p_case_id for share;
  if not found then
    raise exception 'Case not found';
  end if;
  perform 1 from public.clients cl
    where cl.id = case_row.client_id and cl.user_id = actor_id for share;
  if not found then raise exception 'Not authorized'; end if;

  if p_idempotency_key is null or p_storage_path is null
    or p_storage_path !~ ('^receipts/' || p_case_id::text || '/' || actor_id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](pdf|jpg|png|heic|heif)$')
    or p_original_name is null or length(p_original_name) not between 1 and 180
    or p_original_name ~ '[[:cntrl:]/]' or position(chr(92) in p_original_name) > 0
    or p_original_name <> btrim(p_original_name)
    or p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif')
    or p_size_bytes is null or p_size_bytes not between 1 and 20971520
    or p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid receipt metadata';
  end if;
  suffix := lower(substring(p_storage_path from '[.][^.]+$'));
  if not ((p_mime_type = 'application/pdf' and suffix = '.pdf')
    or (p_mime_type = 'image/jpeg' and suffix = '.jpg')
    or (p_mime_type = 'image/png' and suffix = '.png')
    or (p_mime_type = 'image/heic' and suffix = '.heic')
    or (p_mime_type = 'image/heif' and suffix = '.heif')) then
    raise exception 'Receipt type does not match path';
  end if;

  select * into existing from public.payment_receipts
    where case_id = p_case_id and uploaded_by = actor_id and idempotency_key = p_idempotency_key
    for update;
  if found then
    if existing.storage_path = p_storage_path and existing.original_name = p_original_name
      and existing.detected_mime_type = p_mime_type and existing.size_bytes = p_size_bytes
      and existing.content_sha256 = p_content_sha256 then
      return existing.id;
    end if;
    raise exception 'Receipt upload key cannot be reused';
  end if;
  if not exists (
    select 1 from storage.objects obj
    where obj.bucket_id = 'modernsecure-files' and obj.name = p_storage_path
      and obj.metadata->>'size' ~ '^[0-9]+$'
      and (obj.metadata->>'size')::bigint = p_size_bytes
      and obj.metadata->>'mimetype' = p_mime_type
  ) then raise exception 'Receipt object not found or metadata mismatch'; end if;

  insert into public.payment_receipts (case_id, uploaded_by, storage_path,
    original_name, detected_mime_type, size_bytes, content_sha256, idempotency_key)
  values (p_case_id, actor_id, p_storage_path, p_original_name,
    p_mime_type, p_size_bytes, p_content_sha256, p_idempotency_key)
  returning id into receipt_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
  values (actor_id, p_case_id, 'payment_receipt', receipt_id, 'submitted',
    jsonb_build_object('storage_path', p_storage_path, 'size_bytes', p_size_bytes,
      'mime_type', p_mime_type, 'content_sha256', p_content_sha256));
  return receipt_id;
end;
$$;

create or replace function public.staff_review_payment_receipt(
  p_receipt_id uuid, p_accept boolean, p_note text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  item public.payment_receipts%rowtype;
  case_row public.cases%rowtype;
  member public.staff_members%rowtype;
  clean_note text := nullif(btrim(p_note), '');
  decision public.receipt_status; target_case uuid;
begin
  select case_id into target_case from public.payment_receipts where id = p_receipt_id;
  perform private.lock_financial_case(target_case);
  select * into item from public.payment_receipts where id = p_receipt_id for update;
  if not found then raise exception 'Receipt not found'; end if;
  if p_accept is null or clean_note is null or length(clean_note) > 1000 then
    raise exception 'Review note and decision are required';
  end if;
  decision := case when p_accept then 'accepted'::public.receipt_status
    else 'rejected'::public.receipt_status end;
  if item.status <> 'under_review' then
    if item.status = decision and item.reviewed_by = actor_id and item.review_note = clean_note then
      return;
    end if;
    raise exception 'Receipt already reviewed';
  end if;
  update public.payment_receipts set status = decision, review_note = clean_note,
    reviewed_by = actor_id, reviewed_at = clock_timestamp() where id = p_receipt_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action,
    before_data, after_data, reason)
  values (actor_id, item.case_id, 'payment_receipt', p_receipt_id,
    case when p_accept then 'accepted' else 'rejected' end,
    jsonb_build_object('status', 'under_review'),
    jsonb_build_object('status', decision, 'reviewed_by', actor_id), clean_note);
end;
$$;

create or replace function private.enqueue_payment_deadline_reminders(p_reference_day date default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare local_day date := coalesce(p_reference_day, (now() at time zone 'Asia/Almaty')::date); inserted_count integer;
begin
  insert into public.notifications(recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
  select cl.user_id, c.id, 'payment_deadline',
    case when s.due_on = local_day then 'Срок оплаты сегодня' else 'Срок оплаты завтра' end,
    'Остаток: ' || (s.amount_kzt - coalesce(p.paid, 0))::text || ' ₸. Откройте график платежей.',
    '/account/cases/' || c.id || '/payments',
    'payment-deadline:' || s.id || ':' || s.due_on || ':' || case when s.due_on = local_day then 'today' else 'tomorrow' end
  from public.payment_schedule s join public.cases c on c.id = s.case_id
  join public.clients cl on cl.id = c.client_id
  left join lateral (select private.installment_paid(s.id) as paid) p on true
  where s.due_on between local_day and local_day + 1 and s.cancelled_at is null
    and not exists (select 1 from public.payment_receipts r where r.case_id = c.id
      and (r.status = 'under_review' or (r.status = 'accepted' and not exists (
        select 1 from public.payments p2 where p2.receipt_id = r.id and p2.status = 'confirmed'))))
    and cl.user_id is not null and s.amount_kzt > coalesce(p.paid, 0)
  on conflict (recipient_user_id, dedupe_key) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

notify pgrst, 'reload schema';
-- END 20261018008700_payment_allocations_and_schedule_corrections.sql

-- BEGIN 20261018008800_temporary_direct_uploads.sql
-- Untrusted bytes land in a separate private bucket. Only checked server routes
-- copy validated files to permanent storage; signed upload URLs never target it.
insert into storage.buckets(id, name, public, file_size_limit)
values('modernsecure-staging', 'modernsecure-staging', false, 20971520);

create table public.temporary_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_path text not null,
  context jsonb not null,
  original_name text not null check(length(original_name) between 1 and 180),
  size_bytes bigint not null check(size_bytes between 1 and 20971520),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 hours'
);

create index temporary_uploads_owner_created_idx on public.temporary_uploads(user_id, created_at);

alter table public.temporary_uploads enable row level security;

revoke all on public.temporary_uploads from public, anon, authenticated;

grant select, insert, delete on public.temporary_uploads to service_role;

create policy staff_mfa_guard on public.temporary_uploads as restrictive for all to authenticated
  using((select private.staff_mfa_passed())) with check((select private.staff_mfa_passed()));

create function public.server_prepare_temporary_upload(p_user_id uuid, p_target_path text,
  p_context jsonb, p_name text, p_size bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare ticket_id uuid;
begin
  perform 1 from auth.users where id = p_user_id for update;
  if not found then raise exception 'User not found'; end if;
  if p_target_path not in ('/api/contracts', '/api/payment-receipts', '/api/document-uploads/file',
    '/api/message-attachments', '/api/staff-message-attachments') or p_target_path is null
    or p_context is null or jsonb_typeof(p_context) <> 'object' then raise exception 'Invalid upload target'; end if;
  if (select count(*) from public.temporary_uploads where user_id = p_user_id and created_at > now() - interval '1 day') >= 100
    then raise exception 'Upload rate limit exceeded'; end if;
  insert into public.temporary_uploads(user_id, target_path, context, original_name, size_bytes)
    values(p_user_id, p_target_path, p_context, p_name, p_size) returning id into ticket_id;
  return ticket_id;
end;
$$;

revoke all on function public.server_prepare_temporary_upload(uuid, text, jsonb, text, bigint) from public, anon, authenticated;

grant execute on function public.server_prepare_temporary_upload(uuid, text, jsonb, text, bigint) to service_role;

notify pgrst, 'reload schema';
-- END 20261018008800_temporary_direct_uploads.sql

-- BEGIN 20261027008900_primary_account_activation.sql
-- Registration creates an Auth user/profile only. A linked client card or a
-- staff membership is the approval record; existing accounts retain access.
-- Keep the audited legacy implementations private and guard every public path.
alter function public.admin_add_staff(text, text, public.staff_role) set schema private;
alter function public.admin_invite_staff(text, text, public.staff_role) set schema private;
alter function public.admin_set_staff_access(uuid, public.staff_role, boolean, text) set schema private;
alter function public.link_client_account(uuid, text) set schema private;
alter function public.admin_client_registrations(text, integer) set schema private;
alter function public.admin_approve_client_registration(uuid) set schema private;
revoke all on function private.admin_client_registrations(text, integer),
  private.admin_approve_client_registration(uuid) from public, anon, authenticated;
revoke all on function private.admin_add_staff(text, text, public.staff_role),
  private.admin_invite_staff(text, text, public.staff_role),
  private.admin_set_staff_access(uuid, public.staff_role, boolean, text),
  private.link_client_account(uuid, text) from public, anon, authenticated;

create function private.require_primary_account_admin()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_primary_admin() or not private.staff_mfa_passed() then
    raise exception 'Not authorized';
  end if;
end;
$$;
revoke all on function private.require_primary_account_admin() from public, anon, authenticated;

create function public.admin_add_staff(p_email text, p_display_name text, p_role public.staff_role)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_primary_account_admin();
  return private.admin_add_staff(p_email, p_display_name, p_role);
end;
$$;
create function public.admin_invite_staff(p_email text, p_display_name text, p_role public.staff_role)
returns text language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_primary_account_admin();
  return private.admin_invite_staff(p_email, p_display_name, p_role);
end;
$$;
create function public.admin_set_staff_access(p_staff_user_id uuid, p_role public.staff_role, p_active boolean, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_primary_account_admin();
  perform private.admin_set_staff_access(p_staff_user_id, p_role, p_active, p_reason);
end;
$$;
create function public.link_client_account(p_client_id uuid, p_email text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_primary_account_admin();
  perform private.link_client_account(p_client_id, p_email);
end;
$$;

create function public.admin_client_registrations(p_query text default '', p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_primary_account_admin();
  return private.admin_client_registrations(p_query, p_page);
end;
$$;
create function public.admin_approve_client_registration(p_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_primary_account_admin();
  if not exists(select 1 from auth.users where id = p_user_id and email_confirmed_at is not null) then
    raise exception 'Verified account not found';
  end if;
  return private.admin_approve_client_registration(p_user_id);
end;
$$;
revoke all on function public.admin_client_registrations(text, integer),
  public.admin_approve_client_registration(uuid) from public, anon;
grant execute on function public.admin_client_registrations(text, integer),
  public.admin_approve_client_registration(uuid) to authenticated;

-- An invitation is an invitation, never automatic account approval at login.
-- Preserve the RPC for old clients, but activation must be an explicit action.
create or replace function private.claim_staff_invite_for_user(p_user_id uuid)
returns boolean language sql security definer set search_path = '' as $$ select false $$;

create function public.account_access_status()
returns text language sql stable security definer set search_path = '' as $$
  select case
    when auth.uid() is null then 'anonymous'
    when exists (select 1 from public.staff_members where user_id = auth.uid()) then
      case when exists (select 1 from public.staff_members where user_id = auth.uid() and active)
        then 'approved' else 'disabled' end
    when exists (select 1 from public.clients where user_id = auth.uid()) then 'approved'
    else 'pending' end
$$;

create function public.admin_pending_accounts(p_offset integer default 0)
returns table(user_id uuid, email text, display_name text, registered_at timestamptz,
  email_verified boolean, total_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_primary_account_admin();
  return query select u.id, u.email::text, p.display_name, p.created_at,
    u.email_confirmed_at is not null, count(*) over ()
  from auth.users u left join public.profiles p on p.user_id = u.id
  where not exists (select 1 from public.staff_members s where s.user_id = u.id)
    and not exists (select 1 from public.clients c where c.user_id = u.id)
  order by p.created_at desc nulls last, u.id
  limit 25 offset greatest(0, least(coalesce(p_offset, 0), 100000));
end;
$$;

create function public.admin_approve_account(p_user_id uuid, p_role text, p_display_name text, p_client_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  target_email text;
  client_id uuid := p_client_id;
  clean_name text := nullif(trim(p_display_name), '');
begin
  perform private.require_primary_account_admin();
  if p_user_id is null or p_role is null or p_role not in ('client', 'lawyer', 'manager', 'admin')
    or clean_name is null or length(clean_name) > 160 or (p_role <> 'client' and p_client_id is not null) then
    raise exception 'Invalid account approval';
  end if;
  -- Serializes approvals and the existing exclusivity triggers on this user.
  select u.email into target_email from auth.users u
    where u.id = p_user_id and u.email_confirmed_at is not null for update;
  if target_email is null then raise exception 'Verified account not found'; end if;
  if exists (select 1 from public.staff_members where user_id = p_user_id)
    or exists (select 1 from public.clients where user_id = p_user_id) then
    raise exception 'Account already assigned';
  end if;
  if p_role = 'client' then
    if client_id is null then
      client_id := public.staff_create_client(clean_name, target_email, null, null);
    end if;
    perform public.link_client_account(client_id, target_email);
  else
    perform public.admin_add_staff(target_email, clean_name, p_role::public.staff_role);
  end if;
  update public.staff_invites set status = 'cancelled', updated_at = now()
    where email = lower(target_email) and status = 'pending';
  insert into public.audit_events(actor_user_id, entity_type, entity_id, action, after_data)
    values(auth.uid(), 'account', p_user_id, 'approved', jsonb_build_object('role', p_role, 'client_id', client_id));
end;
$$;

revoke all on function public.admin_add_staff(text, text, public.staff_role),
  public.admin_invite_staff(text, text, public.staff_role),
  public.admin_set_staff_access(uuid, public.staff_role, boolean, text),
  public.link_client_account(uuid, text), public.account_access_status(),
  public.admin_pending_accounts(integer), public.admin_approve_account(uuid, text, text, uuid)
  from public, anon;
grant execute on function public.admin_add_staff(text, text, public.staff_role),
  public.admin_invite_staff(text, text, public.staff_role),
  public.admin_set_staff_access(uuid, public.staff_role, boolean, text),
  public.link_client_account(uuid, text), public.account_access_status(),
  public.admin_pending_accounts(integer), public.admin_approve_account(uuid, text, text, uuid)
  to authenticated;

-- PostgREST also covers security-definer RPCs, which bypass table RLS.
create or replace function public.enforce_staff_mfa_request()
returns void language plpgsql stable security definer set search_path = '' as $$
declare request_path text := trim(both '/' from coalesce(current_setting('request.path', true), ''));
begin
  if auth.jwt()->>'role' = 'service_role' then return; end if;
  if request_path in ('rpc/staff_mfa_status', 'rpc/claim_staff_invite', 'rpc/account_access_status') then return; end if;
  if auth.uid() is not null and public.account_access_status() = 'pending'
    and request_path not in ('contact_settings', 'faq_entries', 'legal_documents') then
    raise sqlstate 'PGRST' using
      message = '{"code":"ACCOUNT_PENDING","message":"Account approval is required"}',
      detail = '{"status":403,"headers":{}}';
  end if;
  if private.staff_mfa_passed() then return; end if;
  raise sqlstate 'PGRST' using
    message = '{"code":"MFA_REQUIRED","message":"Complete staff two-factor authentication"}',
    detail = '{"status":403,"headers":{}}';
end;
$$;

notify pgrst, 'reload schema';
-- END 20261027008900_primary_account_activation.sql

-- BEGIN 20261027009000_mobile_push.sql
-- Tokens are server-only. Every device belongs to an authenticated session;
-- deliveries are checked again against current account/case access at dispatch.
create table public.push_devices (
  id uuid primary key,
  secret_hash bytea not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  token text not null unique check(length(token) between 20 and 4096),
  platform text not null check(platform in ('android','ios')),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
create table public.push_outbox (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  device_id uuid not null references public.push_devices(id) on delete cascade,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_id uuid,
  completed_at timestamptz,
  last_error text,
  unique(notification_id, device_id)
);
create index push_outbox_due on public.push_outbox(next_attempt_at) where completed_at is null;
alter table public.push_devices enable row level security;
alter table public.push_outbox enable row level security;
revoke all on public.push_devices, public.push_outbox from public, anon, authenticated;
grant select, insert, update, delete on public.push_devices, public.push_outbox to service_role;

create function public.register_push_device(p_id uuid, p_secret uuid, p_token text, p_platform text)
returns void language plpgsql security definer set search_path = '' as $$
declare session uuid := nullif(auth.jwt()->>'session_id','')::uuid;
begin
  if auth.uid() is null or public.account_access_status() <> 'approved' or not private.staff_mfa_passed()
    or session is null or not exists(select 1 from auth.sessions where id=session and user_id=auth.uid() and (not_after is null or not_after>now())) then
    raise exception 'Not authorized';
  end if;
  if p_id is null or p_secret is null or p_platform is null or p_platform not in ('android','ios')
    or p_token is null or length(p_token) not between 20 and 4096 then raise exception 'Invalid device'; end if;
  perform 1 from auth.users where id=auth.uid() for update;
  if (select count(*) from public.push_devices where user_id=auth.uid() and id<>p_id) >= 20 then raise exception 'Too many devices'; end if;
  insert into public.push_devices(id,secret_hash,user_id,session_id,token,platform)
    values(p_id,extensions.digest(p_secret::text,'sha256'),auth.uid(),session,p_token,p_platform)
  on conflict(id) do update set user_id=excluded.user_id,session_id=excluded.session_id,token=excluded.token,
    platform=excluded.platform,enabled=true,updated_at=now()
    where public.push_devices.secret_hash=excluded.secret_hash;
  if not found then raise exception 'Invalid installation secret'; end if;
end;
$$;
create function public.unregister_push_session()
returns void language sql security definer set search_path = '' as $$
  update public.push_devices set enabled=false,updated_at=now()
    where user_id=auth.uid() and session_id=nullif(auth.jwt()->>'session_id','')::uuid
$$;
revoke all on function public.register_push_device(uuid,uuid,text,text),public.unregister_push_session() from public,anon;
grant execute on function public.register_push_device(uuid,uuid,text,text),public.unregister_push_session() to authenticated;

create function private.enqueue_mobile_push()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.push_outbox(notification_id,device_id)
    select new.id,d.id from public.push_devices d where d.user_id=new.recipient_user_id and d.enabled
    on conflict do nothing;
  return new;
end;
$$;
revoke all on function private.enqueue_mobile_push() from public,anon,authenticated;
create trigger modernsecure_push_notification after insert on public.notifications
  for each row execute function private.enqueue_mobile_push();

create function private.push_recipient_allowed(p_user uuid,p_case uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.staff_members s where s.user_id=p_user and s.active
    and (p_case is null or s.role='admin' or exists(select 1 from public.case_assignments a
      where a.case_id=p_case and a.staff_user_id=p_user and a.revoked_at is null)))
    or exists(select 1 from public.clients c where c.user_id=p_user
      and (p_case is null or exists(select 1 from public.cases k where k.id=p_case and k.client_id=c.id)))
$$;
revoke all on function private.push_recipient_allowed(uuid,uuid) from public,anon,authenticated;

create function public.claim_push_batch(p_limit integer default 50)
returns table(id uuid,lease_id uuid,notification_id uuid,token text,platform text)
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.push_outbox where completed_at < now()-interval '7 days';
  update public.push_outbox set completed_at=now(),last_error='exhausted'
    where completed_at is null and next_attempt_at<=now() and attempts>=6;
  -- Discard work whose recipient changed, signed out, read it, or lost access.
  update public.push_outbox q set completed_at=now(),last_error='ineligible'
  where q.completed_at is null and q.next_attempt_at<=now() and not exists(
    select 1 from public.push_devices d join public.notifications n on n.id=q.notification_id
    join auth.sessions s on s.id=d.session_id and s.user_id=d.user_id
    where d.id=q.device_id and d.enabled and d.user_id=n.recipient_user_id and n.read_at is null
      and (s.not_after is null or s.not_after>now())
      and private.push_recipient_allowed(d.user_id,n.case_id));
  return query with picked as (
    select q.id from public.push_outbox q where q.completed_at is null and q.next_attempt_at<=now() and q.attempts<6
    order by q.next_attempt_at,q.id limit greatest(1,least(coalesce(p_limit,50),100)) for update skip locked
  ), claimed as (
    update public.push_outbox q set attempts=q.attempts+1,lease_id=gen_random_uuid(),next_attempt_at=now()+interval '2 minutes'
    from picked p where q.id=p.id returning q.*
  ) select q.id,q.lease_id,q.notification_id,d.token,d.platform from claimed q join public.push_devices d on d.id=q.device_id;
end;
$$;
create function public.finish_push_delivery(p_id uuid,p_lease uuid,p_result text)
returns void language plpgsql security definer set search_path = '' as $$
declare item public.push_outbox%rowtype;
begin
  if p_result is null or p_result not in ('sent','retry','invalid_token','failed') then raise exception 'Invalid result'; end if;
  select * into item from public.push_outbox where id=p_id and lease_id=p_lease and completed_at is null for update;
  if not found then return; end if;
  update public.push_outbox set completed_at=case when p_result<>'retry' or attempts>=6 then now() else null end,
    last_error=case when p_result='sent' then null else p_result end,
    next_attempt_at=now()+make_interval(secs=>least(3600,30*(2^attempts)::integer)),lease_id=null where id=p_id;
  if p_result='invalid_token' then
    -- Do not disable a token refreshed while a delivery was in flight.
    update public.push_devices set enabled=false where id=item.device_id and updated_at < item.next_attempt_at-interval '2 minutes';
  end if;
end;
$$;
revoke all on function public.claim_push_batch(integer),public.finish_push_delivery(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_push_batch(integer),public.finish_push_delivery(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
-- END 20261027009000_mobile_push.sql

-- BEGIN 20261028009100_admin_account_activation.sql
-- Administrators activate clients, lawyers and managers. Only the primary
-- administrator can appoint or manage administrators. Invitations never grant
-- access automatically, and all entry points retain the MFA requirement.
create function private.require_account_admin(p_role text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if private.staff_role_for_current_user() is distinct from 'admin'
    or not private.staff_mfa_passed()
    or (p_role = 'admin' and not private.is_primary_admin()) then
    raise exception 'Not authorized';
  end if;
end;
$$;
revoke all on function private.require_account_admin(text) from public, anon, authenticated;

create function private.require_account_assignment(p_email text, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_account_admin(p_role);
  perform pg_advisory_xact_lock(hashtextextended(lower(trim(p_email)), 0));
  if not private.is_primary_admin() and exists (
    select 1 from public.staff_invites where email = lower(trim(p_email))
      and status = 'pending' and role = 'admin'
  ) then raise exception 'Protected administrator'; end if;
end;
$$;
revoke all on function private.require_account_assignment(text, text) from public, anon, authenticated;

create or replace function public.admin_add_staff(p_email text, p_display_name text, p_role public.staff_role)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_account_assignment(p_email, p_role::text);
  return private.admin_add_staff(p_email, p_display_name, p_role);
end;
$$;
create or replace function public.admin_invite_staff(p_email text, p_display_name text, p_role public.staff_role)
returns text language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_account_assignment(p_email, p_role::text);
  return private.admin_invite_staff(p_email, p_display_name, p_role);
end;
$$;
create or replace function public.admin_set_staff_access(p_staff_user_id uuid, p_role public.staff_role, p_active boolean, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_account_admin(p_role::text);
  -- The audited implementation locks the target and rejects primary, self,
  -- and ordinary-admin attempts to modify an administrator.
  perform private.admin_set_staff_access(p_staff_user_id, p_role, p_active, p_reason);
end;
$$;
create or replace function public.link_client_account(p_client_id uuid, p_email text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_account_assignment(p_email, 'client');
  perform private.link_client_account(p_client_id, p_email);
end;
$$;
create or replace function public.admin_client_registrations(p_query text default '', p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_account_admin();
  return private.admin_client_registrations(p_query, p_page);
end;
$$;
create or replace function public.admin_approve_client_registration(p_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare target_email text;
begin
  perform private.require_account_admin('client');
  select email into target_email from auth.users where id=p_user_id and email_confirmed_at is not null;
  if target_email is null then raise exception 'Verified account not found'; end if;
  perform private.require_account_assignment(target_email,'client');
  return private.admin_approve_client_registration(p_user_id);
end;
$$;

create or replace function public.admin_pending_accounts(p_offset integer default 0)
returns table(user_id uuid, email text, display_name text, registered_at timestamptz,
  email_verified boolean, total_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_account_admin();
  return query select u.id, u.email::text, p.display_name, p.created_at,
    u.email_confirmed_at is not null, count(*) over ()
  from auth.users u left join public.profiles p on p.user_id = u.id
  where not exists (select 1 from public.staff_members s where s.user_id = u.id)
    and not exists (select 1 from public.clients c where c.user_id = u.id)
  order by p.created_at desc nulls last, u.id
  limit 25 offset greatest(0, least(coalesce(p_offset, 0), 100000));
end;
$$;

create function public.admin_pending_account_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform private.require_account_admin();
  select jsonb_build_object('total_count', count(*), 'ready_count', count(*) filter (where u.email_confirmed_at is not null))
    into result from auth.users u
    where not exists(select 1 from public.staff_members s where s.user_id=u.id)
      and not exists(select 1 from public.clients c where c.user_id=u.id);
  return result;
end;
$$;

-- Return counts and the clamped page together, even when the requested page
-- disappeared after an approval. Preserve the invitation's intended role/name.
create function public.admin_pending_account_page(p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform private.require_account_admin();
  with pending as (
    select u.id as user_id, u.email::text, coalesce(p.full_name, p.display_name, i.display_name) as display_name,
      p.created_at as registered_at, u.email_confirmed_at is not null as email_verified,
      i.role::text as suggested_role, i.display_name as invited_name,
      (i.role is distinct from 'admin' or private.is_primary_admin()) as can_approve
    from auth.users u left join public.profiles p on p.user_id=u.id
      left join public.staff_invites i on i.email=lower(u.email) and i.status='pending'
    where not exists(select 1 from public.staff_members s where s.user_id=u.id)
      and not exists(select 1 from public.clients c where c.user_id=u.id)
  ), totals as (
    select count(*) as total_count, count(*) filter(where email_verified) as ready_count,
      least(greatest(coalesce(p_page,1),1), greatest(1,ceil(count(*)/25.0)::integer)) as page from pending
  ), items as (
    select * from pending order by registered_at desc nulls last,user_id
    limit 25 offset ((select page from totals)-1)*25
  )
  select jsonb_build_object('total_count',t.total_count,'ready_count',t.ready_count,'page',t.page,
    'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.registered_at desc nulls last,i.user_id) from items i),'[]'::jsonb))
    into result from totals t;
  return result;
end;
$$;
revoke all on function public.admin_pending_account_summary(),public.admin_pending_account_page(integer) from public,anon;
grant execute on function public.admin_pending_account_summary(),public.admin_pending_account_page(integer) to authenticated;

create or replace function public.admin_approve_account(p_user_id uuid, p_role text, p_display_name text, p_client_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare target_email text; client_id uuid := p_client_id; clean_name text := nullif(trim(p_display_name), '');
begin
  perform private.require_account_admin(p_role);
  if p_user_id is null or p_role is null or p_role not in ('client','lawyer','manager','admin')
    or clean_name is null or length(clean_name)>160 or (p_role<>'client' and p_client_id is not null) then
    raise exception 'Invalid account approval';
  end if;
  select u.email into target_email from auth.users u where u.id=p_user_id and u.email_confirmed_at is not null;
  if target_email is null then raise exception 'Verified account not found'; end if;
  perform private.require_account_assignment(target_email,p_role);
  -- Match the email/invitation lock order of the other account entry points.
  perform 1 from auth.users where id=p_user_id and email=target_email and email_confirmed_at is not null for update;
  if not found then raise exception 'Verified account not found'; end if;
  if exists(select 1 from public.staff_members where user_id=p_user_id)
    or exists(select 1 from public.clients where user_id=p_user_id) then
    raise exception 'Account already assigned';
  end if;
  if p_role='client' then
    if client_id is null then client_id:=public.staff_create_client(clean_name,target_email,null,null); end if;
    perform public.link_client_account(client_id,target_email);
  else
    perform public.admin_add_staff(target_email,clean_name,p_role::public.staff_role);
  end if;
  update public.staff_invites set status='cancelled',updated_at=now() where email=lower(target_email) and status='pending';
  insert into public.audit_events(actor_user_id,entity_type,entity_id,action,after_data)
    values(auth.uid(),'account',p_user_id,'approved',jsonb_build_object('role',p_role,'client_id',client_id));
end;
$$;

-- In-app notifications only. Existing registrations are discovered by the
-- live queue/count; do not backfill notifications or change existing access.
create function private.notify_account_registration()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is null or exists(select 1 from public.staff_members where user_id=new.id)
    or exists(select 1 from public.clients where user_id=new.id) then return new; end if;
  insert into public.notifications(recipient_user_id,kind,title,body,target_path,dedupe_key)
    select s.user_id,'account_registration','Новая заявка на доступ','Пользователь подтвердил email. Проверьте заявку и назначьте роль.',
      '/staff/team?tab=pending','account-registration:'||new.id::text
    from public.staff_members s where s.active and s.role='admin'
    on conflict(recipient_user_id,dedupe_key) do nothing;
  return new;
end;
$$;
revoke all on function private.notify_account_registration() from public,anon,authenticated;
create trigger modernsecure_account_registration_notify after insert or update of email_confirmed_at on auth.users
  for each row execute function private.notify_account_registration();

-- Cover explicit legacy staff/client activation entry points as well as the
-- unified approval RPC. No notification is sent for an unlinked client card.
create function private.notify_account_activation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is null then return new; end if;
  if tg_table_name='staff_members' then
    if not new.active then return new; end if;
  end if;
  insert into public.notifications(recipient_user_id,kind,title,body,target_path,dedupe_key)
    values(new.user_id,'account_approved','Доступ к кабинету открыт','Аккаунт активирован. Можно приступать к работе.',
      case when tg_table_name='staff_members' then '/staff' else '/account' end,'account-approved:'||new.user_id::text)
    on conflict(recipient_user_id,dedupe_key) do nothing;
  update public.notifications set read_at=coalesce(read_at,now()) where kind='account_registration' and dedupe_key='account-registration:'||new.user_id::text;
  return new;
end;
$$;
revoke all on function private.notify_account_activation() from public,anon,authenticated;
create trigger modernsecure_client_activation_notify after insert or update of user_id on public.clients
  for each row execute function private.notify_account_activation();
create trigger modernsecure_staff_activation_notify after insert on public.staff_members
  for each row execute function private.notify_account_activation();

notify pgrst,'reload schema';
-- END 20261028009100_admin_account_activation.sql

-- BEGIN 20261028009200_case_recovery_and_cancellation.sql
-- Each closure has its own event key, including closure after restoration.
create or replace function public.staff_close_document_request(p_request_id uuid, p_status public.document_request_status, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare item public.document_requests%rowtype; target_case uuid; recipient uuid; clean_reason text := nullif(trim(p_reason), ''); event_id bigint;
begin
  select case_id into target_case from public.document_requests where id = p_request_id;
  if not private.staff_mfa_passed() or not private.lock_legal_case_editor(target_case) then raise exception 'Not authorized'; end if;
  perform 1 from public.cases where id = target_case and status = 'open' for update;
  if not found then raise exception 'Case is not active'; end if;
  select * into item from public.document_requests where id = p_request_id for update;
  if not found or item.status <> 'active' then raise exception 'Request changed'; end if;
  if p_status is null or p_status not in ('cancelled', 'not_required') or clean_reason is null or length(clean_reason) > 1000 then raise exception 'Reason is required'; end if;
  update public.document_requests set status = p_status, closure_reason = clean_reason, updated_at = clock_timestamp() where id = p_request_id;
  insert into public.audit_events(actor_user_id, case_id, entity_type, entity_id, action, reason, after_data)
    values(auth.uid(), target_case, 'document_request', p_request_id, 'closed', clean_reason, jsonb_build_object('status', p_status)) returning id into event_id;
  select cl.user_id into recipient from public.clients cl join public.cases c on c.client_id = cl.id where c.id = target_case;
  if recipient is not null then
    insert into public.notifications(recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
      values(recipient, target_case, 'document_request_closed', case when p_status = 'not_required' then 'Документ больше не требуется: ' else 'Запрос документа отменён: ' end || item.title, clean_reason,
        '/account/cases/' || target_case || '/documents#request-' || p_request_id, 'document-request-closed:' || p_request_id || ':' || event_id);
  end if;
end; $$;
revoke all on function public.staff_close_document_request(uuid, public.document_request_status, text) from public, anon;
grant execute on function public.staff_close_document_request(uuid, public.document_request_status, text) to authenticated;

-- A cancelled required checklist item must not strand its case permanently.
-- Restore the original template link; the existing reasoned waiver remains available.
create function public.staff_reopen_template_document_request(p_request_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare item public.document_requests%rowtype; target_case uuid; recipient uuid;
  clean_reason text := nullif(trim(p_reason), ''); event_id bigint;
begin
  select case_id into target_case from public.document_requests where id = p_request_id;
  if not private.staff_mfa_passed() or not private.lock_legal_case_editor(target_case) then
    raise exception 'Not authorized';
  end if;
  perform 1 from public.cases where id = target_case and status = 'open' and not is_suspended for update;
  if not found then raise exception 'Case is not active'; end if;
  select * into item from public.document_requests where id = p_request_id for update;
  if not found or item.status <> 'cancelled' or not exists (
    select 1 from public.document_templates dt where dt.id = item.template_id and dt.required
  ) then raise exception 'Request cannot be restored'; end if;
  if clean_reason is null or length(clean_reason) > 1000 then raise exception 'Reason is required'; end if;
  update public.document_requests set status = 'active', closure_reason = null,
    updated_at = clock_timestamp() where id = p_request_id;
  insert into public.audit_events(actor_user_id, case_id, entity_type, entity_id, action, reason, before_data, after_data)
    values(auth.uid(), target_case, 'document_request', p_request_id, 'reopened', clean_reason,
      jsonb_build_object('status', item.status, 'closure_reason', item.closure_reason),
      jsonb_build_object('status', 'active')) returning id into event_id;
  select cl.user_id into recipient from public.clients cl join public.cases c on c.client_id = cl.id where c.id = target_case;
  if recipient is not null then
    insert into public.notifications(recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
      values(recipient, target_case, 'document_request', 'Запрос документа восстановлен: ' || item.title,
        clean_reason, '/account/cases/' || target_case || '/documents#request-' || p_request_id,
        'document-request-reopened:' || event_id);
  end if;
end; $$;
revoke all on function public.staff_reopen_template_document_request(uuid, text) from public, anon;
grant execute on function public.staff_reopen_template_document_request(uuid, text) to authenticated;

-- Cancellation records why work stopped without asserting a successful outcome.
-- Completed work and financial records remain in the case history.
create function public.staff_cancel_case(p_case_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare item public.cases%rowtype; request record; task record; suspension record;
  actor_id uuid := auth.uid(); recipient uuid; clean_reason text := nullif(trim(p_reason), '');
begin
  if not private.staff_mfa_passed() or not private.lock_legal_case_editor(p_case_id) then
    raise exception 'Not authorized';
  end if;
  select * into item from public.cases where id = p_case_id for update;
  if not found or item.status <> 'open' then raise exception 'Case cannot be cancelled'; end if;
  if clean_reason is null or length(clean_reason) > 2000 then raise exception 'Reason is required'; end if;
  for request in select dr.id from public.document_requests dr
    where dr.case_id = p_case_id and dr.status = 'active'
      and private.document_request_current_state(dr.id) <> 'accepted' for update loop
    update public.document_requests set status = 'cancelled', closure_reason = clean_reason,
      updated_at = clock_timestamp() where id = request.id;
    insert into public.audit_events(actor_user_id, case_id, entity_type, entity_id, action, reason)
      values(actor_id, p_case_id, 'document_request', request.id, 'cancelled_on_case_cancel', clean_reason);
  end loop;
  -- Linked document tasks have already followed their requests through the trigger.
  for task in select id, status from public.tasks
    where case_id = p_case_id and status in ('new', 'response_sent') for update loop
    update public.tasks set status = 'cancelled', updated_at = clock_timestamp() where id = task.id;
    insert into public.task_events(task_id, actor_user_id, action, response_text)
      values(task.id, actor_id, 'cancelled', 'Дело отменено: ' || clean_reason);
    insert into public.audit_events(actor_user_id, case_id, entity_type, entity_id, action, before_data, after_data, reason)
      values(actor_id, p_case_id, 'task', task.id, 'cancelled_on_case_cancel',
        jsonb_build_object('status', task.status), jsonb_build_object('status', 'cancelled'), clean_reason);
  end loop;
  for suspension in select id, started_at from public.case_suspensions
    where case_id = p_case_id and ended_at is null for update loop
    update public.case_suspensions set ended_by = actor_id,
      ended_at = greatest(clock_timestamp(), suspension.started_at) where id = suspension.id;
    insert into public.audit_events(actor_user_id, case_id, entity_type, entity_id, action, reason)
      values(actor_id, p_case_id, 'case_suspension', suspension.id, 'ended', 'Дело отменено: ' || clean_reason);
  end loop;
  update public.cases set status = 'cancelled', is_suspended = false, next_review_at = null,
    result_summary = clean_reason, closed_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = p_case_id;
  insert into public.audit_events(actor_user_id, case_id, entity_type, entity_id, action, reason, before_data, after_data)
    values(actor_id, p_case_id, 'case', p_case_id, 'cancelled', clean_reason,
      jsonb_build_object('status', item.status, 'is_suspended', item.is_suspended),
      jsonb_build_object('status', 'cancelled'));
  select user_id into recipient from public.clients where id = item.client_id;
  if recipient is not null then
    insert into public.notifications(recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
      values(recipient, p_case_id, 'case_status', 'Дело отменено', clean_reason,
        '/account/cases/' || p_case_id, 'case-cancelled:' || p_case_id);
  end if;
end; $$;
revoke all on function public.staff_cancel_case(uuid, text) from public, anon;
grant execute on function public.staff_cancel_case(uuid, text) to authenticated;

-- Work queues count only decisions staff can actually perform.
create or replace function public.staff_case_worklist(
  p_query text default '',
  p_status text default 'all',
  p_attention text default 'all',
  p_staff uuid default null,
  p_service uuid default null,
  p_stage uuid default null,
  p_client uuid default null,
  p_page integer default 1,
  p_sort text default 'activity'
)
returns table (
  case_id uuid, case_number text, title text, client_name text,
  status public.case_status, is_suspended boolean, stage_name text,
  service_name text, updated_at timestamptz, last_message_at timestamptz,
  last_message_body text, unread_count bigint, overdue_count bigint,
  review_count bigint, total_count bigint
)
language plpgsql stable security definer set search_path = '' as $$
declare
  viewer_id uuid := auth.uid();
  viewer_role public.staff_role := private.staff_role_for_current_user();
  clean_query text := lower(trim(coalesce(p_query, '')));
begin
  if viewer_role is null or viewer_id is null then
    raise exception 'Not authorized';
  end if;
  if length(clean_query) > 120 or p_page is null or p_page not between 1 and 10000
    or p_status is null or p_status not in ('all', 'open', 'closed', 'suspended', 'cancelled')
    or p_attention is null or p_attention not in ('all', 'unread', 'overdue', 'documents', 'messages')
    or p_sort is null or p_sort not in ('activity', 'message') then
    raise exception 'Invalid worklist filter';
  end if;

  return query
    with visible as (
      select c.id, c.case_number, c.title, cl.full_name,
        c.status, c.is_suspended, st.title as stage_title,
        sv.name as service_title, c.updated_at
      from public.cases c
      join public.clients cl on cl.id = c.client_id
      join public.service_template_versions v on v.id = c.service_version_id
      join public.service_templates sv on sv.id = v.service_id
      left join public.stage_templates st on st.id = c.current_stage_id
      where (viewer_role = 'admin' or exists (
        select 1 from public.case_assignments ca
        where ca.case_id = c.id and ca.staff_user_id = viewer_id and ca.revoked_at is null
      ))
        and (p_staff is null or exists (
          select 1 from public.case_assignments ca
          join public.staff_members sm on sm.user_id = ca.staff_user_id
          where ca.case_id = c.id and ca.staff_user_id = p_staff
            and ca.revoked_at is null and sm.active
        ))
        and (p_service is null or sv.id = p_service)
        and (p_stage is null or c.current_stage_id = p_stage)
        and (p_client is null or c.client_id = p_client)
        and (p_status = 'all'
          or (p_status = 'open' and c.status = 'open' and not c.is_suspended)
          or (p_status = 'closed' and c.status = 'closed')
          or (p_status = 'cancelled' and c.status = 'cancelled')
          or (p_status = 'suspended' and c.status = 'open' and c.is_suspended))
        and (clean_query = ''
          or position(clean_query in lower(c.case_number)) > 0
          or position(clean_query in lower(c.title)) > 0
          or position(clean_query in lower(cl.full_name)) > 0
          or exists (
            select 1 from public.contracts ct
            where ct.case_id = c.id and position(clean_query in lower(ct.contract_number)) > 0
          ))
    ), enriched as (
      select v.*, latest.created_at as latest_at,
        latest.preview as latest_body,
        coalesce(unread.items, 0)::bigint as unread_items,
        coalesce(overdue.items, 0)::bigint as overdue_items,
        coalesce(reviews.items, 0)::bigint as review_items
      from visible v
      left join lateral (
        select m.created_at,
          coalesce(nullif(left(trim(m.body), 160), ''), 'Вложение') as preview
        from public.messages m where m.case_id = v.id
        order by m.created_at desc, m.id desc limit 1
      ) latest on true
      left join lateral (
        select count(*) as items from public.messages m
        where m.case_id = v.id and m.sender_user_id <> viewer_id
          and not exists (
            select 1 from public.message_reads mr
            where mr.message_id = m.id and mr.reader_user_id = viewer_id
          )
      ) unread on true
      left join lateral (
        select count(*) as items from public.tasks t
        where t.case_id = v.id and t.status = 'new' and t.due_at < now()
          and v.status = 'open' and not v.is_suspended
      ) overdue on true
      left join lateral (
        select count(*) as items from public.document_requests dr
        join public.document_files df on df.request_id = dr.id
        where dr.case_id = v.id and df.status = 'under_review'
          and dr.status = 'active' and v.status = 'open' and not v.is_suspended
      ) reviews on true
    )
    select e.id, e.case_number, e.title, e.full_name, e.status, e.is_suspended,
      e.stage_title, e.service_title, e.updated_at, e.latest_at, e.latest_body,
      e.unread_items, e.overdue_items, e.review_items, count(*) over ()
    from enriched e
    where p_attention = 'all'
      or (p_attention = 'unread' and e.unread_items > 0)
      or (p_attention = 'overdue' and e.overdue_items > 0)
      or (p_attention = 'documents' and e.review_items > 0)
      or (p_attention = 'messages' and e.latest_at is not null)
    order by
      case when p_sort = 'message' then e.latest_at else e.updated_at end desc nulls last,
      e.id desc
    limit 25 offset (p_page - 1) * 25;
end;
$$;

revoke all on function public.staff_case_worklist(text, text, text, uuid, uuid, uuid, uuid, integer, text) from public, anon;
grant execute on function public.staff_case_worklist(text, text, text, uuid, uuid, uuid, uuid, integer, text) to authenticated;

-- A decision must refer to the exact response the reviewer saw. Status alone
-- cannot distinguish response A from response B after a return/resubmission.
alter table public.tasks add column response_event_id uuid references public.task_events(id) on delete restrict;
update public.tasks t set response_event_id = (
  select e.id from public.task_events e where e.task_id = t.id and e.action in ('responded', 'acknowledged')
  order by e.occurred_at desc, e.id desc limit 1
);
create function private.capture_task_response_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.tasks set response_event_id = new.id where id = new.task_id;
  return new;
end; $$;
revoke all on function private.capture_task_response_revision() from public, anon, authenticated;
create trigger modernsecure_task_response_revision after insert on public.task_events
for each row when (new.action in ('responded', 'acknowledged'))
execute function private.capture_task_response_revision();

revoke all on function public.staff_review_task(uuid, boolean, text) from public, anon, authenticated;
create function public.staff_review_task(p_task_id uuid, p_expected_response_id uuid, p_accept boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare target_case uuid; item public.tasks%rowtype;
begin
  if p_accept is null then raise exception 'Task review decision is required'; end if;
  select case_id into target_case from public.tasks where id = p_task_id;
  if not private.staff_mfa_passed() or not private.lock_legal_case_editor(target_case) then
    raise exception 'Not authorized';
  end if;
  perform 1 from public.cases where id = target_case and status = 'open' and not is_suspended for update;
  if not found then raise exception 'Case is not active'; end if;
  select * into item from public.tasks where id = p_task_id for update;
  if not found or item.status <> 'response_sent' or p_expected_response_id is null
    or item.response_event_id is distinct from p_expected_response_id then
    raise exception 'Task response changed';
  end if;
  perform private.staff_review_task(p_task_id, p_accept, p_note);
end; $$;
revoke all on function public.staff_review_task(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.staff_review_task(uuid, uuid, boolean, text) to authenticated;

notify pgrst, 'reload schema';
-- END 20261028009200_case_recovery_and_cancellation.sql

-- BEGIN 20261028009300_active_financial_case_guard.sql
-- Keep the active-case rule inside the common lock, including direct RPC calls.
-- The row lock serializes these checks with suspension, closure and cancellation.
create or replace function private.lock_financial_case(p_case_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare item public.cases%rowtype;
begin
  perform 1 from public.staff_members where user_id = auth.uid() for share;
  perform 1 from public.case_assignments
    where case_id = p_case_id and staff_user_id = auth.uid() and revoked_at is null for share;
  if auth.uid() is null or not private.staff_mfa_passed() or not private.can_manage_payments(p_case_id) then
    raise exception 'Not authorized';
  end if;
  select * into item from public.cases where id = p_case_id for update;
  if not found then raise exception 'Case not found'; end if;
  if item.status <> 'open' or item.is_suspended then raise exception 'Case is not active'; end if;
end;
$$;

revoke all on function private.lock_financial_case(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
-- END 20261028009300_active_financial_case_guard.sql

-- BEGIN 20261028009400_staff_message_append_order.sql
-- Timestamp/UUID cursors require append order to be monotonic. Transaction
-- start now() plus random UUIDs can hide a later arrival behind a read cursor.
-- All staff text, attachment and case-reference sends use this central RPC.
create or replace function public.staff_send_message(p_thread_id uuid, p_body text, p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); thread_row public.staff_threads%rowtype;
  recipient_id uuid; result_id uuid; prior_body text; clean_body text := btrim(p_body);
  latest_time timestamptz; message_time timestamptz;
begin
  if actor_id is null or p_thread_id is null or p_idempotency_key is null
    or clean_body is null or length(clean_body) not between 1 and 4000 then
    raise exception 'Invalid message';
  end if;
  select * into thread_row from public.staff_threads where id = p_thread_id;
  if not found or not private.can_read_staff_thread(p_thread_id) then raise exception 'Not authorized'; end if;
  recipient_id := case when thread_row.user_low = actor_id then thread_row.user_high else thread_row.user_low end;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text, 0));
  select id, body into result_id, prior_body from public.staff_messages
    where thread_id = p_thread_id and sender_user_id = actor_id and idempotency_key = p_idempotency_key;
  if result_id is not null then
    if prior_body <> clean_body then raise exception 'Message retry conflict'; end if;
    return result_id;
  end if;
  if not exists (select 1 from public.staff_members s where s.user_id = recipient_id and s.active) then
    raise exception 'Recipient inactive';
  end if;
  -- Wrappers acquire this same actor lock before calling us. Acquire the
  -- thread row only afterwards; no read-cursor or access workflow locks an
  -- actor while holding this row. Hold it through commit so a later committed
  -- message always sorts after every previously committed thread message.
  perform 1 from public.staff_threads where id = p_thread_id for update;
  select created_at into latest_time from public.staff_messages
    where thread_id = p_thread_id order by created_at desc, id desc limit 1;
  message_time := greatest(clock_timestamp(), latest_time + interval '1 microsecond');
  if (select count(*) from public.staff_messages where sender_user_id = actor_id
    and created_at >= now() - interval '1 minute') >= 20
    or (select count(*) from public.staff_messages where sender_user_id = actor_id
      and created_at >= now() - interval '1 day') >= 300 then
    raise exception 'Message rate limit exceeded';
  end if;
  insert into public.staff_messages (thread_id, sender_user_id, body, idempotency_key, created_at)
    values (p_thread_id, actor_id, clean_body, p_idempotency_key, message_time) returning id into result_id;
  update public.staff_threads set last_message_at = message_time where id = p_thread_id;
  insert into public.notifications (recipient_user_id, kind, title, body, target_path, dedupe_key)
    select recipient_id, 'staff_message', 'Сообщение от коллеги', s.display_name,
      '/staff/chat?to=' || actor_id::text, 'staff-message:' || result_id::text
      from public.staff_members s where s.user_id = actor_id;
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
    values (actor_id, 'staff_message', result_id, 'sent',
      jsonb_build_object('thread_id', p_thread_id, 'recipient_user_id', recipient_id));
  return result_id;
end;
$$;

notify pgrst, 'reload schema';
-- END 20261028009400_staff_message_append_order.sql

-- BEGIN 20261028009500_resolve_payments_before_case_end.sql
-- A terminal case cannot accept later finance corrections. Require staff to
-- settle or explicitly cancel scheduled obligations before ending the case.
create function private.guard_case_end_payment_schedule()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('closed', 'cancelled') and new.status is distinct from old.status
    and exists (
      select 1 from public.payment_schedule s
      where s.case_id = new.id and s.cancelled_at is null
        and s.amount_kzt > private.installment_paid(s.id)
    ) then
    raise exception 'Outstanding payment schedule must be resolved before ending case';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_case_end_payment_schedule() from public, anon, authenticated;

-- UPDATE already holds the case row lock used by every financial mutation.
-- A failure also rolls back task/request changes made earlier in staff_cancel_case.
create trigger modernsecure_case_end_payment_schedule
before update of status on public.cases
for each row execute function private.guard_case_end_payment_schedule();

notify pgrst, 'reload schema';
-- END 20261028009500_resolve_payments_before_case_end.sql

-- Users created through Auth before schema installation still need profiles.
insert into public.profiles(user_id,email)
select id,coalesce(email,'') from auth.users
on conflict(user_id) do nothing;
notify pgrst, 'reload schema';
commit;
select 'ModernSecure schema installed. Continue with 02_CREATE_OPERATOR.sql.' as result;
