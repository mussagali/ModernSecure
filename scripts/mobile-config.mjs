// Keep the client build allowlist separate from server environment loading.
export function publicMobileConfig(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    throw new Error('Supabase must use HTTPS');
  }
  let publicKey = typeof key === 'string' && key.startsWith('sb_publishable_');
  if (!publicKey && typeof key === 'string' && key.split('.').length === 3) {
    try { publicKey = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role === 'anon'; } catch { /* reject */ }
  }
  if (!publicKey) throw new Error('Mobile builds require a publishable/anon key, never a server secret');
  return { SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: key };
}
