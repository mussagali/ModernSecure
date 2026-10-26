import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';
const { combinedEnv: config } = nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const url = config.NEXT_PUBLIC_SUPABASE_URL;
if(url !== 'https://dukqvwqxgwyadffmdeee.supabase.co') throw new Error('Unexpected Supabase project');
const key = config.NEXT_PUBLIC_SUPABASE_ANON_KEY || config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const response = await fetch(`${url}/auth/v1/settings`, {headers:{apikey:key}});
if(!response.ok) throw new Error(`Auth health: ${response.status}`);
console.log('New project Auth endpoint: OK');
const db = createClient(url,key,{auth:{persistSession:false}});
for(const table of ['cases','document_requests','messages','payment_schedule']) {
  const {data,error} = await db.from(table).select('id').limit(1);
  if(error && error.code !== '42501') throw new Error(`${table}: unexpected API error ${error.code}`);
  if(!error && data.length) throw new Error(`Anonymous data leak: ${table}`);
  console.log(`${table}: anonymous access denied or empty`);
}
