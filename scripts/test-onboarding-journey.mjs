import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import ts from 'typescript';

// No network requests or delivered emails in the default run. The optional
// production probe only executes SELECTs inside a READ ONLY transaction.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const db = new PGlite();
const uid = n => `91000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scenarios = [];
let session = { n: 1, aal: 'aal2' };
let serial = Promise.resolve();
const report = {
  generatedAt: new Date().toISOString(),
  command: 'node scripts/test-onboarding-journey.mjs [--production-read-only]',
  scope: {
    tested: ['All migration SQL in isolated PGlite', 'Actual signup/login/approval Server Actions through an in-memory auth adapter', 'Actual authorization helpers, callback, waiting page, Team page and pending component', 'RLS and API pre-request gate, role/workspace routing, invitations, pagination, fresh reads, audit and notifications'],
    unverified: ['Real GoTrue signup/email delivery/PKCE browser cookies', 'Real browser rendering and hydration', 'Production approval, role changes, invitations and business-data writes'],
  },
  productionReadOnly: { status: 'not-run' },
  scenarios,
};

async function as(n, sql, params = [], aal = 'aal2') {
  const work = serial.then(async () => {
    const user = n ? uid(n) : '';
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [user, JSON.stringify({ sub: user, role: 'authenticated', aal })]);
    await db.exec('set role authenticated');
    try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
  });
  serial = work.catch(() => {});
  return work;
}

async function addUser(n, verified = false, email = `journey${n}@example.test`) {
  await db.query('insert into auth.users values($1,$2,$3)', [uid(n), email, verified ? new Date() : null]);
}
const form = values => { const data = new FormData(); for (const [k, v] of Object.entries(values)) data.set(k, v); return data; };
const Redirect = class extends Error { constructor(destination) { super(`Redirect ${destination}`); this.destination = destination; } };
async function redirected(fn, expected) {
  try { await fn(); assert.fail(`Expected redirect to ${expected}`); }
  catch (error) { if (!(error instanceof Redirect)) throw error; assert.equal(error.destination, expected); }
}
function record(id, expected, actual, sources = [], matches = true, severity = 'none') {
  scenarios.push({ id, result: matches ? 'pass' : 'finding', severity, expected, actual, sources });
}
function identifier(value) {
  assert.match(value, /^[a-z_][a-z0-9_]*$/i);
  return `"${value}"`;
}

function fixtureClient() {
  const actor = { ...session };
  return {
    auth: {
      getClaims: async () => ({ data: { claims: actor.n ? { sub: uid(actor.n), email: `journey${actor.n}@example.test`, aal: actor.aal } : null } }),
      signUp: async ({ email, options }) => { assert.equal(options.emailRedirectTo, 'https://fixture.invalid/auth/callback'); await addUser(10, false, email); return { error: null }; },
      signInWithPassword: async ({ email }) => {
        const { rows } = await db.query('select id,email_confirmed_at from auth.users where email=$1', [email]);
        if (!rows[0]?.email_confirmed_at) return { error: { code: 'email_not_confirmed' } };
        return { error: null };
      },
      exchangeCodeForSession: async code => ({ error: code === 'fixture-valid-code' ? null : { code: 'fixture-missing-pkce-verifier' } }),
      signOut: async () => ({ error: null }),
    },
    rpc: async (name, args = {}) => {
      const names = Object.keys(args);
      const parameters = names.map((key, i) => `${identifier(key)} => $${i + 1}`).join(',');
      const table = ['admin_pending_accounts', 'admin_staff_emails'].includes(name);
      try {
        const result = await as(actor.n, `select ${table ? '*' : ''}${table ? ' from ' : ''}public.${identifier(name)}(${parameters})${table ? '' : ' as data'}`, Object.values(args), actor.aal);
        return { data: table ? result.rows : result.rows[0]?.data, error: null };
      } catch (error) { return { data: null, error }; }
    },
    from: table => {
      const state = { columns: '*', filters: [], args: [], orders: [], count: false, head: false, range: null, single: false };
      const query = {
        select(columns, options = {}) { state.columns = columns; state.count = options.count === 'exact'; state.head = options.head; return query; },
        eq(column, value) { state.args.push(value); state.filters.push(`${identifier(column)}=$${state.args.length}`); return query; },
        is(column, value) { assert.equal(value, null); state.filters.push(`${identifier(column)} is null`); return query; },
        in(column, values) { const slots = values.map(value => { state.args.push(value); return `$${state.args.length}`; }); state.filters.push(`${identifier(column)} in (${slots.join(',')})`); return query; },
        ilike(column, value) { state.args.push(value); state.filters.push(`${identifier(column)} ilike $${state.args.length}`); return query; },
        order(column, options = {}) { state.orders.push(`${identifier(column)} ${options.ascending === false ? 'desc' : 'asc'}`); return query; },
        range(first, last) { state.range = [first, last]; return query; },
        maybeSingle() { state.single = true; return query; },
        then(resolve, reject) {
          const execute = async () => {
            const columns = state.columns === '*' ? '*' : state.columns.split(',').map(x => identifier(x.trim())).join(',');
            const where = state.filters.length ? ` where ${state.filters.join(' and ')}` : '';
            const base = `from public.${identifier(table)}${where}`;
            try {
              const count = state.count ? Number((await as(actor.n, `select count(*) as n ${base}`, state.args, actor.aal)).rows[0].n) : null;
              const rows = state.head ? [] : (await as(actor.n, `select ${columns} ${base}${state.orders.length ? ` order by ${state.orders.join(',')}` : ''}${state.range ? ` limit ${state.range[1] - state.range[0] + 1} offset ${state.range[0]}` : ''}`, state.args, actor.aal)).rows;
              return { data: state.single ? rows[0] ?? null : rows, count, error: null };
            } catch (error) { return { data: null, count: null, error }; }
          };
          return execute().then(resolve, reject);
        },
      };
      return query;
    },
  };
}

// Execute repository TS/TSX, replacing framework/network boundaries only.
// Assertions inspect the resulting element tree, not source-code regexes.
const moduleCache = new Map();
const React = require('react');
const mocks = {
  'next/cache': { revalidatePath: () => {} },
  'next/form': { __esModule: true, default: props => React.createElement('form', props) },
  'next/navigation': { redirect: destination => { throw new Redirect(destination); }, notFound: () => { throw new Error('Not found'); } },
  'next/server': { NextResponse: { redirect: url => ({ location: String(url) }) } },
  'next/link': { __esModule: true, default: props => React.createElement('a', props) },
  [path.join(root, 'lib/supabase/server.ts')]: { createClient: async () => fixtureClient() },
  [path.join(root, 'components/SubmitButton.tsx')]: { SubmitButton: ({ children }) => React.createElement('button', { type: 'submit' }, children) },
  [path.join(root, 'components/NavIcon.tsx')]: { NavIcon: () => null },
  [path.join(root, 'components/AccountAccessRefresh.tsx')]: { AccountAccessRefresh: ({ showButton }) => showButton ? React.createElement('button', { type: 'button' }, 'Обновить заявки') : null },
  [path.join(root, 'components/ListControls.tsx')]: { ListSearch: () => null, ListPagination: () => null },
  [path.join(root, 'app/account/actions.ts')]: { signOutAction: () => {} },
};
function load(relative) {
  const filename = path.resolve(root, relative);
  if (mocks[filename]) return mocks[filename];
  if (moduleCache.has(filename)) return moduleCache.get(filename).exports;
  const mod = { exports: {} };
  moduleCache.set(filename, mod);
  const output = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename }).outputText;
  const localRequire = name => {
    if (mocks[name]) return mocks[name];
    if (!name.startsWith('.')) return require(name);
    const resolved = path.resolve(path.dirname(filename), name);
    const candidate = [resolved, `${resolved}.ts`, `${resolved}.tsx`].find(file => existsSync(file));
    assert.ok(candidate, `Cannot resolve ${name} from ${filename}`);
    return load(candidate);
  };
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports);
  return mod.exports;
}
async function resolveTree(element) {
  if (Array.isArray(element)) { const out = []; for (const item of element) out.push(await resolveTree(item)); return out.flat(); }
  if (element == null || typeof element === 'boolean') return null;
  if (typeof element !== 'object') return String(element);
  if (typeof element.type === 'function') return resolveTree(await element.type(element.props));
  return { type: typeof element.type === 'string' ? element.type : 'fragment', props: element.props, children: await resolveTree(element.props?.children) };
}
function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(item => nodes(item, predicate));
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.children, predicate)];
}
function content(tree) {
  if (Array.isArray(tree)) return tree.map(content).join(' ');
  if (!tree) return '';
  return typeof tree === 'object' ? content(tree.children) : tree;
}

async function productionProbe() {
  const { default: pg } = await import('pg');
  const entry = readFileSync(path.join(root, '.env.db.local'), 'utf8').split(/\r?\n/).find(line => line.trimStart().startsWith('DATABASE_URL='));
  const url = new URL(entry.slice(entry.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, ''));
  url.searchParams.delete('sslmode'); url.searchParams.delete('sslrootcert');
  const client = new pg.Client({ connectionString: url.toString(), ssl: { ca: readFileSync(path.join(root, 'supabase/certs/prod-ca-2021.crt'), 'utf8'), rejectUnauthorized: true }, connectionTimeoutMillis: 12000 });
  try {
    await client.connect();
    await client.query('begin read only');
    const admin = (await client.query("select s.role,s.active,s.is_primary_admin,u.email_confirmed_at is not null as email_verified from auth.users u left join public.staff_members s on s.user_id=u.id where lower(u.email)='admin@modernsecure.test'")).rows[0];
    const pending = (await client.query("select count(*)::int as total,count(*) filter(where email_confirmed_at is not null)::int as verified,count(*) filter(where u.created_at > now()-interval '48 hours')::int as registered_last_48h from auth.users u where not exists(select 1 from public.staff_members s where s.user_id=u.id) and not exists(select 1 from public.clients c where c.user_id=u.id)")).rows[0];
    const primary = (await client.query('select count(*)::int as total,count(*) filter(where active)::int as active from public.staff_members where is_primary_admin')).rows[0];
    const pendingInvites = (await client.query("select count(*)::int as total from public.staff_invites where status='pending'")).rows[0];
    const gates = (await client.query("select p.proname,pg_get_functiondef(p.oid) like '%require_primary_account_admin%' as primary_gate from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('admin_pending_accounts','admin_approve_account') order by 1")).rows;
    report.productionReadOnly = { status: 'pass', observedAt: new Date().toISOString(), target: 'admin@modernsecure.test', admin, pending, primary, pendingInvites, gates };
    await client.query('rollback');
  } finally { await client.end(); }
}

try {
  await db.exec(`create role anon; create role authenticated; create role service_role; create role authenticator;
    create schema auth; create schema storage; create schema extensions;
    create function extensions.digest(text,text) returns bytea language sql as $$ select pg_catalog.sha256(convert_to($1, 'UTF8')) $$;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
    create table auth.mfa_factors(id uuid primary key, user_id uuid, status text);
    create table auth.sessions(id uuid, user_id uuid, aal text, not_after timestamptz);
    create table auth.audit_log_entries(id uuid, created_at timestamptz, payload jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
    grant usage on schema auth,public to authenticated;
    grant execute on function auth.uid(),auth.jwt() to authenticated;
    create table storage.buckets(id text primary key,name text not null,public boolean not null,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text,name text,metadata jsonb,user_metadata jsonb,primary key(bucket_id,name));
    create publication supabase_realtime;`);
  const migrations = readdirSync(path.join(root, 'supabase/migrations')).filter(file => file.endsWith('.sql')).sort();
  for (const file of migrations) {
    if (file.includes('0008')) {
      await addUser(1, true, 'ayanz2008@gmail.com');
      await db.query("insert into public.staff_members(user_id,display_name,role) values($1,'Fixture primary admin','admin')", [uid(1)]);
    }
    try { await db.exec(readFileSync(path.join(root, 'supabase/migrations', file), 'utf8')); }
    catch (error) { throw new Error(`${file}: ${error.message}`); }
  }
  report.migrations = { count: migrations.length, last: migrations.at(-1) };
  await addUser(2, true); await addUser(3, true);
  await db.query("insert into public.staff_members(user_id,display_name,role) values($1,'Fixture ordinary admin','admin'),($2,'Fixture manager','manager')", [uid(2), uid(3)]);
  process.env.APP_ORIGIN = 'https://fixture.invalid';
  const authActions = load('app/login/actions.ts');
  const staffActions = load('app/staff/actions.ts');
  const { workspaceDestination } = load('lib/workspace-destination.ts');
  const { requireAccountApproval } = load('lib/account-access.ts');
  const { PendingAccounts } = load('components/PendingAccounts.tsx');
  const TeamPage = load('app/staff/team/page.tsx').default;
  const WaitingPage = load('app/awaiting-approval/page.tsx').default;

  session = { n: 10, aal: 'aal1' };
  const invalid = await authActions.registerAction({}, form({ email: 'bad-email', password: 'fixture-pass', passwordRepeat: 'fixture-pass' }));
  assert.equal(invalid.status, 'error');
  const signup = await authActions.registerAction({}, form({ email: ' Journey10@Example.Test ', password: 'fixture-pass', passwordRepeat: 'fixture-pass' }));
  assert.equal(signup.status, 'success');
  assert.equal((await db.query('select email from public.profiles where user_id=$1', [uid(10)])).rows[0].email, 'journey10@example.test');
  assert.equal((await db.query('select count(*)::int as n from public.clients')).rows[0].n, 0);
  assert.equal((await as(10, 'select public.account_access_status() as state')).rows[0].state, 'pending');
  assert.equal((await authActions.loginAction({}, form({ email: 'journey10@example.test', password: 'fixture-pass' }))).status, 'error');
  record('signup-unverified', 'Creates only a profile; requests confirmation; cannot obtain workspace access.', 'Actual registration action creates a normalized-email Auth/profile fixture; SQL reports pending and login reports email_not_confirmed.', ['app/login/actions.ts', 'supabase/migrations/20261010000100_core_schema.sql']);

  await assert.rejects(as(1, "select public.admin_approve_account($1,'client','Fixture client')", [uid(10)]), /Verified account not found/);
  session = { n: 1, aal: 'aal2' };
  let pendingTree = await resolveTree(await PendingAccounts({ supabase: fixtureClient(), page: 1 }));
  assert.match(content(pendingTree), /Ожидает подтверждения email/);
  assert.equal(nodes(pendingTree, node => node.type === 'form').length, 0);
  await db.query('update auth.users set email_confirmed_at=now() where id=$1', [uid(10)]);
  session = { n: 10, aal: 'aal1' };
  const callback = load('app/auth/callback/route.ts');
  assert.equal((await callback.GET(new Request('https://fixture.invalid/auth/callback?code=fixture-valid-code'))).location, 'https://fixture.invalid/account');
  assert.equal((await callback.GET(new Request('https://fixture.invalid/auth/callback?code=fixture-missing-code'))).location, 'https://fixture.invalid/login?notice=email-confirmed');
  await redirected(() => requireAccountApproval(fixtureClient()), '/awaiting-approval');
  const waiting = await resolveTree(await WaitingPage());
  assert.match(content(waiting), /Ожидаем активацию/);
  assert.ok(nodes(waiting, node => node.type === 'a' && node.props.href === '/account').length);
  await as(10, "select set_config('request.path','rpc/update_own_profile',false)");
  await assert.rejects(as(10, 'select public.enforce_staff_mfa_request()'), /Account approval is required/);
  for (const route of ['rpc/account_access_status', 'rpc/staff_mfa_status', 'contact_settings', 'legal_documents']) {
    await as(10, "select set_config('request.path',$1,false)", [route]);
    await as(10, 'select public.enforce_staff_mfa_request()');
  }
  assert.equal((await as(10, 'select * from public.cases')).rows.length, 0);
  record('confirmed-pending-and-api-gate', 'Confirmation alone leaves registration pending; protected data and APIs remain unavailable.', 'Actual callback routes through /account to /awaiting-approval; waiting page provides Check status; pre-request hook blocks protected RPC, permits bootstrap/help, RLS hides cases.', ['app/auth/callback/route.ts', 'app/awaiting-approval/page.tsx', 'lib/account-access.ts', 'supabase/migrations/20261027008900_primary_account_activation.sql']);

  for (const actor of [3, 10]) {
    await assert.rejects(as(actor, 'select * from public.admin_pending_accounts()'), /Not authorized/);
    await assert.rejects(as(actor, "select public.admin_approve_account($1,'client','Fixture client')", [uid(10)]), /Not authorized/);
  }
  session = { n: 2, aal: 'aal2' };
  const ordinaryTeam = await resolveTree(await TeamPage({ searchParams: Promise.resolve({ tab: 'pending' }) }));
  assert.ok(nodes(ordinaryTeam, node => node.type === 'a' && node.props.href?.includes('tab=pending')).length);
  assert.equal(nodes(ordinaryTeam, node => node.type === 'option' && node.props.value === 'admin').length, 0);
  await redirected(() => staffActions.approveAccount(form({ userId: uid(10), displayName: 'Escalation', role: 'admin' })), '/staff/team?tab=pending&accountPage=1&error=approval-invalid');
  const hasVisibleExplanation = content(ordinaryTeam).includes('Вы можете активировать клиентов, юристов и менеджеров.');
  assert.ok(hasVisibleExplanation);
  record('ordinary-admin-discovery', 'Ordinary admin sees requests, can approve non-admin roles, and has explicit explanation of protected admin role.', 'Pending tab and count are visible; approval form excludes admin, forged admin Server Action rejected, visible scope explanation present.', ['app/staff/team/page.tsx', 'lib/staff.ts']);

  session = { n: 1, aal: 'aal2' };
  const ownerTeam = await resolveTree(await TeamPage({ searchParams: Promise.resolve({ tab: 'pending' }) }));
  assert.ok(nodes(ownerTeam, node => node.type === 'a' && node.props.href?.includes('tab=pending')).length);
  assert.match(content(ownerTeam), /journey10@example.test/);
  session = { n: 2, aal: 'aal2' };
  await redirected(() => staffActions.approveAccount(form({ userId: uid(10), displayName: 'Fixture client', role: 'client' })), '/staff/team?tab=pending&accountPage=1&approved=1');
  assert.equal((await as(10, 'select public.account_access_status() as state')).rows[0].state, 'approved');
  assert.equal(workspaceDestination(null), '/account');
  session = { n: 10, aal: 'aal1' };
  await redirected(() => WaitingPage(), '/account');
  await requireAccountApproval(fixtureClient());
  const clientCard = (await as(10, 'select id from public.clients where user_id=$1', [uid(10)])).rows[0].id;
  assert.ok(clientCard);
  await assert.rejects(as(1, "select public.admin_approve_account($1,'lawyer','Duplicate')", [uid(10)]), /Account already assigned/);
  assert.equal((await db.query("select count(*)::int as n from public.audit_events where entity_type='account' and action='approved'")).rows[0].n, 1);
  record('ordinary-approval-client-refresh', 'Ordinary admin approves once; client gains only client workspace on a fresh status check; audit is recorded.', 'Executed actual ordinary-admin approval Server Action: redirect preserves pending page, linked client card, pending page redirects to /account on next request, duplicate cross-role approval rejected, one account approval audit event.', ['app/staff/actions.ts', 'app/awaiting-approval/page.tsx', 'lib/workspace-destination.ts']);

  await as(1, "select public.admin_invite_staff('journey11@example.test','Invited lawyer','lawyer')");
  await addUser(11, false);
  await db.query('update auth.users set email_confirmed_at=now() where id=$1', [uid(11)]);
  assert.equal((await as(11, 'select public.claim_staff_invite() as claimed')).rows[0].claimed, false);
  assert.equal((await as(11, 'select public.account_access_status() as state')).rows[0].state, 'pending');
  session = { n: 1, aal: 'aal2' };
  pendingTree = await resolveTree(await PendingAccounts({ supabase: fixtureClient(), page: 1 }));
  const inviteCard = nodes(pendingTree, node => node.type === 'details' && content(node).includes('journey11@example.test'))[0];
  const roleSelect = nodes(inviteCard, node => node.type === 'select' && node.props.name === 'role')[0];
  const nameField = nodes(inviteCard, node => node.type === 'input' && node.props.name === 'displayName')[0];
  record('invitation-role-context', 'A confirmed invitation retains visible intended role/name when primary reviews approval.', `Invitation remains pending and claim cannot grant access. Approval form defaults role=${roleSelect.props.defaultValue}, displayName=${JSON.stringify(nameField.props.defaultValue)}; stored invitation is lawyer / Invited lawyer.`, ['components/PendingAccounts.tsx', 'supabase/migrations/20261027008900_primary_account_activation.sql'], roleSelect.props.defaultValue === 'lawyer' && nameField.props.defaultValue === 'Invited lawyer', 'P2');
  await as(1, "select public.admin_approve_account($1,'lawyer','Invited lawyer')", [uid(11)]);
  const staffStatus = (await as(11, 'select public.staff_mfa_status() as staff')).rows[0].staff;
  assert.equal(workspaceDestination(staffStatus), '/staff');
  assert.equal(staffStatus.is_primary_admin, false);
  assert.equal((await db.query("select status from public.staff_invites where email='journey11@example.test'")).rows[0].status, 'cancelled');
  await as(1, "select public.admin_set_staff_access($1,'lawyer',false,'Fixture disable')", [uid(11)]);
  assert.equal((await as(11, 'select public.account_access_status() as state')).rows[0].state, 'disabled');
  assert.equal(workspaceDestination((await as(11, 'select public.staff_mfa_status() as staff')).rows[0].staff), '/access-denied');
  assert.equal((await as(1, 'select * from public.admin_pending_accounts()')).rows.length, 0);
  record('invitation-approval-disabled-route', 'Only explicit approval grants staff workspace; disabled staff never returns to pending or client access.', 'Invitation claim returned false. Explicit approval created non-primary lawyer and /staff destination. Disable produced disabled and /access-denied; user excluded from pending queue.', ['lib/workspace-destination.ts', 'supabase/migrations/20261027008900_primary_account_activation.sql']);

  await addUser(12, true);
  const existing = (await as(3, "select public.staff_create_client('Existing fixture','journey12@example.test') as id")).rows[0].id;
  await assert.rejects(as(1, "select public.admin_approve_account($1,'client','Existing fixture',$2)", [uid(12), clientCard]), /Client card is unavailable/);
  await as(1, "select public.admin_approve_account($1,'client','Existing fixture',$2)", [uid(12), existing]);
  assert.equal((await db.query('select user_id from public.clients where id=$1', [existing])).rows[0].user_id, uid(12));
  await addUser(13, true);
  await as(1, "select public.admin_approve_account($1,'admin','New ordinary admin')", [uid(13)]);
  await as(13, 'select * from public.admin_pending_accounts()');
  await assert.rejects(as(13, "select public.admin_approve_account($1,'admin','Escalation')", [uid(1000)]), /Not authorized/);
  await db.query("insert into auth.mfa_factors values(gen_random_uuid(),$1,'verified')", [uid(1)]);
  await assert.rejects(as(1, 'select * from public.admin_pending_accounts()', [], 'aal1'), /Not authorized/);
  record('existing-card-role-mfa-boundaries', 'Existing client linkage preserves ownership; new admins do not become primary; enrolled MFA protects approvals.', 'Wrong/occupied card rejected; eligible existing card linked. Newly approved admin can read queue but cannot appoint admin; primary AAL1 rejected after MFA enrollment.', ['supabase/migrations/20261028009100_admin_account_activation.sql']);

  const beforeNotifications = Number((await db.query('select count(*) as n from public.notifications')).rows[0].n);
  for (let n = 100; n < 126; n++) await addUser(n, true);
  const first = (await as(1, 'select * from public.admin_pending_accounts(0)')).rows;
  const second = (await as(1, 'select * from public.admin_pending_accounts(25)')).rows;
  assert.equal(first.length, 25); assert.equal(second.length, 1);
  assert.equal(new Set([...first, ...second].map(row => row.user_id)).size, 26);
  assert.equal(Number(first[0].total_count), 26);
  session = { n: 1, aal: 'aal2' };
  const pageTwo = await resolveTree(await PendingAccounts({ supabase: fixtureClient(), page: 2 }));
  assert.ok(nodes(pageTwo, node => node.type === 'a' && node.props.href?.includes('accountPage=1')).length);
  const stalePage = await resolveTree(await PendingAccounts({ supabase: fixtureClient(), page: 9999 }));
  const staleHasAccounts = nodes(stalePage, node => node.type === 'form').length > 0;
  record('stale-pending-page', 'Out-of-range bookmark/filter state recovers a valid pending page and shows existing requests.', `26 pending accounts; page 1 has 25, page 2 has 1, stable unique ordering. page=9999 renders ${staleHasAccounts ? 'requests' : 'На этой странице нет заявок with only a previous-page link'}.`, ['components/PendingAccounts.tsx', 'lib/list-query.ts', 'supabase/migrations/20261027008900_primary_account_activation.sql'], staleHasAccounts, 'P2');
  const approveLast = second[0].user_id;
  await as(1, "select public.admin_approve_account($1,'client','Paging fixture')", [approveLast]);
  const drainedPage = await resolveTree(await PendingAccounts({ supabase: fixtureClient(), page: 2 }));
  record('pending-page-after-concurrent-approval', 'When another admin/session removes last item on page 2, reload recovers page 1.', `After approval there are 25 pending accounts; page 2 ${nodes(drainedPage, node => node.type === 'form').length ? 'recovers accounts' : 'is empty and requires a manual Back click'}.`, ['components/PendingAccounts.tsx'], nodes(drainedPage, node => node.type === 'form').length > 0, 'P2');
  const afterNotifications = Number((await db.query('select count(*) as n from public.notifications')).rows[0].n);
  assert.equal(afterNotifications - beforeNotifications, 26 * 3 + 1);
  const { notificationDestination } = load('lib/notification-links.ts');
  const registrationNotice = (await as(2,"select id,target_path,kind,dedupe_key from public.notifications where kind='account_registration' and recipient_user_id=$1 order by created_at desc limit 1",[uid(2)])).rows[0];
  assert.equal(notificationDestination(registrationNotice,'staff'),'/staff/team?tab=pending');
  assert.equal((await as(2,'select public.open_own_notification($1) as destination',[registrationNotice.id])).rows[0].destination,'/staff/team?tab=pending');
  assert.equal((await as(10,'select public.open_own_notification($1) as destination',[registrationNotice.id])).rows[0].destination,null);
  const approvedNotice = (await as(10,"select target_path,kind,dedupe_key from public.notifications where kind='account_approved'")).rows[0];
  assert.equal(notificationDestination(approvedNotice,'client'),'/account');
  record('registration-approval-notifications', 'Admins learn about confirmed registrations and users learn about activation; notification links stay in the correct workspace.', `26 new confirmed registrations notified three active admins each; approval added one client notification. Existing resolver routes registration to pending queue, approval to account. A foreign recipient cannot open the notice.`, ['supabase/migrations/20261028009100_admin_account_activation.sql', 'lib/notification-links.ts', 'app/awaiting-approval/page.tsx']);

  // Add client by exact email: run the real lookup, component and server action.
  const lookup = async (email, actor = 2, aal = 'aal2') => (await as(actor, 'select public.admin_find_client_account($1) as result', [email], aal)).rows[0].result;
  const { AddClient } = load('components/AddClient.tsx');
  const { addRegisteredClient } = load('app/staff/clients/actions.ts');
  for (const actor of [3, 10]) await assert.rejects(lookup('journey200@example.test', actor), /Not authorized/);
  await assert.rejects(lookup('not-an-email'), /Invalid email/);
  assert.equal((await lookup('missing@example.test')).status, 'missing');
  assert.equal((await lookup('%@example.test')).status, 'missing', 'Search is exact, not a SQL pattern');
  assert.equal((await lookup('journey2@example.test')).status, 'staff');
  assert.equal((await lookup('journey10@example.test')).status, 'linked');
  await addUser(200, true);
  await addUser(201, false);
  const found = await lookup('  JOURNEY200@EXAMPLE.TEST ');
  assert.equal(found.status, 'pending'); assert.equal(found.email_verified, true);
  assert.equal(found.user_id, uid(200));
  const foundTree = await resolveTree(AddClient({ admin: true, open: true, email: found.email, result: found, error: null }));
  assert.equal(nodes(foundTree, node => node.type === 'form' && node.props.action === addRegisteredClient).length, 1);
  const unverifiedTree = await resolveTree(AddClient({ admin: true, open: true, email: 'journey201@example.test', result: await lookup('journey201@example.test'), error: null }));
  assert.equal(nodes(unverifiedTree, node => node.type === 'form' && node.props.action === addRegisteredClient).length, 0);
  session = { n: 2, aal: 'aal2' };
  await redirected(() => addRegisteredClient(form({ email: 'journey201@example.test', displayName: 'Unverified' })), '/staff/clients?new=1&email=journey201%40example.test&error=lookup-unverified');
  await redirected(() => addRegisteredClient(form({ email: 'JOURNEY200@EXAMPLE.TEST', displayName: 'Client by email', role: 'admin' })), '/staff/clients?added=1&q=journey200%40example.test');
  assert.equal((await lookup('journey200@example.test')).status, 'linked');
  assert.equal((await db.query('select count(*)::int n from public.staff_members where user_id=$1', [uid(200)])).rows[0].n, 0);
  await redirected(() => addRegisteredClient(form({ email: 'journey200@example.test', displayName: 'Duplicate' })), '/staff/clients?new=1&email=journey200%40example.test&error=lookup-card');
  assert.equal((await db.query('select count(*)::int n from public.clients where user_id=$1', [uid(200)])).rows[0].n, 1);
  await addUser(202, true);
  const matching = (await as(2, "select public.staff_create_client('Existing matching client','journey202@example.test') as id")).rows[0].id;
  assert.equal((await lookup('journey202@example.test')).cards[0].id, matching);
  await redirected(() => addRegisteredClient(form({ email: 'journey202@example.test', displayName: 'Existing' })), '/staff/clients?new=1&email=journey202%40example.test&error=lookup-card');
  await redirected(() => addRegisteredClient(form({ email: 'journey202@example.test', displayName: 'Existing', clientId: matching })), '/staff/clients?added=1&q=journey202%40example.test');
  assert.equal((await lookup('journey202@example.test')).client_id, matching);
  await addUser(203, true);
  await as(2, "select public.admin_invite_staff('journey203@example.test','Invited staff','lawyer')");
  assert.equal((await lookup('journey203@example.test')).invited_role, 'lawyer');
  await redirected(() => addRegisteredClient(form({ email: 'journey203@example.test', displayName: 'Wrong flow' })), '/staff/clients?new=1&email=journey203%40example.test&error=lookup-invited');
  for (const actor of [3, 10]) await assert.rejects(as(actor, "select public.admin_add_client_account('journey201@example.test','Forbidden')"), /Not authorized/);
  await db.query("insert into auth.mfa_factors values(gen_random_uuid(),$1,'verified')", [uid(2)]);
  await assert.rejects(lookup('journey200@example.test', 2, 'aal1'), /Not authorized/);
  await assert.rejects(as(2, "select public.admin_add_client_account('journey201@example.test','Forbidden')", [], 'aal1'), /Not authorized/);
  await db.query('update public.staff_members set active=false where user_id=$1', [uid(2)]);
  await assert.rejects(lookup('journey200@example.test'), /Not authorized/);
  await db.query('update public.staff_members set active=true where user_id=$1', [uid(2)]);
  record('client-email-lookup-and-activation', 'Exact admin-only lookup resolves registered accounts and existing cards; activation remains verified, explicit, client-only and duplicate-safe.', 'Executed lookup/component/action: normalized email, exact wildcard handling, missing/staff/linked/unverified states, create + replay rejection, existing card reuse, staff invitation refusal, manager/client/MFA/disabled denials.', ['components/AddClient.tsx', 'app/staff/clients/actions.ts', 'supabase/migrations/20261028009600_client_account_email_lookup.sql']);

  if (process.argv.includes('--production-read-only')) await productionProbe();
  report.status = 'completed';
  console.log(`OK onboarding harness: ${scenarios.length} scenarios, ${scenarios.filter(item => item.result === 'finding').length} reproducible UX findings; all authorization assertions passed.`);
} catch (error) {
  report.status = 'failed';
  report.error = error.message;
  process.exitCode = 1;
  console.error(error);
} finally {
  await db.close();
  mkdirSync(path.join(root, 'artifacts/workflow-qa'), { recursive: true });
  writeFileSync(path.join(root, 'artifacts/workflow-qa/onboarding.json'), `${JSON.stringify(report, null, 2)}\n`);
}
