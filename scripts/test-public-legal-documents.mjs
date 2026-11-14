// Isolated anonymous RLS and real public component rendering; no external calls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create schema auth; create schema private;
    create table auth.users(id uuid primary key);
    create function private.staff_mfa_passed() returns boolean language sql as $$ select false $$;
    grant usage on schema public to anon;
    insert into auth.users values('11111111-1111-4111-8111-111111111111');`);
  const schema = readFileSync('supabase/migrations/20261016007900_versioned_client_consents.sql', 'utf8');
  await db.exec(schema.slice(0, schema.indexOf('create function public.admin_publish_legal_document')));
  // Match hosted Supabase's default table grants, not just vanilla PostgreSQL.
  await db.exec('grant all privileges on public.legal_documents to anon');
  await db.exec(readFileSync('supabase/migrations/20261114010200_public_legal_documents.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/20261114010300_public_legal_column_grants.sql', 'utf8'));
  await db.exec(`insert into public.legal_documents(document_type,version,title,body,document_hash,is_current,published_by) values
    ('terms',1,'Previous terms','Old text','hash',false,'11111111-1111-4111-8111-111111111111'),
    ('terms',2,'Current terms','Approved terms','hash',true,'11111111-1111-4111-8111-111111111111'),
    ('privacy',1,'Current privacy','Approved privacy','hash',true,'11111111-1111-4111-8111-111111111111'),
    ('marketing',1,'Marketing','Optional','hash',true,'11111111-1111-4111-8111-111111111111');
    set role anon;`);
  const rows = (await db.query('select document_type,version,title,body from public.legal_documents order by document_type')).rows;
  assert.equal(rows.length, 2);
  assert.equal(rows.find(row => row.document_type === 'terms').version, 2);
  await assert.rejects(db.query('select published_by from public.legal_documents'), /permission denied/);
  await assert.rejects(db.query("update public.legal_documents set body='Changed'"), /permission denied/);
  await db.exec('reset role');
} finally { await db.close(); }

const nativeRequire = createRequire(import.meta.url);
let result = { data: null, error: null };
let signedIn = false;
const queryCalls = [];
const fakeClient = {
  from(table) {
    assert.equal(table, 'legal_documents');
    const query = {
      select(columns) { assert.equal(columns, 'title,body,version,published_at'); return query; },
      eq(column, value) { queryCalls.push([column, value]); return query; },
      maybeSingle: async () => result,
    };
    return query;
  },
};
const loadedModule = { exports: {} };
const source = ts.transpileModule(readFileSync('components/PublicLegalDocument.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const require = name => {
  if (name === 'next/link') return { default: ({ children, ...props }) => React.createElement('a', props, children) };
  if (name === 'next/image') return { default: ({ src, alt, width, height }) => React.createElement('img', { src, alt, width, height }) };
  if (name.endsWith('.css')) return {};
  if (name === './ReferenceIcon') return { ReferenceIcon: () => null };
  if (name === '../lib/supabase/server') return { createClient: async () => ({ auth: { getClaims: async () => ({ data: signedIn ? { claims: { sub: 'test-user' } } : null }) } }) };
  if (name === '@supabase/supabase-js') return { createClient: (url, key, options) => {
    assert.equal(key, 'public-test-key'); assert.equal(options.auth.persistSession, false); return fakeClient;
  } };
  return nativeRequire(name);
};
vm.runInNewContext(`(function(require,module,exports){${source}\n})`, {
  process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://example.test', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-test-key' } },
})(require, loadedModule, loadedModule.exports);
for (const type of ['terms', 'privacy']) {
  result = { data: { title: `Approved ${type}`, body: '<script>text only</script>', version: 2 }, error: null };
  const render = async () => renderToStaticMarkup(await loadedModule.exports.PublicLegalDocument({ type }));
  assert.match(await render(), /Approved/);
  assert.match(await render(), /href="\/login"[^>]*.*К входу/);
  signedIn = true;
  assert.match(await render(), /href="\/account"[^>]*.*В кабинет/);
  signedIn = false;
  assert.match(await render(), /&lt;script&gt;text only&lt;\/script&gt;/);
  assert.deepEqual(queryCalls.slice(-2), [['document_type', type], ['is_current', true]]);
  result = { data: null, error: null };
  assert.match(await render(), /Документ ещё не опубликован/);
  result = { data: null, error: { message: 'Synthetic failure' } };
  assert.match(await render(), /Не удалось загрузить документ/);
}
console.log('PASS public legal pages without secret key; current-only anonymous RLS, no publisher metadata/write access, safe text rendering and honest empty/error states');
