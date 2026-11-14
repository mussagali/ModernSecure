// Actual navigation + selector render with deterministic data; no network or user writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const nativeRequire = createRequire(import.meta.url);
let pathname = '/account/select-case', search = new URLSearchParams();
let rows = [], total = 0, queryError = null;
const caseId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const fakeDb = {
  auth: { getClaims: async () => ({ data: { claims: { sub: 'client-id' } } }) },
  from(table) {
    const query = {
      select: () => query, eq: () => query, or: () => query, order: () => query,
      maybeSingle: async () => ({ data: { id: 'client-card' }, error: null }),
      range: async () => {
        assert.equal(table, 'cases');
        return { data: rows, count: total, error: queryError };
      },
    }; return query;
  },
};
const loaded = new Map();
function load(filename) {
  const absolute = path.resolve(filename);
  if (loaded.has(absolute)) return loaded.get(absolute).exports;
  const loadedModule = { exports: {} }; loaded.set(absolute, loadedModule);
  const source = ts.transpileModule(readFileSync(absolute, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const require = name => {
    if (name === 'next/link') return { default: ({ children, ...props }) => React.createElement('a', props, children) };
    if (name === 'next/image') return { default: () => null };
    if (name === 'next/navigation') return { usePathname: () => pathname, useSearchParams: () => search, redirect: href => { throw new Error(`REDIRECT:${href}`); } };
    if (name.endsWith('/supabase/server')) return { createClient: async () => fakeDb };
    if (name.endsWith('/useNavigationDrawer')) return { useNavigationDrawer: () => ({ menuOpen: false, setMenuOpen: () => {}, toggleRef: null, sidebarRef: null }) };
    if (name.endsWith('/ReferenceIcon') || name.endsWith('/NavIcon')) return { ReferenceIcon: () => null, NavIcon: () => null };
    if (name.endsWith('/AccountHeader')) return { AccountHeader: () => null };
    if (name.endsWith('/account/actions')) return { signOutAction: () => {} };
    if (name.endsWith('/ListControls')) return {
      ListSearch: () => React.createElement('div', { 'data-search': true }), ListPagination: () => null,
    };
    if (name.startsWith('.')) {
      const base = path.resolve(path.dirname(absolute), name);
      for (const extension of ['.tsx', '.ts']) {
        try { return load(base + extension); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
    return nativeRequire(name);
  };
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { URLSearchParams })(require, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
const Shell = load('components/ClientShell.tsx').ClientShell;
const activeLabels = props => [...renderToStaticMarkup(React.createElement(Shell, props)).matchAll(/<a\b[^>]*aria-current="page"[^>]*>(.*?)<\/a>/g)].map(match => match[1].replace(/<[^>]*>/g, ''));
for (const [section, label] of Object.entries({ messages: 'Чат с юристом', tasks: 'Задачи', documents: 'Документы', payments: 'Договор и оплаты' })) {
  search = new URLSearchParams({ section, q: 'sample', status: 'open' });
  assert.deepEqual(activeLabels({}), [label]);
  assert.deepEqual(activeLabels({ caseId }), [label]);
}
search = new URLSearchParams();
assert.deepEqual(activeLabels({}), ['Мои дела']);
pathname = `/account/cases/${caseId}`;
assert.deepEqual(activeLabels({ caseId }), ['Мои дела']);
pathname += '/messages';
assert.deepEqual(activeLabels({ caseId }), ['Чат с юристом']);
pathname = '/account';
assert.deepEqual(activeLabels({}), ['Главная']);

const Page = load('app/account/select-case/page.tsx').default;
const render = async params => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
const empty = await render({ section: 'messages' });
assert.match(empty, /Чат с юристом/);
assert.match(empty, /Чат появится вместе с делом/);
assert.match(empty, /href="\/account\/contacts"/);
assert.doesNotMatch(empty, /Здесь будут ваши дела|data-search|Статус дел|Выберите дело/);
assert.match(await render({ section: 'messages', q: 'missing' }), /data-search/);
assert.match(await render({ section: 'messages', q: 'missing' }), /Дела не найдены/);
assert.match(await render({ section: '__proto__' }), /Мои дела/);
rows = [{ id: caseId, title: 'My matter', case_number: 'QA-1', status: 'open', is_suspended: false, updated_at: '2026-11-14T00:00:00Z' }]; total = 1;
await assert.rejects(render({ section: 'messages' }), new RegExp(`REDIRECT:/account/cases/${caseId}/messages`));
assert.match(await render({ section: 'messages', q: 'My' }), new RegExp(`href="/account/cases/${caseId}/messages"`));
rows = [...rows, { ...rows[0], id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }]; total = 2;
assert.match(await render({ section: 'messages' }), /Выберите дело, чтобы открыть переписку с юристом/);
queryError = { message: 'No access' };
await assert.rejects(render({ section: 'messages' }), /Не удалось загрузить дела/);
console.log('PASS real client navigation and selector: correct active section, contextual no-case chat, filtered recovery, one-case direct routing, multiple-case selector, errors remain errors');
