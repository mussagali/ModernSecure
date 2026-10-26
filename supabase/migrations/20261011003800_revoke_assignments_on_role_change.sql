-- A manager's existing assignments must not become lawyer authority after a role switch.
-- Revoke them transactionally; the administrator can explicitly reassign suitable cases.
create or replace function public.admin_set_staff_access(
  p_staff_user_id uuid, p_role public.staff_role, p_active boolean, p_reason text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  before_staff public.staff_members%rowtype;
  assignment record;
  clean_reason text := nullif(trim(p_reason), '');
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  if p_staff_user_id is null or p_staff_user_id = actor_id
    or not coalesce(p_role in ('lawyer', 'manager'), false) or p_active is null
    or clean_reason is null or length(clean_reason) > 500 then
    raise exception 'Invalid staff access change';
  end if;
  select * into before_staff from public.staff_members where user_id = p_staff_user_id for update;
  if not found or before_staff.role = 'admin' then raise exception 'Protected administrator'; end if;
  if before_staff.role = p_role and before_staff.active = p_active then raise exception 'Access is unchanged'; end if;
  update public.staff_members set role = p_role, active = p_active where user_id = p_staff_user_id;
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, before_data, after_data, reason)
  values (actor_id, 'staff_member', p_staff_user_id, 'access_changed',
    jsonb_build_object('role', before_staff.role, 'active', before_staff.active),
    jsonb_build_object('role', p_role, 'active', p_active), clean_reason);
  if before_staff.role <> p_role or not p_active then
    for assignment in select id, case_id, assigned_at from public.case_assignments
      where staff_user_id = p_staff_user_id and revoked_at is null for update loop
      update public.case_assignments
        set revoked_at = greatest(clock_timestamp(), assignment.assigned_at)
        where id = assignment.id;
      insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, reason)
      values (actor_id, assignment.case_id, 'case_assignment', assignment.id, 'revoked', clean_reason);
    end loop;
  end if;
end;
$$;
