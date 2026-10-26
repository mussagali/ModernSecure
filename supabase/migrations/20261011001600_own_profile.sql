-- Profile edits belong to the signed-in account, not to a caller-supplied user id.
create function public.update_own_profile(p_display_name text, p_phone text, p_city text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  previous public.profiles%rowtype;
  clean_name text := nullif(trim(p_display_name), '');
  clean_phone text := nullif(trim(p_phone), '');
  clean_city text := nullif(trim(p_city), '');
  changed_fields text[] := array[]::text[];
begin
  if actor_id is null then raise exception 'Not authenticated'; end if;
  if length(coalesce(clean_name, '')) > 160 or length(coalesce(clean_city, '')) > 100
    or (clean_phone is not null and (length(clean_phone) > 30
      or clean_phone !~ '^\+?[0-9 ()-]{7,30}$'))
    or coalesce(clean_name, '') ~ '[[:cntrl:]]'
    or coalesce(clean_city, '') ~ '[[:cntrl:]]' then
    raise exception 'Invalid profile';
  end if;
  select * into previous from public.profiles where user_id = actor_id for update;
  if not found then raise exception 'Profile not found'; end if;
  if previous.display_name is distinct from clean_name then changed_fields := array_append(changed_fields, 'display_name'); end if;
  if previous.phone is distinct from clean_phone then changed_fields := array_append(changed_fields, 'phone'); end if;
  if previous.city is distinct from clean_city then changed_fields := array_append(changed_fields, 'city'); end if;
  if cardinality(changed_fields) = 0 then return; end if;
  update public.profiles set display_name = clean_name, phone = clean_phone, city = clean_city,
    updated_at = clock_timestamp() where user_id = actor_id;
  insert into public.audit_events (actor_user_id, entity_type, entity_id, action, after_data)
  values (actor_id, 'profile', actor_id, 'profile_updated', jsonb_build_object('changed_fields', changed_fields));
end;
$$;
revoke all on function public.update_own_profile(text, text, text) from public, anon;
grant execute on function public.update_own_profile(text, text, text) to authenticated;
