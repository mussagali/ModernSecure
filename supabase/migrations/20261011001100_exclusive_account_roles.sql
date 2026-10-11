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
