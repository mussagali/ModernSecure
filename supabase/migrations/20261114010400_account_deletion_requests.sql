-- Privacy requests remain available without business-role approval or staff MFA.
-- These two narrowly scoped RPCs can access only auth.uid()'s own request.
create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  requester_email text not null,
  status text not null default 'requested' check (status in ('requested','in_progress','completed')),
  requested_at timestamptz not null default now(),
  due_at timestamptz not null default (now() + interval '30 days'),
  completed_at timestamptz,
  response text,
  handled_by uuid references auth.users(id) on delete set null,
  check ((status = 'completed') = (completed_at is not null)),
  check (response is null or length(response) <= 2000)
);
create unique index account_deletion_one_open on public.account_deletion_requests(user_id)
  where user_id is not null and status <> 'completed';
create index account_deletion_queue on public.account_deletion_requests(status, requested_at, id);
alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from public, anon, authenticated;
grant all on public.account_deletion_requests to service_role;
create policy current_account_guard on public.account_deletion_requests as restrictive for all to authenticated
  using ((select private.current_account_exists())) with check ((select private.current_account_exists()));

create function public.request_own_account_deletion()
returns uuid language plpgsql security definer set search_path = '' as $$
declare current_user_id uuid := auth.uid(); request_id uuid; account_email text;
begin
  if current_user_id is null then raise exception 'Not authorized'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('deletion:' || current_user_id::text, 0));
  select id into request_id from public.account_deletion_requests
    where user_id = current_user_id and status <> 'completed';
  if request_id is not null then return request_id; end if;
  select email into account_email from auth.users where id = current_user_id;
  if nullif(account_email, '') is null then raise exception 'Account unavailable'; end if;
  insert into public.account_deletion_requests(user_id, requester_email)
    values(current_user_id, account_email) returning id into request_id;
  insert into public.audit_events(actor_user_id, entity_type, entity_id, action, after_data)
    values(current_user_id, 'account_deletion_request', request_id, 'requested', jsonb_build_object('status','requested'));
  insert into public.notifications(recipient_user_id, kind, title, target_path, dedupe_key)
    select user_id, 'account_deletion_request', 'Новый запрос на удаление аккаунта',
      '/staff/settings/deletion-requests', 'account-deletion:' || request_id::text
    from public.staff_members where active and is_primary_admin;
  return request_id;
end; $$;

create function public.own_account_deletion_request()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.current_account_exists() then raise exception 'Not authorized'; end if;
  return (select jsonb_build_object('id', id, 'status', status, 'requested_at', requested_at,
    'due_at', due_at, 'completed_at', completed_at, 'response', response)
    from public.account_deletion_requests where user_id = auth.uid()
    order by requested_at desc, id desc limit 1);
end; $$;

create function public.admin_account_deletion_requests(p_page integer default 1)
returns setof public.account_deletion_requests language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_primary_account_admin();
  if p_page is null or p_page < 1 or p_page > 100000 then raise exception 'Invalid page'; end if;
  return query select * from public.account_deletion_requests
    order by (status = 'completed'), requested_at, id limit 25 offset ((p_page - 1) * 25);
end; $$;

-- This records a human operator's work; it does not itself destroy business data.
create function public.admin_update_account_deletion(p_id uuid, p_status text, p_response text,
  p_confirm_completed boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare previous_status text; target_user_id uuid; clean_response text := nullif(trim(coalesce(p_response, '')), '');
begin
  perform private.require_primary_account_admin();
  if p_status is null or p_status not in ('in_progress','completed') or length(clean_response) > 2000
    or (p_status = 'completed' and (not coalesce(p_confirm_completed, false) or coalesce(length(clean_response),0) < 20))
    then raise exception 'Invalid completion or response'; end if;
  select status, user_id into previous_status, target_user_id from public.account_deletion_requests where id = p_id for update;
  if previous_status is null or previous_status = 'completed' then raise exception 'Request unavailable'; end if;
  if p_status = 'completed' and exists(select 1 from auth.users where id = target_user_id) then
    raise exception 'Account still exists';
  end if;
  update public.account_deletion_requests set status = p_status, response = clean_response,
    handled_by = auth.uid(), completed_at = case when p_status = 'completed' then now() else null end where id = p_id;
  insert into public.audit_events(actor_user_id, entity_type, entity_id, action, before_data, after_data)
    values(auth.uid(), 'account_deletion_request', p_id, 'updated',
      jsonb_build_object('status', previous_status), jsonb_build_object('status', p_status));
end; $$;

revoke all on function public.request_own_account_deletion(), public.own_account_deletion_request(),
  public.admin_account_deletion_requests(integer), public.admin_update_account_deletion(uuid,text,text,boolean) from public, anon;
grant execute on function public.request_own_account_deletion(), public.own_account_deletion_request(),
  public.admin_account_deletion_requests(integer), public.admin_update_account_deletion(uuid,text,text,boolean) to authenticated;

-- Preserve account existence, approval, consent and MFA guards for all business APIs.
create or replace function public.enforce_staff_mfa_request()
returns void language plpgsql stable security definer set search_path = '' as $$
declare request_path text := trim(both '/' from coalesce(current_setting('request.path', true), ''));
begin
  if auth.jwt()->>'role' = 'service_role' then return; end if;
  -- Anonymous access is still determined by its explicit grants/RLS (public legal pages).
  if auth.uid() is null and auth.jwt()->>'role' is distinct from 'authenticated' then return; end if;
  if not private.current_account_exists() then
    raise sqlstate 'PGRST' using
      message = '{"code":"ACCOUNT_REMOVED","message":"This account no longer exists"}',
      detail = '{"status":401,"headers":{}}';
  end if;
  if request_path in ('rpc/staff_mfa_status', 'rpc/claim_staff_invite', 'rpc/account_access_status',
    'rpc/request_own_account_deletion', 'rpc/own_account_deletion_request') then return; end if;
  if public.account_access_status() = 'pending'
    and request_path not in ('contact_settings', 'faq_entries', 'legal_documents') then
    raise sqlstate 'PGRST' using
      message = '{"code":"ACCOUNT_PENDING","message":"Account approval is required"}',
      detail = '{"status":403,"headers":{}}';
  end if;
  if not private.staff_mfa_passed() then
    raise sqlstate 'PGRST' using
      message = '{"code":"MFA_REQUIRED","message":"Complete two-factor authentication"}',
      detail = '{"status":403,"headers":{}}';
  end if;
  if not public.client_consent_status()
    and request_path not in ('rpc/client_consent_status', 'rpc/accept_client_consents',
      'legal_documents', 'consent_records', 'contact_settings', 'faq_entries') then
    raise sqlstate 'PGRST' using
      message = '{"code":"CONSENT_REQUIRED","message":"Accept current required documents"}',
      detail = '{"status":403,"headers":{}}';
  end if;
end;
$$;
notify pgrst, 'reload schema';
