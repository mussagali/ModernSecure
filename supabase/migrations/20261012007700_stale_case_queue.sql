-- Staff attention queue for open cases without a client-visible stage update.
-- This internal setting is not exposed through the Data API as a table.
create table private.staff_work_settings (
  id boolean primary key default true check (id),
  stale_case_days integer not null default 14 check (stale_case_days between 1 and 365),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff_members(user_id) on delete restrict
);
insert into private.staff_work_settings (id, stale_case_days) values (true, 14);

create function public.staff_stale_case_days()
returns integer language plpgsql stable security definer set search_path = '' as $$
declare days integer;
begin
  if auth.uid() is null or private.staff_role_for_current_user() is null then
    raise exception 'Not authorized';
  end if;
  select s.stale_case_days into days from private.staff_work_settings s where s.id = true;
  return days;
end;
$$;
revoke all on function public.staff_stale_case_days() from public, anon;
grant execute on function public.staff_stale_case_days() to authenticated;

create function public.admin_set_stale_case_days(p_days integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare previous_days integer; actor_id uuid := auth.uid();
begin
  if actor_id is null or private.staff_role_for_current_user() is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;
  if p_days is null or p_days not between 1 and 365 then
    raise exception 'Invalid stale case threshold';
  end if;
  select s.stale_case_days into previous_days from private.staff_work_settings s
    where s.id = true for update;
  if previous_days is null then raise exception 'Staff work settings are missing'; end if;
  if previous_days <> p_days then
    update private.staff_work_settings
      set stale_case_days = p_days, updated_at = now(), updated_by = actor_id
      where id = true;
    insert into public.audit_events
      (actor_user_id, entity_type, action, before_data, after_data)
    values (actor_id, 'staff_work_settings', 'stale_threshold_changed',
      jsonb_build_object('stale_case_days', previous_days),
      jsonb_build_object('stale_case_days', p_days));
  end if;
  return p_days;
end;
$$;
revoke all on function public.admin_set_stale_case_days(integer) from public, anon;
grant execute on function public.admin_set_stale_case_days(integer) to authenticated;

create function public.staff_stale_case_page(p_page integer default 1)
returns table(
  case_id uuid, case_number text, title text, client_name text,
  last_update_at timestamptz, days_without_update integer,
  is_suspended boolean, total_count bigint
)
language plpgsql stable security definer set search_path = '' as $$
declare viewer_id uuid := auth.uid(); viewer_role public.staff_role := private.staff_role_for_current_user();
  threshold_days integer;
begin
  if viewer_id is null or viewer_role is null then raise exception 'Not authorized'; end if;
  if p_page is null or p_page not between 1 and 10000 then raise exception 'Invalid page'; end if;
  select s.stale_case_days into threshold_days from private.staff_work_settings s where s.id = true;
  if threshold_days is null then raise exception 'Staff work settings are missing'; end if;

  return query
    with visible as (
      select c.id, c.case_number, c.title, cl.full_name,
        coalesce((select max(e.occurred_at) from public.case_stage_events e
          where e.case_id = c.id), c.created_at) as latest_at,
        c.is_suspended
      from public.cases c
      join public.clients cl on cl.id = c.client_id
      where c.status = 'open'
        and (viewer_role = 'admin' or exists (
          select 1 from public.case_assignments ca
          where ca.case_id = c.id and ca.staff_user_id = viewer_id and ca.revoked_at is null
        ))
    )
    select v.id, v.case_number, v.title, v.full_name, v.latest_at,
      floor(extract(epoch from now() - v.latest_at) / 86400)::integer,
      v.is_suspended, count(*) over ()
    from visible v
    where v.latest_at < now() - make_interval(days => threshold_days)
    order by v.latest_at asc, v.id
    limit 25 offset (p_page - 1) * 25;
end;
$$;
revoke all on function public.staff_stale_case_page(integer) from public, anon;
grant execute on function public.staff_stale_case_page(integer) to authenticated;
