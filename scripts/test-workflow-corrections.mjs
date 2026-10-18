import { runWorkflowCorrections } from './fixtures/workflow-corrections.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const admin = randomUUID(), manager = randomUUID(), lawyer = randomUUID();
const legacy = randomUUID();
async function as(user, sql, params = []) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)",
    [user, JSON.stringify({ sub: user, aal: 'aal2', role: 'authenticated' })]);
  await db.exec('set role authenticated');
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
}
const approve = (user, target) => as(user, 'select public.admin_approve_client_registration($1) as id', [target]);
const identity = (user, name, iin = null) => as(user, 'select public.complete_own_client_identity($1,$2)', [name, iin]);


try {
  await db.exec(`create role anon; create role authenticated; create role service_role; create role authenticator;
    create schema auth; create schema storage; create schema extensions;
    create function extensions.digest(text,text) returns bytea language sql as $$ select pg_catalog.sha256(convert_to($1, 'UTF8')) $$;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create table auth.mfa_factors(id uuid primary key,user_id uuid,status text);
    create table auth.sessions(id uuid,user_id uuid,aal text,not_after timestamptz);
    create table auth.audit_log_entries(id uuid,created_at timestamptz,payload jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
    grant usage on schema auth,public to authenticated;
    grant execute on function auth.uid(),auth.jwt() to authenticated;
    create table storage.buckets(id text primary key,name text not null,public boolean not null,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text,name text,metadata jsonb,user_metadata jsonb,primary key(bucket_id,name));
    create publication supabase_realtime;
  `);
  for (const file of readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort()) {
    if (file === '20261011000800_role_boundaries.sql') {
      for (const [id, email] of [[admin, 'ayanz2008@gmail.com'], [manager, 'manager@example.test'], [lawyer, 'lawyer@example.test'], [legacy, 'legacy@example.test']]) {
        await db.query('insert into auth.users values($1,$2,now())', [id, email]);
      }
      for (const [id, role] of [[admin, 'admin'], [manager, 'manager'], [lawyer, 'lawyer']]) {
        await db.query('insert into public.staff_members(user_id,display_name,role) values($1,$2,$2::text::public.staff_role)', [id, role]);
      }
    }
    await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  }

  await runWorkflowCorrections({ db, admin, lawyer, legacy, as, approve, identity });
} catch(error) { console.error(error.stack,error.where ?? '',error.query ?? ''); process.exitCode=1; }
finally { await db.close(); }
