-- Required consent is a data-boundary check, including Realtime table reads.
-- Keep the documents, consent history and support needed to complete it readable.
do $$
declare item record;
begin
  for item in select tablename from pg_tables where schemaname = 'public'
    and tablename not in ('legal_documents', 'consent_records', 'contact_settings', 'faq_entries') loop
    execute format(
      'create policy client_consent_guard on public.%I as restrictive for all to authenticated '
      || 'using ((select public.client_consent_status())) '
      || 'with check ((select public.client_consent_status()))', item.tablename
    );
  end loop;
end;
$$;

-- SECURITY DEFINER RPCs bypass table policies, so enforce consent in the
-- existing API hook too. Approval and MFA still precede consent bootstrap.
create or replace function public.enforce_staff_mfa_request()
returns void language plpgsql stable security definer set search_path = '' as $$
declare request_path text := trim(both '/' from coalesce(current_setting('request.path', true), ''));
begin
  if auth.jwt()->>'role' = 'service_role' then return; end if;
  if request_path in ('rpc/staff_mfa_status', 'rpc/claim_staff_invite', 'rpc/account_access_status') then return; end if;
  if auth.uid() is not null and public.account_access_status() = 'pending'
    and request_path not in ('contact_settings', 'faq_entries', 'legal_documents') then
    raise sqlstate 'PGRST' using
      message = '{"code":"ACCOUNT_PENDING","message":"Account approval is required"}',
      detail = '{"status":403,"headers":{}}';
  end if;
  if not private.staff_mfa_passed() then
    raise sqlstate 'PGRST' using
      message = '{"code":"MFA_REQUIRED","message":"Complete two-factor authentication"}',
      detail = '{"status":403,"headers":{}}';
  end if;
  if auth.uid() is not null and not public.client_consent_status()
    and request_path not in ('rpc/client_consent_status', 'rpc/accept_client_consents',
      'legal_documents', 'consent_records', 'contact_settings', 'faq_entries') then
    raise sqlstate 'PGRST' using
      message = '{"code":"CONSENT_REQUIRED","message":"Accept current required documents"}',
      detail = '{"status":403,"headers":{}}';
  end if;
end;
$$;

-- Recheck the same assignment boundary immediately before serving bytes.
-- Managers, like lawyers, need a current case assignment; admin scope is unchanged.
create or replace function public.server_record_file_access(
  p_actor_user_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_action text
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  related_case_id uuid;
  related_thread_id uuid;
  permitted boolean := false;
begin
  if p_actor_user_id is null or p_entity_id is null
    or p_action not in ('preview_issued', 'download_issued') then
    raise exception 'Invalid file access event';
  end if;
  case p_entity_type
    when 'document_file' then
      select dr.case_id into related_case_id
      from public.document_files df
      join public.document_requests dr on dr.id = df.request_id
      where df.id = p_entity_id and df.status in ('under_review', 'accepted', 'returned');
    when 'contract' then
      select c.case_id into related_case_id from public.contracts c where c.id = p_entity_id;
    when 'payment_receipt' then
      select r.case_id into related_case_id from public.payment_receipts r where r.id = p_entity_id;
    when 'message_attachment' then
      select m.case_id into related_case_id
      from public.message_attachments a join public.messages m on m.id = a.message_id
      where a.id = p_entity_id;
    when 'staff_message_attachment' then
      select m.thread_id into related_thread_id
      from public.staff_message_attachments a join public.staff_messages m on m.id = a.message_id
      where a.id = p_entity_id;
    else
      raise exception 'Invalid file access entity';
  end case;
  if related_case_id is not null then
    select exists (
      select 1 from public.cases c join public.clients cl on cl.id = c.client_id
      where c.id = related_case_id and cl.user_id = p_actor_user_id
    ) or exists (
      select 1 from public.staff_members sm
      where sm.user_id = p_actor_user_id and sm.active
        and (sm.role = 'admin' or exists (
          select 1 from public.case_assignments ca
          where ca.case_id = related_case_id and ca.staff_user_id = p_actor_user_id and ca.revoked_at is null
        ))
    ) into permitted;
  elsif related_thread_id is not null then
    select exists (
      select 1 from public.staff_threads t
      join public.staff_members sm on sm.user_id = p_actor_user_id and sm.active
      where t.id = related_thread_id and p_actor_user_id in (t.user_low, t.user_high)
    ) into permitted;
  end if;
  if not permitted then raise exception 'File access is no longer authorized'; end if;
  insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, after_data)
  values (p_actor_user_id, related_case_id, p_entity_type, p_entity_id, p_action,
    case when related_thread_id is null then null else jsonb_build_object('thread_id', related_thread_id) end);
end;
$$;

notify pgrst, 'reload schema';
