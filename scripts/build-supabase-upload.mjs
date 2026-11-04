import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'supabase-upload');
mkdirSync(output, { recursive: true });
const files = readdirSync(path.join(root, 'supabase/migrations')).filter(name => name.endsWith('.sql')).sort();
const parts = [];
const manifest = [];
for (const name of files) {
  const original = readFileSync(path.join(root, 'supabase/migrations', name), 'utf8').replace(/\r\n/g, '\n');
  let sql = original;
  if (name === '20261011000800_role_boundaries.sql') {
    const boundary = sql.indexOf('create unique index staff_one_primary_admin');
    if (boundary < 0 || !sql.slice(0, boundary).includes('Primary administrator account must be uniquely verified')) {
      throw new Error('Migration 008 changed: review its owner bootstrap before packaging');
    }
    sql = '-- Portable installation: owner provisioning is a separate explicit step.\n' + sql.slice(boundary);
  }
  parts.push(`-- BEGIN ${name}\n${sql.trim()}\n-- END ${name}`);
  manifest.push({ file: name, sha256: createHash('sha256').update(original).digest('hex'), adapted: sql !== original });
}
const preamble = `-- MODERNSECURE: установка в другой, ПУСТОЙ проект Supabase.
-- Выполнять целиком в SQL Editor от postgres. Повторный запуск запрещён.
-- Не переносит пользователей, пароли, записи или файлы старого проекта.
-- Сначала выполните 00_INSPECT.sql. Настройки Auth см. в README.md.
begin;
set local statement_timeout = '120s';
do $preflight$
begin
  if exists (select 1 from pg_tables where schemaname in ('public', 'private'))
    or exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','private') and not exists (
        select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e'))
    or exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
      where n.nspname in ('public','private') and t.typtype='e') then
    raise exception 'STOP: public/private already contains application objects. Do not delete them; prepare a migration for this database.';
  end if;
  if exists (select 1 from storage.buckets where id in ('modernsecure-files','modernsecure-previews'))
    or exists (select 1 from pg_policies where schemaname='storage' and tablename='objects') then
    raise exception 'STOP: existing Storage configuration must be reviewed before installation.';
  end if;
  if to_regclass('auth.users') is null or to_regclass('auth.mfa_factors') is null then
    raise exception 'Run this script in a Supabase project, not a plain PostgreSQL database.';
  end if;
end;
$preflight$;
create schema if not exists extensions;
do $crypto$
begin
  if exists (select 1 from pg_available_extensions where name='pgcrypto') then
    create extension if not exists pgcrypto with schema extensions;
  end if;
  if to_regprocedure('extensions.digest(text,text)') is null then
    raise exception 'pgcrypto must provide extensions.digest(text,text); review extension schema.';
  end if;
end;
$crypto$;
`;
const epilogue = `
-- Users created through Auth before schema installation still need profiles.
insert into public.profiles(user_id,email)
select id,coalesce(email,'') from auth.users
on conflict(user_id) do nothing;
notify pgrst, 'reload schema';
commit;
select 'ModernSecure schema installed. Continue with 02_CREATE_OPERATOR.sql.' as result;
`;
const sql = preamble + '\n' + parts.join('\n\n') + '\n' + epilogue;
writeFileSync(path.join(output, '01_INSTALL_SCHEMA.sql'), sql, 'utf8');
writeFileSync(path.join(output, 'SOURCE_MANIFEST.json'), JSON.stringify({
  schemaVersion: files.at(-1).split('_')[0],
  installSha256: createHash('sha256').update(sql).digest('hex'),
  note: 'Migration 008 owner-specific provisioning removed. Original migrations remain unchanged. Source SHA-256 uses LF-normalized text for consistent Windows/macOS builds. Supabase CLI migration history is not modified.',
  migrations: manifest,
}, null, 2) + '\n');
console.log(`Created supabase-upload/01_INSTALL_SCHEMA.sql from ${files.length} migrations (${Buffer.byteLength(sql)} bytes)`);
