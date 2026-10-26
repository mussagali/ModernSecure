-- Private objects only. No authenticated/anon storage.objects policy is created:
-- file transfer is intentionally reserved for checked server endpoints.
-- Inspect existing storage.objects policies before deploying to a reused project.

do $$
begin
  if exists (select 1 from storage.buckets where id in ('modernsecure-files', 'modernsecure-previews')) then
    raise exception 'ModernSecure bucket already exists; inspect it before applying migration';
  end if;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'modernsecure-files',
    'modernsecure-files',
    false,
    20971520,
    array['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif']
  ),
  (
    'modernsecure-previews',
    'modernsecure-previews',
    false,
    20971520,
    array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
  );
