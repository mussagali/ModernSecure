-- Automatic chat reading is limited to the newest message actually displayed.
-- Keep mark_case_messages_read(uuid) for the explicit "mark all" action.
create function public.mark_case_messages_seen(p_case_id uuid, p_through_message_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  seen_at timestamptz;
  marked integer;
  cleared integer;
begin
  if actor_id is null or p_case_id is null or p_through_message_id is null
    or not private.can_read_case(p_case_id) then
    raise exception 'Not authorized';
  end if;
  select m.created_at into seen_at from public.messages m
  where m.id = p_through_message_id and m.case_id = p_case_id;
  if not found then raise exception 'Message is not in this case'; end if;

  insert into public.message_reads (message_id, reader_user_id)
  select m.id, actor_id from public.messages m
  where m.case_id = p_case_id and m.sender_user_id <> actor_id
    and (m.created_at, m.id) <= (seen_at, p_through_message_id)
  on conflict (message_id, reader_user_id) do nothing;
  get diagnostics marked = row_count;

  update public.notifications n set read_at = now()
  from public.messages m
  where m.case_id = p_case_id and m.sender_user_id <> actor_id
    and (m.created_at, m.id) <= (seen_at, p_through_message_id)
    and n.recipient_user_id = actor_id and n.case_id = p_case_id
    and n.kind = 'message' and n.dedupe_key = 'message:' || m.id::text
    and n.read_at is null;
  get diagnostics cleared = row_count;
  return marked + cleared;
end;
$$;
revoke all on function public.mark_case_messages_seen(uuid, uuid) from public, anon;
grant execute on function public.mark_case_messages_seen(uuid, uuid) to authenticated;
