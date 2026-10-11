-- A notification recipient may clear their own inbox across all cases.
create function public.mark_own_notifications_read()
returns integer language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); marked integer;
begin
  if actor_id is null then raise exception 'Not authenticated'; end if;
  update public.notifications set read_at = clock_timestamp()
  where recipient_user_id = actor_id and read_at is null;
  get diagnostics marked = row_count;
  return marked;
end;
$$;
revoke all on function public.mark_own_notifications_read() from public, anon;
grant execute on function public.mark_own_notifications_read() to authenticated;
