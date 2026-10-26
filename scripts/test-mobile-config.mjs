import assert from 'node:assert/strict';
import { publicMobileConfig } from './mobile-config.mjs';
const base = { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example', SUPABASE_SECRET_KEY: 'sb_secret_never_ship', DATABASE_URL: 'never_ship' };
assert.deepEqual(publicMobileConfig(base), { SUPABASE_URL: base.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: base.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY });
assert.throws(() => publicMobileConfig({ ...base, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_example' }));
const serviceJwt = 'header.' + Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url') + '.signature';
assert.throws(() => publicMobileConfig({ ...base, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: serviceJwt }));
assert.throws(() => publicMobileConfig({ ...base, NEXT_PUBLIC_SUPABASE_URL: 'http://example.supabase.co' }));
console.log('PASS: public config matches web; server secrets/service-role JWTs excluded.');
