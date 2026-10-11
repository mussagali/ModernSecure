-- Prevent a signed-in account from flooding case correspondence and notifications.
-- Retries of an existing idempotency key remain possible after the limit is reached.
create index messages_sender_time_idx on public.messages(sender_user_id, created_at desc);

create function private.guard_message_rate()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null then return new; end if;
  if new.sender_user_id is distinct from actor_id then raise exception 'Message sender mismatch'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text, 0));
  if exists (select 1 from public.messages m where m.case_id = new.case_id
    and m.sender_user_id = actor_id and m.idempotency_key = new.idempotency_key) then
    return new;
  end if;
  if (select count(*) from public.messages m where m.sender_user_id = actor_id
    and m.created_at >= now() - interval '1 minute') >= 20
    or (select count(*) from public.messages m where m.sender_user_id = actor_id
      and m.created_at >= now() - interval '1 day') >= 300 then
    raise exception 'Message rate limit exceeded';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_message_rate() from public, anon, authenticated;
create trigger modernsecure_guard_message_rate before insert on public.messages
for each row execute function private.guard_message_rate();
