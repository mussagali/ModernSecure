import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readUploadFormData, uploadContext } from '../lib/staged-uploads.ts';
import { readBoundedJson } from '../lib/upload-request.ts';
import { checkDocumentFile } from '../lib/document-files.ts';
import { fileStream } from '../lib/file-stream.ts';
import { installmentPaid } from '../lib/payment-balances.ts';

const user = randomUUID(), ticketId = randomUUID(), caseId = randomUUID();
const bytes = Buffer.alloc(20 * 1024 * 1024, 32);
bytes.write('%PDF-1.7\n'); bytes.write('\n%%EOF', bytes.length - 6);
let ticket = { id: ticketId, user_id: user, target_path: '/api/contracts', context: { caseId }, original_name: 'large.pdf', size_bytes: bytes.length, expires_at: new Date(Date.now() + 60000).toISOString() };
let downloaded = 0;
const admin = {
  from(table) {
    assert.equal(table, 'temporary_uploads');
    const filters = {};
    const query = { select() { return query; }, eq(key,value) { filters[key]=value; return query; },
      async maybeSingle() { return { data: filters.user_id === ticket.user_id && filters.id === ticket.id ? ticket : null, error: null }; } };
    return query;
  },
  storage: { from(bucket) {
    assert.equal(bucket, 'modernsecure-staging');
    return { async download(path) { assert.equal(path, `${user}/${ticketId}`); downloaded++; return { data: new Blob([bytes]), error: null }; } };
  } },
};
const request = (overrides = {}, path = '/api/contracts') => new Request(`http://localhost${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ fields: [['caseId', caseId], ['price', '100000']], files: [{ field: 'file', ticket: ticketId }], ...overrides }),
});
const form = await readUploadFormData(request(), bytes.length + 1024, user, admin);
assert.equal(form.get('price'), '100000');
const checked = await checkDocumentFile(form.get('file'));
assert.equal(checked.size, 20 * 1024 * 1024);
assert.deepEqual(Buffer.from(await new Response(fileStream(checked.bytes)).arrayBuffer()), bytes, '20MB streamed response preserves all bytes');
assert.deepEqual(uploadContext({ caseId: caseId.toUpperCase(), price: 'untrusted' }), { caseId });
await assert.rejects(readUploadFormData(request(), 100, user, admin));
await assert.rejects(readUploadFormData(request(), bytes.length+1024, randomUUID(), admin));
await assert.rejects(readUploadFormData(request({}, '/api/payment-receipts'), bytes.length+1024, user, admin));
await assert.rejects(readUploadFormData(request({fields: [['caseId', randomUUID()]]}), bytes.length+1024, user, admin));
await assert.rejects(readUploadFormData(request({files: [{field:'file',ticket:ticketId},{field:'file',ticket:ticketId}]}), bytes.length*2, user, admin));
await assert.rejects(readUploadFormData(request({fields: [['caseId', randomUUID()], ['caseId', caseId]]}), bytes.length+1024, user, admin));
assert.equal(downloaded, 1, 'Invalid actor, scope, size and duplicate tickets are rejected before reading bytes');
ticket = {...ticket, expires_at: '2000-01-01'};
await assert.rejects(readUploadFormData(request(), bytes.length+1024, user, admin));
await assert.rejects(readBoundedJson(new Request('http://localhost', {method:'POST',body:'x'.repeat(500)}),100));
assert.equal(installmentPaid([{status:'confirmed',payment_allocations:[{schedule_id:'a',amount_kzt:'100.01'},{schedule_id:'b',amount_kzt:'50'}]},{status:'void',payment_allocations:[{schedule_id:'a',amount_kzt:'99'}]}],'a'),10001n);
console.log('OK 20MB staged transfer/stream, actor/context/expiry/size isolation, duplicate tickets, bounded manifests and allocated balances');
