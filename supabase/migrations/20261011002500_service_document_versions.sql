-- Publish complete service versions atomically; active cases stay on their
-- original version when the administrator creates a newer checklist.
create function private.insert_service_documents(p_version_id uuid, p_documents jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare doc record; clean_title text; clean_instructions text;
  needed boolean; seen_titles text[] := array[]::text[]; created_count integer := 0;
begin
  if p_documents is null or jsonb_typeof(p_documents) <> 'array'
    or jsonb_array_length(p_documents) > 20 then raise exception 'Invalid document templates'; end if;
  for doc in select value, ordinality from jsonb_array_elements(p_documents) with ordinality loop
    if jsonb_typeof(doc.value) <> 'object'
      or jsonb_typeof(doc.value->'title') is distinct from 'string'
      or (doc.value ? 'instructions' and jsonb_typeof(doc.value->'instructions') is distinct from 'string')
      or (doc.value ? 'required' and jsonb_typeof(doc.value->'required') is distinct from 'boolean') then
      raise exception 'Invalid document template';
    end if;
    clean_title := nullif(trim(doc.value->>'title'), '');
    clean_instructions := nullif(trim(doc.value->>'instructions'), '');
    needed := coalesce((doc.value->>'required')::boolean, true);
    if clean_title is null or length(clean_title) > 180
      or length(coalesce(clean_instructions, '')) > 2000
      or lower(clean_title) = any(seen_titles) then raise exception 'Invalid document template'; end if;
    seen_titles := array_append(seen_titles, lower(clean_title));
    insert into public.document_templates (version_id, title, instructions, required, position)
      values (p_version_id, clean_title, clean_instructions, needed, doc.ordinality::integer);
    created_count := created_count + 1;
  end loop;
  return created_count;
end;
$$;
revoke all on function private.insert_service_documents(uuid, jsonb) from public, anon, authenticated;

create function public.admin_create_service_with_documents(
  p_name text, p_stages text[], p_documents jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); new_service_id uuid; version_id uuid; document_count integer;
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  new_service_id := public.admin_create_service(p_name, p_stages);
  select id into version_id from public.service_template_versions
    where service_id = new_service_id and version_no = 1;
  document_count := private.insert_service_documents(version_id, p_documents);
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
    values (actor_id, 'service_template_version', version_id, 'document_checklist_published',
      jsonb_build_object('document_count', document_count));
  return new_service_id;
end;
$$;

create function public.admin_publish_service_version(
  p_service_id uuid, p_stages text[], p_documents jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); service public.service_templates%rowtype;
  new_version_id uuid; next_version integer; stage_index integer;
  clean_stage text; seen_stages text[] := array[]::text[]; document_count integer;
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  select * into service from public.service_templates where id = p_service_id for update;
  if not found or not service.active then raise exception 'Active service not found'; end if;
  if coalesce(array_length(p_stages, 1), 0) not between 1 and 12 then
    raise exception 'Invalid stages';
  end if;
  for stage_index in 1..array_length(p_stages, 1) loop
    clean_stage := nullif(trim(p_stages[stage_index]), '');
    if clean_stage is null or length(clean_stage) > 120 or lower(clean_stage) = any(seen_stages) then
      raise exception 'Invalid stage title';
    end if;
    seen_stages := array_append(seen_stages, lower(clean_stage));
  end loop;
  select coalesce(max(version_no), 0) + 1 into next_version
    from public.service_template_versions where service_id = p_service_id;
  insert into public.service_template_versions (service_id, version_no, created_by)
    values (p_service_id, next_version, actor_id) returning id into new_version_id;
  for stage_index in 1..array_length(p_stages, 1) loop
    insert into public.stage_templates (version_id, position, title)
      values (new_version_id, stage_index, trim(p_stages[stage_index]));
  end loop;
  document_count := private.insert_service_documents(new_version_id, p_documents);
  update public.service_template_versions set published_at = clock_timestamp()
    where id = new_version_id;
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
    values (actor_id, 'service_template_version', new_version_id, 'published',
      jsonb_build_object('service_id', p_service_id, 'version_no', next_version,
        'stage_count', array_length(p_stages, 1), 'document_count', document_count));
  return new_version_id;
end;
$$;

revoke all on function public.admin_create_service_with_documents(text, text[], jsonb) from public, anon;
revoke all on function public.admin_publish_service_version(uuid, text[], jsonb) from public, anon;
grant execute on function public.admin_create_service_with_documents(text, text[], jsonb) to authenticated;
grant execute on function public.admin_publish_service_version(uuid, text[], jsonb) to authenticated;
