// User explicitly approved these exact current documents for the isolated Apple
// demo on 2026-11-14. Never accepts marketing, another account, or newer text.
import fs from 'node:fs';
import crypto from 'node:crypto';
const root = new URL('../', import.meta.url);
const base = 'https://bdkrihsiprkmukyjyspv.supabase.co';
const approval = JSON.parse(fs.readFileSync(new URL('app-store/demo-consent-approval.json', root)));
const access = JSON.parse(fs.readFileSync(new URL('build/screenshot-access.local.json', root)));
let token;
try {
  if (process.env.ACCEPT_APPROVED_DEMO_CONSENTS !== 'true'
      || access.email !== 'apple-review-modernsecure@example.test' || access.email !== approval.account)
    throw Error('Dedicated approval required');
  const apikey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!apikey) throw Error('Project publishable key required');
  async function request(path, options = {}) {
    const response = await fetch(base + path, { ...options, headers: { apikey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error(`Demo setup request failed: ${response.status}`);
    return response.status === 204 ? null : response.json();
  }
  const auth = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify(access) });
  if (auth.user?.email !== approval.account) throw Error('Demo identity mismatch');
  token = auth.access_token;
  const documents = (await request('/rest/v1/legal_documents?select=id,document_type,version,title,body&is_current=eq.true')).filter(d => d.document_type !== 'marketing');
  if (documents.length !== approval.documents.length || documents.some(d => !approval.documents.some(a =>
      a.document_type === d.document_type && a.version === d.version && a.title === d.title
      && a.bodySha256 === crypto.createHash('sha256').update(d.body).digest('hex'))))
    throw Error('Published documents differ from user-approved text');
  await request('/rest/v1/rpc/accept_client_consents', { method: 'POST', body: JSON.stringify({ p_document_ids: documents.map(d => d.id) }) });
  if (await request('/rest/v1/rpc/client_consent_status', { method: 'POST', body: '{}' }) !== true)
    throw Error('Approved demo consents not confirmed');
  console.log('PASS: only user-approved terms/privacy v2 accepted by the dedicated Apple demo; no marketing consent.');
} catch (error) {
  console.error(error.message?.startsWith('Demo setup request failed') ? error.message : 'Dedicated demo setup failed; private values omitted.');
  process.exitCode = 1;
} finally {
  if (token) await fetch(base + '/auth/v1/logout?scope=local', { method: 'POST', headers: {
    apikey: process.env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`,
  }, signal: AbortSignal.timeout(15000) }).catch(() => {});
}
