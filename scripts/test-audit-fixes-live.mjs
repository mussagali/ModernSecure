import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createServerClient} from '@supabase/ssr';
import {signInQa} from './qa-login.mjs';
const env=readFileSync('.env.local','utf8');
const value=(name)=>env.split(/\r?\n/).find(l=>l.startsWith(`${name}=`))?.slice(name.length+1).trim().replace(/^['"]|['"]$/g,'');
const account=JSON.parse(readFileSync('.test-accounts.local.json','utf8')).accounts.client;
const jar=new Map();
const client=createServerClient(value('NEXT_PUBLIC_SUPABASE_URL'),value('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:items=>items.forEach(item=>item.options?.maxAge===0?jar.delete(item.name):jar.set(item.name,item.value))}});
const base=new URL(process.env.TEST_BASE_URL ?? 'http://localhost:3000');
assert.ok(['localhost','127.0.0.1'].includes(base.hostname));
try {
  assert.ifError((await signInQa(client,{email:account.email,password:account.password})).error);
  const cases=await client.from('cases').select('id').limit(1); assert.ifError(cases.error); assert.ok(cases.data.length);
  const path=`/account/cases/${cases.data[0].id}/documents`;
  const anonymous=await fetch(new URL(path,base),{redirect:'manual'}); assert.equal(anonymous.status,307);
  const destination=new URL(anonymous.headers.get('location'),base); assert.equal(destination.pathname,'/login'); assert.equal(destination.searchParams.get('next'),path);
  const headers={cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; ')};
  const consent=await fetch(new URL('/consent',base),{headers,redirect:'manual'}); assert.equal(consent.status,200); assert.ok((await consent.text()).includes('<h1>Перед началом работы</h1>'));
  const legal=await client.from('legal_documents').select('id'); assert.ifError(legal.error);
  assert.ifError((await client.rpc('client_consent_status')).error);
  for (const [rpc,args] of [['admin_publish_legal_document',{p_type:'terms',p_title:'Test',p_body:'Never publish',p_expected_id:null}],['staff_cancel_task',{p_task_id:'00000000-0000-4000-8000-000000000001',p_expected_status:'new',p_reason:'Forbidden'}]]) {
    const denied=await client.rpc(rpc,args); assert.ok(denied.error,'Client invoked staff-only workflow');
  }
  const guarded=await fetch(new URL('/staff/settings/legal',base),{headers,redirect:'manual'}); assert.equal(guarded.status,307);
  console.log('OK live login return path, empty consent configuration, client denial for publishing and cancelling');
} finally { await client.auth.signOut(); }
