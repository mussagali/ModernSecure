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
