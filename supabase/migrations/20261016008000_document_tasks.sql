-- Upload tasks own a document request; file review remains the source of truth.
create or replace function public.staff_create_task(p_case_id uuid, p_kind public.task_kind, p_title text,
 p_description text default null, p_due_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare request_id uuid; task_id uuid;
begin
  if not private.staff_mfa_passed() or not private.lock_legal_case_editor(p_case_id) then raise exception 'Not authorized'; end if;
  perform 1 from public.cases where id = p_case_id and status = 'open' and not is_suspended for update;
  if not found then raise exception 'Case is not active'; end if;
  if p_kind = 'acknowledge' and nullif(trim(p_description), '') is null then raise exception 'Acknowledgment text is required'; end if;
  if p_kind is distinct from 'upload_document' then
    return private.staff_create_task(p_case_id, p_kind, p_title, p_description, p_due_at);
  end if;
  request_id := public.staff_create_document_request(p_case_id, p_title, p_description, true, p_due_at);
  insert into public.tasks(case_id, document_request_id, kind, title, description, due_at, created_by)
    values(p_case_id, request_id, p_kind, trim(p_title), nullif(trim(p_description), ''), p_due_at, auth.uid()) returning id into task_id;
  insert into public.task_events(task_id, actor_user_id, action) values(task_id, auth.uid(), 'created');
  insert into public.audit_events(actor_user_id, case_id, entity_type, entity_id, action, after_data)
    values(auth.uid(), p_case_id, 'task', task_id, 'created', jsonb_build_object('document_request_id', request_id));
  return task_id;
end; $$;

create function private.sync_document_tasks()
returns trigger language plpgsql security definer set search_path = '' as $$
declare request_id uuid; request_status public.document_request_status; reason text; state text;
  next_status public.task_status; task public.tasks%rowtype; actor uuid;
begin
  if tg_table_name = 'document_files' then request_id := new.request_id; actor := coalesce(auth.uid(), new.reviewed_by, new.uploaded_by);
  else request_id := new.id; actor := coalesce(auth.uid(), new.created_by); end if;
  select status, closure_reason into request_status, reason from public.document_requests where id = request_id;
  state := private.document_request_current_state(request_id);
  next_status := case when request_status <> 'active' then 'cancelled'::public.task_status
    when state = 'accepted' then 'completed'::public.task_status
    when state = 'under_review' then 'response_sent'::public.task_status else 'new'::public.task_status end;
  for task in select * from public.tasks where document_request_id = request_id and kind = 'upload_document' and status <> 'cancelled' for update loop
    if task.status = next_status then continue; end if;
    update public.tasks set status = next_status, updated_at = clock_timestamp(),
      completed_at = case when next_status = 'completed' then clock_timestamp() end,
      completed_by = case when next_status = 'completed' then actor end where id = task.id;
    insert into public.task_events(task_id, actor_user_id, action, response_text)
      values(task.id, actor, case next_status when 'completed' then 'completed' when 'response_sent' then 'responded' when 'cancelled' then 'cancelled' else 'returned' end,
      case next_status when 'completed' then 'Все файлы документа приняты' when 'response_sent' then 'Документ отправлен на проверку' when 'cancelled' then coalesce(reason, 'Запрос закрыт') else 'Нужно отправить исправленный или полный набор файлов' end);
    insert into public.audit_events(actor_user_id, case_id, entity_type, entity_id, action, after_data)
      values(actor, task.case_id, 'task', task.id, 'document_status_synced', jsonb_build_object('status', next_status, 'document_request_id', request_id));
  end loop;
  return new;
end; $$;
revoke all on function private.sync_document_tasks() from public, anon, authenticated;
create trigger modernsecure_document_task_files after insert or update of status on public.document_files for each row execute function private.sync_document_tasks();
create trigger modernsecure_document_task_closed after update of status on public.document_requests for each row when(old.status is distinct from new.status) execute function private.sync_document_tasks();

-- A linked task is cancelled by closing its request, and reviewed through its files.
create function private.guard_linked_document_task()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.kind = 'upload_document' and old.document_request_id is not null and new.status is distinct from old.status
    and pg_trigger_depth() = 1 then raise exception 'Review or close the linked document request'; end if;
  return new;
end; $$;
revoke all on function private.guard_linked_document_task() from public, anon, authenticated;
create trigger modernsecure_linked_document_task_guard before update of status on public.tasks for each row execute function private.guard_linked_document_task();
