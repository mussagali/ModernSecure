import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import legal from '../content/legal/documents.ru.json' with {type:'json'};

// Use a real authenticated administrator; never synthesize MFA or bypass the
// versioned publication RPC. Dry-run is the default and does not publish texts.
const options=Object.fromEntries(process.argv.slice(2).filter(v=>v.startsWith('--')&&v.includes('=')).map(v=>{const i=v.indexOf('=');return[v.slice(2,i),v.slice(i+1)];}));
const apply=process.argv.includes('--apply');
if (!options.env || !options.accounts || !options['expect-project']) throw new Error('Use --env=FILE --accounts=PRIVATE_JSON --expect-project=REF [--role=owner] [--apply]');
const env=Object.fromEntries(readFileSync(options.env,'utf8').split(/\r?\n/).filter(l=>/^[A-Z_0-9]+=/.test(l)).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).replace(/^['"]|['"]$/g,'')];}));
const accounts=JSON.parse(readFileSync(options.accounts,'utf8').replace(/^\uFEFF/,''));
const role=options.role??'owner';
const account=accounts.accounts?.[role];
if (!account || accounts.project!==options['expect-project'] || new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname!==options['expect-project']+'.supabase.co') throw new Error('Account/project identity mismatch');
const db=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
try {
  const login=await db.auth.signInWithPassword({email:account.email,password:account.password});
  if (login.error || login.data.user?.id!==account.id) throw new Error('Administrator login unavailable or identity mismatch');
  const status=await db.rpc('staff_mfa_status');
  if(status.error || status.data?.role!=='admin' || !status.data?.active || !status.data?.mfa_passed) throw new Error('An active administrator with passed MFA is required');
  const current=await db.from('legal_documents').select('id,document_type,title,body,version').eq('is_current',true);
  if(current.error) throw new Error('Cannot inspect current legal versions');
  for(const document of legal.documents.filter(d=>['privacy','terms'].includes(d.type))){
    if(!document.body.trim() || document.body.length>60000) throw new Error('Invalid legal text');
    const existing=current.data.find(d=>d.document_type===document.type);
    if(existing?.body===document.body && existing?.title===document.title){ console.log(`${document.type}: current version already matches`);continue; }
    if(apply && existing && !process.argv.includes('--replace-current')) throw new Error(`Existing ${document.type} differs; review it and explicitly use --replace-current to replace an approved version`);
    if(!apply){console.log(`${document.type}: ready to publish revision ${legal.revision}; current version ${existing?.version??'none'}`);continue;}
    const result=await db.rpc('admin_publish_legal_document',{p_type:document.type,p_title:document.title,p_body:document.body,p_expected_id:existing?.id??null});
    if(result.error) throw new Error(`Publication failed for ${document.type} (${result.error.code??'unknown'})`);
    console.log(`${document.type}: published using the authenticated administrator and versioned audit flow`);
  }
} finally { await db.auth.signOut({scope:'local'}); }
