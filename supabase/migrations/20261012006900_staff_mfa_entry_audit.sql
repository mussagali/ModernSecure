-- A provider's verification_attempted event is not proof that MFA succeeded.
-- Record the first authorized panel entry for each real AAL2 Auth session.
create unique index audit_staff_mfa_entry_once_idx
  on public.audit_events (action, request_id)
  where action = 'staff_mfa_verified' and request_id is not null;

create function public.record_staff_mfa_entry()
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  session_text text := auth.jwt()->>'session_id';
  session_id uuid;
  audit_key text;
begin
  if actor_id is null or auth.jwt()->>'aal' is distinct from 'aal2'
    or session_text is null
    or session_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Not authorized';
  end if;
  session_id := session_text::uuid;
  if not exists (
    select 1 from public.staff_members sm
    where sm.user_id = actor_id and sm.active
  ) or not private.staff_mfa_passed()
    or not exists (
      select 1 from auth.sessions session_record
      where session_record.id = session_id
        and session_record.user_id = actor_id
        and session_record.aal::text = 'aal2'
        and (session_record.not_after is null or session_record.not_after > now())
    )
    or not exists (
      select 1 from auth.mfa_factors factor
      where factor.user_id = actor_id and factor.status = 'verified'
    ) then
    raise exception 'Not authorized';
  end if;

  -- A one-way digest avoids storing the Auth session identifier in audit_events.
  audit_key := encode(extensions.digest(session_id::text, 'sha256'), 'hex');
  insert into public.audit_events
    (actor_user_id, entity_type, entity_id, action, request_id, after_data)
  values
    (actor_id, 'staff_session', actor_id, 'staff_mfa_verified', audit_key,
      jsonb_build_object('aal', 'aal2'))
  on conflict do nothing;
  return found;
end;
$$;

revoke all on function public.record_staff_mfa_entry() from public, anon;
grant execute on function public.record_staff_mfa_entry() to authenticated;
