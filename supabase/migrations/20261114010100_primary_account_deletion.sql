-- Login accounts can be removed without rewriting immutable company records.
-- The private registry is attribution, never an authentication/authorization source.
create table private.account_actors (
  user_id uuid primary key,
  display_name text not null default 'Участник дела',
  deleted_at timestamptz
);
revoke all on table private.account_actors from public, anon, authenticated;
insert into private.account_actors(user_id, display_name)
select u.id, coalesce(nullif(s.display_name, ''), nullif(c.full_name, ''),
  nullif(p.display_name, ''), 'Участник дела')
from auth.users u left join public.profiles p on p.user_id = u.id
left join public.staff_members s on s.user_id = u.id
left join public.clients c on c.user_id = u.id;

create function private.register_account_actor()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.account_actors(user_id) values(new.id) on conflict do nothing;
  if exists(select 1 from private.account_actors where user_id = new.id and deleted_at is not null) then
    raise exception 'Deleted account identity cannot be reused';
  end if;
  return new;
end;
$$;
revoke all on function private.register_account_actor() from public, anon, authenticated;
create trigger modernsecure_account_actor before insert on auth.users
for each row execute function private.register_account_actor();

-- Preserve the original UUIDs; no UPDATE/DELETE of immutable history is needed.
do $$
declare entry record; constraint_name text;
begin
  for entry in select * from (values
    ('staff_members', 'user_id'), ('upload_sessions', 'uploader_user_id'),
    ('document_files', 'uploaded_by'), ('task_events', 'actor_user_id'),
    ('messages', 'sender_user_id'), ('payment_receipts', 'uploaded_by'),
    ('consent_records', 'user_id'), ('audit_events', 'actor_user_id'),
    ('staff_invites', 'accepted_user_id'), ('legal_documents', 'published_by'),
    ('portal_requests', 'user_id')
  ) as historical(table_name, column_name) loop
    constraint_name := entry.table_name || '_' || entry.column_name || '_fkey';
    execute format('alter table public.%I drop constraint %I', entry.table_name, constraint_name);
    execute format('alter table public.%I add constraint %I foreign key (%I) references private.account_actors(user_id) on delete restrict',
      entry.table_name, constraint_name, entry.column_name);
  end loop;
end;
$$;

alter table public.staff_members add column deleted_at timestamptz;
alter table public.staff_members add constraint deleted_staff_cannot_activate
  check (deleted_at is null or (not active and not can_confirm_payments and not can_bulk_export and not can_delete));

create function public.primary_account_directory(p_query text default '', p_page integer default 1, p_user_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb; clean_query text := lower(trim(coalesce(p_query, '')));
begin
  perform private.require_primary_account_admin();
  if length(clean_query) > 120 or p_page is null or p_page not between 1 and 10000 then
    raise exception 'Invalid account search';
  end if;
  with accounts as (
    select u.id as user_id, u.email::text, coalesce(s.display_name, c.full_name, p.display_name, 'Без имени') as display_name,
      p.created_at, u.email_confirmed_at is not null as email_verified,
      coalesce(s.role::text, case when c.id is not null then 'client' else 'pending' end) as role,
      coalesce(s.is_primary_admin, false) as is_primary_admin,
      coalesce(s.active, c.id is not null) as active,
      (select count(*) from public.case_assignments a join public.cases k on k.id = a.case_id
        where a.staff_user_id = u.id and a.revoked_at is null and k.status = 'open') as active_case_count,
      (select count(*) from public.cases k where k.client_id = c.id) as client_case_count
    from auth.users u left join public.profiles p on p.user_id = u.id
    left join public.staff_members s on s.user_id = u.id
    left join public.clients c on c.user_id = u.id
    where (p_user_id is null or u.id = p_user_id)
      and (clean_query = '' or position(clean_query in lower(coalesce(u.email, ''))) > 0
        or position(clean_query in lower(coalesce(s.display_name, c.full_name, p.display_name, ''))) > 0)
  ), totals as (
    select count(*) as total_count, least(p_page, greatest(1, ceil(count(*) / 25.0)::integer)) as page from accounts
  ), items as (
    select * from accounts order by created_at desc nulls last, user_id
    limit 25 offset ((select page from totals) - 1) * 25
  ) select jsonb_build_object('total_count', t.total_count, 'page', t.page,
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at desc nulls last, i.user_id) from items i), '[]'::jsonb))
    into result from totals t;
  return result;
end;
$$;
revoke all on function public.primary_account_directory(text, integer, uuid) from public, anon;
grant execute on function public.primary_account_directory(text, integer, uuid) to authenticated;

create function public.primary_delete_account(p_user_id uuid, p_confirmation_email text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid(); target_email text; target_name text;
  target_staff public.staff_members%rowtype; assignment record;
  clean_reason text := nullif(trim(p_reason), ''); removed_at timestamptz := clock_timestamp();
begin
  -- Reuse the existing primary-admin and MFA policy, including its rollout rules.
  perform private.require_primary_account_admin();
  if p_user_id is null or p_user_id = actor_id then raise exception 'account_protected'; end if;
  if clean_reason is null or length(clean_reason) > 500 then raise exception 'account_invalid_reason'; end if;
  select u.email into target_email from auth.users u where u.id = p_user_id for update;
  if not found then raise exception 'account_not_found'; end if;
  if nullif(trim(target_email), '') is null
    or lower(trim(coalesce(p_confirmation_email, ''))) <> lower(target_email) then
    raise exception 'account_confirmation_mismatch';
  end if;
  -- The same staff-row lock is used by staff_assign_case and access changes.
  select * into target_staff from public.staff_members where user_id = p_user_id for update;
  if found and target_staff.is_primary_admin then raise exception 'account_protected'; end if;
  if exists(select 1 from public.case_assignments a join public.cases c on c.id = a.case_id
    where a.staff_user_id = p_user_id and a.revoked_at is null and c.status = 'open') then
    raise exception 'account_active_assignments';
  end if;
  select coalesce(nullif(target_staff.display_name, ''), nullif(c.full_name, ''), nullif(p.display_name, ''), 'Участник дела')
    into target_name from public.profiles p left join public.clients c on c.user_id = p.user_id where p.user_id = p_user_id;
  update private.account_actors set display_name = coalesce(target_name, 'Участник дела'), deleted_at = removed_at where user_id = p_user_id;
  update public.staff_members set active = false, can_confirm_payments = false,
    can_bulk_export = false, can_delete = false, deleted_at = removed_at where user_id = p_user_id;
  for assignment in select id, case_id, assigned_at from public.case_assignments
    where staff_user_id = p_user_id and revoked_at is null for update loop
    update public.case_assignments set revoked_at = greatest(removed_at, assignment.assigned_at) where id = assignment.id;
    insert into public.audit_events(actor_user_id, case_id, entity_type, entity_id, action, reason)
      values(actor_id, assignment.case_id, 'case_assignment', assignment.id, 'revoked', clean_reason);
  end loop;
  update public.document_requests set assigned_staff_id = null where assigned_staff_id = p_user_id and status = 'active';
  update public.clients set user_id = null, linked_by = null, linked_at = null where user_id = p_user_id;
  update public.staff_invites set status = 'cancelled', updated_at = removed_at
    where email = lower(target_email) and status = 'pending';
  delete from public.notifications where recipient_user_id = p_user_id;
  delete from public.message_reads where reader_user_id = p_user_id;
  delete from public.profiles where user_id = p_user_id;
  -- Auth sessions cascade to their refresh tokens and AMR claims. Older tokens
  -- may lack a session FK; remove those by user_id too. No Storage rows/files are deleted.
  if to_regclass('auth.refresh_tokens') is not null then
    execute 'delete from auth.refresh_tokens where user_id::text = $1' using p_user_id::text;
  end if;
  if to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where user_id = $1' using p_user_id;
  end if;
  delete from auth.users where id = p_user_id;
  insert into public.audit_events(actor_user_id, entity_type, entity_id, action, before_data, after_data, reason)
    values(actor_id, 'account', p_user_id, 'account_deleted',
      jsonb_build_object('email', target_email, 'role', target_staff.role),
      jsonb_build_object('deleted_at', removed_at, 'company_records_preserved', true), clean_reason);
end;
$$;
revoke all on function public.primary_delete_account(uuid, text, text) from public, anon;
grant execute on function public.primary_delete_account(uuid, text, text) to authenticated;

-- Attribution remains readable to existing case participants after client detachment.
create or replace function public.case_message_authors(p_case_id uuid)
returns table(user_id uuid, display_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_case_id is null or not private.can_read_case(p_case_id) then raise exception 'Not authorized'; end if;
  return query select distinct m.sender_user_id,
    coalesce(nullif(s.display_name, ''), nullif(cl.full_name, ''), nullif(a.display_name, ''), 'Участник дела')
  from public.messages m join public.cases c on c.id = m.case_id
  left join public.staff_members s on s.user_id = m.sender_user_id
  left join public.clients cl on cl.id = c.client_id and cl.user_id = m.sender_user_id
  left join private.account_actors a on a.user_id = m.sender_user_id
  where m.case_id = p_case_id;
end;
$$;

-- A signed JWT can outlive its deleted Auth account. Revoke its data access
-- immediately, including Realtime/Storage reads that do not run the API hook.
create function private.current_account_exists()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from auth.users where id = auth.uid())
$$;
revoke all on function private.current_account_exists() from public, anon, authenticated;
grant execute on function private.current_account_exists() to authenticated;

do $$
declare item record;
begin
  for item in select tablename from pg_tables where schemaname = 'public' loop
    execute format('create policy current_account_guard on public.%I as restrictive for all to authenticated '
      || 'using ((select private.current_account_exists())) '
      || 'with check ((select private.current_account_exists()))', item.tablename);
  end loop;
end;
$$;
create policy current_account_guard on storage.objects as restrictive for all to authenticated
  using ((select private.current_account_exists())) with check ((select private.current_account_exists()));

-- Also cover direct security-definer consent mutations. Existing enrollment
-- exemptions remain unchanged for accounts that still exist.
create or replace function private.staff_mfa_passed()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.current_account_exists() and coalesce(not private.staff_mfa_required()
    or (auth.jwt()->>'aal' = 'aal2' and exists (
      select 1 from auth.mfa_factors factor where factor.user_id = auth.uid() and factor.status = 'verified'
    )), false)
$$;

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
  if request_path in ('rpc/staff_mfa_status', 'rpc/claim_staff_invite', 'rpc/account_access_status') then return; end if;
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
