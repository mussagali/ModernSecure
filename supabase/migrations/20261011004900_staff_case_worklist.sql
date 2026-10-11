-- One bounded, role-scoped source for the staff case list and conversation inbox.
create index if not exists messages_case_recent_idx on public.messages(case_id, created_at desc, id desc);
create index if not exists tasks_case_open_due_idx on public.tasks(case_id, due_at)
  where status = 'new' and due_at is not null;
create index if not exists document_files_review_request_idx on public.document_files(request_id)
  where status = 'under_review';

create function public.staff_case_worklist(
  p_query text default '',
  p_status text default 'all',
  p_attention text default 'all',
  p_staff uuid default null,
  p_service uuid default null,
  p_stage uuid default null,
  p_client uuid default null,
  p_page integer default 1,
  p_sort text default 'activity'
)
returns table (
  case_id uuid, case_number text, title text, client_name text,
  status public.case_status, is_suspended boolean, stage_name text,
  service_name text, updated_at timestamptz, last_message_at timestamptz,
  last_message_body text, unread_count bigint, overdue_count bigint,
  review_count bigint, total_count bigint
)
language plpgsql stable security definer set search_path = '' as $$
declare
  viewer_id uuid := auth.uid();
  viewer_role public.staff_role := private.staff_role_for_current_user();
  clean_query text := lower(trim(coalesce(p_query, '')));
begin
  if viewer_role is null or viewer_id is null then
    raise exception 'Not authorized';
  end if;
  if length(clean_query) > 120 or p_page is null or p_page not between 1 and 10000
    or p_status is null or p_status not in ('all', 'open', 'closed', 'suspended')
    or p_attention is null or p_attention not in ('all', 'unread', 'overdue', 'documents', 'messages')
    or p_sort is null or p_sort not in ('activity', 'message') then
    raise exception 'Invalid worklist filter';
  end if;

  return query
    with visible as (
      select c.id, c.case_number, c.title, cl.full_name,
        c.status, c.is_suspended, st.title as stage_title,
        sv.name as service_title, c.updated_at
      from public.cases c
      join public.clients cl on cl.id = c.client_id
      join public.service_template_versions v on v.id = c.service_version_id
      join public.service_templates sv on sv.id = v.service_id
      left join public.stage_templates st on st.id = c.current_stage_id
      where (viewer_role = 'admin' or exists (
        select 1 from public.case_assignments ca
        where ca.case_id = c.id and ca.staff_user_id = viewer_id and ca.revoked_at is null
      ))
        and (p_staff is null or exists (
          select 1 from public.case_assignments ca
          join public.staff_members sm on sm.user_id = ca.staff_user_id
          where ca.case_id = c.id and ca.staff_user_id = p_staff
            and ca.revoked_at is null and sm.active
        ))
        and (p_service is null or sv.id = p_service)
        and (p_stage is null or c.current_stage_id = p_stage)
        and (p_client is null or c.client_id = p_client)
        and (p_status = 'all'
          or (p_status = 'open' and c.status = 'open' and not c.is_suspended)
          or (p_status = 'closed' and c.status = 'closed')
          or (p_status = 'suspended' and c.status = 'open' and c.is_suspended))
        and (clean_query = ''
          or position(clean_query in lower(c.case_number)) > 0
          or position(clean_query in lower(c.title)) > 0
          or position(clean_query in lower(cl.full_name)) > 0
          or exists (
            select 1 from public.contracts ct
            where ct.case_id = c.id and position(clean_query in lower(ct.contract_number)) > 0
          ))
    ), enriched as (
      select v.*, latest.created_at as latest_at,
        latest.preview as latest_body,
        coalesce(unread.items, 0)::bigint as unread_items,
        coalesce(overdue.items, 0)::bigint as overdue_items,
        coalesce(reviews.items, 0)::bigint as review_items
      from visible v
      left join lateral (
        select m.created_at,
          coalesce(nullif(left(trim(m.body), 160), ''), 'Вложение') as preview
        from public.messages m where m.case_id = v.id
        order by m.created_at desc, m.id desc limit 1
      ) latest on true
      left join lateral (
        select count(*) as items from public.messages m
        where m.case_id = v.id and m.sender_user_id <> viewer_id
          and not exists (
            select 1 from public.message_reads mr
            where mr.message_id = m.id and mr.reader_user_id = viewer_id
          )
      ) unread on true
      left join lateral (
        select count(*) as items from public.tasks t
        where t.case_id = v.id and t.status = 'new' and t.due_at < now()
          and v.status = 'open' and not v.is_suspended
      ) overdue on true
      left join lateral (
        select count(*) as items from public.document_requests dr
        join public.document_files df on df.request_id = dr.id
        where dr.case_id = v.id and df.status = 'under_review'
      ) reviews on true
    )
    select e.id, e.case_number, e.title, e.full_name, e.status, e.is_suspended,
      e.stage_title, e.service_title, e.updated_at, e.latest_at, e.latest_body,
      e.unread_items, e.overdue_items, e.review_items, count(*) over ()
    from enriched e
    where p_attention = 'all'
      or (p_attention = 'unread' and e.unread_items > 0)
      or (p_attention = 'overdue' and e.overdue_items > 0)
      or (p_attention = 'documents' and e.review_items > 0)
      or (p_attention = 'messages' and e.latest_at is not null)
    order by
      case when p_sort = 'message' then e.latest_at else e.updated_at end desc nulls last,
      e.id desc
    limit 25 offset (p_page - 1) * 25;
end;
$$;

revoke all on function public.staff_case_worklist(text, text, text, uuid, uuid, uuid, uuid, integer, text) from public, anon;
grant execute on function public.staff_case_worklist(text, text, text, uuid, uuid, uuid, uuid, integer, text) to authenticated;
