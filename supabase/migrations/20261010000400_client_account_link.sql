-- A verified account may be linked to an existing client card only by an active
-- manager or administrator. The operation and audit row share one transaction.
create function public.link_client_account(p_client_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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

  select cl.user_id into existing_user_id
  from public.clients cl where cl.id = p_client_id for update;
  if not found or existing_user_id is not null then
    raise exception 'Client card is unavailable';
  end if;

  select u.id into target_id
  from auth.users u
  where lower(u.email) = lower(trim(p_email)) and u.email_confirmed_at is not null;
  if target_id is null then
    raise exception 'Verified account not found';
  end if;
  if exists (select 1 from public.clients cl where cl.user_id = target_id) then
    raise exception 'Account is already linked';
  end if;

  update public.clients
  set user_id = target_id, linked_by = actor_id, linked_at = now(), updated_at = now()
  where id = p_client_id;

  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
  values (actor_id, 'client', p_client_id, 'account_linked', jsonb_build_object('user_id', target_id));
end;
$$;

revoke all on function public.link_client_account(uuid, text) from public, anon;
grant execute on function public.link_client_account(uuid, text) to authenticated;
