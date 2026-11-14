// Isolated execution of the actual route and guards. No real user is removed.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const nativeRequire=createRequire(import.meta.url);
let accountError=null, signedIn=true, signOuts=[];
const supabase={rpc:async()=>({data:null,error:accountError}),auth:{getClaims:async()=>({data:{claims:signedIn?{sub:'removed-user'}:null}}),signOut:async options=>{signOuts.push(options);return {error:null};}}};
const redirects={redirect:path=>{throw Object.assign(new Error('REDIRECT'),{path});},notFound:()=>{throw new Error('NOT_FOUND');}};
function load(file){
 const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};
 new Function('require','exports',code)(name=>{
  if(name.endsWith('/supabase/server'))return {createClient:async()=>supabase};
  if(name==='./application-scope')return {staffWorkspaceEnabled:true};
  if(name==='next/navigation')return redirects;
  return nativeRequire(name);
 },exports);
 return exports;
}
const {GET}=load('app/auth/session-ended/route.ts');
const {getStaffStatus}=load('lib/staff.ts');
const {requireAccountApproval}=load('lib/account-access.ts');
const request=()=>new Request('http://localhost:3000/auth/session-ended?next=https://untrusted.invalid');
accountError={code:'ACCOUNT_REMOVED'};
await assert.rejects(getStaffStatus(supabase),error=>error.path==='/auth/session-ended');
await assert.rejects(requireAccountApproval(supabase),error=>error.path==='/auth/session-ended');
let response=await GET(request());
assert.equal(response.headers.get('location'),'http://localhost:3000/login?notice=session-ended');
assert.deepEqual(signOuts,[{scope:'local'}]);
accountError=null;signOuts=[];
response=await GET(request());
assert.equal(response.headers.get('location'),'http://localhost:3000/login');assert.equal(signOuts.length,0);
accountError={code:'NETWORK_ERROR'};
response=await GET(request());assert.equal(response.status,503);assert.equal(signOuts.length,0);
assert.equal((await getStaffStatus(supabase)).error.code,'NETWORK_ERROR');
signedIn=false;
response=await GET(request());assert.equal(response.headers.get('location'),'http://localhost:3000/login');assert.equal(signOuts.length,0);
console.log('PASS removed account recovers to login; guarded local-only session cleanup; active/anonymous/network states do not log out; no external redirects');
