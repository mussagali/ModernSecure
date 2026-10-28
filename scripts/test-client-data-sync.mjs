import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const source = ts.transpileModule(fs.readFileSync('components/ClientDataSync.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
let cleanup, refreshes = 0, removed = false, unsubscribed = false, authCallback;
const timeouts = new Map(), intervals = new Map(), listeners = new Map(), changes = [];
let sequence = 0;
const router = { refresh() { refreshes++; }, replace(path) { assert.equal(path, '/login'); } };
const channel = { on(_event, _filter, callback) { changes.push(callback); return this; }, subscribe() {} };
const supabase = {
  channel: () => channel,
  removeChannel() { removed = true; },
  auth: {
    onAuthStateChange(callback) {
      authCallback = callback;
      return { data: { subscription: { unsubscribe() { unsubscribed = true; } } } };
    },
  },
};
const navigator = { onLine: true };
const document = { visibilityState: 'visible', addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) };
const window = { addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) };
const exports = {};
vm.runInNewContext(source, {
  exports, process: { env: {} }, navigator, document, window,
  require(name) {
    if (name === 'react') return { useEffect(fn) { cleanup = fn(); } };
    if (name === 'next/navigation') return { useRouter: () => router };
    if (name === '@supabase/ssr') return { createBrowserClient: () => supabase };
    throw new Error(name);
  },
  setTimeout(fn) { timeouts.set(++sequence, fn); return sequence; }, clearTimeout(id) { timeouts.delete(id); },
  setInterval(fn) { intervals.set(++sequence, fn); return sequence; }, clearInterval(id) { intervals.delete(id); },
});
const flush = () => { const pending = [...timeouts.values()]; timeouts.clear(); pending.forEach(fn => fn()); };
exports.ClientDataSync({ userId: 'fixture-client' });
assert.ok(changes.length > 0, 'subscribes to client data changes');
changes[0](); changes[1](); flush(); assert.equal(refreshes, 1, 'bursts coalesce');
document.visibilityState = 'hidden'; changes[0](); flush(); assert.equal(refreshes, 1);
document.visibilityState = 'visible'; navigator.onLine = false; listeners.get('focus')(); flush(); assert.equal(refreshes, 1);
navigator.onLine = true; listeners.get('online')(); flush(); assert.equal(refreshes, 2);
authCallback('SIGNED_OUT'); assert.equal(refreshes, 3);
changes[0](); cleanup(); flush(); assert.equal(refreshes, 3);
assert.equal(removed, true); assert.equal(unsubscribed, true);
assert.equal(intervals.size, 0); assert.equal(listeners.size, 0);
console.log('PASS: cross-device refresh coalescing, offline/hidden tabs, sign-out and cleanup.');
