-- Only the principal administrator publishes client-facing support details.
create function public.admin_save_contact_settings(p_phone text, p_email text, p_whatsapp_url text,
  p_business_hours text, p_response_expectation text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  previous public.contact_settings%rowtype;
  clean_phone text := nullif(trim(p_phone), '');
  clean_email text := nullif(lower(trim(p_email)), '');
  clean_whatsapp text := nullif(trim(p_whatsapp_url), '');
  clean_hours text := nullif(trim(p_business_hours), '');
  clean_response text := nullif(trim(p_response_expectation), '');
  changed_fields text[] := array[]::text[];
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  if length(coalesce(clean_phone, '')) > 40 or (clean_phone is not null and clean_phone !~ '^\+?[0-9 ()-]{6,40}$')
    or length(coalesce(clean_email, '')) > 254 or (clean_email is not null and clean_email !~ '^[^[:space:]@/?#]+@[^[:space:]@/?#]+\.[^[:space:]@/?#]+$')
    or length(coalesce(clean_whatsapp, '')) > 300
    or (clean_whatsapp is not null and clean_whatsapp !~ '^https://(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)/[^[:space:]]+$')
    or length(coalesce(clean_hours, '')) > 300 or length(coalesce(clean_response, '')) > 500
    or coalesce(clean_hours, '') ~ '[[:cntrl:]]' or coalesce(clean_response, '') ~ '[[:cntrl:]]' then
    raise exception 'Invalid contact settings';
  end if;
  select * into previous from public.contact_settings where id = true for update;
  if previous.phone is distinct from clean_phone then changed_fields := array_append(changed_fields, 'phone'); end if;
  if previous.email is distinct from clean_email then changed_fields := array_append(changed_fields, 'email'); end if;
  if previous.whatsapp_url is distinct from clean_whatsapp then changed_fields := array_append(changed_fields, 'whatsapp_url'); end if;
  if previous.business_hours is distinct from clean_hours then changed_fields := array_append(changed_fields, 'business_hours'); end if;
  if previous.response_expectation is distinct from clean_response then changed_fields := array_append(changed_fields, 'response_expectation'); end if;
  if cardinality(changed_fields) = 0 then return; end if;
  insert into public.contact_settings (id, phone, email, whatsapp_url, business_hours, response_expectation)
  values (true, clean_phone, clean_email, clean_whatsapp, clean_hours, clean_response)
  on conflict (id) do update set phone = excluded.phone, email = excluded.email,
    whatsapp_url = excluded.whatsapp_url, business_hours = excluded.business_hours,
    response_expectation = excluded.response_expectation, updated_at = clock_timestamp();
  insert into public.audit_events (actor_user_id, entity_type, action, after_data)
  values (actor_id, 'contact_settings', 'contact_settings_updated', jsonb_build_object('changed_fields', changed_fields));
end;
$$;
revoke all on function public.admin_save_contact_settings(text, text, text, text, text) from public, anon;
grant execute on function public.admin_save_contact_settings(text, text, text, text, text) to authenticated;

create function public.admin_upsert_faq(p_id uuid, p_question text, p_answer text,
  p_position integer, p_published boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); previous public.faq_entries%rowtype; faq_id uuid;
  clean_question text := nullif(trim(p_question), ''); clean_answer text := nullif(trim(p_answer), '');
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  if clean_question is null or length(clean_question) > 180 or clean_answer is null or length(clean_answer) > 4000
    or p_position is null or p_position not between 1 and 1000 or p_published is null then
    raise exception 'Invalid FAQ entry';
  end if;
  if p_id is null then
    insert into public.faq_entries (question, answer, position, published)
    values (clean_question, clean_answer, p_position, p_published) returning id into faq_id;
    insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
    values (actor_id, 'faq_entry', faq_id, 'faq_created', jsonb_build_object('published', p_published));
  else
    select * into previous from public.faq_entries where id = p_id for update;
    if not found then raise exception 'FAQ entry not found'; end if;
    faq_id := p_id;
    if previous.question = clean_question and previous.answer = clean_answer
      and previous.position = p_position and previous.published = p_published then return faq_id; end if;
    update public.faq_entries set question = clean_question, answer = clean_answer,
      position = p_position, published = p_published, updated_at = clock_timestamp() where id = p_id;
    insert into public.audit_events (actor_user_id, entity_type, entity_id, action, before_data, after_data)
    values (actor_id, 'faq_entry', faq_id, 'faq_updated',
      jsonb_build_object('published', previous.published, 'position', previous.position),
      jsonb_build_object('published', p_published, 'position', p_position));
  end if;
  return faq_id;
end;
$$;
revoke all on function public.admin_upsert_faq(uuid, text, text, integer, boolean) from public, anon;
grant execute on function public.admin_upsert_faq(uuid, text, text, integer, boolean) to authenticated;
