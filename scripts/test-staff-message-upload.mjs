import assert from "node:assert/strict";
import { staffMessageFileId } from "../lib/staff-message-upload.ts";

const thread = "11111111-1111-4111-8111-111111111111";
const sender = "22222222-2222-4222-8222-222222222222";
const key = "33333333-3333-4333-8333-333333333333";
const otherKey = "44444444-4444-4444-8444-444444444444";
const ids = Array.from({ length: 5 }, (_, position) => staffMessageFileId(thread, sender, key, position));

assert.equal(new Set(ids).size, ids.length);
for (const [position, id] of ids.entries()) {
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(id, staffMessageFileId(thread, sender, key, position));
  assert.notEqual(id, staffMessageFileId(thread, sender, otherKey, position));
  assert.notEqual(id, staffMessageFileId(thread, "55555555-5555-4555-8555-555555555555", key, position));
}
console.log("OK stable staff file paths across retries and distinct files, senders and keys");
