-- Staff search stays on the server and returns one bounded page at a time.
create function public.staff_search_clients(p_query text default '', p_page integer default 1)
returns table (
  id uuid, full_name text, email text, phone text, city text,
  user_id uuid, created_at timestamptz, total_count bigint
) language plpgsql stable security definer set search_path = '' as $$
declare clean_query text := lower(trim(coalesce(p_query, '')));
begin
  if private.staff_role_for_current_user() not in ('manager', 'admin') then
    raise exception 'Not authorized';
  end if;
  if length(clean_query) > 120 or p_page is null or p_page not between 1 and 10000 then
    raise exception 'Invalid client search';
  end if;
  return query
    select cl.id, cl.full_name, cl.email, cl.phone, cl.city, cl.user_id, cl.created_at,
      count(*) over() as total_count
    from public.clients cl
    where clean_query = '' or position(clean_query in lower(cl.full_name)) > 0
      or position(clean_query in lower(coalesce(cl.email, ''))) > 0
      or position(clean_query in lower(coalesce(cl.phone, ''))) > 0
    order by cl.created_at desc, cl.id desc
    limit 25 offset (p_page - 1) * 25;
end;
$$;
revoke all on function public.staff_search_clients(text, integer) from public, anon;
grant execute on function public.staff_search_clients(text, integer) to authenticated;
