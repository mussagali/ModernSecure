import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const entry = (name) => env.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim().replace(/^['"]|['"]$/g, '');
const url = entry('NEXT_PUBLIC_SUPABASE_URL'), key = entry('SUPABASE_SECRET_KEY');
if (url !== 'https://bdkrihsiprkmukyjyspv.supabase.co' || !key) throw new Error('Unexpected or incomplete project configuration');
const apply = process.argv[2] === '--apply';
if (process.argv.length > 3 || (process.argv[2] && !apply)) throw new Error('Usage: npm run staging:cleanup [-- --apply]');
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const { data: tickets, error } = await admin.from('temporary_uploads').select('id, user_id').lt('created_at', cutoff).order('created_at').limit(1000);
if (error) throw new Error(error.message);
console.log(`Expired staging tickets: ${tickets.length}. ${apply ? 'Removing staged copies.' : 'Dry run; use -- --apply to remove.'}`);
if (apply) {
  for (const ticket of tickets) {
    if (![ticket.id, ticket.user_id].every(value => /^[0-9a-f-]{36}$/.test(value))) throw new Error('Unexpected staging path');
    // Signed upload URLs expire after 2h. Wait 24h so a still valid URL cannot
    // resurrect an object after cleanup. Permanent files live in another bucket.
    const removed = await admin.storage.from('modernsecure-staging').remove([`${ticket.user_id}/${ticket.id}`]);
    if (removed.error) throw new Error(removed.error.message);
    const deleted = await admin.from('temporary_uploads').delete().eq('id', ticket.id).lt('created_at', cutoff);
    if (deleted.error) throw new Error(deleted.error.message);
  }
  console.log(`Removed ${tickets.length} expired staging copies and tickets.`);
}
