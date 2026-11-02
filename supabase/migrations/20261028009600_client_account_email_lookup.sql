-- Exact account lookup for the administrator's Add client flow. Auth records
-- remain private; the RPC is bounded and checks current role and MFA itself.
create index clients_normalized_email_idx on public.clients(lower(trim(email))) where email is not null;

create function public.admin_find_client_account(p_email text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare clean_email text := lower(trim(coalesce(p_email, ''))); account_id uuid;
  verified boolean; account_name text; member_role text; linked_id uuid;
  invite_role text; cards jsonb;
begin
  perform private.require_account_admin();
  if length(clean_email) > 254 or clean_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'Invalid email';
  end if;
  select u.id, u.email_confirmed_at is not null, coalesce(p.full_name, p.display_name)
    into account_id, verified, account_name
    from auth.users u left join public.profiles p on p.user_id = u.id
    where lower(u.email) = clean_email limit 1;
  select sm.role::text into member_role from public.staff_members sm where sm.user_id = account_id;
  select cl.id into linked_id from public.clients cl where cl.user_id = account_id;
  select i.role::text into invite_role from public.staff_invites i
    where i.email = clean_email and i.status = 'pending'
      and (i.expires_at > now() or i.role = 'admin') limit 1;
  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into cards from (
    select cl.id, cl.full_name, cl.user_id is null as available
    from public.clients cl where lower(trim(cl.email)) = clean_email
    order by cl.created_at, cl.id limit 10
  ) c;
  return jsonb_build_object('email', clean_email, 'user_id', account_id,
    'display_name', account_name, 'email_verified', coalesce(verified, false),
    'status', case when member_role is not null then 'staff' when linked_id is not null then 'linked'
      when account_id is not null then 'pending' else 'missing' end,
    'client_id', linked_id, 'invited_role', invite_role, 'cards', cards);
end;
$$;
revoke all on function public.admin_find_client_account(text) from public, anon;
grant execute on function public.admin_find_client_account(text) to authenticated;

-- Resolve the email and approve under the same locks as the common activation
-- flow. The client-only action cannot turn a staff invitation into a client.
create function public.admin_add_client_account(p_email text, p_display_name text, p_client_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare clean_email text := lower(trim(coalesce(p_email, ''))); account_id uuid;
begin
  perform private.require_account_assignment(clean_email, 'client');
  if length(clean_email) > 254 or clean_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'Invalid email';
  end if;
  select u.id into account_id from auth.users u where lower(u.email) = clean_email
    and u.email_confirmed_at is not null for update;
  if account_id is null then raise exception 'Verified account not found'; end if;
  if exists(select 1 from public.staff_invites i where i.email = clean_email and i.status = 'pending'
    and (i.expires_at > now() or i.role = 'admin')) then raise exception 'Account has a staff invitation'; end if;
  if p_client_id is null and exists(select 1 from public.clients c where lower(trim(c.email)) = clean_email) then
    raise exception 'Existing client card';
  end if;
  perform public.admin_approve_account(account_id, 'client', p_display_name, p_client_id);
end;
$$;
revoke all on function public.admin_add_client_account(text, text, uuid) from public, anon;
grant execute on function public.admin_add_client_account(text, text, uuid) to authenticated;

notify pgrst, 'reload schema';
