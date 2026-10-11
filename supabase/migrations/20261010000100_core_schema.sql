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
