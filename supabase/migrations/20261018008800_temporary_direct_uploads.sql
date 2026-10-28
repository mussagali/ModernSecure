-- Untrusted bytes land in a separate private bucket. Only checked server routes
-- copy validated files to permanent storage; signed upload URLs never target it.
insert into storage.buckets(id, name, public, file_size_limit)
values('modernsecure-staging', 'modernsecure-staging', false, 20971520);

create table public.temporary_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_path text not null,
  context jsonb not null,
  original_name text not null check(length(original_name) between 1 and 180),
  size_bytes bigint not null check(size_bytes between 1 and 20971520),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 hours'
);

create index temporary_uploads_owner_created_idx on public.temporary_uploads(user_id, created_at);

alter table public.temporary_uploads enable row level security;

revoke all on public.temporary_uploads from public, anon, authenticated;

grant select, insert, delete on public.temporary_uploads to service_role;

create policy staff_mfa_guard on public.temporary_uploads as restrictive for all to authenticated
  using((select private.staff_mfa_passed())) with check((select private.staff_mfa_passed()));

create function public.server_prepare_temporary_upload(p_user_id uuid, p_target_path text,
  p_context jsonb, p_name text, p_size bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare ticket_id uuid;
begin
  perform 1 from auth.users where id = p_user_id for update;
  if not found then raise exception 'User not found'; end if;
  if p_target_path not in ('/api/contracts', '/api/payment-receipts', '/api/document-uploads/file',
    '/api/message-attachments', '/api/staff-message-attachments') or p_target_path is null
    or p_context is null or jsonb_typeof(p_context) <> 'object' then raise exception 'Invalid upload target'; end if;
  if (select count(*) from public.temporary_uploads where user_id = p_user_id and created_at > now() - interval '1 day') >= 100
    then raise exception 'Upload rate limit exceeded'; end if;
  insert into public.temporary_uploads(user_id, target_path, context, original_name, size_bytes)
    values(p_user_id, p_target_path, p_context, p_name, p_size) returning id into ticket_id;
  return ticket_id;
end;
$$;

revoke all on function public.server_prepare_temporary_upload(uuid, text, jsonb, text, bigint) from public, anon, authenticated;

grant execute on function public.server_prepare_temporary_upload(uuid, text, jsonb, text, bigint) to service_role;

notify pgrst, 'reload schema';
