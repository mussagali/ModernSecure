import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// Creates only a dedicated client and synthetic review content. No SQL role
// impersonation, MFA bypass, existing password reset or real client assignment.
const options = Object.fromEntries(process.argv.slice(2).filter(x => x.startsWith('--') && x.includes('=')).map(x => {
  const i = x.indexOf('='); return [x.slice(2, i), x.slice(i + 1)];
}));
const project = options['expect-project'];
if (!options.env || !options.accounts || !project) throw new Error('Use --env=FILE --accounts=PRIVATE_JSON --expect-project=REF [--apply]');
const env = Object.fromEntries(readFileSync(options.env, 'utf8').split(/\r?\n/).filter(x => /^[A-Z_0-9]+=/.test(x)).map(x => {
  const i = x.indexOf('='); return [x.slice(0, i), x.slice(i + 1).replace(/^['"]|['"]$/g, '')];
}));
const ownerFile = JSON.parse(readFileSync(options.accounts, 'utf8').replace(/^\uFEFF/, ''));
if (ownerFile.project !== project || new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== project + '.supabase.co') throw new Error('Project mismatch');
const settings = { auth: { persistSession: false, autoRefreshToken: false } };
const actor = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, settings);
const reviewer = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, settings);
const file = 'apps/mobile_webview/ios/app-store/reviewer-access.local.json';
const email = 'apple-review-modernsecure@example.test';
const serviceName = 'ДЕМО APPLE — вымышленная консультация';
const caseTitle = 'ДЕМО APPLE — проверка приложения, не юридическая услуга';
function checked(result, step) {
  if (result.error) throw new Error(`${step} failed (${result.error.code ?? 'unknown'})`);
  return result.data;
}
const save = data => writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
try {
  const signed = checked(await actor.auth.signInWithPassword({ email: ownerFile.accounts.owner.email, password: ownerFile.accounts.owner.password }), 'Admin sign-in');
  if (signed.user?.id !== ownerFile.accounts.owner.id) throw new Error('Administrator identity mismatch');
  const status = checked(await actor.rpc('staff_mfa_status'), 'Admin status');
  if (status?.role !== 'admin' || !status.active || !status.mfa_passed) throw new Error('Active administrator with passed MFA required');
  if (!process.argv.includes('--apply')) {
    console.log('Ready: dedicated client, synthetic service/case/task; credentials saved only to ignored reviewer-access.local.json. No changes applied.');
  } else {
    if (!env.SUPABASE_SECRET_KEY) throw new Error('Auth administration key missing');
    const authAdmin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, settings);
    let saved;
    if (existsSync(file)) {
      saved = JSON.parse(readFileSync(file, 'utf8'));
      if (saved.project !== project || saved.email !== email || !saved.password) throw new Error('Private reviewer file mismatch');
    } else {
      saved = { project, email, password: randomBytes(30).toString('base64url'), status: 'pending', createdAt: new Date().toISOString() };
      writeFileSync(file, JSON.stringify(saved, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    }
    if (!saved.userId) {
      const created = checked(await authAdmin.auth.admin.createUser({ email, password: saved.password, email_confirm: true,
        user_metadata: { display_name: 'ДЕМО APPLE — вымышленный клиент', qa_marker: 'apple_review_synthetic_only' } }), 'Create reviewer');
      saved.userId = created.user.id; save(saved);
    }
    const identity = checked(await authAdmin.auth.admin.getUserById(saved.userId), 'Reviewer identity');
    if (identity.user?.email !== email || identity.user?.user_metadata?.qa_marker !== 'apple_review_synthetic_only') throw new Error('Not the dedicated synthetic reviewer');
    let card = checked(await actor.from('clients').select('id,full_name,email').eq('user_id', saved.userId).maybeSingle(), 'Inspect reviewer card');
    if (!card) {
      checked(await actor.rpc('admin_approve_account', { p_user_id: saved.userId, p_role: 'client', p_display_name: 'ДЕМО APPLE — вымышленный клиент', p_client_id: null }), 'Activate reviewer');
      card = checked(await actor.from('clients').select('id,full_name,email').eq('user_id', saved.userId).single(), 'Reviewer card');
    }
    if (card.email !== email || !card.full_name.startsWith('ДЕМО APPLE')) throw new Error('Unexpected client identity');
    saved.clientId = card.id; save(saved);
    let versions = checked(await actor.rpc('available_service_versions'), 'Available services');
    if (!versions.some(x => x.service_name === serviceName)) {
      checked(await actor.rpc('admin_create_service', { p_name: serviceName, p_stages: ['ДЕМО — знакомство', 'ДЕМО — проверка документов', 'ДЕМО — завершение'] }), 'Synthetic service');
      versions = checked(await actor.rpc('available_service_versions'), 'Synthetic service version');
    }
    const version = versions.find(x => x.service_name === serviceName);
    if (!version) throw new Error('Synthetic version unavailable');
    let cases = checked(await actor.from('cases').select('id,title').eq('client_id', card.id), 'Reviewer cases');
    if (cases.some(x => x.title !== caseTitle) || cases.length > 1) throw new Error('Unexpected reviewer data; manual review required');
    if (!cases.length) {
      saved.caseId = checked(await actor.rpc('staff_create_case', { p_client_id: card.id, p_version_id: version.version_id, p_title: caseTitle }), 'Synthetic case'); save(saved);
    } else { saved.caseId = cases[0].id; save(saved); }
    const tasks = checked(await actor.from('tasks').select('id').eq('case_id', saved.caseId).eq('title', 'ДЕМО — прочитайте описание'), 'Synthetic task');
    if (!tasks.length) checked(await actor.rpc('staff_create_task', { p_case_id: saved.caseId, p_kind: 'answer', p_title: 'ДЕМО — прочитайте описание',
      p_description: 'Все сведения в этом деле вымышлены и предназначены только для проверки Apple. Можно загрузить тестовый файл без персональных данных.', p_due_at: null }), 'Synthetic task creation');
    const login = checked(await reviewer.auth.signInWithPassword({ email, password: saved.password }), 'Reviewer sign-in');
    if (login.user?.id !== saved.userId || !login.user.email_confirmed_at) throw new Error('Reviewer sign-in identity mismatch');
    const visible = checked(await reviewer.from('cases').select('id').limit(100), 'Reviewer case visibility');
    if (visible.length !== 1 || visible[0].id !== saved.caseId) throw new Error('Reviewer isolation check failed');
    saved.status = 'login_and_case_access_verified'; saved.verifiedAt = new Date().toISOString();
    saved.notes = 'Client account only. Review current legal texts in the normal consent screen. No App Store Connect entry or iOS end-to-end validation yet. No real client assignments.';
    save(saved);
    console.log('Reviewer created and activated; confirmed sign-in and access to exactly one synthetic case. Credentials are in the ignored private reviewer file; not sent to Apple.');
  }
} finally {
  await Promise.allSettled([actor.auth.signOut({ scope: 'local' }), reviewer.auth.signOut({ scope: 'local' })]);
}
