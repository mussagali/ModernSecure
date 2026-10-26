-- Reminders use confirmed money, not uploaded receipts. Retries are idempotent.
create function private.enqueue_payment_deadline_reminders(p_reference_day date default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare local_day date := coalesce(p_reference_day, (now() at time zone 'Asia/Almaty')::date); inserted_count integer;
begin
  insert into public.notifications(recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
  select cl.user_id, c.id, 'payment_deadline',
    case when s.due_on = local_day then 'Срок оплаты сегодня' else 'Срок оплаты завтра' end,
    'Остаток: ' || (s.amount_kzt - coalesce(p.paid, 0))::text || ' ₸. Откройте график платежей.',
    '/account/cases/' || c.id || '/payments',
    'payment-deadline:' || s.id || ':' || s.due_on || ':' || case when s.due_on = local_day then 'today' else 'tomorrow' end
  from public.payment_schedule s join public.cases c on c.id = s.case_id
  join public.clients cl on cl.id = c.client_id
  left join lateral (select sum(amount_kzt) as paid from public.payments where schedule_id = s.id and status = 'confirmed') p on true
  where s.due_on between local_day and local_day + 1 and c.status = 'open' and not c.is_suspended
    and cl.user_id is not null and s.amount_kzt > coalesce(p.paid, 0)
  on conflict (recipient_user_id, dedupe_key) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;
revoke all on function private.enqueue_payment_deadline_reminders(date) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    perform cron.schedule('modernsecure-payment-deadlines', '5 * * * *', 'select private.enqueue_payment_deadline_reminders()');
  end if;
end; $$;

alter table public.document_requests add column closure_reason text;

create function public.staff_cancel_task(p_task_id uuid, p_expected_status public.task_status, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare item public.tasks%rowtype; target_case uuid; recipient uuid; clean_reason text := nullif(trim(p_reason), '');
begin
  select case_id into target_case from public.tasks where id = p_task_id;
  if not private.staff_mfa_passed() or not private.lock_legal_case_editor(target_case) then raise exception 'Not authorized'; end if;
  perform 1 from public.cases where id = target_case and status = 'open' for update;
  if not found then raise exception 'Case is not active'; end if;
  select * into item from public.tasks where id = p_task_id for update;
  if not found or item.status is distinct from p_expected_status or item.status not in ('new', 'response_sent') then raise exception 'Task changed'; end if;
  if clean_reason is null or length(clean_reason) > 1000 then raise exception 'Reason is required'; end if;
  update public.tasks set status = 'cancelled', updated_at = clock_timestamp() where id = p_task_id;
  insert into public.task_events(task_id, actor_user_id, action, response_text) values(p_task_id, auth.uid(), 'cancelled', clean_reason);
  insert into public.audit_events(actor_user_id, case_id, entity_type, entity_id, action, reason)
    values(auth.uid(), target_case, 'task', p_task_id, 'cancelled', clean_reason);
  select cl.user_id into recipient from public.clients cl join public.cases c on c.client_id = cl.id where c.id = target_case;
  if recipient is not null then
    insert into public.notifications(recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
      values(recipient, target_case, 'task_cancelled', 'Задача отменена: ' || item.title, clean_reason,
        '/account/cases/' || target_case || '/tasks#task-' || p_task_id, 'task-cancelled:' || p_task_id);
  end if;
end; $$;
revoke all on function public.staff_cancel_task(uuid, public.task_status, text) from public, anon;
grant execute on function public.staff_cancel_task(uuid, public.task_status, text) to authenticated;

create function public.staff_close_document_request(p_request_id uuid, p_status public.document_request_status, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare item public.document_requests%rowtype; target_case uuid; recipient uuid; clean_reason text := nullif(trim(p_reason), '');
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
    values(auth.uid(), target_case, 'document_request', p_request_id, 'closed', clean_reason, jsonb_build_object('status', p_status));
  select cl.user_id into recipient from public.clients cl join public.cases c on c.client_id = cl.id where c.id = target_case;
  if recipient is not null then
    insert into public.notifications(recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
      values(recipient, target_case, 'document_request_closed', 'Документ больше не требуется: ' || item.title, clean_reason,
        '/account/cases/' || target_case || '/documents#request-' || p_request_id, 'document-request-closed:' || p_request_id);
  end if;
end; $$;
revoke all on function public.staff_close_document_request(uuid, public.document_request_status, text) from public, anon;
grant execute on function public.staff_close_document_request(uuid, public.document_request_status, text) to authenticated;

-- Keep validated implementations private. Old clients cannot bypass the revision check.
alter function public.admin_save_contact_settings(text, text, text, text, text) set schema private;
revoke all on function private.admin_save_contact_settings(text, text, text, text, text) from public, anon, authenticated;
alter function public.admin_upsert_faq(uuid, text, text, integer, boolean) set schema private;
revoke all on function private.admin_upsert_faq(uuid, text, text, integer, boolean) from public, anon, authenticated;
alter table public.contact_settings add column payment_details text check (length(payment_details) <= 4000);

create function public.admin_save_contact_settings(p_phone text, p_email text, p_whatsapp_url text,
 p_business_hours text, p_response_expectation text, p_expected_updated_at timestamptz, p_payment_details text)
returns void language plpgsql security definer set search_path = '' as $$
declare previous public.contact_settings%rowtype;
begin
  if not private.staff_mfa_passed() or private.staff_role_for_current_user() is distinct from 'admin' then raise exception 'Not authorized'; end if;
  perform pg_advisory_xact_lock(781601);
  select * into previous from public.contact_settings where id = true for update;
  if previous.updated_at is distinct from p_expected_updated_at then raise exception 'Settings changed'; end if;
  if length(coalesce(p_payment_details, '')) > 4000 then raise exception 'Invalid payment details'; end if;
  perform private.admin_save_contact_settings(p_phone, p_email, p_whatsapp_url, p_business_hours, p_response_expectation);
  if previous.payment_details is distinct from nullif(trim(p_payment_details), '') then
    insert into public.contact_settings(id, payment_details) values(true, nullif(trim(p_payment_details), ''))
    on conflict(id) do update set payment_details = excluded.payment_details, updated_at = clock_timestamp();
    insert into public.audit_events(actor_user_id, entity_type, action) values(auth.uid(), 'contact_settings', 'payment_details_updated');
  end if;
end; $$;
revoke all on function public.admin_save_contact_settings(text, text, text, text, text, timestamptz, text) from public, anon;
grant execute on function public.admin_save_contact_settings(text, text, text, text, text, timestamptz, text) to authenticated;

create function public.admin_upsert_faq(p_id uuid, p_question text, p_answer text, p_position integer, p_published boolean, p_expected_updated_at timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare revision timestamptz;
begin
  if not private.staff_mfa_passed() or private.staff_role_for_current_user() is distinct from 'admin' then raise exception 'Not authorized'; end if;
  if p_id is not null then
    select updated_at into revision from public.faq_entries where id = p_id for update;
    if not found or revision is distinct from p_expected_updated_at then raise exception 'Settings changed'; end if;
  end if;
  return private.admin_upsert_faq(p_id, p_question, p_answer, p_position, p_published);
end; $$;
revoke all on function public.admin_upsert_faq(uuid, text, text, integer, boolean, timestamptz) from public, anon;
grant execute on function public.admin_upsert_faq(uuid, text, text, integer, boolean, timestamptz) to authenticated;
