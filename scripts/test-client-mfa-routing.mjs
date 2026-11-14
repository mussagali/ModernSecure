import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const requireNative = createRequire(import.meta.url);
const { NextRequest } = requireNative('next/server');
const code = ts.transpileModule(readFileSync('lib/supabase/proxy.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
async function route({ path='/account', aal='aal1', enrolled=false, signedIn=true, error=null }={}) {
  let checks = 0;
  const supabase = { auth: { getClaims: async () => ({ data: { claims: signedIn ? { sub:'client', aal } : null } }), mfa: { listFactors: async () => { checks++; return { data:{ all: enrolled ? [{ status:'verified' }] : [] }, error }; } } } };
  const exports = {};
  new Function('require', 'exports', code)(name => name === '@supabase/ssr' ? { createServerClient: () => supabase } : requireNative(name), exports);
  return { response: await exports.updateSession(new NextRequest(`https://local.invalid${path}`)), checks };
}
assert.equal((await route({ enrolled:true })).response.headers.get('location'), 'https://local.invalid/account-security');
assert.equal((await route({ enrolled:true, path:'/consent?view=1' })).response.headers.get('location'), 'https://local.invalid/account-security');
assert.equal((await route({ enrolled:true, path:'/account-security' })).checks, 0);
assert.equal((await route({ enrolled:true, aal:'aal2' })).checks, 0);
assert.equal((await route()).response.status, 200);
assert.equal((await route({ error: new Error('network') })).response.status, 503);
assert.equal((await route({ error: { code: 'user_not_found' } })).response.headers.get('location'), 'https://local.invalid/auth/session-ended');
assert.match((await route({ signedIn:false, path:'/account-security' })).response.headers.get('location'), /\/login\?next=/);
console.log('OK client MFA routing: enrollment, confirmation, anonymous and network failure without redirect loop');
