-- Hourly job, deduplicated by task and local due date. Kazakhstan uses Asia/Almaty.
create index tasks_open_deadline_idx on public.tasks (due_at)
  where status = 'new' and due_at is not null;

create function private.enqueue_task_deadline_reminders(p_reference_day date default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare local_day date := coalesce(p_reference_day, (now() at time zone 'Asia/Almaty')::date);
  inserted_count integer;
begin
  with upcoming as (
    select t.id, t.case_id, t.title, cl.user_id,
      (t.due_at at time zone 'Asia/Almaty')::date as due_day
    from public.tasks t
    join public.cases c on c.id = t.case_id
    join public.clients cl on cl.id = c.client_id
    where t.status = 'new' and t.due_at is not null
      and c.status = 'open' and not c.is_suspended and cl.user_id is not null
      and t.due_at >= (local_day::timestamp at time zone 'Asia/Almaty')
      and t.due_at < ((local_day + 2)::timestamp at time zone 'Asia/Almaty')
  )
  insert into public.notifications (recipient_user_id, case_id, kind, title, body, target_path, dedupe_key)
  select u.user_id, u.case_id, 'task_deadline',
    case when u.due_day = local_day then 'Срок задачи сегодня' else 'Срок задачи завтра' end,
    left(u.title, 180), '/account/cases/' || u.case_id || '/tasks',
    'task-deadline:' || u.id || ':' || u.due_day || ':' ||
      case when u.due_day = local_day then 'today' else 'tomorrow' end
  from upcoming u
  on conflict (recipient_user_id, dedupe_key) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;
revoke all on function private.enqueue_task_deadline_reminders(date) from public, anon, authenticated;

-- pg_cron is available on Supabase; local PGlite tests do not ship this extension.
do $$
begin
  if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('modernsecure-task-deadlines', '0 * * * *',
      'select private.enqueue_task_deadline_reminders()');
  end if;
end;
$$;
