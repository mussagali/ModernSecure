import assert from 'node:assert/strict';
import { readBoundedFormData } from '../lib/upload-request.ts';
import { deliverFile } from '../lib/file-delivery.ts';
const id='10000000-0000-4000-8000-000000000001';
const user='10000000-0000-4000-8000-000000000002';
const target='/api/document-uploads/file';
const bytes=new Uint8Array(6*1024*1024);
let ticket={id,user_id:user,target_path:target,original_name:'large.pdf',size_bytes:bytes.length,
  expires_at:new Date(Date.now()+60000).toISOString(),context:{field:'file',fields:[['sessionId',id],['fileId',id]]}};
let signed=0;
const admin={
  from(table){ assert.equal(table,'temporary_uploads');const filters={};return {select(){return this},eq(k,v){filters[k]=v;return this},async maybeSingle(){return {data:ticket.id===filters.id&&ticket.user_id===filters.user_id?ticket:null}}}; },
  storage:{from(bucket){return {async download(path){assert.equal(bucket,'modernsecure-staging');assert.equal(path,`${user}/${id}`);return {data:new Blob([bytes])}},
    async createSignedUrl(path,expiry,options){assert.equal(bucket,'modernsecure-files');assert.equal(expiry,90);assert.equal(options.download,'large.pdf');signed++;return {data:{signedUrl:'https://storage.test/signed-file'}}}}}}
};
const request=(ids=[id],path=target)=>new Request(`http://localhost${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tickets:ids})});
const context={admin,userId:user};
const form=await readBoundedFormData(request(),20*1024*1024,context);
assert.equal(form.get('file').size,bytes.length);assert.equal(form.get('file').name,'large.pdf');assert.equal(form.get('sessionId'),id);
await assert.rejects(readBoundedFormData(request(),bytes.length-1,context),e=>e.status===413);
await assert.rejects(readBoundedFormData(request(),20*1024*1024,{admin,userId:id}),e=>e.status===400);
await assert.rejects(readBoundedFormData(request([id],'/api/contracts'),20*1024*1024,context),e=>e.status===400);
await assert.rejects(readBoundedFormData(request([id,id]),20*1024*1024,context),e=>e.status===400);
ticket={...ticket,expires_at:new Date(0).toISOString()};
await assert.rejects(readBoundedFormData(request(),20*1024*1024,context),e=>e.status===400);
ticket={...ticket,expires_at:new Date(Date.now()+60000).toISOString(),size_bytes:bytes.length-1};
await assert.rejects(readBoundedFormData(request(),20*1024*1024,context),e=>e.status===400);
const headers={'Content-Type':'application/pdf'};
const short=await deliverFile(admin,'file',Buffer.from('small'),headers,{preview:false,name:'small.pdf'});
assert.equal(short.status,200);assert.equal(signed,0);
const large=await deliverFile(admin,'file',Buffer.from(bytes),headers,{preview:false,name:'large.pdf'});
assert.equal(large.status,302);assert.equal(large.headers.get('location'),'https://storage.test/signed-file');assert.equal(signed,1);
assert.equal(await large.text(),'');
console.log('OK direct upload: owner/route/expiry/size/duplicate checks; large private downloads redirect without proxying bytes');
