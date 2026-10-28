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
