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
