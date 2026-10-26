-- Supabase Auth owns the source table. Expose only bounded, sanitized events
-- to the active chief admin; never return IP, user-agent, or the raw payload.

create function public.admin_auth_audit_page(
  p_before_at timestamptz default null,
  p_before_id uuid default null,
  p_actor_user_id uuid default null,
  p_limit integer default 50
)
returns table (
  id uuid,
  occurred_at timestamptz,
  action text,
  actor_user_id uuid,
  actor_email text,
  provider text
)
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.staff_members sm
    where sm.user_id = auth.uid() and sm.role = 'admin' and sm.active
  ) then
    raise exception 'Not authorized';
  end if;
  if p_limit is null or p_limit not between 1 and 100
    or (p_before_at is null) <> (p_before_id is null) then
    raise exception 'Invalid auth audit page request';
  end if;

  return query
  select log.id, log.created_at, left(log.payload->>'action', 80),
    actor.user_id, user_record.email::text,
    left(log.payload->'traits'->>'provider', 40)
  from auth.audit_log_entries log
  cross join lateral (
    select case
      when log.payload->>'actor_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (log.payload->>'actor_id')::uuid
      else null::uuid
    end as user_id
  ) actor
  left join auth.users user_record on user_record.id = actor.user_id
  where (p_actor_user_id is null or actor.user_id = p_actor_user_id)
    and (p_before_at is null or (log.created_at, log.id) < (p_before_at, p_before_id))
  order by log.created_at desc, log.id desc
  limit p_limit + 1;
end;
$$;

revoke all on function public.admin_auth_audit_page(timestamptz, uuid, uuid, integer)
  from public, anon;
grant execute on function public.admin_auth_audit_page(timestamptz, uuid, uuid, integer)
  to authenticated;
