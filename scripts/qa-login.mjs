// Temporary factors are allowed only for the named QA accounts. No credentials are logged.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
const pending = new Set();
function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret.toUpperCase().replace(/=|\s/g,'')].map(c=>alphabet.indexOf(c).toString(2).padStart(5,'0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g).map(b=>parseInt(b,2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const hash = createHmac('sha1',key).update(counter).digest();
  return ((hash.readUInt32BE(hash.at(-1)&15)&0x7fffffff)%1000000).toString().padStart(6,'0');
}
export async function cleanupQaMfa() { for (const cleanup of [...pending]) await cleanup(); }
process.once('beforeExit', async () => { try { await cleanupQaMfa(); } catch { console.error('Temporary QA MFA cleanup failed'); process.exitCode=1; } });
export async function signInQa(client, credentials) {
  assert.match(credentials.email, /^qa-(client|lawyer|manager)-modernsecure@example\.test$/);
  const login = await client.auth.signInWithPassword(credentials);
  if (login.error || credentials.email.startsWith('qa-client-')) return login;
  const status = await client.rpc('staff_mfa_status'); assert.ifError(status.error);
  if (status.data?.mfa_passed) return login;
  const factors = await client.auth.mfa.listFactors(); assert.ifError(factors.error);
  assert.equal(factors.data.all.length,0,'QA already has a factor: preserve it and stop');
  const enrolled = await client.auth.mfa.enroll({factorType:'totp',friendlyName:'QA temporary test'}); assert.ifError(enrolled.error);
  const factorId=enrolled.data.id;
  const cleanup=async()=>{ const removed=await client.auth.mfa.unenroll({factorId}); assert.ifError(removed.error); pending.delete(cleanup); };
  pending.add(cleanup);
  const verified=await client.auth.mfa.challengeAndVerify({factorId,code:totp(enrolled.data.totp.secret)});
  if(verified.error){ await cleanup(); throw verified.error; }
  const signOut=client.auth.signOut.bind(client.auth);
  client.auth.signOut=async(...args)=>{ if(pending.has(cleanup)) await cleanup(); return signOut(...args); };
  return login;
}
