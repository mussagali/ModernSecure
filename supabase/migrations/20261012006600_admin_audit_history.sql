-- A stable, bounded view of the complete audit history for the chief admin.
create index audit_events_time_id_idx on public.audit_events (occurred_at desc, id desc);

create function public.admin_audit_page(
  p_before_at timestamptz default null,
  p_before_id bigint default null,
  p_case_id uuid default null,
  p_actor_user_id uuid default null,
  p_limit integer default 50
)
returns table (
  id bigint,
  case_id uuid,
  entity_type text,
  entity_id uuid,
  action text,
  reason text,
  occurred_at timestamptz,
  actor_user_id uuid
)
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.staff_members sm
    where sm.user_id = auth.uid() and sm.role = 'admin' and sm.active
  ) then
    raise exception 'Not authorized';
  end if;
  if p_limit not between 1 and 100
    or (p_before_at is null) <> (p_before_id is null)
    or (p_before_id is not null and p_before_id < 1) then
    raise exception 'Invalid audit page request';
  end if;

  return query
  select ae.id, ae.case_id, ae.entity_type, ae.entity_id, ae.action,
    ae.reason, ae.occurred_at, ae.actor_user_id
  from public.audit_events ae
  where (p_case_id is null or ae.case_id = p_case_id)
    and (p_actor_user_id is null or ae.actor_user_id = p_actor_user_id)
    and (p_before_at is null or (ae.occurred_at, ae.id) < (p_before_at, p_before_id))
  order by ae.occurred_at desc, ae.id desc
  limit p_limit + 1;
end;
$$;

revoke all on function public.admin_audit_page(timestamptz, bigint, uuid, uuid, integer)
  from public, anon;
grant execute on function public.admin_audit_page(timestamptz, bigint, uuid, uuid, integer)
  to authenticated;
