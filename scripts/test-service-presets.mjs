// Real createService action + full isolated SQL. Never writes to the connected project.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
import {servicePresets, findServicePreset} from '../lib/service-presets.ts';
const db = new PGlite();
const uid = n => `82000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let actor = 1;
async function as(n, sql, values=[]) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[uid(n),JSON.stringify({sub:uid(n),role:'authenticated',aal:'aal1'})]);
  await db.exec('set role authenticated');
  try {return await db.query(sql,values);} finally {await db.exec('reset role');}
}
try {
  await db.exec(`create role anon;create role authenticated;create role service_role;create role authenticator;
    create schema auth;create schema storage;create schema extensions;
    create function extensions.digest(text,text) returns bytea language sql as $$select pg_catalog.sha256(convert_to($1,'UTF8'))$$;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create table auth.mfa_factors(id uuid primary key,user_id uuid,status text);
    create table auth.sessions(id uuid,user_id uuid,aal text,not_after timestamptz);
    create table auth.audit_log_entries(id uuid,created_at timestamptz,payload jsonb);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;
    grant usage on schema auth,public to authenticated;grant execute on function auth.uid(),auth.jwt() to authenticated;
    create table storage.buckets(id text primary key,name text not null,public boolean not null,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text,name text,metadata jsonb,user_metadata jsonb,primary key(bucket_id,name));
    create publication supabase_realtime;`);
  for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()) {
    if(file.includes('0008')) {
      await db.query("insert into auth.users values($1,'ayanz2008@gmail.com',now())",[uid(1)]);
      await db.query("insert into public.staff_members(user_id,display_name,role) values($1,'Owner','admin')",[uid(1)]);
    }
    await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
  }
  for(const n of [2,3]) await db.query('insert into auth.users values($1,$2,now())',[uid(n),`preset${n}@example.test`]);
  await as(1,"select public.admin_approve_account($1,'manager','Manager')",[uid(2)]);
  await as(1,"select public.admin_approve_account($1,'client','Client')",[uid(3)]);
  const card=(await db.query("select id from public.clients where user_id=$1",[uid(3)])).rows[0].id;
  const nativeRequire=createRequire(import.meta.url), loaded={exports:{}};
  const source=ts.transpileModule(readFileSync('app/staff/actions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const require=name=>name==='next/navigation'?{redirect:location=>{throw Error('REDIRECT '+location);}}:name==='../../lib/staff'?{
    requireStaff:async roles=>{
      if(!roles.includes(actor===1?'admin':actor===2?'manager':'client'))throw Error('Forbidden');
      return {supabase:{rpc:async(name,args)=>{
        assert.equal(name,'admin_create_service_with_documents');
        try {return {data:(await as(actor,'select public.admin_create_service_with_documents($1,$2,$3::jsonb)',[args.p_name,args.p_stages,JSON.stringify(args.p_documents)])).rows[0].admin_create_service_with_documents,error:null};}
        catch(error){return {data:null,error:{message:error.message}};}
      }}};
    }
  }:name==='../../lib/deadlines'?{parseAlmatyDeadline:()=>null}:nativeRequire(name);
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`,{})(require,loaded,loaded.exports);
  assert.equal(findServicePreset('unknown'),undefined);
  assert.equal(servicePresets.length,4);
  const uploadAccept=readFileSync('components/DocumentUploadForm.tsx','utf8').match(/accept="([^"]+)"/)[1].split(',');
  for(const preset of servicePresets) {
    for(const document of preset.documents) {
      assert.doesNotMatch(document.instructions,/текстов(?:ый|ого)\s+файл/i,'Do not advertise unsupported plain text uploads');
      for(const format of document.instructions.match(/\b(?:PDF|JPEG|PNG|HEIC|HEIF|TXT|DOCX?|RTF|XLSX?|CSV)\b/g)??[])
        assert.ok(uploadAccept.includes('.'+format.toLowerCase()),`${format} must be accepted by the real uploader`);
    }
    const form=new FormData();form.set('name',preset.name);form.set('stages',preset.stages.join('\n'));form.set('documents',JSON.stringify(preset.documents));
    actor=2;await assert.rejects(loaded.exports.createService(form),/Forbidden/);
    await assert.rejects(as(2,'select public.admin_create_service_with_documents($1,$2,$3::jsonb)',[preset.name,preset.stages,JSON.stringify(preset.documents)]),/Not authorized/);
    actor=1;await assert.rejects(loaded.exports.createService(form),/REDIRECT \/staff\/services\?created=1/);
    const service=(await db.query('select id from public.service_templates where name=$1',[preset.name])).rows[0];
    const version=(await db.query('select id,published_at from public.service_template_versions where service_id=$1',[service.id])).rows[0];
    assert.ok(version.published_at);
    assert.deepEqual((await db.query('select title from public.stage_templates where version_id=$1 order by position',[version.id])).rows.map(s=>s.title),preset.stages);
    assert.deepEqual((await db.query('select title,instructions,required from public.document_templates where version_id=$1 order by position',[version.id])).rows,preset.documents);
    const caseId=(await as(2,'select public.staff_create_case($1,$2,$3)',[card,version.id,'Preset fixture'])).rows[0].staff_create_case;
    const requests=(await as(3,'select title,instructions,required from public.document_requests where case_id=$1 order by title',[caseId])).rows;
    assert.equal(requests.length,preset.documents.length);
    for(const document of preset.documents)assert.deepEqual(requests.find(row=>row.title===document.title),document);
    assert.equal((await db.query('select s.title from public.cases c join public.stage_templates s on s.id=c.current_stage_id where c.id=$1',[caseId])).rows[0].title,preset.stages[0]);
    assert.equal(Number((await db.query('select count(*) as n from public.tasks where case_id=$1',[caseId])).rows[0].n),0,'Presets do not pretend to create task automation');
  }
  console.log('PASS 4 editable authored service presets: actual Server Action publishes ordered stages/documents; manager denied; case creation instantiates client-visible requests and current stage');
} finally {await db.close();}
