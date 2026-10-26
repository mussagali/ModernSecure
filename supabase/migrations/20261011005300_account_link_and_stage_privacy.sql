-- Managers may only link a verified account matching the card's contact email.
-- Administrators retain the explicit override for exceptional identity checks.
create or replace function public.link_client_account(p_client_id uuid, p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  actor_role public.staff_role := private.staff_role_for_current_user();
  target_id uuid;
  existing_user_id uuid;
  card_email text;
begin
  if actor_id is null or not coalesce(actor_role in ('manager', 'admin'), false) then
    raise exception 'Not authorized';
  end if;
  if p_client_id is null or p_email is null or length(trim(p_email)) > 254 or length(trim(p_email)) < 3 then
    raise exception 'Invalid input';
  end if;
  select cl.user_id, cl.email into existing_user_id, card_email
    from public.clients cl where cl.id = p_client_id for update;
  if not found or existing_user_id is not null then raise exception 'Client card is unavailable'; end if;
  if actor_role = 'manager' and (card_email is null or lower(trim(card_email)) <> lower(trim(p_email))) then
    raise exception 'Account email must match client card';
  end if;
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
  values (actor_id, 'client', p_client_id, 'account_linked',
    jsonb_build_object('user_id', target_id, 'email_match', card_email is not null and lower(trim(card_email)) = lower(trim(p_email))));
end;
$$;

-- Column grants, not UI field selection, protect staff-only change_reason.
revoke select on public.case_stage_events from authenticated;
grant select (id, case_id, from_stage_id, to_stage_id, actor_user_id, client_note, occurred_at)
  on public.case_stage_events to authenticated;

create function public.staff_case_stage_events(p_case_id uuid)
returns setof public.case_stage_events language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_staff_for_case(p_case_id) then
    raise exception 'Not authorized';
  end if;
  return query select e.* from public.case_stage_events e
    where e.case_id = p_case_id order by e.occurred_at desc limit 20;
end;
$$;
revoke all on function public.staff_case_stage_events(uuid) from public, anon;
grant execute on function public.staff_case_stage_events(uuid) to authenticated;
