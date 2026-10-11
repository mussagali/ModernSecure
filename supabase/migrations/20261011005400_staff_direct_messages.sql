-- Staff-to-staff correspondence is separate from case/client messages.
-- Participants alone can read content; the audit log records metadata, not body text.
create table public.staff_threads (
  id uuid primary key default gen_random_uuid(),
  user_low uuid not null references public.staff_members(user_id) on delete restrict,
  user_high uuid not null references public.staff_members(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  constraint staff_threads_order_check check (user_low < user_high),
  constraint staff_threads_pair_unique unique (user_low, user_high)
);

create table public.staff_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.staff_threads(id) on delete restrict,
  sender_user_id uuid not null references public.staff_members(user_id) on delete restrict,
  body text not null check (length(body) between 1 and 4000 and body = btrim(body)),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  constraint staff_messages_retry_unique unique (thread_id, sender_user_id, idempotency_key)
);

create table public.staff_thread_reads (
  thread_id uuid not null references public.staff_threads(id) on delete restrict,
  reader_user_id uuid not null references public.staff_members(user_id) on delete restrict,
  read_at timestamptz not null default now(),
  primary key (thread_id, reader_user_id)
);

create index staff_threads_low_recent_idx on public.staff_threads(user_low, last_message_at desc);
create index staff_threads_high_recent_idx on public.staff_threads(user_high, last_message_at desc);
create index staff_messages_thread_recent_idx on public.staff_messages(thread_id, created_at desc, id desc);
create index staff_messages_sender_recent_idx on public.staff_messages(sender_user_id, created_at desc);

create function private.can_read_staff_thread(p_thread_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff_threads t
    join public.staff_members me on me.user_id = auth.uid() and me.active
    where t.id = p_thread_id and auth.uid() in (t.user_low, t.user_high)
  )
$$;
revoke all on function private.can_read_staff_thread(uuid) from public, anon, authenticated;
grant execute on function private.can_read_staff_thread(uuid) to authenticated;

alter table public.staff_threads enable row level security;
alter table public.staff_messages enable row level security;
alter table public.staff_thread_reads enable row level security;
revoke all on public.staff_threads, public.staff_messages, public.staff_thread_reads from public, anon, authenticated;
grant select on public.staff_threads, public.staff_messages, public.staff_thread_reads to authenticated;
grant all on public.staff_threads, public.staff_messages, public.staff_thread_reads to service_role;

create policy staff_threads_participant_read on public.staff_threads for select to authenticated
  using (private.can_read_staff_thread(id));
create policy staff_messages_participant_read on public.staff_messages for select to authenticated
  using (private.can_read_staff_thread(thread_id));
create policy staff_thread_reads_participant_read on public.staff_thread_reads for select to authenticated
  using (reader_user_id = auth.uid() and private.can_read_staff_thread(thread_id));

create function public.staff_directory()
returns table(user_id uuid, display_name text, role public.staff_role, active boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.staff_role_for_current_user() is null then
    raise exception 'Not authorized';
  end if;
  return query
    select s.user_id, s.display_name, s.role, s.active from public.staff_members s
    where s.user_id <> auth.uid()
    order by s.display_name, s.user_id;
end;
$$;
revoke all on function public.staff_directory() from public, anon;
grant execute on function public.staff_directory() to authenticated;

create function public.staff_open_thread(p_recipient_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); found_id uuid;
begin
  if actor_id is null or p_recipient_user_id is null or actor_id = p_recipient_user_id
    or private.staff_role_for_current_user() is null
    or not exists (select 1 from public.staff_members s where s.user_id = p_recipient_user_id and s.active) then
    raise exception 'Not authorized';
  end if;
  insert into public.staff_threads (user_low, user_high)
    values (least(actor_id, p_recipient_user_id), greatest(actor_id, p_recipient_user_id))
    on conflict (user_low, user_high) do nothing;
  select t.id into found_id from public.staff_threads t
    where t.user_low = least(actor_id, p_recipient_user_id)
      and t.user_high = greatest(actor_id, p_recipient_user_id);
  return found_id;
end;
$$;
revoke all on function public.staff_open_thread(uuid) from public, anon;
grant execute on function public.staff_open_thread(uuid) to authenticated;

create function public.staff_send_message(p_thread_id uuid, p_body text, p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); thread_row public.staff_threads%rowtype;
  recipient_id uuid; result_id uuid; clean_body text := btrim(p_body);
begin
  if actor_id is null or p_thread_id is null or p_idempotency_key is null
    or clean_body is null or length(clean_body) not between 1 and 4000 then
    raise exception 'Invalid message';
  end if;
  select * into thread_row from public.staff_threads where id = p_thread_id;
  if not found or not private.can_read_staff_thread(p_thread_id) then raise exception 'Not authorized'; end if;
  recipient_id := case when thread_row.user_low = actor_id then thread_row.user_high else thread_row.user_low end;
  if not exists (select 1 from public.staff_members s where s.user_id = recipient_id and s.active) then
    raise exception 'Recipient inactive';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text, 0));
  select id into result_id from public.staff_messages
    where thread_id = p_thread_id and sender_user_id = actor_id and idempotency_key = p_idempotency_key;
  if result_id is not null then return result_id; end if;
  if (select count(*) from public.staff_messages where sender_user_id = actor_id
    and created_at >= now() - interval '1 minute') >= 20
    or (select count(*) from public.staff_messages where sender_user_id = actor_id
      and created_at >= now() - interval '1 day') >= 300 then
    raise exception 'Message rate limit exceeded';
  end if;
  insert into public.staff_messages (thread_id, sender_user_id, body, idempotency_key)
    values (p_thread_id, actor_id, clean_body, p_idempotency_key) returning id into result_id;
  update public.staff_threads set last_message_at = now() where id = p_thread_id;
  insert into public.notifications (recipient_user_id, kind, title, body, target_path, dedupe_key)
    select recipient_id, 'staff_message', 'Сообщение от коллеги', s.display_name,
      '/staff/chat?to=' || actor_id::text, 'staff-message:' || result_id::text
      from public.staff_members s where s.user_id = actor_id;
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
    values (actor_id, 'staff_message', result_id, 'sent',
      jsonb_build_object('thread_id', p_thread_id, 'recipient_user_id', recipient_id));
  return result_id;
end;
$$;
revoke all on function public.staff_send_message(uuid, text, uuid) from public, anon;
grant execute on function public.staff_send_message(uuid, text, uuid) to authenticated;

create function public.staff_mark_thread_read(p_thread_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); other_id uuid;
begin
  if actor_id is null or not private.can_read_staff_thread(p_thread_id) then
    raise exception 'Not authorized';
  end if;
  insert into public.staff_thread_reads (thread_id, reader_user_id, read_at)
    values (p_thread_id, actor_id, now())
    on conflict (thread_id, reader_user_id) do update set read_at = excluded.read_at;
  select case when t.user_low = actor_id then t.user_high else t.user_low end into other_id
    from public.staff_threads t where t.id = p_thread_id;
  update public.notifications set read_at = now()
    where recipient_user_id = actor_id and kind = 'staff_message'
      and target_path = '/staff/chat?to=' || other_id::text and read_at is null;
end;
$$;
revoke all on function public.staff_mark_thread_read(uuid) from public, anon;
grant execute on function public.staff_mark_thread_read(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'staff_messages') then
    alter publication supabase_realtime add table public.staff_messages;
  end if;
end;
$$;
