-- A notification becomes read when its recipient opens it, without clearing
-- unrelated work. The path comes from the database, never from form input.
create function public.open_own_notification(p_notification_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); destination text;
begin
  if actor_id is null then raise exception 'Not authenticated'; end if;
  select n.target_path into destination from public.notifications n
    where n.id = p_notification_id and n.recipient_user_id = actor_id;
  if not found then return null; end if;
  update public.notifications set read_at = clock_timestamp()
    where id = p_notification_id and recipient_user_id = actor_id and read_at is null;
  return destination;
end;
$$;
revoke all on function public.open_own_notification(uuid) from public, anon;
grant execute on function public.open_own_notification(uuid) to authenticated;
