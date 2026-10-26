-- Internal case notes are separate from the client conversation. Only an
-- active administrator or an actively assigned employee may write/read them.
alter table public.case_internal_notes
  add column idempotency_key uuid;

create unique index case_internal_notes_replay_idx
  on public.case_internal_notes(case_id, author_user_id, idempotency_key)
  where idempotency_key is not null;

create index case_internal_notes_history_idx
  on public.case_internal_notes(case_id, created_at desc, id desc);

create function public.staff_add_case_note(
  p_case_id uuid, p_body text, p_idempotency_key uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  actor_role public.staff_role;
  clean_body text := nullif(trim(p_body), '');
  note_id uuid;
  existing_body text;
begin
  if actor_id is null or p_case_id is null or p_idempotency_key is null
    or clean_body is null or length(clean_body) > 4000 then
    raise exception 'Invalid note';
  end if;

  -- The row locks order this write against deactivation and reassignment.
  select sm.role into actor_role from public.staff_members sm
    where sm.user_id = actor_id and sm.active for share;
  if actor_role is null then raise exception 'Not authorized'; end if;
  if actor_role <> 'admin' then
    perform 1 from public.case_assignments ca
      where ca.case_id = p_case_id and ca.staff_user_id = actor_id
        and ca.revoked_at is null for share;
    if not found then raise exception 'Not authorized'; end if;
  end if;

  insert into public.case_internal_notes(case_id, author_user_id, body, idempotency_key)
    values (p_case_id, actor_id, clean_body, p_idempotency_key)
    on conflict (case_id, author_user_id, idempotency_key)
      where idempotency_key is not null do nothing
    returning id into note_id;
  if note_id is null then
    select n.id, n.body into note_id, existing_body from public.case_internal_notes n
      where n.case_id = p_case_id and n.author_user_id = actor_id
        and n.idempotency_key = p_idempotency_key;
    if existing_body is distinct from clean_body then
      raise exception 'Note retry conflict';
    end if;
  else
    insert into public.audit_events(actor_user_id, case_id, entity_type, entity_id, action)
      values (actor_id, p_case_id, 'case_internal_note', note_id, 'created');
  end if;
  return note_id;
end;
$$;

create function public.staff_case_note_page(
  p_case_id uuid, p_before_created_at timestamptz, p_before_id uuid, p_limit integer
)
returns table(id uuid, author_user_id uuid, author_name text, body text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_case_id is null
    or not private.is_staff_for_case(p_case_id)
    or ((p_before_created_at is null) <> (p_before_id is null))
    or p_limit is null or p_limit not between 1 and 51 then
    raise exception 'Not authorized or invalid page';
  end if;
  return query
    select n.id, n.author_user_id, sm.display_name, n.body, n.created_at
      from public.case_internal_notes n
      join public.staff_members sm on sm.user_id = n.author_user_id
      where n.case_id = p_case_id
        and (p_before_created_at is null
          or (n.created_at, n.id) < (p_before_created_at, p_before_id))
      order by n.created_at desc, n.id desc
      limit p_limit;
end;
$$;

revoke all on function public.staff_add_case_note(uuid, text, uuid) from public, anon;
grant execute on function public.staff_add_case_note(uuid, text, uuid) to authenticated;
revoke all on function public.staff_case_note_page(uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.staff_case_note_page(uuid, timestamptz, uuid, integer) to authenticated;
