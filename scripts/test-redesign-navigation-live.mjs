import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createServerClient } from '@supabase/ssr';

for (const file of ['.env.local', '.test-accounts.local.json']) assert.equal(statSync(file).mode & 0o077, 0);
const env = readFileSync('.env.local', 'utf8');
const value = name => env.split(/\r?\n/).find(line => line.startsWith(`${name}=`))?.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, '');
const accounts = JSON.parse(readFileSync('.test-accounts.local.json', 'utf8')).accounts;
const base = new URL(process.env.TEST_BASE_URL ?? 'http://localhost:3000');
assert.ok(['localhost', '127.0.0.1'].includes(base.hostname));
let checked = 0;
for (const role of ['client', 'lawyer', 'manager']) {
  const jar = new Map();
  const client = createServerClient(value('NEXT_PUBLIC_SUPABASE_URL'), value('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'), {cookies: {
    getAll: () => [...jar].map(([name, value]) => ({name, value})),
    setAll: items => items.forEach(item => item.options?.maxAge === 0 ? jar.delete(item.name) : jar.set(item.name, item.value)),
  }});
  const get = path => fetch(new URL(path, base), {headers: {cookie: [...jar].map(([k,v]) => `${k}=${v}`).join('; ')}, redirect: 'manual'});
  try {
    const login = await client.auth.signInWithPassword({email: accounts[role].email, password: accounts[role].password});
    assert.ifError(login.error);
    const cases = await client.from('cases').select('id, case_number').limit(1);
    assert.ifError(cases.error); assert.ok(cases.data?.length);
    const item = cases.data[0];
    const root = role === 'client' ? '/account' : '/staff';
    const routes = role === 'client' ? ['/account', '/account/profile', '/account/help', '/account/notifications'] : ['/staff', '/staff/cases', '/staff/overview', '/staff/inbox', '/staff/chat', '/staff/notifications', '/staff-security'];
    if (role === 'manager') routes.push('/staff/clients');
    if (role === 'lawyer') routes.push('/staff/review');
    for (const suffix of ['', '/tasks', '/documents', '/messages', '/payments', ...(role === 'client' ? [] : ['/notes'])]) routes.push(`${root}/cases/${item.id}${suffix}`);
    for (const route of routes) {
      const response = await get(route);
      assert.equal(response.status, 200, `${role}: ${route} did not load`);
      const html = await response.text();
      assert.ok(!html.includes('Попробуем ещё раз?'), `${role}: ${route} rendered error boundary`);
      assert.ok(html.includes('Современная'), `${role}: ${route} lacks application identity`);
      if (role === 'client') for (const nav of ['/account', '/account/profile', '/account/help', '/account/notifications']) assert.ok(html.includes(`href="${nav}"`), `${route} lost shared navigation: ${nav}`);
      if (route === '/staff') assert.ok(html.includes('Поиск и фильтры дел') && html.includes('Список дел'), 'Staff must land in searchable cases');
      if (route.includes(`/cases/${item.id}`)) {
        assert.ok(html.includes(`Разделы дела № ${item.case_number}`), `${route} lost case navigation`);
        for (const section of ['tasks','documents','messages','payments']) assert.ok(html.includes(`href="${root}/cases/${item.id}/${section}"`), `${route} lost ${section}`);
      }
      checked++;
    }
    if (role !== 'client') for (const route of ['/staff/team', '/staff/settings', '/staff/audit']) assert.notEqual((await get(route)).status, 200, `${role} reached admin route ${route}`);
    if (role === 'client') assert.notEqual((await get('/staff')).status, 200, 'Client reached staff area');
  } finally { await client.auth.signOut({scope: 'local'}); }
}
console.log(`OK redesign navigation: ${checked} authenticated pages, shared client navigation, case-first landing, case context and role restrictions; password-only QA sign-in works`);
