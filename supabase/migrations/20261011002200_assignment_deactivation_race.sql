-- Serialize assignment creation with staff deactivation. The private implementation
-- rechecks active after the wrapper has acquired the target row lock.
create or replace function public.staff_assign_case(p_case_id uuid, p_staff_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if private.staff_role_for_current_user() is distinct from 'admin' then raise exception 'Not authorized'; end if;
  perform 1 from public.staff_members where user_id = p_staff_user_id for update;
  return private.staff_assign_case(p_case_id, p_staff_user_id);
end;
$$;

-- The manager's automatic assignment on a newly created case needs the same
-- lock on the manager's own staff row.
create or replace function public.staff_create_case(p_client_id uuid, p_version_id uuid, p_title text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid; actor_id uuid := auth.uid(); assignment_id uuid;
begin
  perform 1 from public.staff_members where user_id = actor_id for update;
  if private.staff_role_for_current_user() not in ('manager', 'admin') then raise exception 'Not authorized'; end if;
  new_id := private.staff_create_case(p_client_id, p_version_id, p_title);
  if private.staff_role_for_current_user() = 'manager' then
    insert into public.case_assignments (case_id, staff_user_id, assigned_by)
    values (new_id, actor_id, actor_id) returning id into assignment_id;
    insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
    values (actor_id, new_id, 'case_assignment', assignment_id, 'created', jsonb_build_object('staff_user_id', actor_id));
  end if;
  return new_id;
end;
$$;

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
  if not p_active then
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

create or replace function public.admin_revoke_case_assignment(p_assignment_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); assignment public.case_assignments%rowtype; clean_reason text := nullif(trim(p_reason), '');
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  if p_assignment_id is null or clean_reason is null or length(clean_reason) > 500 then
    raise exception 'Reason is required';
  end if;
  select * into assignment from public.case_assignments where id = p_assignment_id for update;
  if not found or assignment.revoked_at is not null then raise exception 'Active assignment not found'; end if;
  update public.case_assignments
    set revoked_at = greatest(clock_timestamp(), assignment.assigned_at)
    where id = p_assignment_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, reason, before_data)
  values (actor_id, assignment.case_id, 'case_assignment', assignment.id, 'revoked', clean_reason,
    jsonb_build_object('staff_user_id', assignment.staff_user_id));
end;
$$;
