-- Each closure has its own event key, including closure after restoration.
create or replace function public.staff_close_document_request(p_request_id uuid, p_status public.document_request_status, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare item public.document_requests%rowtype; target_case uuid; recipient uuid; clean_reason text := nullif(trim(p_reason), ''); event_id bigint;
begin
  select case_id into target_case from public.document_requests where id = p_request_id;
  if not private.staff_mfa_passed() or not private.lock_legal_case_editor(target_case) then raise exception 'Not authorized'; end if;
  perform 1 from public.cases where id = target_case and status = 'open' for update;
  if not found then raise exception 'Case is not active'; end if;
  select * into item from public.document_requests where id = p_request_id for update;
  if not found or item.status <> 'active' then raise exception 'Request changed'; end if;
  if p_status is null or p_status not in ('cancelled', 'not_required') or clean_reason is null or length(clean_reason) > 1000 then raise exception 'Reason is required'; end if;
  update public.document_requests set status = p_status, closure_reason = clean_reason, updated_at = clock_timestamp() where id = p_request_id;
  insert into public.audit_events(actor_user_id, case_id, entity_type, entity_id, action, reason, after_data)
    values(auth.uid(), target_case, 'document_request', p_request_id, 'closed', clean_reason, jsonb_build_object('status', p_status)) returning id into event_id;
  select cl.user_id into recipient from public.clients cl join public.cases c on c.client_id = cl.id where c.id = target_case;
  if recipient is not null then
    insert into public.notifications(recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
      values(recipient, target_case, 'document_request_closed', case when p_status = 'not_required' then 'Документ больше не требуется: ' else 'Запрос документа отменён: ' end || item.title, clean_reason,
        '/account/cases/' || target_case || '/documents#request-' || p_request_id, 'document-request-closed:' || p_request_id || ':' || event_id);
  end if;
end; $$;
revoke all on function public.staff_close_document_request(uuid, public.document_request_status, text) from public, anon;
grant execute on function public.staff_close_document_request(uuid, public.document_request_status, text) to authenticated;

-- A cancelled required checklist item must not strand its case permanently.
-- Restore the original template link; the existing reasoned waiver remains available.
create function public.staff_reopen_template_document_request(p_request_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare item public.document_requests%rowtype; target_case uuid; recipient uuid;
  clean_reason text := nullif(trim(p_reason), ''); event_id bigint;
begin
  select case_id into target_case from public.document_requests where id = p_request_id;
  if not private.staff_mfa_passed() or not private.lock_legal_case_editor(target_case) then
    raise exception 'Not authorized';
  end if;
  perform 1 from public.cases where id = target_case and status = 'open' and not is_suspended for update;
  if not found then raise exception 'Case is not active'; end if;
  select * into item from public.document_requests where id = p_request_id for update;
  if not found or item.status <> 'cancelled' or not exists (
    select 1 from public.document_templates dt where dt.id = item.template_id and dt.required
  ) then raise exception 'Request cannot be restored'; end if;
  if clean_reason is null or length(clean_reason) > 1000 then raise exception 'Reason is required'; end if;
  update public.document_requests set status = 'active', closure_reason = null,
    updated_at = clock_timestamp() where id = p_request_id;
  insert into public.audit_events(actor_user_id, case_id, entity_type, entity_id, action, reason, before_data, after_data)
    values(auth.uid(), target_case, 'document_request', p_request_id, 'reopened', clean_reason,
      jsonb_build_object('status', item.status, 'closure_reason', item.closure_reason),
      jsonb_build_object('status', 'active')) returning id into event_id;
  select cl.user_id into recipient from public.clients cl join public.cases c on c.client_id = cl.id where c.id = target_case;
  if recipient is not null then
    insert into public.notifications(recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
      values(recipient, target_case, 'document_request', 'Запрос документа восстановлен: ' || item.title,
        clean_reason, '/account/cases/' || target_case || '/documents#request-' || p_request_id,
        'document-request-reopened:' || event_id);
  end if;
end; $$;
revoke all on function public.staff_reopen_template_document_request(uuid, text) from public, anon;
grant execute on function public.staff_reopen_template_document_request(uuid, text) to authenticated;

-- Cancellation records why work stopped without asserting a successful outcome.
-- Completed work and financial records remain in the case history.
create function public.staff_cancel_case(p_case_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare item public.cases%rowtype; request record; task record; suspension record;
  actor_id uuid := auth.uid(); recipient uuid; clean_reason text := nullif(trim(p_reason), '');
begin
  if not private.staff_mfa_passed() or not private.lock_legal_case_editor(p_case_id) then
    raise exception 'Not authorized';
  end if;
  select * into item from public.cases where id = p_case_id for update;
  if not found or item.status <> 'open' then raise exception 'Case cannot be cancelled'; end if;
  if clean_reason is null or length(clean_reason) > 2000 then raise exception 'Reason is required'; end if;
  for request in select dr.id from public.document_requests dr
    where dr.case_id = p_case_id and dr.status = 'active'
      and private.document_request_current_state(dr.id) <> 'accepted' for update loop
    update public.document_requests set status = 'cancelled', closure_reason = clean_reason,
      updated_at = clock_timestamp() where id = request.id;
    insert into public.audit_events(actor_user_id, case_id, entity_type, entity_id, action, reason)
      values(actor_id, p_case_id, 'document_request', request.id, 'cancelled_on_case_cancel', clean_reason);
  end loop;
  -- Linked document tasks have already followed their requests through the trigger.
  for task in select id, status from public.tasks
    where case_id = p_case_id and status in ('new', 'response_sent') for update loop
    update public.tasks set status = 'cancelled', updated_at = clock_timestamp() where id = task.id;
    insert into public.task_events(task_id, actor_user_id, action, response_text)
      values(task.id, actor_id, 'cancelled', 'Дело отменено: ' || clean_reason);
    insert into public.audit_events(actor_user_id, case_id, entity_type, entity_id, action, before_data, after_data, reason)
      values(actor_id, p_case_id, 'task', task.id, 'cancelled_on_case_cancel',
        jsonb_build_object('status', task.status), jsonb_build_object('status', 'cancelled'), clean_reason);
  end loop;
  for suspension in select id, started_at from public.case_suspensions
    where case_id = p_case_id and ended_at is null for update loop
    update public.case_suspensions set ended_by = actor_id,
      ended_at = greatest(clock_timestamp(), suspension.started_at) where id = suspension.id;
    insert into public.audit_events(actor_user_id, case_id, entity_type, entity_id, action, reason)
      values(actor_id, p_case_id, 'case_suspension', suspension.id, 'ended', 'Дело отменено: ' || clean_reason);
  end loop;
  update public.cases set status = 'cancelled', is_suspended = false, next_review_at = null,
    result_summary = clean_reason, closed_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = p_case_id;
  insert into public.audit_events(actor_user_id, case_id, entity_type, entity_id, action, reason, before_data, after_data)
    values(actor_id, p_case_id, 'case', p_case_id, 'cancelled', clean_reason,
      jsonb_build_object('status', item.status, 'is_suspended', item.is_suspended),
      jsonb_build_object('status', 'cancelled'));
  select user_id into recipient from public.clients where id = item.client_id;
  if recipient is not null then
    insert into public.notifications(recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
      values(recipient, p_case_id, 'case_status', 'Дело отменено', clean_reason,
        '/account/cases/' || p_case_id, 'case-cancelled:' || p_case_id);
  end if;
end; $$;
revoke all on function public.staff_cancel_case(uuid, text) from public, anon;
grant execute on function public.staff_cancel_case(uuid, text) to authenticated;

-- Work queues count only decisions staff can actually perform.
create or replace function public.staff_case_worklist(
  p_query text default '',
  p_status text default 'all',
  p_attention text default 'all',
  p_staff uuid default null,
  p_service uuid default null,
  p_stage uuid default null,
  p_client uuid default null,
  p_page integer default 1,
  p_sort text default 'activity'
)
returns table (
  case_id uuid, case_number text, title text, client_name text,
  status public.case_status, is_suspended boolean, stage_name text,
  service_name text, updated_at timestamptz, last_message_at timestamptz,
  last_message_body text, unread_count bigint, overdue_count bigint,
  review_count bigint, total_count bigint
)
language plpgsql stable security definer set search_path = '' as $$
declare
  viewer_id uuid := auth.uid();
  viewer_role public.staff_role := private.staff_role_for_current_user();
  clean_query text := lower(trim(coalesce(p_query, '')));
begin
  if viewer_role is null or viewer_id is null then
    raise exception 'Not authorized';
  end if;
  if length(clean_query) > 120 or p_page is null or p_page not between 1 and 10000
    or p_status is null or p_status not in ('all', 'open', 'closed', 'suspended', 'cancelled')
    or p_attention is null or p_attention not in ('all', 'unread', 'overdue', 'documents', 'messages')
    or p_sort is null or p_sort not in ('activity', 'message') then
    raise exception 'Invalid worklist filter';
  end if;

  return query
    with visible as (
      select c.id, c.case_number, c.title, cl.full_name,
        c.status, c.is_suspended, st.title as stage_title,
        sv.name as service_title, c.updated_at
      from public.cases c
      join public.clients cl on cl.id = c.client_id
      join public.service_template_versions v on v.id = c.service_version_id
      join public.service_templates sv on sv.id = v.service_id
      left join public.stage_templates st on st.id = c.current_stage_id
      where (viewer_role = 'admin' or exists (
        select 1 from public.case_assignments ca
        where ca.case_id = c.id and ca.staff_user_id = viewer_id and ca.revoked_at is null
      ))
        and (p_staff is null or exists (
          select 1 from public.case_assignments ca
          join public.staff_members sm on sm.user_id = ca.staff_user_id
          where ca.case_id = c.id and ca.staff_user_id = p_staff
            and ca.revoked_at is null and sm.active
        ))
        and (p_service is null or sv.id = p_service)
        and (p_stage is null or c.current_stage_id = p_stage)
        and (p_client is null or c.client_id = p_client)
        and (p_status = 'all'
          or (p_status = 'open' and c.status = 'open' and not c.is_suspended)
          or (p_status = 'closed' and c.status = 'closed')
          or (p_status = 'cancelled' and c.status = 'cancelled')
          or (p_status = 'suspended' and c.status = 'open' and c.is_suspended))
        and (clean_query = ''
          or position(clean_query in lower(c.case_number)) > 0
          or position(clean_query in lower(c.title)) > 0
          or position(clean_query in lower(cl.full_name)) > 0
          or exists (
            select 1 from public.contracts ct
            where ct.case_id = c.id and position(clean_query in lower(ct.contract_number)) > 0
          ))
    ), enriched as (
      select v.*, latest.created_at as latest_at,
        latest.preview as latest_body,
        coalesce(unread.items, 0)::bigint as unread_items,
        coalesce(overdue.items, 0)::bigint as overdue_items,
        coalesce(reviews.items, 0)::bigint as review_items
      from visible v
      left join lateral (
        select m.created_at,
          coalesce(nullif(left(trim(m.body), 160), ''), 'Вложение') as preview
        from public.messages m where m.case_id = v.id
        order by m.created_at desc, m.id desc limit 1
      ) latest on true
      left join lateral (
        select count(*) as items from public.messages m
        where m.case_id = v.id and m.sender_user_id <> viewer_id
          and not exists (
            select 1 from public.message_reads mr
            where mr.message_id = m.id and mr.reader_user_id = viewer_id
          )
      ) unread on true
      left join lateral (
        select count(*) as items from public.tasks t
        where t.case_id = v.id and t.status = 'new' and t.due_at < now()
          and v.status = 'open' and not v.is_suspended
      ) overdue on true
      left join lateral (
        select count(*) as items from public.document_requests dr
        join public.document_files df on df.request_id = dr.id
        where dr.case_id = v.id and df.status = 'under_review'
          and dr.status = 'active' and v.status = 'open' and not v.is_suspended
      ) reviews on true
    )
    select e.id, e.case_number, e.title, e.full_name, e.status, e.is_suspended,
      e.stage_title, e.service_title, e.updated_at, e.latest_at, e.latest_body,
      e.unread_items, e.overdue_items, e.review_items, count(*) over ()
    from enriched e
    where p_attention = 'all'
      or (p_attention = 'unread' and e.unread_items > 0)
      or (p_attention = 'overdue' and e.overdue_items > 0)
      or (p_attention = 'documents' and e.review_items > 0)
      or (p_attention = 'messages' and e.latest_at is not null)
    order by
      case when p_sort = 'message' then e.latest_at else e.updated_at end desc nulls last,
      e.id desc
    limit 25 offset (p_page - 1) * 25;
end;
$$;

revoke all on function public.staff_case_worklist(text, text, text, uuid, uuid, uuid, uuid, integer, text) from public, anon;
grant execute on function public.staff_case_worklist(text, text, text, uuid, uuid, uuid, uuid, integer, text) to authenticated;

-- A decision must refer to the exact response the reviewer saw. Status alone
-- cannot distinguish response A from response B after a return/resubmission.
alter table public.tasks add column response_event_id uuid references public.task_events(id) on delete restrict;
update public.tasks t set response_event_id = (
  select e.id from public.task_events e where e.task_id = t.id and e.action in ('responded', 'acknowledged')
  order by e.occurred_at desc, e.id desc limit 1
);
create function private.capture_task_response_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.tasks set response_event_id = new.id where id = new.task_id;
  return new;
end; $$;
revoke all on function private.capture_task_response_revision() from public, anon, authenticated;
create trigger modernsecure_task_response_revision after insert on public.task_events
for each row when (new.action in ('responded', 'acknowledged'))
execute function private.capture_task_response_revision();

revoke all on function public.staff_review_task(uuid, boolean, text) from public, anon, authenticated;
create function public.staff_review_task(p_task_id uuid, p_expected_response_id uuid, p_accept boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare target_case uuid; item public.tasks%rowtype;
begin
  if p_accept is null then raise exception 'Task review decision is required'; end if;
  select case_id into target_case from public.tasks where id = p_task_id;
  if not private.staff_mfa_passed() or not private.lock_legal_case_editor(target_case) then
    raise exception 'Not authorized';
  end if;
  perform 1 from public.cases where id = target_case and status = 'open' and not is_suspended for update;
  if not found then raise exception 'Case is not active'; end if;
  select * into item from public.tasks where id = p_task_id for update;
  if not found or item.status <> 'response_sent' or p_expected_response_id is null
    or item.response_event_id is distinct from p_expected_response_id then
    raise exception 'Task response changed';
  end if;
  perform private.staff_review_task(p_task_id, p_accept, p_note);
end; $$;
revoke all on function public.staff_review_task(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.staff_review_task(uuid, uuid, boolean, text) to authenticated;

notify pgrst, 'reload schema';
