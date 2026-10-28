// Isolated workflow audit. Never reads .env, opens a network connection, or writes business data.
// Runs the real migrated SQL, server actions, route handlers and page components using
// a local PostgREST-shaped adapter and in-memory Storage bytes.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = path.resolve(import.meta.dirname, '..');
const nativeRequire = createRequire(import.meta.url);
const db = new PGlite();
const uid = n => `96000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = uid(1), finance = uid(2), lawyer = uid(3), client = uid(4), stranger = uid(5);
const card = uid(20), caseId = uid(21), service = uid(22), version = uid(23), assignment = uid(24);
const report = { generatedAt: new Date().toISOString(), scope: 'finance/files/session boundaries',
  environment: 'All repository migrations in isolated PGlite; actual TS actions/routes/pages with local SQL and Storage adapters. No production writes or network calls.',
  checks: [], findings: [], limitations: ['No browser layout validation in this slice.', 'No real Storage/network delivery or push delivery; Firebase is unconfigured on the deployment.', 'No real Supabase Auth server; logout action order and push-session removal are tested locally, not browser cookie invalidation.', 'PGlite serial execution does not prove real PostgreSQL concurrency/deadlock behavior.'] };
const store = new Map();
let tail = Promise.resolve();
async function as(user, sql, params = [], claims = {}) {
  const run = tail.then(async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [user ?? '', JSON.stringify({ sub: user, role: 'authenticated', aal: 'aal2', ...claims })]);
    await db.exec(`set role ${user ? 'authenticated' : 'anon'}`);
    try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
  });
  tail = run.catch(() => {});
  return run;
}
const normalize = value => JSON.parse(JSON.stringify(value));
async function rpc(user, name, args = {}, claims = {}) {
  const entries = Object.entries(args);
  return (await as(user, `select public.${name}(${entries.map(([key], i) => `${key} => $${i + 1}`).join(',')}) as value`, entries.map(([, v]) => v), claims)).rows[0]?.value;
}
async function check(name, fn) {
  try { const evidence = await fn(); report.checks.push({ name, status: 'pass', ...(evidence ? { evidence } : {}) }); }
  catch (error) { report.checks.push({ name, status: 'fail', error: error.message, stack: error.stack }); throw error; }
}
const redirect = destination => { throw Object.assign(new Error(`REDIRECT ${destination}`), { destination }); };
async function destination(work) { try { await work(); return null; } catch (error) { if (error.destination) return error.destination; throw error; } }

function clientAdapter(user, state = {}) {
  const adapter = {
    auth: { getClaims: async () => ({ data: { claims: user ? { sub: user } : null } }), signOut: async () => { state.signedOut = true; return { error: null }; } },
    from(table) {
      assert.match(table, /^[a-z_]+$/);
      let columns = '*', limit; const filters = [], values = [], orders = [];
      let memo;
      const execute = () => memo ??= (async () => {
        const query = `select ${columns} from public.${table}${filters.length ? ` where ${filters.join(' and ')}` : ''}${orders.length ? ` order by ${orders.join(',')}` : ''}${limit ? ` limit ${limit}` : ''}`;
        try { return { data: normalize((await as(user, query, values)).rows), error: null }; }
        catch (error) { return { data: null, error }; }
      })();
      const builder = {
        select(value = '*') { assert.match(value, /^[a-z0-9_, *]+$/); columns = value; return builder; },
        eq(key, value) { assert.match(key, /^[a-z_]+$/); values.push(value); filters.push(`${key}=$${values.length}`); return builder; },
        limit(value) { assert.ok(Number.isInteger(value) && value > 0); limit = value; return builder; },
        in(key, entries) { assert.match(key, /^[a-z_]+$/); const positions = entries.map(value => { values.push(value); return `$${values.length}`; }); filters.push(positions.length ? `${key} in (${positions.join(',')})` : 'false'); return builder; },
        neq(key, value) { assert.match(key, /^[a-z_]+$/); values.push(value); filters.push(`${key}<>$${values.length}`); return builder; },
        is(key, value) { assert.equal(value, null); assert.match(key, /^[a-z_]+$/); filters.push(`${key} is null`); return builder; },
        order(key, options = {}) { assert.match(key, /^[a-z_]+$/); orders.push(`${key} ${options.ascending === false ? 'desc' : 'asc'}`); return builder; },
        async maybeSingle() { const result = await execute(); return { ...result, data: result.data?.[0] ?? null }; },
        then(resolve, reject) { return execute().then(resolve, reject); },
      };
      return builder;
    },
    async rpc(name, args) {
      state.calls?.push({ name, args });
      try { return { data: normalize(await rpc(user, name, args)), error: null }; }
      catch (error) { return { data: null, error }; }
    },
  };
  return adapter;
}
const storageState = { failUpload: false, failAudit: false, signed: [], downloads: 0 };
const admin = {
  storage: { from(bucket) { return {
    async upload(name, bytes, options) {
      if (storageState.failUpload) return { error: { message: 'simulated outage' } };
      store.set(`${bucket}/${name}`, Buffer.from(bytes));
      await db.query(`insert into storage.objects(bucket_id,name,metadata,user_metadata) values($1,$2,$3,$4)
        on conflict(bucket_id,name) do update set metadata=excluded.metadata,user_metadata=excluded.user_metadata`,
        [bucket, name, { size: bytes.length, mimetype: options.contentType }, options.metadata ?? null]);
      if (storageState.afterUpload) await storageState.afterUpload();
      return { error: null };
    },
    async download(name) { storageState.downloads++; const bytes = store.get(`${bucket}/${name}`); return { data: bytes ? new Blob([bytes]) : null, error: bytes ? null : { message: 'missing' } }; },
    async createSignedUrl(name, seconds, options) { storageState.signed.push({ bucket, name, seconds, options }); return { data: { signedUrl: `https://storage.invalid/${bucket}/${name}?token=local` }, error: null }; },
  }; } },
  async rpc(name, args) {
    if (name === 'server_record_file_access' && storageState.failAudit) return { error: { code: 'LOCAL_AUDIT_OUTAGE' } };
    const entries = Object.entries(args);
    try { await db.query(`select public.${name}(${entries.map(([key], i) => `${key} => $${i + 1}`).join(',')})`, entries.map(([, v]) => v)); return { error: null }; }
    catch (error) { return { error }; }
  },
};

function loader(overrides = {}, environment = {}) {
  const cache = new Map();
  function load(file) {
    const full = path.resolve(root, file);
    if (Object.hasOwn(overrides, full)) return overrides[full];
    if (cache.has(full)) return cache.get(full).exports;
    const mod = { exports: {} }; cache.set(full, mod);
    const source = ts.transpileModule(readFileSync(full, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    } }).outputText;
    const require = name => {
      if (name === 'server-only') return {};
      if (name.endsWith('.css')) return {};
      if (name === 'next/navigation') return { redirect, notFound: () => { throw new Error('NOT_FOUND'); } };
      if (!name.startsWith('.')) return nativeRequire(name);
      const target = path.resolve(path.dirname(full), name);
      if (Object.hasOwn(overrides, target)) return overrides[target];
      for (const suffix of ['', '.ts', '.tsx', '.js']) if (existsSync(target + suffix)) return load(target + suffix);
      throw new Error(`Missing module ${target}`);
    };
    vm.runInNewContext(source, { module: mod, exports: mod.exports, require,
      Buffer, Blob, File, FormData, Request, Response, URL, console,
      process: { env: { APP_ORIGIN: 'https://local.invalid', SUPABASE_SECRET_KEY: 'LOCAL_MOCK_ONLY', ...environment } },
    }, { filename: full });
    return mod.exports;
  }
  return load;
}
const localFileUtils = loader()('lib/document-files.ts');
function appLoader(user, extra = {}, state = {}) {
  const supabase = clientAdapter(user, state);
  return loader({
    [path.join(root, 'lib/supabase/server')]: { createClient: async () => supabase },
    [path.join(root, 'lib/document-files')]: { ...localFileUtils, storageAdmin: () => admin },
    [path.join(root, 'lib/upload-request')]: { readBoundedFormData: request => request.formData(), UploadInputError: class extends Error {} },
    [path.join(root, 'components/DirectUploadForm')]: { DirectUploadForm: ({ children }) => children },
    ...extra,
  });
}
function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node !== 'object') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  return textOf(node.props?.children);
}
function nodes(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(child => nodes(child, predicate));
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}
function inert(node, index = 0) {
  if (Array.isArray(node)) return node.map(inert);
  if (!React.isValidElement(node)) return node;
  const { children, ...props } = node.props;
  delete props.action;
  delete props.formAction;
  if (typeof node.type === 'function') return inert(node.type({ ...props, children }));
  return React.createElement(node.type, { ...props, key: node.key ?? `fixture-${index}` }, inert(children));
}
const parameters = () => ({ params: Promise.resolve({ id: caseId }), searchParams: Promise.resolve({}) });
const pdf = label => new File([`%PDF-1.7\nLocal workflow fixture ${label}\n%%EOF`], `${label}.pdf`, { type: 'application/pdf' });
const metadata = checked => ({ name: checked.name, mime: checked.mime, size: checked.size, sha256: checked.sha256 });
const paymentKey = randomUUID();
let scheduleA, scheduleB, contractId, receiptId, paymentId, documentRequest, batch, checkedDocs;

try {
  await check('All migrations initialize an isolated database', async () => {
    await db.exec(`create role anon; create role authenticated; create role service_role; create role authenticator;
      create schema auth; create schema storage; create schema extensions;
      create function extensions.digest(text,text) returns bytea language sql as $$ select pg_catalog.sha256(convert_to($1,'UTF8')) $$;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create table auth.mfa_factors(id uuid primary key,user_id uuid,status text);
      create table auth.sessions(id uuid,user_id uuid,aal text,not_after timestamptz);
      create table auth.audit_log_entries(id uuid,created_at timestamptz,payload jsonb);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
      grant usage on schema auth,public to authenticated; grant execute on function auth.uid(),auth.jwt() to authenticated;
      create table storage.buckets(id text primary key,name text not null,public boolean not null,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(bucket_id text,name text,metadata jsonb,user_metadata jsonb,primary key(bucket_id,name));
      create publication supabase_realtime;`);
    const migrations = readdirSync(path.join(root, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
    for (const file of migrations) {
      if (file === '20261011000800_role_boundaries.sql') {
        await db.query('insert into auth.users values($1,$2,now())', [owner, 'ayanz2008@gmail.com']);
        await db.query("insert into public.staff_members(user_id,display_name,role) values($1,'Owner','admin')", [owner]);
      }
      try { await db.exec(readFileSync(path.join(root, 'supabase/migrations', file), 'utf8')); }
      catch (error) { throw new Error(`${file}: ${error.message}`); }
    }
    for (const user of [finance, lawyer, client, stranger]) await db.query('insert into auth.users values($1,$2,now())', [user, `${user}@example.test`]);
    await db.query("insert into public.staff_members(user_id,display_name,role,can_confirm_payments) values($1,'Finance','lawyer',true),($2,'Legal','lawyer',false)", [finance, lawyer]);
    await db.query('update public.staff_members set can_confirm_payments=true where user_id=$1', [owner]);
    await db.query("insert into public.clients(id,user_id,full_name,linked_by,linked_at) values($1,$2,'Client',$3,now())", [card, client, owner]);
    await db.query("insert into public.service_templates(id,code,name) values($1,'FQA','Finance/file QA')", [service]);
    await db.query('insert into public.service_template_versions(id,service_id,version_no) values($1,$2,1)', [version, service]);
    await db.query("insert into public.cases(id,case_number,client_id,service_version_id,title) values($1,'FQA-1',$2,$3,'Journey')", [caseId, card, version]);
    await db.query('insert into public.case_assignments(id,case_id,staff_user_id,assigned_by) values($1,$2,$3,$4),(gen_random_uuid(),$2,$5,$4)', [assignment, caseId, finance, owner, lawyer]);
    return { count: migrations.length, latest: migrations.at(-1) };
  });

  await check('Contract upload, replay, finance authorization and schedule ceiling', async () => {
    const checked = await localFileUtils.checkDocumentFile(pdf('contract'));
    const storagePath = `contracts/${caseId}/${randomUUID()}.pdf`;
    await admin.storage.from('modernsecure-files').upload(storagePath, checked.bytes, { contentType: checked.mime, metadata: { sha256: checked.sha256 } });
    const args = { p_case_id: caseId, p_contract_number: 'FQA-CONTRACT', p_signed_on: null, p_price_kzt: 1000, p_storage_path: storagePath, p_content_sha256: checked.sha256, p_size_bytes: checked.size };
    await assert.rejects(rpc(lawyer, 'staff_register_contract', args), /Not authorized/);
    contractId = await rpc(finance, 'staff_register_contract', args);
    assert.equal(await rpc(finance, 'staff_register_contract', args), contractId);
    scheduleA = await rpc(finance, 'staff_add_payment_installment', { p_case_id: caseId, p_due_on: '2026-10-01', p_amount_kzt: 500, p_description: 'INSTALLMENT-A' });
    scheduleB = await rpc(finance, 'staff_add_payment_installment', { p_case_id: caseId, p_due_on: '2026-11-01', p_amount_kzt: 500, p_description: 'INSTALLMENT-B' });
    await assert.rejects(rpc(finance, 'staff_add_payment_installment', { p_case_id: caseId, p_due_on: '2026-12-01', p_amount_kzt: 1 }), /exceeds remaining/);
    assert.equal((await as(client, 'select * from public.payment_schedule')).rows.length, 2);
  });

  async function receipt(label) {
    const file = await localFileUtils.checkDocumentFile(pdf(label));
    const key = randomUUID(), storagePath = `receipts/${caseId}/${client}/${key}.pdf`;
    await admin.storage.from('modernsecure-files').upload(storagePath, file.bytes, { contentType: file.mime, metadata: { sha256: file.sha256 } });
    const args = { p_case_id: caseId, p_storage_path: storagePath, p_original_name: file.name, p_mime_type: file.mime, p_size_bytes: file.size, p_content_sha256: file.sha256, p_idempotency_key: key };
    const id = await rpc(client, 'client_register_payment_receipt', args);
    assert.equal(await rpc(client, 'client_register_payment_receipt', args), id);
    return id;
  }
  await check('Receipt reject/retry, accepted receipt is not payment, and finance notification audience', async () => {
    const rejected = await receipt('rejected-receipt');
    const review = { p_receipt_id: rejected, p_accept: false, p_note: 'Not the matching transaction' };
    await assert.rejects(rpc(lawyer, 'staff_review_payment_receipt', review), /Not authorized/);
    await rpc(finance, 'staff_review_payment_receipt', review);
    await rpc(finance, 'staff_review_payment_receipt', review);
    await assert.rejects(rpc(finance, 'staff_review_payment_receipt', { ...review, p_accept: true }), /already reviewed/);
    receiptId = await receipt('accepted-receipt');
    await rpc(finance, 'staff_review_payment_receipt', { p_receipt_id: receiptId, p_accept: true, p_note: 'Readable bank transaction' });
    assert.equal((await as(client, 'select * from public.payments')).rows.length, 0);
    const recipients = (await db.query("select distinct recipient_user_id from public.notifications where kind='payment_receipt' and recipient_user_id<>$1", [client])).rows.map(r => r.recipient_user_id).sort();
    assert.deepEqual(recipients, [owner, finance].sort());
  });

  await check('Actual web confirm action records one transaction across installments and maps excess errors', async () => {
    const form = new FormData();
    for (const [key, value] of Object.entries({ caseId, scheduleId: scheduleA, key: paymentKey, amount: '700', paidOn: '2026-10-01', reference: 'BANK-FQA-700', receiptId })) form.set(key, value);
    const state = { calls: [] }, supabase = clientAdapter(finance, state);
    const load = appLoader(finance, { [path.join(root, 'lib/staff-case')]: { requireStaffCase: async () => ({ supabase, userId: finance, staff: { role: 'lawyer' }, item: { status: 'open', is_suspended: false } }) } });
    const actual = await destination(() => load('app/staff/cases/[id]/payments/actions.ts').confirmPayment(form));
    assert.equal(actual, `/staff/cases/${caseId}/payments?error=exceeds`);
    assert.equal((await as(client, 'select * from public.payments')).rows.length, 0, 'Failed confirmation must roll back');
    form.set('scheduleId', '');
    assert.equal(await destination(() => load('app/staff/cases/[id]/payments/actions.ts').confirmPayment(form)), `/staff/cases/${caseId}/payments?confirmed=1`);
    assert.equal(await destination(() => load('app/staff/cases/[id]/payments/actions.ts').confirmPayment(form)), `/staff/cases/${caseId}/payments?confirmed=1`);
    assert.equal((await as(client, 'select * from public.payments')).rows.length, 1);
    report.findings.push({ id: 'FIN-01', status: 'fixed and locally verified', severity: 'high', title: 'One bank transfer cannot cover multiple installments through the web UI',
      sources: ['app/staff/cases/[id]/payments/actions.ts:76', 'app/staff/cases/[id]/payments/page.tsx:126', 'supabase/migrations/20261018008700_payment_allocations_and_schedule_corrections.sql:76'],
      reproduction: 'Register a 1000 KZT contract; create two 500 KZT installments; accept a 700 KZT receipt; submit 700 against the first installment in the web confirmation form.',
      expected: 'Record the one unique bank transaction and allocate 500 plus 200 to the two installments.',
      actual: 'The actual action calls staff_confirm_payment_with_receipt with mandatory schedule_id; SQL rejects Payment exceeds active schedule; UI redirects to generic error=payment. Splitting the transaction requires a second reference and cannot reuse the same receipt.',
      fix: 'Use staff_record_payment at case level with optional installment selection; offer an allocation-aware form and map Payment exceeds active schedule to a useful error.' });
    return { redirect: actual, rpc: state.calls[0]?.name };
  });

  await check('Database cross-installment payment, idempotency and duplicate-reference protection', async () => {
    const args = { p_case_id: caseId, p_amount_kzt: 700, p_paid_on: '2026-10-01', p_reference: 'BANK-FQA-700', p_client_note: null, p_idempotency_key: paymentKey, p_receipt_id: receiptId };
    paymentId = await rpc(finance, 'staff_record_payment', args);
    assert.equal(await rpc(finance, 'staff_record_payment', args), paymentId);
    await assert.rejects(rpc(finance, 'staff_record_payment', { ...args, p_amount_kzt: 701 }), /key cannot be reused/);
    await assert.rejects(rpc(finance, 'staff_record_payment', { ...args, p_receipt_id: null, p_idempotency_key: randomUUID() }), /unique constraint/);
    const allocation = (await as(client, 'select schedule_id,amount_kzt from public.payment_allocations order by amount_kzt desc')).rows;
    assert.deepEqual(allocation.map(r => [r.schedule_id, Number(r.amount_kzt)]), [[scheduleA, 500], [scheduleB, 200]]);
    return { allocated: allocation };
  });

  async function paymentPage(user, staff) {
    const supabase = clientAdapter(user);
    const overrides = staff ? { [path.join(root, 'lib/staff-case')]: { requireStaffCase: async () => ({ supabase, userId: user, staff: { role: 'lawyer' }, item: { status: 'open', is_suspended: false } }) } } : {};
    return appLoader(user, overrides)(`app/${staff ? 'staff' : 'account'}/cases/[id]/payments/page.tsx`).default(parameters());
  }
  function saveFinanceFixture(tree, name, staff) {
    mkdirSync(path.join(root, 'artifacts/workflow-qa'), { recursive: true });
    writeFileSync(path.join(root, `artifacts/workflow-qa/finance-${name}.html`), `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Local finance fixture</title></head><body><main class="${staff ? 'staff-content' : 'account-content'}">${renderToStaticMarkup(inert(tree))}</main></body></html>`);
  }
  async function summaryPages(expectDue) {
    const overview = await appLoader(client)('app/account/cases/[id]/CaseOverview.tsx').default({ params: Promise.resolve({ id: caseId }) });
    const nextPayment = nodes(overview, node => node.props?.href === `/account/cases/${caseId}/payments`)[0];
    const more = await appLoader(client)('app/account/more/page.tsx').default();
    const morePayment = nodes(more, node => node.props?.className?.includes('client-next-payment'))[0];
    if (expectDue) {
      assert.match(textOf(nextPayment), /300/);
      assert.match(textOf(morePayment), /300/);
    } else {
      assert.match(textOf(nextPayment), /Нет платежей к оплате/);
      assert.equal(morePayment, undefined);
    }
  }
  await check('Actual client/staff pages reflect allocated payments and cancelled obligations', async () => {
    const evidence = [];
    for (const [user, staff] of [[client, false], [finance, true]]) {
      const tree = await paymentPage(user, staff);
      const article = nodes(tree, n => n.type === 'article' && textOf(n).includes('INSTALLMENT-A'))[0];
      const actual = textOf(article).replace(/\s+/g, ' ');
      assert.match(actual, /Оплачено/);
      assert.match(actual, /500.*из.*500/);
      if (staff) saveFinanceFixture(tree, 'staff-pending', true);
      evidence.push({ audience: staff ? 'staff' : 'client', firstInstallment: actual });
    }
    await summaryPages(true);
    const revision = (await as(finance, 'select updated_at::text from public.payment_schedule where id=$1', [scheduleB])).rows[0].updated_at;
    const cancelForm = new FormData();
    for (const [key, value] of Object.entries({ caseId, scheduleId: scheduleB, expectedUpdatedAt: revision, reason: 'Remaining obligation waived' })) cancelForm.set(key, value);
    const supabase = clientAdapter(finance);
    const cancelAction = appLoader(finance, { [path.join(root, 'lib/staff-case')]: { requireStaffCase: async () => ({ supabase }) } })('app/staff/cases/[id]/payments/actions.ts').cancelInstallment;
    assert.equal(await destination(() => cancelAction(cancelForm)), `/staff/cases/${caseId}/payments?cancelled=1`);
    assert.equal(await destination(() => cancelAction(cancelForm)), `/staff/cases/${caseId}/payments?error=conflict`);
    for (const [user, staff] of [[client, false], [finance, true]]) {
      const tree = await paymentPage(user, staff);
      const article = nodes(tree, n => n.type === 'article' && textOf(n).includes('INSTALLMENT-B'))[0];
      const actual = textOf(article).replace(/\s+/g, ' ');
      assert.match(actual, /Остаток отменён/);
      assert.match(actual, /200.*из.*500/);
      assert.match(actual, /Remaining obligation waived/);
      assert.equal(nodes(article, n => n.type === 'form').length, 0);
      const nextDue = nodes(tree, n => (n.type === 'article' || n.type === 'div') && textOf(n).startsWith('Следующий срок'))[0];
      assert.match(textOf(nextDue), /Нет/);
      saveFinanceFixture(tree, staff ? 'staff' : 'client', staff);
      evidence.push({ audience: staff ? 'staff' : 'client', cancelledInstallment: actual });
    }
    await summaryPages(false);
    report.findings.push({ id: 'FIN-02', status: 'fixed and locally verified', severity: 'high', title: 'Client and staff pages show allocated and cancelled installments as unpaid',
      sources: ['app/account/cases/[id]/payments/page.tsx:15', 'app/account/cases/[id]/payments/page.tsx:43', 'app/staff/cases/[id]/payments/page.tsx:23', 'app/staff/cases/[id]/payments/page.tsx:109'],
      reproduction: 'Record the 700 KZT transaction through staff_record_payment (allocations 500/200, payment.schedule_id=null), then cancel the remaining second installment.',
      expected: 'First installment paid; second installment shows its 200 KZT payment and cancelled remainder; neither is next due.',
      actual: 'Executing both real page components against the migrated database renders 0 of 500, Ожидается for both. The cancelled item still offers edit/confirm controls to staff. Pages read payments.schedule_id and omit payment_allocations/cancelled_at.',
      fix: 'Read confirmed payment_allocations and cancellation fields in all payment summaries and pages; exclude cancelled obligations from next due and mutations; show historical paid amounts.' });
    return evidence;
  });

  await check('Payment void reopens allocations; stale installment changes and revoked finance permissions are rejected', async () => {
    await rpc(finance, 'staff_void_payment', { p_payment_id: paymentId, p_reason: 'Correct mistaken bank matching' });
    await assert.rejects(rpc(finance, 'staff_void_payment', { p_payment_id: paymentId, p_reason: 'Retry' }), /Invalid void/);
    assert.equal(Number((await db.query('select private.installment_paid($1) as paid', [scheduleA])).rows[0].paid), 0);
    const revision = (await as(finance, 'select updated_at::text from public.payment_schedule where id=$1', [scheduleA])).rows[0].updated_at;
    const args = { p_schedule_id: scheduleA, p_expected_updated_at: revision, p_due_on: '2026-10-02', p_amount_kzt: 500, p_description: 'INSTALLMENT-A', p_reason: 'Date correction' };
    await rpc(finance, 'staff_update_payment_installment', args);
    await assert.rejects(rpc(finance, 'staff_update_payment_installment', args), /changed by another/);
    await rpc(owner, 'admin_set_payment_permission', { p_staff_user_id: finance, p_allowed: false, p_reason: 'Access boundary test' });
    await assert.rejects(rpc(finance, 'staff_record_payment', { p_case_id: caseId, p_amount_kzt: 10, p_paid_on: '2026-10-01', p_reference: 'BANK-FQA-NEW', p_client_note: null, p_idempotency_key: randomUUID() }), /Not authorized/);
    await rpc(owner, 'admin_set_payment_permission', { p_staff_user_id: finance, p_allowed: true, p_reason: 'Restore local fixture access' });
  });

  await check('Document upload partial failure, draft privacy, resume and complete replay', async () => {
    documentRequest = await rpc(lawyer, 'staff_create_document_request', { p_case_id: caseId, p_title: 'Identity pages', p_instructions: 'Both pages', p_required: true });
    checkedDocs = await Promise.all([pdf('identity-front'), pdf('identity-back')].map(f => localFileUtils.checkDocumentFile(f)));
    const key = randomUUID();
    const args = { p_request_id: documentRequest, p_idempotency_key: key, p_files: checkedDocs.map(metadata) };
    batch = await rpc(client, 'resume_or_begin_document_upload', args);
    assert.equal((await as(lawyer, 'select * from public.document_files where request_id=$1', [documentRequest])).rows.length, 0);
    assert.equal((await as(client, 'select * from public.document_files where request_id=$1', [documentRequest])).rows.length, 2);
    async function upload(index) {
      const form = new FormData(); form.set('sessionId', batch.session_id); form.set('fileId', batch.files[index].id);
      form.set('file', new File([checkedDocs[index].bytes], checkedDocs[index].name));
      return appLoader(client)('app/api/document-uploads/file/route.ts').POST(new Request('https://local.invalid/api/document-uploads/file', { method: 'POST', headers: { origin: 'https://local.invalid' }, body: form }));
    }
    assert.equal((await upload(0)).status, 200);
    storageState.failUpload = true; assert.equal((await upload(1)).status, 503); storageState.failUpload = false;
    await assert.rejects(rpc(client, 'complete_document_upload', { p_session_id: batch.session_id }), /incomplete/);
    const resumed = await rpc(client, 'resume_or_begin_document_upload', { ...args, p_idempotency_key: randomUUID() });
    assert.equal(resumed.session_id, batch.session_id);
    assert.equal((await upload(1)).status, 200);
    await rpc(client, 'complete_document_upload', { p_session_id: batch.session_id });
    await rpc(client, 'complete_document_upload', { p_session_id: batch.session_id });
    assert.equal((await rpc(client, 'resume_or_begin_document_upload', args)).status, 'completed');
    assert.equal((await as(lawyer, "select * from public.document_files where request_id=$1 and status='under_review'", [documentRequest])).rows.length, 2);
    assert.equal((await db.query("select count(*)::int as n from public.audit_events where entity_id=$1 and action='documents_submitted'", [batch.session_id])).rows[0].n, 1);
    return { session: batch.session_id, files: batch.files.map(f => f.id), versions: 1 };
  });

  await check('Document review return, new version, final acceptance and immutable accepted file', async () => {
    await rpc(lawyer, 'staff_review_document_file', { p_file_id: batch.files[0].id, p_accept: true });
    await rpc(lawyer, 'staff_review_document_file', { p_file_id: batch.files[1].id, p_accept: false, p_reason: 'Back side blurry' });
    const next = await rpc(client, 'resume_or_begin_document_upload', { p_request_id: documentRequest, p_idempotency_key: randomUUID(), p_files: checkedDocs.map(metadata) });
    for (const [index, target] of next.files.entries()) {
      await rpc(client, 'authorize_document_file_upload', { p_session_id: next.session_id, p_file_id: target.id });
      await admin.storage.from('modernsecure-files').upload(target.path, checkedDocs[index].bytes, { contentType: checkedDocs[index].mime });
      assert.equal((await admin.rpc('server_verify_document_file', { p_session_id: next.session_id, p_file_id: target.id, p_sha256: checkedDocs[index].sha256 })).error, null);
    }
    await rpc(client, 'complete_document_upload', { p_session_id: next.session_id });
    for (const file of next.files) await rpc(lawyer, 'staff_review_document_file', { p_file_id: file.id, p_accept: true });
    assert.equal((await db.query('select private.document_request_current_state($1) as state', [documentRequest])).rows[0].state, 'accepted');
    await assert.rejects(rpc(client, 'retract_document_file', { p_file_id: next.files[0].id }), /cannot be retracted/);
    assert.deepEqual((await as(client, 'select distinct version_no from public.document_files where request_id=$1 order by version_no', [documentRequest])).rows.map(r => r.version_no), [1, 2]);
  });

  async function getFile(user, kind, id, preview = false) {
    return appLoader(user)(`app/api/${kind}/[id]/route.ts`).GET(new Request(`https://local.invalid/api/${kind}/${id}${preview ? '?preview=1' : ''}`), { params: Promise.resolve({ id }) });
  }
  await check('File route authorization, byte integrity, audit fail-closed, download and preview', async () => {
    for (const [kind, id] of [['contracts', contractId], ['payment-receipts', receiptId], ['document-files', batch.files[0].id]]) {
      assert.equal((await getFile(null, kind, id)).status, 401);
      assert.equal((await getFile(stranger, kind, id)).status, 404);
      const response = await getFile(client, kind, id);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assert.match(response.headers.get('content-disposition'), /attachment/);
      assert.equal((await getFile(client, kind, id, true)).status, 200);
      storageState.failAudit = true;
      assert.equal((await getFile(client, kind, id)).status, 503);
      storageState.failAudit = false;
    }
    const target = `modernsecure-files/${batch.files[0].path}`, original = store.get(target);
    store.set(target, Buffer.from('Corrupt storage bytes'));
    assert.equal((await getFile(client, 'document-files', batch.files[0].id)).status, 503);
    store.set(target, original);
  });

  await check('Notification deep links use current access and retain unread state', async () => {
    const notice = (await as(finance, "select id,read_at from public.notifications where kind='document_submission' and case_id=$1 limit 1", [caseId])).rows[0];
    assert.ok(notice);
    const extra = { [path.join(root, 'lib/staff')]: { getStaffStatus: async () => ({ staff: { active: true, mfa_passed: true }, error: null }) }, [path.join(root, 'lib/account-access')]: { requireAccountApproval: async () => {} } };
    const open = () => appLoader(finance, extra)('app/notifications/open/[id]/page.tsx').default({ params: Promise.resolve({ id: notice.id }) });
    assert.equal(await destination(open), `/staff/cases/${caseId}/documents#request-${documentRequest}`);
    assert.equal((await as(finance, 'select read_at from public.notifications where id=$1', [notice.id])).rows[0].read_at, null);
    await rpc(owner, 'admin_revoke_case_assignment', { p_assignment_id: assignment, p_reason: 'Case reassigned' });
    assert.equal(await destination(open), '/staff/notifications');
    for (const [kind, id] of [['contracts', contractId], ['payment-receipts', receiptId], ['document-files', batch.files[0].id]]) assert.equal((await getFile(finance, kind, id)).status, 404);
    await assert.rejects(rpc(finance, 'staff_record_payment', { p_case_id: caseId, p_amount_kzt: 10, p_paid_on: '2026-10-01', p_reference: 'REVOKED-REF', p_client_note: null, p_idempotency_key: randomUUID() }), /Not authorized/);
    return { validTarget: `/staff/cases/${caseId}/documents#request-${documentRequest}`, afterRevocation: '/staff/notifications' };
  });

  await check('Assignment revocation during byte transfer leaves an inaccessible unsubmitted draft', async () => {
    const request = await rpc(lawyer, 'staff_create_document_request', { p_case_id: caseId, p_title: 'Revocation boundary', p_required: false });
    const checked = await localFileUtils.checkDocumentFile(pdf('revocation-boundary'));
    const prepared = await rpc(lawyer, 'resume_or_begin_document_upload', { p_request_id: request, p_idempotency_key: randomUUID(), p_files: [metadata(checked)] });
    const assignment = (await db.query('select id from public.case_assignments where case_id=$1 and staff_user_id=$2 and revoked_at is null', [caseId, lawyer])).rows[0].id;
    storageState.afterUpload = () => rpc(owner, 'admin_revoke_case_assignment', { p_assignment_id: assignment, p_reason: 'Reassigned during transfer' });
    const form = new FormData(); form.set('sessionId', prepared.session_id); form.set('fileId', prepared.files[0].id); form.set('file', new File([checked.bytes], checked.name));
    const response = await appLoader(lawyer)('app/api/document-uploads/file/route.ts').POST(new Request('https://local.invalid/api/document-uploads/file', { method: 'POST', headers: { origin: 'https://local.invalid' }, body: form }));
    storageState.afterUpload = null;
    assert.equal(response.status, 403);
    await assert.rejects(rpc(lawyer, 'authorize_document_file_upload', { p_session_id: prepared.session_id, p_file_id: prepared.files[0].id }), /authorized/);
    await assert.rejects(rpc(lawyer, 'complete_document_upload', { p_session_id: prepared.session_id }), /incomplete|authorized/);
    assert.equal((await db.query('select status from public.document_files where id=$1', [prepared.files[0].id])).rows[0].status, 'quarantine');
    assert.equal((await getFile(client, 'document-files', prepared.files[0].id)).status, 404);
    assert.equal((await getFile(lawyer, 'document-files', prepared.files[0].id)).status, 404);
    return { responseStatus: 403, fileStatus: 'quarantine', clientDownload: 404, revokedStaffDownload: 404 };
  });

  await check('Large-file handoff uses 90-second signed URL and no-store redirect', async () => {
    const deliver = loader()('lib/file-delivery.ts').deliverFile;
    const response = await deliver(admin, 'local-large-file.pdf', Buffer.alloc(4 * 1024 * 1024 + 1), { 'Content-Type': 'application/pdf' }, { preview: false, name: 'large.pdf' });
    assert.equal(response.status, 302); assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(storageState.signed.at(-1).seconds, 90);
    return { expirySeconds: 90, limitation: 'Existing bearer URL can remain valid until expiry after assignment revocation; fresh application-route access was verified denied.' };
  });

  await check('Logout action unregisters current push session and redirects only after signOut call', async () => {
    const calls = [];
    const fake = { rpc: async name => { calls.push(name); return { error: null }; }, auth: { signOut: async () => { calls.push('signOut'); return { error: null }; } } };
    const action = loader({ [path.join(root, 'lib/supabase/server')]: { createClient: async () => fake } })('app/account/actions.ts').signOutAction;
    assert.equal(await destination(action), '/login');
    assert.deepEqual(calls, ['unregister_push_session', 'signOut']);
    const session = uid(91);
    await db.query('insert into auth.sessions values($1,$2,$3,null)', [session, client, 'aal1']);
    await rpc(client, 'register_push_device', { p_id: uid(92), p_secret: uid(93), p_token: 'LOCAL-TEST-PUSH-TOKEN-ONLY', p_platform: 'android' }, { session_id: session });
    await rpc(client, 'unregister_push_session', {}, { session_id: session });
    assert.equal((await db.query('select enabled from public.push_devices where id=$1', [uid(92)])).rows[0].enabled, false);
  });

  await check('Suspended, closed and cancelled cases reject every financial mutation through RPC', async () => {
    const evidence = [];
    for (const [index, state] of ['suspended', 'closed', 'cancelled'].entries()) {
      const targetCase = uid(60 + index);
      await db.query("insert into public.cases(id,case_number,client_id,service_version_id,title) values($1,$2,$3,$4,'Boundary fixture')", [targetCase, `FIN-BOUNDARY-${state}`, card, version]);
      const file = await localFileUtils.checkDocumentFile(pdf(`boundary-${state}`));
      const contractArgs = { p_case_id: targetCase, p_contract_number: `FIN-${state}`, p_signed_on: null, p_price_kzt: 200, p_storage_path: `contracts/${targetCase}/${randomUUID()}.pdf`, p_content_sha256: file.sha256, p_size_bytes: file.size };
      await admin.storage.from('modernsecure-files').upload(contractArgs.p_storage_path, file.bytes, { contentType: file.mime, metadata: { sha256: file.sha256 } });
      await rpc(owner, 'staff_register_contract', contractArgs);
      const schedule = await rpc(owner, 'staff_add_payment_installment', { p_case_id: targetCase, p_due_on: '2026-10-01', p_amount_kzt: 100 });
      const recordArgs = { p_case_id: targetCase, p_amount_kzt: state === 'suspended' ? 10 : 100, p_paid_on: '2026-10-01', p_reference: 'BOUNDARY-INITIAL', p_client_note: null, p_idempotency_key: randomUUID() };
      const payment = await rpc(owner, 'staff_record_payment', recordArgs);
      const revision = (await as(owner, 'select updated_at::text from public.payment_schedule where id=$1', [schedule])).rows[0].updated_at;
      if (state === 'suspended') await rpc(owner, 'staff_suspend_case', { p_case_id: targetCase, p_reason_for_client: 'Paused for boundary test', p_control_at: new Date(Date.now() + 86400000).toISOString() });
      if (state === 'closed') await rpc(owner, 'staff_close_case', { p_case_id: targetCase, p_result_summary: 'Completed boundary fixture' });
      if (state === 'cancelled') await rpc(owner, 'staff_cancel_case', { p_case_id: targetCase, p_reason: 'Cancelled boundary fixture' });
      const denied = [
        ['staff_record_payment', { ...recordArgs, p_reference: 'BOUNDARY-AFTER', p_idempotency_key: randomUUID() }],
        ['staff_add_payment_installment', { p_case_id: targetCase, p_due_on: '2026-11-01', p_amount_kzt: 20 }],
        ['staff_update_payment_installment', { p_schedule_id: schedule, p_expected_updated_at: revision, p_due_on: '2026-11-01', p_amount_kzt: 100, p_description: null, p_reason: 'After terminal state' }],
        ['staff_cancel_payment_installment', { p_schedule_id: schedule, p_expected_updated_at: revision, p_reason: 'After terminal state' }],
        ['staff_void_payment', { p_payment_id: payment, p_reason: 'After terminal state' }],
        ['staff_register_contract', { ...contractArgs, p_contract_number: 'NEW', p_storage_path: `contracts/${targetCase}/${randomUUID()}.pdf` }],
      ];
      for (const [name, args] of denied) await assert.rejects(rpc(owner, name, args), /Case is not active/, `${state}: ${name} must reject`);
      assert.equal((await as(client, 'select * from public.payments where case_id=$1', [targetCase])).rows.length, 1);
      evidence.push({ state, rejected: denied.map(([name]) => name) });
    }
    report.findings.push({ id: 'FIN-03', status: 'fixed and locally verified', severity: 'high',
      title: 'Migration 087 allowed finance writes after a case was suspended or ended',
      sources: ['supabase/migrations/20261018008700_payment_allocations_and_schedule_corrections.sql:39', 'supabase/migrations/20261028009300_active_financial_case_guard.sql:3'],
      reproduction: 'Create contract and schedule, suspend case through staff_suspend_case, then call staff_record_payment with a fresh transaction.',
      expected: 'Reject mutations while suspended, closed or cancelled.',
      actual: 'Before migration 093, the isolated reproduction succeeded and assert.rejects reported Missing expected rejection. The shared financial lock checked access and existence but omitted status/is_suspended.',
      fix: 'Migration 093 restores the active-case check under the same row lock for all financial mutations.' });
    return evidence;
  });

  await check('Ending a partially unpaid case is atomic; settlement or explicit cancellation unlocks the transition', async () => {
    const evidence = [];
    for (const [index, terminal] of ['closed', 'cancelled'].entries()) {
      const targetCase = uid(70 + index);
      await db.query("insert into public.cases(id,case_number,client_id,service_version_id,title) values($1,$2,$3,$4,'End-case payment boundary')", [targetCase, `FIN-END-${terminal}`, card, version]);
      const file = await localFileUtils.checkDocumentFile(pdf(`ending-${terminal}`));
      const storagePath = `contracts/${targetCase}/${randomUUID()}.pdf`;
      await admin.storage.from('modernsecure-files').upload(storagePath, file.bytes, { contentType: file.mime, metadata: { sha256: file.sha256 } });
      await rpc(owner, 'staff_register_contract', { p_case_id: targetCase, p_contract_number: `ENDING-${terminal}`, p_signed_on: null, p_price_kzt: 100, p_storage_path: storagePath, p_content_sha256: file.sha256, p_size_bytes: file.size });
      const schedule = await rpc(owner, 'staff_add_payment_installment', { p_case_id: targetCase, p_due_on: '2026-10-01', p_amount_kzt: 100 });
      await rpc(owner, 'staff_record_payment', { p_case_id: targetCase, p_amount_kzt: 40, p_paid_on: '2026-10-01', p_reference: 'ENDING-PARTIAL', p_client_note: null, p_idempotency_key: randomUUID() });
      const task = await rpc(owner, 'staff_create_task', { p_case_id: targetCase, p_kind: 'answer', p_title: 'Unfinished work', p_description: null, p_due_at: null });
      const request = await rpc(owner, 'staff_create_document_request', { p_case_id: targetCase, p_title: 'Optional unsubmitted document', p_required: false });
      const counts = async () => (await db.query(`select
        (select count(*) from public.audit_events where case_id=$1)::int as audits,
        (select count(*) from public.notifications where case_id=$1)::int as notices,
        (select count(*) from public.task_events where task_id=$2)::int as task_events`, [targetCase, task])).rows[0];
      const before = await counts();
      const endName = terminal === 'closed' ? 'staff_close_case' : 'staff_cancel_case';
      const endArgs = terminal === 'closed' ? { p_case_id: targetCase, p_result_summary: 'Completed' } : { p_case_id: targetCase, p_reason: 'Cancelled' };
      await assert.rejects(rpc(owner, endName, endArgs), /Outstanding payment schedule must be resolved/);
      const staffOverride = { [path.join(root, 'lib/staff')]: { requireStaff: async () => ({ supabase: clientAdapter(owner), userId: owner, staff: { role: 'admin' } }) } };
      const actions = appLoader(owner, staffOverride)('app/staff/actions.ts');
      const form = new FormData(); form.set('caseId', targetCase); form.set('result', 'Completed'); form.set('reason', 'Cancelled');
      assert.equal(await destination(() => actions[terminal === 'closed' ? 'closeCase' : 'cancelCase'](form)), `/staff/cases/${targetCase}?error=outstanding-payments`);
      assert.equal((await db.query('select status from public.cases where id=$1', [targetCase])).rows[0].status, 'open');
      assert.equal((await db.query('select status from public.tasks where id=$1', [task])).rows[0].status, 'new');
      assert.equal((await db.query('select status from public.document_requests where id=$1', [request])).rows[0].status, 'active');
      assert.deepEqual(await counts(), before, 'Rejected end must not emit audits, notifications or task events');
      if (terminal === 'closed') {
        await rpc(owner, 'staff_record_payment', { p_case_id: targetCase, p_amount_kzt: 60, p_paid_on: '2026-10-01', p_reference: 'ENDING-SETTLEMENT', p_client_note: null, p_idempotency_key: randomUUID() });
      } else {
        const revision = (await db.query('select updated_at::text from public.payment_schedule where id=$1', [schedule])).rows[0].updated_at;
        await rpc(owner, 'staff_cancel_payment_installment', { p_schedule_id: schedule, p_expected_updated_at: revision, p_reason: 'Explicitly waive remaining obligation' });
      }
      await rpc(owner, endName, endArgs);
      assert.equal((await db.query('select status from public.cases where id=$1', [targetCase])).rows[0].status, terminal);
      assert.equal((await db.query('select status from public.tasks where id=$1', [task])).rows[0].status, 'cancelled');
      assert.equal(Number((await db.query("select sum(amount_kzt) as paid from public.payments where case_id=$1 and status='confirmed'", [targetCase])).rows[0].paid), terminal === 'closed' ? 100 : 40);
      evidence.push({ terminal, rejectedWhileDue: 60, resolution: terminal === 'closed' ? 'recorded actual remaining 60' : 'explicit reasoned cancellation of 60', preservedPaid: terminal === 'closed' ? 100 : 40 });
    }
    report.findings.push({ id: 'LR-01', status: 'fixed and locally verified', severity: 'high',
      title: 'Ending a case could strand unpaid scheduled obligations',
      sources: ['supabase/migrations/20261028009500_resolve_payments_before_case_end.sql', 'app/staff/actions.ts', 'app/staff/cases/[id]/page.tsx'],
      reproduction: 'Record 40 against a 100 installment, then close or cancel the case.',
      expected: 'Require actual settlement or explicit cancellation of the 60 remainder before ending the case.',
      actual: 'Independent reviewer reproduced successful terminal transition followed by permanent denial of settlement under migration 093.',
      fix: 'Migration 095 blocks terminal transitions under the case row lock; rejection rolls back task/request changes. Actions link staff to finance resolution; archived client views retain history without active payment guidance.' });
    return evidence;
  });

  await check('Legacy archives suppress payment guidance while preserving unpaid historical records', async () => {
    const targetCase = uid(80);
    await db.query("insert into public.cases(id,case_number,client_id,service_version_id,title) values($1,'FIN-LEGACY-ARCHIVE',$2,$3,'Legacy archive')", [targetCase, card, version]);
    const file = await localFileUtils.checkDocumentFile(pdf('legacy-archive'));
    const storagePath = `contracts/${targetCase}/${randomUUID()}.pdf`;
    await admin.storage.from('modernsecure-files').upload(storagePath, file.bytes, { contentType: file.mime, metadata: { sha256: file.sha256 } });
    await rpc(owner, 'staff_register_contract', { p_case_id: targetCase, p_contract_number: 'LEGACY-ARCHIVE', p_signed_on: null, p_price_kzt: 100, p_storage_path: storagePath, p_content_sha256: file.sha256, p_size_bytes: file.size });
    await rpc(owner, 'staff_add_payment_installment', { p_case_id: targetCase, p_due_on: '2026-10-01', p_amount_kzt: 100, p_description: 'Historical unpaid installment' });
    await db.query("update public.contact_settings set payment_details='LOCAL PAYMENT INSTRUCTIONS' where id=true");
    // Model a pre-095 archived row in this isolated fixture only; never rewrite
    // historical debt or disable a trigger in the connected database.
    await db.exec('alter table public.cases disable trigger modernsecure_case_end_payment_schedule');
    try {
      for (const state of ['closed', 'cancelled']) {
        await db.query("update public.cases set status=$2,closed_at=now(),result_summary='Legacy terminal fixture',updated_at=clock_timestamp() where id=$1", [targetCase, state]);
        const load = appLoader(client);
        const payments = await load('app/account/cases/[id]/payments/page.tsx').default({ params: Promise.resolve({ id: targetCase }), searchParams: Promise.resolve({}) });
        assert.doesNotMatch(textOf(payments), /Следующий срок|Как оплатить|LOCAL PAYMENT INSTRUCTIONS|Добавить чек об оплате/);
        assert.match(textOf(payments), /Historical unpaid installment/);
        assert.match(textOf(payments), /Непогашено в архивном графике/);
        const overview = await load('app/account/cases/[id]/CaseOverview.tsx').default({ params: Promise.resolve({ id: targetCase }) });
        assert.doesNotMatch(textOf(overview), /Ближайшая оплата/);
        assert.match(textOf(overview), /Открыть договор и историю оплат/);
        const more = await load('app/account/more/page.tsx').default();
        assert.equal(nodes(more, node => node.props?.className?.includes('client-next-payment')).length, 0);
      }
    } finally { await db.exec('alter table public.cases enable trigger modernsecure_case_end_payment_schedule'); }
  });
} catch (error) {
  report.fatalError = error.message;
  process.exitCode = 1;
} finally {
  report.totals = { passed: report.checks.filter(c => c.status === 'pass').length, failed: report.checks.filter(c => c.status === 'fail').length, findings: report.findings.length };
  mkdirSync(path.join(root, 'artifacts/workflow-qa'), { recursive: true });
  writeFileSync(path.join(root, 'artifacts/workflow-qa/finance-files.json'), `${JSON.stringify(report, null, 2)}\n`);
  await db.close();
  console.log(JSON.stringify({ ...report.totals, fatalError: report.fatalError, report: 'artifacts/workflow-qa/finance-files.json' }, null, 2));
}
