import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { readUploadFormData } from '../lib/staged-uploads.ts';
import { checkDocumentFile } from '../lib/document-files.ts';

const env=readFileSync('.env.local','utf8');
const entry=(name)=>env.split(/\r?\n/).find(line=>line.startsWith(`${name}=`))?.slice(name.length+1).trim().replace(/^['"]|['"]$/g,'');
const url=entry('NEXT_PUBLIC_SUPABASE_URL'), secret=entry('SUPABASE_SECRET_KEY'), publicKey=entry('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
assert.equal(url,'https://bdkrihsiprkmukyjyspv.supabase.co'); assert.ok(secret && publicKey);
const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const anon=createClient(url,publicKey,{auth:{persistSession:false,autoRefreshToken:false}});
const user=JSON.parse(readFileSync('.workspace-accounts.local.json','utf8')).accounts.owner.id;
const caseId=randomUUID(), bytes=Buffer.alloc(20*1024*1024,32);
bytes.write('%PDF-1.7\n');bytes.write('\n%%EOF',bytes.length-6);
const prepared=await admin.rpc('server_prepare_temporary_upload',{p_user_id:user,p_target_path:'/api/contracts',p_context:{caseId},p_name:'storage-regression.pdf',p_size:bytes.length});
assert.equal(prepared.error,null);
const ticket=prepared.data, path=`${user}/${ticket}`;
try {
  const signed=await admin.storage.from('modernsecure-staging').createSignedUploadUrl(path,{upsert:false});
  assert.equal(signed.error,null);
  const uploaded=await fetch(signed.data.signedUrl,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:bytes});
  assert.ok(uploaded.ok,`Signed 20MB PUT failed: ${uploaded.status}`);
  const forbidden=await anon.storage.from('modernsecure-staging').download(path);
  assert.ok(forbidden.error,'Anonymous users must not read temporary files');
  const overwritten=await fetch(signed.data.signedUrl,{method:'PUT',headers:{'Content-Type':'application/octet-stream','x-upsert':'true'},body:Buffer.from('replacement')});
  assert.ok(!overwritten.ok,'A signed upload must not allow replacing bytes after validation');
  const request=new Request('http://localhost:3000/api/contracts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields:[['caseId',caseId]],files:[{field:'file',ticket}]})});
  const form=await readUploadFormData(request,21*1024*1024,user,admin);
  const checked=await checkDocumentFile(form.get('file'));
  assert.equal(checked.size,bytes.length);
  assert.equal(checked.sha256,createHash('sha256').update(bytes).digest('hex'));
  console.log('OK actual Storage: signed 20MB upload, anonymous-read denial, overwrite denial, server-side content/size/hash verification');
} finally {
  const removed=await admin.storage.from('modernsecure-staging').remove([path]);assert.equal(removed.error,null);
  const deleted=await admin.from('temporary_uploads').delete().eq('id',ticket);assert.equal(deleted.error,null);
  console.log('Temporary test file and ticket removed. No case or payment records created.');
}
