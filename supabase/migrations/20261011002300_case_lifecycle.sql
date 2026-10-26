-- Case lifecycle transitions are explicit, authorized and audited.
create function private.lock_legal_case_editor(p_case_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); member public.staff_members%rowtype;
begin
  if actor_id is null then return false; end if;
  select * into member from public.staff_members where user_id = actor_id for update;
  if not found or not member.active then return false; end if;
  if member.role = 'admin' then return true; end if;
  if member.role <> 'lawyer' then return false; end if;
  perform 1 from public.case_assignments
    where case_id = p_case_id and staff_user_id = actor_id and revoked_at is null for update;
  return found;
end;
$$;
revoke all on function private.lock_legal_case_editor(uuid) from public, anon, authenticated;

create function public.staff_suspend_case(p_case_id uuid, p_reason_for_client text, p_control_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); item public.cases%rowtype; suspension_id uuid;
  clean_reason text := nullif(trim(p_reason_for_client), ''); client_user_id uuid;
begin
  if not private.lock_legal_case_editor(p_case_id) then raise exception 'Not authorized'; end if;
  select * into item from public.cases where id = p_case_id for update;
  if not found or item.status <> 'open' or item.is_suspended then raise exception 'Case cannot be suspended'; end if;
  if clean_reason is null or length(clean_reason) > 2000 or p_control_at is null or p_control_at <= clock_timestamp()
    then raise exception 'Reason and future control date are required'; end if;
  insert into public.case_suspensions (case_id, reason_for_client, control_at, started_by)
    values (p_case_id, clean_reason, p_control_at, actor_id) returning id into suspension_id;
  update public.cases set is_suspended = true, next_review_at = p_control_at,
    updated_at = clock_timestamp() where id = p_case_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
    values (actor_id, p_case_id, 'case_suspension', suspension_id, 'started',
      jsonb_build_object('reason_for_client', clean_reason, 'control_at', p_control_at));
  select cl.user_id into client_user_id from public.clients cl where cl.id = item.client_id;
  if client_user_id is not null then
    insert into public.notifications (recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
      values (client_user_id, p_case_id, 'case_status', 'Дело приостановлено', clean_reason,
        '/account/cases/' || p_case_id::text, 'case-suspended:' || suspension_id::text)
      on conflict (recipient_user_id, dedupe_key) do nothing;
  end if;
end;
$$;

create function public.staff_resume_case(p_case_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); item public.cases%rowtype; suspension public.case_suspensions%rowtype;
  client_user_id uuid;
begin
  if not private.lock_legal_case_editor(p_case_id) then raise exception 'Not authorized'; end if;
  select * into item from public.cases where id = p_case_id for update;
  if not found or item.status <> 'open' or not item.is_suspended then raise exception 'Case is not suspended'; end if;
  select * into suspension from public.case_suspensions
    where case_id = p_case_id and ended_at is null for update;
  if not found then raise exception 'Active suspension not found'; end if;
  update public.case_suspensions set ended_by = actor_id,
    ended_at = greatest(clock_timestamp(), suspension.started_at) where id = suspension.id;
  update public.cases set is_suspended = false, next_review_at = null,
    updated_at = clock_timestamp() where id = p_case_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action)
    values (actor_id, p_case_id, 'case_suspension', suspension.id, 'ended');
  select cl.user_id into client_user_id from public.clients cl where cl.id = item.client_id;
  if client_user_id is not null then
    insert into public.notifications (recipient_user_id, case_id, kind, title, target_path, dedupe_key)
      values (client_user_id, p_case_id, 'case_status', 'Работа по делу возобновлена',
        '/account/cases/' || p_case_id::text, 'case-resumed:' || suspension.id::text)
      on conflict (recipient_user_id, dedupe_key) do nothing;
  end if;
end;
$$;

create function public.staff_close_case(p_case_id uuid, p_result_summary text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); item public.cases%rowtype;
  clean_result text := nullif(trim(p_result_summary), ''); client_user_id uuid;
begin
  if not private.lock_legal_case_editor(p_case_id) then raise exception 'Not authorized'; end if;
  select * into item from public.cases where id = p_case_id for update;
  if not found or item.status <> 'open' or item.is_suspended then raise exception 'Case cannot be closed'; end if;
  if clean_result is null or length(clean_result) > 4000 then raise exception 'Result summary is required'; end if;
  if exists (
    select 1 from public.document_requests dr
    where dr.case_id = p_case_id and dr.required and dr.status = 'active'
      and not exists (select 1 from public.document_files df
        where df.request_id = dr.id and df.status = 'accepted')
  ) then raise exception 'Required documents are not accepted'; end if;
  update public.cases set status = 'closed', result_summary = clean_result,
    closed_at = clock_timestamp(), next_review_at = null, updated_at = clock_timestamp()
    where id = p_case_id;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
    values (actor_id, p_case_id, 'case', p_case_id, 'closed',
      jsonb_build_object('result_summary', clean_result));
  select cl.user_id into client_user_id from public.clients cl where cl.id = item.client_id;
  if client_user_id is not null then
    insert into public.notifications (recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
      values (client_user_id, p_case_id, 'case_status', 'Дело завершено', clean_result,
        '/account/cases/' || p_case_id::text, 'case-closed:' || p_case_id::text)
      on conflict (recipient_user_id, dedupe_key) do nothing;
  end if;
end;
$$;

revoke all on function public.staff_suspend_case(uuid, text, timestamptz) from public, anon;
revoke all on function public.staff_resume_case(uuid) from public, anon;
revoke all on function public.staff_close_case(uuid, text) from public, anon;
grant execute on function public.staff_suspend_case(uuid, text, timestamptz) to authenticated;
grant execute on function public.staff_resume_case(uuid) to authenticated;
grant execute on function public.staff_close_case(uuid, text) to authenticated;
