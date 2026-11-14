import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../app/consent/actions.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const id='00000000-0000-4000-8000-000000000001';
async function scenario({signedIn=true,saveError=null,status=true,statusError=null,document=id}={}) {
  const events=[];
  const supabase={auth:{getClaims:async()=>({data:{claims:signedIn?{sub:id}:null}})},rpc:async name=>{events.push(name);return name==='accept_client_consents'?{error:saveError}:{data:status,error:statusError};}};
  const exports={};
  const require=name=>name==='next/navigation'?{redirect:path=>{events.push(`redirect:${path}`);throw new Error('redirect');}}:name==='next/cache'?{revalidatePath:(path,type)=>events.push(`revalidate:${path}:${type}`)}:name.endsWith('supabase/server')?{createClient:async()=>supabase}:{uuidPattern:/^[0-9a-f-]{36}$/i};
  new Function('require','exports','console',code)(require,exports,{error:()=>{}});
  const form=new FormData();form.append('documentId',document);
  await assert.rejects(exports.acceptConsents(form),/redirect/);
  return events;
}
assert.deepEqual(await scenario(),['accept_client_consents','client_consent_status','revalidate:/account:layout','redirect:/account']);
assert.deepEqual(await scenario({saveError:{code:'db'}}),['accept_client_consents','redirect:/consent?error=1']);
assert.deepEqual(await scenario({status:false}),['accept_client_consents','client_consent_status','redirect:/consent?error=1']);
assert.deepEqual(await scenario({statusError:{code:'db'}}),['accept_client_consents','client_consent_status','redirect:/consent?error=1']);
assert.deepEqual(await scenario({signedIn:false}),['redirect:/login']);
assert.deepEqual(await scenario({document:'invalid'}),['redirect:/consent?error=1']);
console.log('OK consent transitions: fresh layout after confirmed save; errors never unlock account');
