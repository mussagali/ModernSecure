-- Contact synchronization changes only the fields actually edited.
create or replace function private.sync_client_profile_contacts()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.clients set
    phone = case when old.phone is distinct from new.phone then new.phone else phone end,
    city = case when old.city is distinct from new.city then new.city else city end,
    updated_at = clock_timestamp()
  where user_id = new.user_id;
  return new;
end;
$$;

-- Populate the form from existing card contacts, including cards linked later.
create function private.seed_linked_profile_contacts()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is not null then
    update public.profiles set phone = coalesce(phone, new.phone), city = coalesce(city, new.city),
      updated_at = clock_timestamp()
      where user_id = new.user_id and ((phone is null and new.phone is not null) or (city is null and new.city is not null));
  end if;
  return new;
end;
$$;

revoke all on function private.seed_linked_profile_contacts() from public, anon, authenticated;

create trigger modernsecure_seed_linked_profile_contacts
after insert or update of user_id on public.clients
for each row execute function private.seed_linked_profile_contacts();

update public.profiles p set phone = coalesce(p.phone, cl.phone), city = coalesce(p.city, cl.city),
  updated_at = clock_timestamp()
from public.clients cl where cl.user_id = p.user_id
  and ((p.phone is null and cl.phone is not null) or (p.city is null and cl.city is not null));

create function public.save_own_profile(p_display_name text, p_phone text, p_city text, p_expected_updated_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare previous public.profiles%rowtype;
begin
  select * into previous from public.profiles where user_id = auth.uid() for update;
  if not found then raise exception 'Not authenticated'; end if;
  if previous.updated_at is distinct from p_expected_updated_at then raise exception 'Profile changed'; end if;
  perform public.update_own_profile(p_display_name, p_phone, p_city);
end;
$$;

revoke all on function public.save_own_profile(text, text, text, timestamptz) from public, anon;

grant execute on function public.save_own_profile(text, text, text, timestamptz) to authenticated;

-- Identity corrections are explicit, version checked, and never copy IINs into audit history.
create function public.staff_correct_client_identity(p_client_id uuid, p_expected_updated_at timestamptz,
  p_full_name text, p_iin text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare card public.clients%rowtype; linked_user uuid; clean_name text := nullif(trim(p_full_name), '');
  clean_iin text := nullif(trim(p_iin), ''); clean_reason text := nullif(trim(p_reason), '');
begin
  if not private.staff_mfa_passed() or coalesce(private.staff_role_for_current_user() not in ('admin', 'manager'), true)
    or auth.uid() is null then raise exception 'Not authorized'; end if;
  if clean_name is null or length(clean_name) > 160 or clean_name ~ '[[:cntrl:]]'
    or (clean_iin is not null and clean_iin !~ '^[0-9]{12}$')
    or clean_reason is null or length(clean_reason) > 500 then raise exception 'Invalid identity correction'; end if;
  select user_id into linked_user from public.clients where id = p_client_id;
  if linked_user is not null then
    perform 1 from auth.users where id = linked_user for update;
    perform 1 from public.profiles where user_id = linked_user for update;
  end if;
  select * into card from public.clients where id = p_client_id for update;
  if not found then raise exception 'Client not found'; end if;
  if card.user_id is distinct from linked_user or card.updated_at is distinct from p_expected_updated_at then
    raise exception 'Client changed';
  end if;
  if card.full_name = clean_name and card.iin is not distinct from clean_iin then return; end if;
  update public.clients set full_name = clean_name, iin = clean_iin, updated_at = clock_timestamp() where id = p_client_id;
  update public.profiles set full_name = clean_name, iin = clean_iin, updated_at = clock_timestamp() where user_id = linked_user;
  insert into public.audit_events(actor_user_id, entity_type, entity_id, action, after_data, reason)
  values(auth.uid(), 'client', p_client_id, 'identity_corrected',
    jsonb_build_object('name_changed', card.full_name is distinct from clean_name,
      'iin_changed', card.iin is distinct from clean_iin, 'iin_provided', clean_iin is not null), clean_reason);
end;
$$;

revoke all on function public.staff_correct_client_identity(uuid, timestamptz, text, text, text) from public, anon;

grant execute on function public.staff_correct_client_identity(uuid, timestamptz, text, text, text) to authenticated;

-- A reasoned waiver satisfies a template. Cancelling a mistaken request does not.
create function private.case_required_documents_complete(p_case_id uuid, p_version_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.document_requests dr where dr.case_id = p_case_id and dr.required and dr.status = 'active'
      and private.document_request_current_state(dr.id) <> 'accepted'
  ) and not exists (
    select 1 from public.document_templates dt where dt.version_id = p_version_id and dt.required
    and not exists (
      select 1 from public.document_requests dr where dr.case_id = p_case_id and dr.template_id = dt.id
        and ((dr.status = 'active' and private.document_request_current_state(dr.id) = 'accepted')
          or (dr.status = 'not_required' and nullif(trim(dr.closure_reason), '') is not null))
    )
  );
$$;

revoke all on function private.case_required_documents_complete(uuid, uuid) from public, anon, authenticated;

create or replace function private.guard_case_close_document_versions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'closed' and old.status is distinct from 'closed'
    and not private.case_required_documents_complete(new.id, new.service_version_id) then
    raise exception 'Latest required document versions are not accepted';
  end if;
  return new;
end;
$$;

create or replace function public.staff_close_case(p_case_id uuid, p_result_summary text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); item public.cases%rowtype; pending_task record;
  clean_result text := nullif(trim(p_result_summary), ''); client_user_id uuid;
begin
  if not private.lock_legal_case_editor(p_case_id) then raise exception 'Not authorized'; end if;
  select * into item from public.cases where id = p_case_id for update;
  if not found or item.status <> 'open' or item.is_suspended then raise exception 'Case cannot be closed'; end if;
  if clean_result is null or length(clean_result) > 4000 then raise exception 'Result summary is required'; end if;
  if not private.case_required_documents_complete(p_case_id, item.service_version_id) then
    raise exception 'Required documents are not accepted';
  end if;
  update public.cases set status = 'closed', result_summary = clean_result,
    closed_at = clock_timestamp(), next_review_at = null, updated_at = clock_timestamp()
    where id = p_case_id;
  for pending_task in select id, status from public.tasks
    where case_id = p_case_id and status in ('new', 'response_sent') for update loop
    update public.tasks set status = 'cancelled', updated_at = clock_timestamp()
      where id = pending_task.id;
    insert into public.task_events (task_id, actor_user_id, action, response_text)
      values (pending_task.id, actor_id, 'cancelled', 'Дело завершено');
    insert into public.audit_events (actor_user_id, case_id, entity_type, entity_id, action, before_data, after_data)
      values (actor_id, p_case_id, 'task', pending_task.id, 'cancelled_on_case_close',
        jsonb_build_object('status', pending_task.status), jsonb_build_object('status', 'cancelled'));
  end loop;
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

notify pgrst, 'reload schema';
