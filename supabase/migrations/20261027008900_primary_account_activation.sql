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
