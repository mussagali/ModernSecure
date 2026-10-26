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
