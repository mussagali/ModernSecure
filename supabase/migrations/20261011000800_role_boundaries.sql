-- One primary administrator; operational roles are granted to real, verified accounts.
do $$
declare owner_id uuid; matches integer;
begin
  select count(*)::integer into matches from auth.users
  where lower(email) = 'ayanz2008@gmail.com' and email_confirmed_at is not null;
  if matches <> 1 then raise exception 'Primary administrator account must be uniquely verified'; end if;
  select id into owner_id from auth.users where lower(email) = 'ayanz2008@gmail.com' and email_confirmed_at is not null;
  if exists (select 1 from public.staff_members where role = 'admin' and user_id <> owner_id) then
    raise exception 'Another administrator exists; inspect roles before continuing';
  end if;
  insert into public.staff_members (user_id, display_name, role, active)
  values (owner_id, 'Главный администратор', 'admin', true)
  on conflict (user_id) do update set role = 'admin', active = true;
end;
$$;
create unique index staff_one_primary_admin on public.staff_members ((role)) where role = 'admin';

-- Admin sees every case; lawyers and managers see only active assignments.
create or replace function private.is_staff_for_case(p_case_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff_members sm
    where sm.user_id = (select auth.uid()) and sm.active
      and (sm.role = 'admin' or exists (
        select 1 from public.case_assignments ca
        where ca.case_id = p_case_id and ca.staff_user_id = sm.user_id and ca.revoked_at is null
      ))
  )
$$;

-- Legal changes are made by the admin or an assigned lawyer, not by a manager.
create function private.can_edit_legal_case(p_case_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff_members sm
    where sm.user_id = (select auth.uid()) and sm.active
      and (sm.role = 'admin' or (sm.role = 'lawyer' and exists (
        select 1 from public.case_assignments ca
        where ca.case_id = p_case_id and ca.staff_user_id = sm.user_id and ca.revoked_at is null
      )))
  )
$$;
revoke all on function private.can_edit_legal_case(uuid) from public, anon, authenticated;

-- Managers no longer get a global list of staff through a direct select.
create or replace function private.can_read_staff_profile(p_staff_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_staff_user_id = (select auth.uid())
    or private.staff_role_for_current_user() = 'admin'
    or exists (
      select 1 from public.case_assignments ca
      join public.cases c on c.id = ca.case_id
      join public.clients cl on cl.id = c.client_id
      where ca.staff_user_id = p_staff_user_id and ca.revoked_at is null
        and (cl.user_id = (select auth.uid()) or private.is_staff_for_case(c.id))
    )
$$;

drop policy consents_own_or_admin_read on public.consent_records;
create policy consents_own_or_admin_read on public.consent_records for select to authenticated
  using (user_id = (select auth.uid()) or private.staff_role_for_current_user() = 'admin');

-- Keep the existing validated implementations, but make them inaccessible to
-- authenticated users directly. Public wrappers enforce the narrower role.
alter function public.staff_assign_case(uuid, uuid) set schema private;
revoke all on function private.staff_assign_case(uuid, uuid) from public, anon, authenticated;
create function public.staff_assign_case(p_case_id uuid, p_staff_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if private.staff_role_for_current_user() is distinct from 'admin' then raise exception 'Not authorized'; end if;
  return private.staff_assign_case(p_case_id, p_staff_user_id);
end;
$$;
revoke all on function public.staff_assign_case(uuid, uuid) from public, anon;
grant execute on function public.staff_assign_case(uuid, uuid) to authenticated;

alter function public.staff_create_case(uuid, uuid, text) set schema private;
revoke all on function private.staff_create_case(uuid, uuid, text) from public, anon, authenticated;
create function public.staff_create_case(p_client_id uuid, p_version_id uuid, p_title text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid; actor_id uuid := auth.uid(); assignment_id uuid;
begin
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
revoke all on function public.staff_create_case(uuid, uuid, text) from public, anon;
grant execute on function public.staff_create_case(uuid, uuid, text) to authenticated;

alter function public.staff_change_case_stage(uuid, uuid, uuid, text, text) set schema private;
revoke all on function private.staff_change_case_stage(uuid, uuid, uuid, text, text) from public, anon, authenticated;
create function public.staff_change_case_stage(
  p_case_id uuid, p_expected_stage_id uuid, p_to_stage_id uuid,
  p_client_note text, p_change_reason text default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_edit_legal_case(p_case_id) then raise exception 'Not authorized'; end if;
  perform private.staff_change_case_stage(p_case_id, p_expected_stage_id, p_to_stage_id, p_client_note, p_change_reason);
end;
$$;
revoke all on function public.staff_change_case_stage(uuid, uuid, uuid, text, text) from public, anon;
grant execute on function public.staff_change_case_stage(uuid, uuid, uuid, text, text) to authenticated;

alter function public.staff_create_task(uuid, public.task_kind, text, text, timestamptz) set schema private;
revoke all on function private.staff_create_task(uuid, public.task_kind, text, text, timestamptz) from public, anon, authenticated;
create function public.staff_create_task(
  p_case_id uuid, p_kind public.task_kind, p_title text,
  p_description text default null, p_due_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_edit_legal_case(p_case_id) then raise exception 'Not authorized'; end if;
  return private.staff_create_task(p_case_id, p_kind, p_title, p_description, p_due_at);
end;
$$;
revoke all on function public.staff_create_task(uuid, public.task_kind, text, text, timestamptz) from public, anon;
grant execute on function public.staff_create_task(uuid, public.task_kind, text, text, timestamptz) to authenticated;

alter function public.staff_review_task(uuid, boolean, text) set schema private;
revoke all on function private.staff_review_task(uuid, boolean, text) from public, anon, authenticated;
create function public.staff_review_task(p_task_id uuid, p_accept boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare case_id uuid;
begin
  select t.case_id into case_id from public.tasks t where t.id = p_task_id;
  if case_id is null or not private.can_edit_legal_case(case_id) then raise exception 'Not authorized'; end if;
  perform private.staff_review_task(p_task_id, p_accept, p_note);
end;
$$;
revoke all on function public.staff_review_task(uuid, boolean, text) from public, anon;
grant execute on function public.staff_review_task(uuid, boolean, text) to authenticated;

alter function public.staff_create_document_request(uuid, text, text, boolean, timestamptz) set schema private;
revoke all on function private.staff_create_document_request(uuid, text, text, boolean, timestamptz) from public, anon, authenticated;
create function public.staff_create_document_request(
  p_case_id uuid, p_title text, p_instructions text default null,
  p_required boolean default true, p_due_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_edit_legal_case(p_case_id) then raise exception 'Not authorized'; end if;
  return private.staff_create_document_request(p_case_id, p_title, p_instructions, p_required, p_due_at);
end;
$$;
revoke all on function public.staff_create_document_request(uuid, text, text, boolean, timestamptz) from public, anon;
grant execute on function public.staff_create_document_request(uuid, text, text, boolean, timestamptz) to authenticated;
