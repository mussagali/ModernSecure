-- A case link belongs to one private staff message, not to the whole thread.
create table public.staff_message_case_refs (
  message_id uuid primary key references public.staff_messages(id) on delete restrict,
  case_id uuid not null references public.cases(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index staff_message_case_refs_case_idx on public.staff_message_case_refs(case_id);

create function private.staff_user_can_reference_case(p_user_id uuid, p_case_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff_members sm
    where sm.user_id = p_user_id and sm.active
      and exists (select 1 from public.cases c where c.id = p_case_id)
      and (sm.role = 'admin' or exists (
        select 1 from public.case_assignments ca
        where ca.case_id = p_case_id and ca.staff_user_id = sm.user_id
          and ca.revoked_at is null
      ))
  )
$$;
revoke all on function private.staff_user_can_reference_case(uuid, uuid) from public, anon, authenticated;
grant execute on function private.staff_user_can_reference_case(uuid, uuid) to authenticated;

create function private.can_reference_staff_case(p_thread_id uuid, p_case_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff_threads t
    where t.id = p_thread_id
      and auth.uid() in (t.user_low, t.user_high)
      and private.staff_user_can_reference_case(t.user_low, p_case_id)
      and private.staff_user_can_reference_case(t.user_high, p_case_id)
  )
$$;
revoke all on function private.can_reference_staff_case(uuid, uuid) from public, anon, authenticated;

alter table public.staff_message_case_refs enable row level security;
revoke all on public.staff_message_case_refs from public, anon, authenticated;
grant select on public.staff_message_case_refs to authenticated;
grant all on public.staff_message_case_refs to service_role;
create policy staff_message_case_refs_participant_read
  on public.staff_message_case_refs for select to authenticated
  using (exists (
    select 1 from public.staff_messages m
    where m.id = message_id and private.can_read_staff_thread(m.thread_id)
      and private.staff_user_can_reference_case(auth.uid(), case_id)
  ));
create policy staff_mfa_guard on public.staff_message_case_refs
  as restrictive for all to authenticated
  using ((select private.staff_mfa_passed()))
  with check ((select private.staff_mfa_passed()));
create trigger modernsecure_staff_message_case_refs_immutable
  before update or delete on public.staff_message_case_refs
  for each row execute function private.reject_message_change();

create function public.staff_can_reference_case(p_thread_id uuid, p_case_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_reference_staff_case(p_thread_id, p_case_id)
$$;
revoke all on function public.staff_can_reference_case(uuid, uuid) from public, anon;
grant execute on function public.staff_can_reference_case(uuid, uuid) to authenticated;

create function public.staff_send_case_message(
  p_thread_id uuid, p_body text, p_idempotency_key uuid, p_case_id uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); prior_id uuid; result_id uuid;
begin
  if actor_id is null or p_idempotency_key is null
    or not private.can_reference_staff_case(p_thread_id, p_case_id) then
    raise exception 'Case link unavailable';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text, 0));
  select id into prior_id from public.staff_messages
    where thread_id = p_thread_id and sender_user_id = actor_id
      and idempotency_key = p_idempotency_key;
  if prior_id is not null and not exists (
    select 1 from public.staff_message_case_refs r
    where r.message_id = prior_id and r.case_id = p_case_id
  ) then raise exception 'Staff message key cannot be reused'; end if;
  result_id := public.staff_send_message(p_thread_id, p_body, p_idempotency_key);
  if prior_id is null then
    insert into public.staff_message_case_refs(message_id, case_id)
      values (result_id, p_case_id);
  end if;
  return result_id;
end;
$$;
revoke all on function public.staff_send_case_message(uuid, text, uuid, uuid) from public, anon;
grant execute on function public.staff_send_case_message(uuid, text, uuid, uuid) to authenticated;

create function public.staff_send_case_message_with_attachments(
  p_thread_id uuid, p_body text, p_idempotency_key uuid, p_files jsonb, p_case_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); prior_id uuid; result jsonb;
begin
  if actor_id is null or p_idempotency_key is null
    or not private.can_reference_staff_case(p_thread_id, p_case_id) then
    raise exception 'Case link unavailable';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text, 0));
  select id into prior_id from public.staff_messages
    where thread_id = p_thread_id and sender_user_id = actor_id
      and idempotency_key = p_idempotency_key;
  if prior_id is not null and not exists (
    select 1 from public.staff_message_case_refs r
    where r.message_id = prior_id and r.case_id = p_case_id
  ) then raise exception 'Staff message key cannot be reused'; end if;
  result := public.staff_send_message_with_attachments(p_thread_id, p_body, p_idempotency_key, p_files);
  if (result->>'created')::boolean then
    insert into public.staff_message_case_refs(message_id, case_id)
      values ((result->>'id')::uuid, p_case_id);
  end if;
  return result;
end;
$$;
revoke all on function public.staff_send_case_message_with_attachments(uuid, text, uuid, jsonb, uuid)
  from public, anon;
grant execute on function public.staff_send_case_message_with_attachments(uuid, text, uuid, jsonb, uuid)
  to authenticated;
