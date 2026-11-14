import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
let response, calls=0;
const client={auth:{signUp:async()=>{calls++;return response;},resetPasswordForEmail:async()=>response}};
const exports={};
const require=name=>{
 if(name==='next/navigation')return{redirect:path=>{throw new Error('REDIRECT:'+path);}};
 if(name.endsWith('/supabase/server'))return{createClient:async()=>client};
 if(name.endsWith('/workspace-destination'))return{};
 if(name.endsWith('/staff'))return{};
 throw new Error(name);
};
new Function('require','exports',ts.transpileModule(readFileSync('app/login/actions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(require,exports);
const form=new FormData();form.set('email','new@example.test');form.set('password','fixture-password');form.set('passwordRepeat','fixture-password');
response={data:{user:{identities:[]},session:null},error:null};
let result=await exports.registerAction({},form);assert.equal(result.status,'error');assert.match(result.message,/не отправлено/);assert.match(result.message,/восстановите пароль/);
response={data:{user:{identities:[{provider:'email'}]},session:null},error:null};
result=await exports.registerAction({},form);assert.equal(result.status,'success');assert.match(result.message,/ссылку подтверждения/);
for(const code of ['user_already_exists','email_exists','over_email_send_rate_limit','over_request_rate_limit','email_address_not_authorized','unexpected_failure']) {
 response={data:{user:null,session:null},error:{code}};
 result=await exports.registerAction({},form);assert.equal(result.status,'error',code);
 if(code==='over_email_send_rate_limit')assert.match(result.message,/лимита/);
 result=await exports.forgotPasswordAction({},form);assert.equal(result.status,'error');
}
response={data:{user:null,session:null},error:null};assert.equal((await exports.registerAction({},form)).status,'error');
response={data:{user:{identities:[{}]},session:{access_token:'fixture'}},error:null};await assert.rejects(exports.registerAction({},form),/REDIRECT:\/account/);
form.set('passwordRepeat','different');const before=calls;assert.equal((await exports.registerAction({},form)).status,'error');assert.equal(calls,before);
console.log('OK actual auth actions: new signup, obfuscated duplicate, provider errors, password mismatch, session redirect; no emails sent');
