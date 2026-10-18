import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServerClient } from '@supabase/ssr';

const source = readFileSync('.env.local', 'utf8');
const value = name => source.split(/\r?\n/).find(line => line.startsWith(`${name}=`))?.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, '');
const accounts = JSON.parse(readFileSync('.workspace-accounts.local.json', 'utf8')).accounts;
const base = new URL(process.env.TEST_BASE_URL ?? 'http://localhost:3000');
assert.equal(base.protocol, 'http:');
assert.ok(['localhost', '127.0.0.1'].includes(base.hostname));
assert.equal(value('NEXT_PUBLIC_SUPABASE_URL'), 'https://bdkrihsiprkmukyjyspv.supabase.co');

async function session(role) {
  const jar = new Map();
  const supabase = createServerClient(value('NEXT_PUBLIC_SUPABASE_URL'), value('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'), {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: cookies => cookies.forEach(({ name, value }) => jar.set(name, value)) },
  });
  const { data, error } = await supabase.auth.signInWithPassword({ email: accounts[role].email, password: accounts[role].password });
  assert.equal(error, null, `${role} sign-in failed`);
  return { supabase, user: data.user, cookie: () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ') };
}

for (const role of ['owner', 'admin', 'manager', 'client']) {
  const auth = await session(role);
  try {
    const route = role === 'client' ? '/account/profile' : '/staff/clients';
    const response = await fetch(new URL(route, base), { headers: { cookie: auth.cookie() } });
    assert.equal(response.status, 200, `${role} page did not load`);
    assert.equal(new URL(response.url).pathname, route, `${role} unexpectedly redirected`);
    const html = await response.text();
    if (role === 'client') {
      assert.ok(html.includes('Карточка одобрена'), 'Client cannot see approval status');
      const { data: card, error } = await auth.supabase.from('clients').select('iin').eq('user_id', auth.user.id).single();
      assert.equal(error, null);
      if (card.iin) {
        assert.ok(html.includes(card.iin.slice(-4)));
        assert.ok(!html.includes(card.iin), 'Full IIN leaked into rendered HTML');
      } else {
        assert.ok(html.includes('name="iin"'), 'Client cannot add IIN later');
        const form = [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].find(match => match[1].includes('name="iin"'))?.[1];
        const action = form?.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1];
        assert.ok(action, 'Identity form has no server action');
        const body = new FormData();
        body.set(action, ''); body.set('fullName', 'Invalid input test'); body.set('iin', '123');
        const invalid = await fetch(new URL(route, base), { method: 'POST', body, redirect: 'manual', headers: { cookie: auth.cookie(), origin: base.origin } });
        assert.equal(invalid.status, 303);
        assert.ok(invalid.headers.get('location')?.includes('error=identity-invalid'), 'Server must reject malformed IIN');
      }
    } else {
      assert.equal(html.includes('id="registrations"'), role !== 'manager', 'Queue visibility must follow admin role');
      assert.ok(!html.includes('Не удалось загрузить регистрации'));
    }
    console.log(`OK ${role}: ${route}`);
  } finally { await auth.supabase.auth.signOut({ scope: 'local' }); }
}
const register = await (await fetch(new URL('/register', base))).text();
assert.ok(register.includes('ФИО и ИИН можно заполнить позже'));
console.log('OK registration instructions and invalid-IIN server action; existing client data unchanged');
