import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import ts from 'typescript';

// Isolated SQL and actual route code; no network, real accounts, or delivered mail.
const db = new PGlite();
const id = n => `81000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const admin = id(1), client = id(2), manager = id(3), pending = id(4);
let actor = client, aal = 'aal1';
async function as(user, sql, params = [], assurance = 'aal1') {
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
    [user, JSON.stringify({ sub: user, aal: assurance, role: 'authenticated' })]);
  await db.exec('set role authenticated');
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
}
async function api(user, path, sql, params = [], assurance = 'aal1') {
  await db.query("select set_config('request.path',$1,false)", [path]);
  await as(user, 'select public.enforce_staff_mfa_request()', [], assurance);
  return as(user, sql, params, assurance);
}
function load(file, require) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', code)(require, exports);
  return exports;
}

try {
  await db.exec(`create role anon; create role authenticated; create role service_role; create role authenticator;
    create schema auth; create schema storage; create schema extensions;
    create function extensions.digest(text,text) returns bytea language sql as $$ select pg_catalog.sha256(convert_to($1,'UTF8')) $$;
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
    if (file.includes('0008')) {
      for (const [user, email] of [[admin, 'ayanz2008@gmail.com'], [client, 'client@example.test'], [manager, 'manager@example.test'], [pending, 'pending@example.test']]) {
        await db.query('insert into auth.users values($1,$2,now())', [user, email]);
      }
      await db.query("insert into public.staff_members(user_id,display_name,role) values($1,'Admin','admin'),($2,'Manager','manager')", [admin, manager]);
    }
    await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  }
  await db.query("insert into public.clients(id,user_id,full_name,linked_by,linked_at) values($1,$2,'Client',$3,now())", [id(10), client, admin]);
  await db.query("insert into public.service_templates(id,code,name) values($1,'BOUNDARY','Boundary test')", [id(11)]);
  await db.query('insert into public.service_template_versions(id,service_id,version_no) values($1,$2,1)', [id(12), id(11)]);
  await db.query("insert into public.cases(id,case_number,client_id,service_version_id,title) values($1,'BOUNDARY-1',$2,$3,'Case')", [id(13), id(10), id(12)]);
  const publish = expected => as(admin, "select public.admin_publish_legal_document('terms','Required terms','Fixture text',$1) as id", [expected]);
  const terms = (await publish(null)).rows[0].id;
  assert.equal((await as(client, 'select public.client_consent_status() as ok')).rows[0].ok, false);
  // Table policy works independently of the HTTP pre-request hook (Realtime).
  assert.equal((await as(client, 'select id from public.cases')).rows.length, 0);
  await assert.rejects(api(client, '/cases', 'select id from public.cases'), /CONSENT_REQUIRED/);
  await assert.rejects(api(client, '/rpc/post_case_message', 'select public.post_case_message($1,$2,$3)', [id(13), 'Before consent', id(14)]), /CONSENT_REQUIRED/);
  assert.equal((await api(client, '/legal_documents', 'select id from public.legal_documents')).rows.length, 1);
  assert.equal((await api(client, '/rpc/client_consent_status', 'select public.client_consent_status() as ok')).rows[0].ok, false);
  assert.equal((await api(admin, '/cases', 'select id from public.cases')).rows.length, 1, 'Staff are not subject to client consent');
  await api(pending, '/rpc/account_access_status', 'select public.account_access_status()');
  await api(pending, '/contact_settings', 'select id from public.contact_settings');
  await assert.rejects(api(pending, '/rpc/accept_client_consents', 'select public.accept_client_consents($1)', [[terms]]), /ACCOUNT_PENDING/);

  // Actual upload-preparation route uses the real DB hook via this RPC adapter.
  let issued = 0;
  const supabase = {
    auth: { getClaims: async () => ({ data: { claims: { sub: actor, aal } } }) },
    rpc: async name => {
      assert.ok(['account_access_status', 'staff_mfa_status', 'client_consent_status'].includes(name));
      try { return { data: (await api(actor, `/rpc/${name}`, `select public.${name}() as data`, [], aal)).rows[0].data, error: null }; }
      catch (error) { return { data: null, error }; }
    },
  };
  const route = load('app/api/uploads/prepare/route.ts', name => {
    if (name.endsWith('/supabase/server')) return { createClient: async () => supabase };
    if (name.endsWith('/document-files')) return { MAX_DOCUMENT_BYTES: 20971520, storageAdmin: () => ({
      rpc: async () => { issued++; return { data: id(20), error: null }; },
      storage: { from: () => ({ createSignedUploadUrl: async () => ({ data: { signedUrl: 'https://fixture.invalid/upload' }, error: null }) }) },
    }) };
    if (name.endsWith('/upload-request')) return { readBoundedBytes: async request => new Uint8Array(await request.arrayBuffer()), UploadInputError: class extends Error {} };
    throw new Error(name);
  });
  process.env.APP_ORIGIN = 'https://fixture.invalid';
  const prepare = () => route.POST(new Request(`${process.env.APP_ORIGIN}/api/uploads/prepare`, {
    method: 'POST', headers: { origin: process.env.APP_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ target: '/api/message-attachments', field: 'files', name: 'test.pdf', size: 10, fields: [] }),
  }));
  assert.equal((await prepare()).status, 403, 'Consent missing');
  await db.query("insert into auth.mfa_factors values($1,$2,'verified')", [id(21), client]);
  await assert.rejects(api(client, '/rpc/client_consent_status', 'select public.client_consent_status()'), /MFA_REQUIRED/);
  assert.equal((await prepare()).status, 403, 'Client MFA missing');
  assert.equal(issued, 0, 'Denied requests never create service-role upload tickets');
  aal = 'aal2';
  await api(client, '/rpc/accept_client_consents', 'select public.accept_client_consents($1)', [[terms]], aal);
  assert.equal((await prepare()).status, 200);
  assert.equal(issued, 1);
  assert.equal((await api(client, '/cases', 'select id from public.cases', [], aal)).rows.length, 1);
  await api(client, '/rpc/post_case_message', 'select public.post_case_message($1,$2,$3)', [id(13), 'After consent', id(14)], aal);
  await publish(terms);
  assert.equal((await as(client, 'select id from public.cases', [], aal)).rows.length, 0, 'A newly published version locks old consent');
  assert.equal((await prepare()).status, 403);
  actor = admin; aal = 'aal1';
  assert.equal((await prepare()).status, 200, 'Staff consent remains exempt');

  const request = (await as(admin, "select public.staff_create_document_request($1,'Document',null,true,null) as id", [id(13)])).rows[0].id;
  await db.query(`insert into public.document_files(id,request_id,version_no,file_position,storage_path,original_name,detected_mime_type,size_bytes,status,uploaded_by,content_sha256)
    values($1,$2,1,1,'fixture/doc','doc.pdf','application/pdf',10,'under_review',$3,repeat('a',64))`, [id(22), request, client]);
  const assignment = (await as(admin, 'select public.staff_assign_case($1,$2) as id', [id(13), manager])).rows[0].id;
  async function recordManagerAccess() {
    await db.exec('set role service_role');
    try { return await db.query("select public.server_record_file_access($1,'document_file',$2,'download_issued')", [manager, id(22)]); }
    finally { await db.exec('reset role'); }
  }
  await recordManagerAccess();
  await as(admin, "select public.admin_revoke_case_assignment($1,'Reassigned during file download')", [assignment]);
  await assert.rejects(recordManagerAccess(), /no longer authorized/, 'Final byte-delivery guard must reject a manager after revocation');
  assert.equal((await as(manager, 'select id from public.document_files')).rows.length, 0);

  for (const code of ['bad_code_verifier', 'flow_state_expired', 'flow_state_not_found', 'unexpected_failure']) {
    const callback = load('app/auth/callback/route.ts', name => {
      if (name === 'next/server') return { NextResponse: { redirect: url => ({ location: String(url) }) } };
      if (name.endsWith('/supabase/server')) return { createClient: async () => ({ auth: { exchangeCodeForSession: async () => ({ error: { code } }) } }) };
      return {};
    });
    const response = await callback.GET(new Request('https://fixture.invalid/auth/callback?code=invalid'));
    assert.equal(response.location, 'https://fixture.invalid/login?notice=link-sign-in-failed');
    assert.equal((await callback.GET(new Request('https://fixture.invalid/auth/callback'))).location, 'https://fixture.invalid/login?error=invalid-link');
  }
  console.log('OK consent RLS/API/version gates, client MFA upload gate, staff/bootstrap access, manager file revocation, truthful callback errors');
} finally { await db.close(); }
