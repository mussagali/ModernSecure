-- Tokens are server-only. Every device belongs to an authenticated session;
-- deliveries are checked again against current account/case access at dispatch.
create table public.push_devices (
  id uuid primary key,
  secret_hash bytea not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  token text not null unique check(length(token) between 20 and 4096),
  platform text not null check(platform in ('android','ios')),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
create table public.push_outbox (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  device_id uuid not null references public.push_devices(id) on delete cascade,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_id uuid,
  completed_at timestamptz,
  last_error text,
  unique(notification_id, device_id)
);
create index push_outbox_due on public.push_outbox(next_attempt_at) where completed_at is null;
alter table public.push_devices enable row level security;
alter table public.push_outbox enable row level security;
revoke all on public.push_devices, public.push_outbox from public, anon, authenticated;
grant select, insert, update, delete on public.push_devices, public.push_outbox to service_role;

create function public.register_push_device(p_id uuid, p_secret uuid, p_token text, p_platform text)
returns void language plpgsql security definer set search_path = '' as $$
declare session uuid := nullif(auth.jwt()->>'session_id','')::uuid;
begin
  if auth.uid() is null or public.account_access_status() <> 'approved' or not private.staff_mfa_passed()
    or session is null or not exists(select 1 from auth.sessions where id=session and user_id=auth.uid() and (not_after is null or not_after>now())) then
    raise exception 'Not authorized';
  end if;
  if p_id is null or p_secret is null or p_platform is null or p_platform not in ('android','ios')
    or p_token is null or length(p_token) not between 20 and 4096 then raise exception 'Invalid device'; end if;
  perform 1 from auth.users where id=auth.uid() for update;
  if (select count(*) from public.push_devices where user_id=auth.uid() and id<>p_id) >= 20 then raise exception 'Too many devices'; end if;
  insert into public.push_devices(id,secret_hash,user_id,session_id,token,platform)
    values(p_id,extensions.digest(p_secret::text,'sha256'),auth.uid(),session,p_token,p_platform)
  on conflict(id) do update set user_id=excluded.user_id,session_id=excluded.session_id,token=excluded.token,
    platform=excluded.platform,enabled=true,updated_at=now()
    where public.push_devices.secret_hash=excluded.secret_hash;
  if not found then raise exception 'Invalid installation secret'; end if;
end;
$$;
create function public.unregister_push_session()
returns void language sql security definer set search_path = '' as $$
  update public.push_devices set enabled=false,updated_at=now()
    where user_id=auth.uid() and session_id=nullif(auth.jwt()->>'session_id','')::uuid
$$;
revoke all on function public.register_push_device(uuid,uuid,text,text),public.unregister_push_session() from public,anon;
grant execute on function public.register_push_device(uuid,uuid,text,text),public.unregister_push_session() to authenticated;

create function private.enqueue_mobile_push()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.push_outbox(notification_id,device_id)
    select new.id,d.id from public.push_devices d where d.user_id=new.recipient_user_id and d.enabled
    on conflict do nothing;
  return new;
end;
$$;
revoke all on function private.enqueue_mobile_push() from public,anon,authenticated;
create trigger modernsecure_push_notification after insert on public.notifications
  for each row execute function private.enqueue_mobile_push();

create function private.push_recipient_allowed(p_user uuid,p_case uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.staff_members s where s.user_id=p_user and s.active
    and (p_case is null or s.role='admin' or exists(select 1 from public.case_assignments a
      where a.case_id=p_case and a.staff_user_id=p_user and a.revoked_at is null)))
    or exists(select 1 from public.clients c where c.user_id=p_user
      and (p_case is null or exists(select 1 from public.cases k where k.id=p_case and k.client_id=c.id)))
$$;
revoke all on function private.push_recipient_allowed(uuid,uuid) from public,anon,authenticated;

create function public.claim_push_batch(p_limit integer default 50)
returns table(id uuid,lease_id uuid,notification_id uuid,token text,platform text)
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.push_outbox where completed_at < now()-interval '7 days';
  update public.push_outbox set completed_at=now(),last_error='exhausted'
    where completed_at is null and next_attempt_at<=now() and attempts>=6;
  -- Discard work whose recipient changed, signed out, read it, or lost access.
  update public.push_outbox q set completed_at=now(),last_error='ineligible'
  where q.completed_at is null and q.next_attempt_at<=now() and not exists(
    select 1 from public.push_devices d join public.notifications n on n.id=q.notification_id
    join auth.sessions s on s.id=d.session_id and s.user_id=d.user_id
    where d.id=q.device_id and d.enabled and d.user_id=n.recipient_user_id and n.read_at is null
      and (s.not_after is null or s.not_after>now())
      and private.push_recipient_allowed(d.user_id,n.case_id));
  return query with picked as (
    select q.id from public.push_outbox q where q.completed_at is null and q.next_attempt_at<=now() and q.attempts<6
    order by q.next_attempt_at,q.id limit greatest(1,least(coalesce(p_limit,50),100)) for update skip locked
  ), claimed as (
    update public.push_outbox q set attempts=q.attempts+1,lease_id=gen_random_uuid(),next_attempt_at=now()+interval '2 minutes'
    from picked p where q.id=p.id returning q.*
  ) select q.id,q.lease_id,q.notification_id,d.token,d.platform from claimed q join public.push_devices d on d.id=q.device_id;
end;
$$;
create function public.finish_push_delivery(p_id uuid,p_lease uuid,p_result text)
returns void language plpgsql security definer set search_path = '' as $$
declare item public.push_outbox%rowtype;
begin
  if p_result is null or p_result not in ('sent','retry','invalid_token','failed') then raise exception 'Invalid result'; end if;
  select * into item from public.push_outbox where id=p_id and lease_id=p_lease and completed_at is null for update;
  if not found then return; end if;
  update public.push_outbox set completed_at=case when p_result<>'retry' or attempts>=6 then now() else null end,
    last_error=case when p_result='sent' then null else p_result end,
    next_attempt_at=now()+make_interval(secs=>least(3600,30*(2^attempts)::integer)),lease_id=null where id=p_id;
  if p_result='invalid_token' then
    -- Do not disable a token refreshed while a delivery was in flight.
    update public.push_devices set enabled=false where id=item.device_id and updated_at < item.next_attempt_at-interval '2 minutes';
  end if;
end;
$$;
revoke all on function public.claim_push_batch(integer),public.finish_push_delivery(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_push_batch(integer),public.finish_push_delivery(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
