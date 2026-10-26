-- Attachments in staff direct messages never share case-message rows or paths.
create table public.staff_message_attachments (
  id uuid primary key,
  message_id uuid not null references public.staff_messages(id) on delete restrict,
  storage_path text not null unique,
  original_name text not null check (length(original_name) between 1 and 180
    and original_name !~ '[[:cntrl:]/]' and position(chr(92) in original_name) = 0
    and original_name = btrim(original_name)),
  detected_mime_type text not null check (detected_mime_type in
    ('application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif')),
  size_bytes bigint not null check (size_bytes between 1 and 20971520),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  position integer not null check (position between 0 and 4),
  created_at timestamptz not null default now(),
  constraint staff_message_attachment_position_unique unique (message_id, position),
  constraint staff_message_attachment_path_check check (storage_path ~
    '^staff-messages/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
);
create index staff_message_attachments_message_idx on public.staff_message_attachments(message_id, position);

create function private.can_read_staff_attachment(p_attachment_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff_message_attachments a
    join public.staff_messages m on m.id = a.message_id
    where a.id = p_attachment_id and private.can_read_staff_thread(m.thread_id)
  )
$$;
revoke all on function private.can_read_staff_attachment(uuid) from public, anon, authenticated;
grant execute on function private.can_read_staff_attachment(uuid) to authenticated;

alter table public.staff_message_attachments enable row level security;
revoke all on public.staff_message_attachments from public, anon, authenticated;
grant select on public.staff_message_attachments to authenticated;
grant all on public.staff_message_attachments to service_role;
create policy staff_message_attachments_participant_read
  on public.staff_message_attachments for select to authenticated
  using (private.can_read_staff_attachment(id));

create function private.guard_staff_message_attachment_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.storage_path, 0));
  if not exists (select 1 from storage.objects obj
    where obj.bucket_id = 'modernsecure-files' and obj.name = new.storage_path
      and obj.metadata->>'size' ~ '^[0-9]+$'
      and (obj.metadata->>'size')::bigint = new.size_bytes
      and obj.metadata->>'mimetype' = new.detected_mime_type) then
    raise exception 'Staff message object not found or metadata mismatch';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_staff_message_attachment_insert() from public, anon, authenticated;
create trigger modernsecure_staff_message_attachment_insert_guard
  before insert on public.staff_message_attachments
  for each row execute function private.guard_staff_message_attachment_insert();
create trigger modernsecure_staff_message_attachments_immutable
  before update or delete on public.staff_message_attachments
  for each row execute function private.reject_message_change();
create trigger modernsecure_staff_messages_immutable
  before update or delete on public.staff_messages
  for each row execute function private.reject_message_change();

create function public.staff_send_message_with_attachments(
  p_thread_id uuid, p_body text, p_idempotency_key uuid, p_files jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  prior public.staff_messages%rowtype;
  message_id uuid;
  item jsonb;
  ordinal integer;
  total_bytes bigint := 0;
  expected_files jsonb := '[]'::jsonb;
  saved_files jsonb;
  file_path text;
  suffix text;
  file_mime text;
  file_size bigint;
begin
  if actor_id is null or p_thread_id is null or p_idempotency_key is null
    or not private.can_read_staff_thread(p_thread_id) then raise exception 'Not authorized'; end if;
  if nullif(btrim(p_body), '') is null or length(btrim(p_body)) > 4000
    or p_files is null or jsonb_typeof(p_files) <> 'array'
    or jsonb_array_length(p_files) not between 1 and 5 then
    raise exception 'Invalid staff message files';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text, 0));
  for item, ordinal in select value, ordinality::integer - 1
    from jsonb_array_elements(p_files) with ordinality loop
    if jsonb_typeof(item) <> 'object' or not (item ?& array['id','path','name','mime','size','sha256'])
      or (item->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (item->>'sha256') !~ '^[0-9a-f]{64}$'
      or (item->>'size') !~ '^[0-9]+$' then raise exception 'Invalid staff message file'; end if;
    file_path := item->>'path';
    file_mime := item->>'mime';
    file_size := (item->>'size')::bigint;
    if file_path !~ ('^staff-messages/' || p_thread_id::text || '/' || actor_id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' ||
      (item->>'id') || '$')
      or length(item->>'name') not between 1 and 180
      or (item->>'name') ~ '[[:cntrl:]/]'
      or position(chr(92) in item->>'name') > 0
      or (item->>'name') <> btrim(item->>'name')
      or file_mime not in ('application/pdf','image/jpeg','image/png','image/heic','image/heif')
      or file_size not between 1 and 20971520 then raise exception 'Invalid staff message file'; end if;
    suffix := lower(substring(item->>'name' from '[.][^.]+$'));
    if not ((file_mime = 'application/pdf' and suffix = '.pdf')
      or (file_mime = 'image/jpeg' and suffix in ('.jpg','.jpeg'))
      or (file_mime = 'image/png' and suffix = '.png')
      or (file_mime = 'image/heic' and suffix = '.heic')
      or (file_mime = 'image/heif' and suffix = '.heif')) then
      raise exception 'Invalid staff message file type';
    end if;
    total_bytes := total_bytes + file_size;
    expected_files := expected_files || jsonb_build_array(jsonb_build_object(
      'name', item->>'name', 'mime', file_mime, 'size', file_size,
      'sha256', item->>'sha256'));
  end loop;
  if total_bytes > 41943040 then raise exception 'Staff message files too large'; end if;

  select * into prior from public.staff_messages
    where thread_id = p_thread_id and sender_user_id = actor_id
      and idempotency_key = p_idempotency_key;
  if found then
    select coalesce(jsonb_agg(jsonb_build_object('name', a.original_name,
      'mime', a.detected_mime_type, 'size', a.size_bytes,
      'sha256', a.content_sha256) order by a.position), '[]'::jsonb)
      into saved_files from public.staff_message_attachments a where a.message_id = prior.id;
    if prior.body <> btrim(p_body) or saved_files <> expected_files then
      raise exception 'Staff message key cannot be reused';
    end if;
    return jsonb_build_object('id', prior.id, 'created', false);
  end if;

  for item in select value from jsonb_array_elements(p_files) loop
    if not exists (select 1 from storage.objects obj
      where obj.bucket_id = 'modernsecure-files' and obj.name = item->>'path'
        and obj.metadata->>'size' ~ '^[0-9]+$'
        and (obj.metadata->>'size')::bigint = (item->>'size')::bigint
        and obj.metadata->>'mimetype' = item->>'mime') then
      raise exception 'Staff message object not found or metadata mismatch';
    end if;
  end loop;
  message_id := public.staff_send_message(p_thread_id, p_body, p_idempotency_key);
  for item, ordinal in select value, ordinality::integer - 1
    from jsonb_array_elements(p_files) with ordinality loop
    insert into public.staff_message_attachments
      (id, message_id, storage_path, original_name, detected_mime_type,
       size_bytes, content_sha256, position)
    values ((item->>'id')::uuid, message_id, item->>'path', item->>'name',
      item->>'mime', (item->>'size')::bigint, item->>'sha256', ordinal);
  end loop;
  return jsonb_build_object('id', message_id, 'created', true);
end;
$$;
revoke all on function public.staff_send_message_with_attachments(uuid, text, uuid, jsonb)
  from public, anon;
grant execute on function public.staff_send_message_with_attachments(uuid, text, uuid, jsonb)
  to authenticated;
