// Render the real components against synthetic data; no network or account writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const nativeRequire = createRequire(import.meta.url);
const caseId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const rows = Array.from({ length: 52 }, (_, index) => ({
  id: String(index).padStart(3, '0'), case_id: caseId,
  to_stage_id: 'third', client_note: `Event ${String(index).padStart(3, '0')}`,
  occurred_at: '2026-11-14T10:00:00Z',
}));
let accessAllowed = true;
const selections = [];
const supabase = {
  from(table) {
    const filters = [];
    const orders = [];
    let bounds;
    const query = {
      select(columns) { selections.push({ table, columns }); return query; },
      eq(key, value) { filters.push([key, value]); return query; },
      order(key, options) { orders.push([key, options]); return query; },
      range(start, end) { bounds = [start, end]; return query; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          if (table === 'stage_templates') return { data: [{ id: 'third', title: 'Final stage' }], error: null };
          assert.equal(table, 'case_stage_events');
          assert.deepEqual(filters, [['case_id', caseId]]);
          assert.deepEqual(JSON.parse(JSON.stringify(orders)), [['occurred_at', { ascending: false }], ['id', { ascending: false }]]);
          assert.equal(bounds[1] - bounds[0] + 1, 25);
          return { data: [...rows].reverse().slice(bounds[0], bounds[1] + 1), count: rows.length, error: null };
        }).then(resolve, reject);
      },
    };
    return query;
  },
};
const modules = new Map();
function load(filename) {
  const absolute = path.resolve(filename);
  if (modules.has(absolute)) return modules.get(absolute).exports;
  const original = readFileSync(absolute, 'utf8');
  const loadedModule = { exports: {} }; modules.set(absolute, loadedModule);
  const source = ts.transpileModule(original, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const require = specifier => {
    if (specifier === 'next/link') return { default: ({ children, ...props }) => React.createElement('a', props, children) };
    if (specifier.endsWith('/client-case')) return {
      requireClientCase: async id => { assert.equal(id, caseId); if (!accessAllowed) throw new Error('No access'); return { supabase, item: { service_version_id: 'version' } }; },
      formatKzDate: value => value,
    };
    if (specifier.endsWith('/ReferenceIcon') || specifier === './ReferenceIcon') return { ReferenceIcon: () => null };
    if (specifier === './NavIcon') return { NavIcon: () => null };
    if (specifier.startsWith('.')) {
      const base = path.resolve(path.dirname(absolute), specifier);
      for (const extension of ['.tsx', '.ts']) {
        try { return load(base + extension); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      throw new Error(`Missing module ${specifier}`);
    }
    return nativeRequire(specifier);
  };
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { URLSearchParams })(require, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

const { ReferenceCaseView } = load('components/ReferenceCaseView.tsx');
const stages = ['first', 'skipped', 'third'].map((id, index) => ({ id, position: index + 1, title: id, client_description: null }));
const html = renderToStaticMarkup(React.createElement(ReferenceCaseView, {
  caseId, caseNumber: 'CASE-123', caseTitle: 'Real matter', serviceName: 'Real service', updatedAt: '14.11.2026',
  lawyers: ['Assigned lawyer'], currentStage: stages[2], stages, suspended: false, status: 'open',
}));
assert.doesNotMatch(html, /is-complete|банкрот|картотек|Завершено дел|Опыт/);
assert.equal((html.match(/is-current/g) ?? []).length, 1);
for (const value of ['CASE-123', 'Real matter', 'Real service', '14.11.2026']) assert.ok(html.includes(value));

const History = load('app/account/cases/[id]/history/page.tsx').default;
const renderPage = async page => renderToStaticMarkup(await History({ params: Promise.resolve({ id: caseId }), searchParams: Promise.resolve({ page }) }));
const seen = [];
for (const page of ['1', '2', '3']) {
  const markup = await renderPage(page);
  seen.push(...[...markup.matchAll(/Event (\d{3})/g)].map(match => match[1]));
}
assert.equal(seen.length, 52);
assert.equal(new Set(seen).size, 52);
assert.match(await renderPage('999'), /Event 000/);
assert.match(await renderPage(['2', '3']), /Event 051/);
assert.ok(selections.filter(entry => entry.table === 'case_stage_events').every(entry => !entry.columns.includes('change_reason')));
accessAllowed = false;
await assert.rejects(renderPage('1'), /No access/);
console.log('PASS actual case render: real metadata, no inferred completion; full bounded history, stable ordering, clamped page, access guard, public fields only');
