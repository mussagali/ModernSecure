-- Registration already creates a private profile. Use those profiles as the
-- review queue, including existing accounts, without making signup depend on
-- another trigger or granting administrators direct access to auth.users.
alter table public.profiles
  add column full_name text,
  add column iin text,
  add constraint profiles_full_name_format check (
    full_name is null or (length(trim(full_name)) between 1 and 160 and full_name !~ '[[:cntrl:]]')
  ),
  add constraint profiles_iin_format check (iin is null or iin ~ '^[0-9]{12}$');

create function public.admin_client_registrations(p_query text default '', p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  clean_query text := lower(trim(coalesce(p_query, '')));
  result jsonb;
begin
  if auth.uid() is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  if length(clean_query) > 120 or p_page is null or p_page not between 1 and 10000 then
    raise exception 'Invalid registration search';
  end if;
  with pending as (
    select p.user_id, u.email, coalesce(p.full_name, p.display_name) as full_name,
      p.phone, p.city, p.created_at, u.email_confirmed_at is not null as email_confirmed,
      p.iin is not null as has_iin
    from public.profiles p join auth.users u on u.id = p.user_id
    where nullif(trim(u.email), '') is not null
      and not exists (select 1 from public.clients cl where cl.user_id = p.user_id)
      and not exists (select 1 from public.staff_members sm where sm.user_id = p.user_id)
      and not exists (select 1 from public.staff_invites si where si.email = lower(u.email)
        and si.status = 'pending' and si.expires_at > now())
      and (clean_query = '' or position(clean_query in lower(u.email)) > 0
        or position(clean_query in lower(coalesce(p.full_name, p.display_name, ''))) > 0
        or position(clean_query in lower(coalesce(p.phone, ''))) > 0)
  ), totals as (
    select count(*) as total_count,
      least(p_page, greatest(1, ceil(count(*) / 25.0)::integer)) as page from pending
  ), items as (
    select p.*, matches.matching_client_count, matches.matching_client_id
    from pending p
    cross join lateral (
      select count(*) as matching_client_count,
        case when count(*) = 1 and bool_and(cl.user_id is null) then (array_agg(cl.id))[1] end as matching_client_id
      from public.clients cl where lower(trim(cl.email)) = lower(p.email)
    ) matches
    order by p.created_at desc, p.user_id desc
    limit 25 offset ((select page from totals) - 1) * 25
  )
  select jsonb_build_object('total_count', t.total_count, 'page', t.page,
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at desc, i.user_id desc) from items i), '[]'::jsonb))
    into result from totals t;
  return result;
end;
$$;

-- Only a fresh card can be approved before email confirmation. Linking an
-- existing card (and its cases) still requires the existing verified-email RPC.
create function public.admin_approve_client_registration(p_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  target_email text;
  profile public.profiles%rowtype;
  client_id uuid;
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  select u.email into target_email from auth.users u where u.id = p_user_id for update;
  if not found or nullif(trim(target_email), '') is null then raise exception 'Account not found'; end if;
  if exists (select 1 from public.staff_members sm where sm.user_id = p_user_id) then
    raise exception 'Account is already staff';
  end if;
  if exists (select 1 from public.staff_invites si where si.email = lower(target_email)
    and si.status = 'pending' and si.expires_at > now()) then
    raise exception 'Account has a staff invitation';
  end if;
  select cl.id into client_id from public.clients cl where cl.user_id = p_user_id;
  if found then return client_id; end if;
  if exists (select 1 from public.clients cl where lower(trim(cl.email)) = lower(target_email)) then
    raise exception 'Existing client card';
  end if;
  select * into profile from public.profiles where user_id = p_user_id for update;
  if not found then raise exception 'Profile not found'; end if;
  insert into public.clients (user_id, full_name, email, phone, city, iin, linked_by, linked_at)
  values (p_user_id, coalesce(profile.full_name, profile.display_name, target_email),
    lower(target_email), profile.phone, profile.city, profile.iin, actor_id, now())
  returning id into client_id;
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
  values (actor_id, 'client', client_id, 'registration_approved', jsonb_build_object('user_id', p_user_id));
  return client_id;
end;
$$;

-- A client can complete identity before review or fill the missing IIN later.
-- Once an approved card has an IIN, corrections remain a staff workflow.
create function public.complete_own_client_identity(p_full_name text, p_iin text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  clean_name text := nullif(trim(p_full_name), '');
  clean_iin text := nullif(trim(p_iin), '');
  profile public.profiles%rowtype;
  card public.clients%rowtype;
begin
  if actor_id is null then raise exception 'Not authenticated'; end if;
  if clean_name is null or length(clean_name) > 160 or clean_name ~ '[[:cntrl:]]'
    or (clean_iin is not null and clean_iin !~ '^[0-9]{12}$') then
    raise exception 'Invalid identity';
  end if;
  -- The same account lock serializes profile completion, approval and role changes.
  perform 1 from auth.users where id = actor_id for update;
  if exists (select 1 from public.staff_members where user_id = actor_id) then
    raise exception 'Account is already staff';
  end if;
  select * into profile from public.profiles where user_id = actor_id for update;
  if not found then raise exception 'Profile not found'; end if;
  select * into card from public.clients where user_id = actor_id for update;
  if card.iin is not null then raise exception 'Identity is already completed'; end if;
  if profile.full_name is not distinct from clean_name and profile.iin is not distinct from clean_iin
    and (card.id is null or (card.full_name = clean_name and card.iin is not distinct from clean_iin)) then
    return;
  end if;
  update public.profiles set full_name = clean_name, iin = clean_iin, updated_at = now()
    where user_id = actor_id;
  if card.id is not null then
    update public.clients set full_name = clean_name, iin = clean_iin, updated_at = now() where id = card.id;
  end if;
  -- Do not duplicate government identifiers in audit payloads.
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
  values (actor_id, case when card.id is null then 'profile' else 'client' end,
    coalesce(card.id, actor_id), 'identity_completed', jsonb_build_object('iin_provided', clean_iin is not null));
end;
$$;

revoke all on function public.admin_client_registrations(text, integer) from public, anon;
revoke all on function public.admin_approve_client_registration(uuid) from public, anon;
revoke all on function public.complete_own_client_identity(text, text) from public, anon;
grant execute on function public.admin_client_registrations(text, integer) to authenticated;
grant execute on function public.admin_approve_client_registration(uuid) to authenticated;
grant execute on function public.complete_own_client_identity(text, text) to authenticated;

-- Contacts entered after approval must also reach the card staff work with.
create function private.sync_client_profile_contacts()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.clients set phone = new.phone, city = new.city, updated_at = now()
    where user_id = new.user_id;
  return new;
end;
$$;
revoke all on function private.sync_client_profile_contacts() from public, anon, authenticated;
create trigger modernsecure_client_profile_contacts
after update of phone, city on public.profiles
for each row when (old.phone is distinct from new.phone or old.city is distinct from new.city)
execute function private.sync_client_profile_contacts();

notify pgrst, 'reload schema';
