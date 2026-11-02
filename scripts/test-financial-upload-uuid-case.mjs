import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { uuidPattern } from "../lib/uuid.ts";
import { staffWorkspaceEnabled } from "../lib/application-scope.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const origin = "https://modernsecure.test";
const caseId = "abcdefab-cdef-4abc-8def-abcdefabcdef";
const key = "fedcbafe-dcba-4fed-8cba-fedcbafedcba";
const userId = "11111111-1111-4111-8111-111111111111";
const sha256 = "a".repeat(64);

function loadRoute(route, state, form) {
  const source = readFileSync(path.join(root, `app/api/${route}/route.ts`), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const routeModule = { exports: {} };
  const checked = {
    name: route === "contracts" ? "contract.pdf" : "receipt.pdf",
    mime: "application/pdf", size: 30, sha256, bytes: Buffer.from("test"),
  };
  const bucket = {
    upload: async (storagePath) => {
      state.uploads.push(storagePath);
      return { error: null };
    },
  };
  const supabase = {
    auth: { getClaims: async () => ({ data: { claims: { sub: userId } } }) },
    from(table) {
      const filters = [];
      const query = {
        select: () => query,
        eq: (column, value) => { filters.push([column, value]); return query; },
        is: (column, value) => { filters.push([column, value]); return query; },
        async maybeSingle() {
          state.queries.push({ table, filters });
          const data = {
            staff_members: { role: "admin", active: true, can_confirm_payments: true },
            clients: { id: "client-1" },
            cases: { id: caseId, client_id: "client-1", status: state.closed ? "closed" : "open", is_suspended: false },
            contracts: state.existing && route === "contracts" ? {
              id: "existing-contract", contract_number: "CON-1", signed_on: null,
              price_kzt: 100, content_sha256: sha256, size_bytes: 30,
            } : null,
            payment_receipts: state.existing && route === "payment-receipts" ? {
              id: "existing-receipt", storage_path: `receipts/${caseId}/${userId}/${key}.pdf`,
              original_name: "receipt.pdf", detected_mime_type: "application/pdf",
              size_bytes: 30, content_sha256: sha256,
            } : null,
          }[table];
          assert.notEqual(data, undefined, `unexpected table: ${table}`);
          return { data, error: null };
        },
      };
      return query;
    },
    async rpc(name, args) {
      state.rpcs.push({ name, args });
      return { error: null };
    },
  };
  const dependencies = {
    "../../../lib/document-files": {
      checkDocumentFile: async () => checked,
      MAX_DOCUMENT_BYTES: 20 * 1024 * 1024,
      storageAdmin: () => ({ storage: { from: () => bucket } }),
    },
    "../../../lib/money": { toKztCents: (value) => Math.round(Number(value) * 100) },
    "../../../lib/supabase/server": { createClient: async () => supabase },
    "../../../lib/upload-request": { readBoundedFormData: async () => form, UploadInputError: class extends Error {} },
    "../../../lib/uuid": { uuidPattern },
    "../../../lib/application-scope": { staffWorkspaceEnabled },
  };
  vm.runInNewContext(compiled, {
    module: routeModule, exports: routeModule.exports,
    require: (name) => {
      assert(Object.hasOwn(dependencies, name), `unexpected import: ${name}`);
      return dependencies[name];
    },
    Buffer, File, Request, Response, URL, process: { env: { APP_ORIGIN: origin } },
  }, { filename: `${route}/route.ts` });
  return routeModule.exports.POST;
}

async function runUpload(route, submittedCaseId, submittedKey, options = {}) {
  const form = new FormData();
  form.set("caseId", submittedCaseId);
  form.set("key", submittedKey);
  form.set("file", new File(["test"], "receipt.pdf", { type: "application/pdf" }));
  if (route === "contracts") {
    form.set("contractNumber", "CON-1");
    form.set("price", "100.00");
  }
  const state = { queries: [], uploads: [], rpcs: [], ...options };
  const post = loadRoute(route, state, form);
  const response = await post(new Request(`${origin}/api/${route}`, {
    method: "POST", headers: { origin },
  }));
  return { response, state };
}

for (const route of ["contracts", "payment-receipts"]) {
  const prefix = route === "contracts" ? "contracts" : `receipts`;
  const expectedPath = route === "contracts"
    ? `${prefix}/${caseId}/${key}.pdf`
    : `${prefix}/${caseId}/${userId}/${key}.pdf`;
  for (const [submittedCaseId, submittedKey] of [
    [caseId, key], [caseId.toUpperCase(), key.toUpperCase()],
  ]) {
    const { response, state } = await runUpload(route, submittedCaseId, submittedKey);
    assert.equal(response.status, 303);
    assert(response.headers.get("location")?.includes(`/${caseId}/payments?`));
    assert.deepEqual(state.uploads, [expectedPath]);
    assert.equal(state.rpcs.length, 1);
    assert.equal(state.rpcs[0].args.p_case_id, caseId);
    assert.equal(state.rpcs[0].args.p_storage_path, expectedPath);
    if (route === "payment-receipts") assert.equal(state.rpcs[0].args.p_idempotency_key, key);
    const caseQuery = state.queries.find(({ table }) => table === "cases");
    assert(caseQuery.filters.some(([column, value]) => column === "id" && value === caseId));
    const existingQuery = state.queries.find(({ table }) => table === route.replace("payment-receipts", "payment_receipts"));
    assert(existingQuery);
    if (route === "contracts") {
      assert(existingQuery.filters.some(([column, value]) => column === "storage_path" && value === expectedPath));
    } else {
      assert(existingQuery.filters.some(([column, value]) => column === "case_id" && value === caseId));
      assert(existingQuery.filters.some(([column, value]) => column === "idempotency_key" && value === key));
    }
  }
  const invalid = await runUpload(route, `${caseId}/extra`, key);
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.state.uploads.length, 0);
  assert.equal(invalid.state.rpcs.length, 0);
  const closedReplay = await runUpload(route, caseId, key, { closed: true, existing: true });
  assert.equal(closedReplay.response.status, 303);
  assert(closedReplay.response.headers.get("location")?.includes("Uploaded=1"));
  assert.equal(closedReplay.state.uploads.length, 0);
  assert.equal(closedReplay.state.rpcs.length, 0);
  const closedNew = await runUpload(route, caseId, key, { closed: true });
  assert.equal(closedNew.response.status, 303);
  assert(closedNew.response.headers.get("location")?.includes("Error=access"));
  assert.equal(closedNew.state.uploads.length, 0);
}

console.log("OK financial upload UUID casing, Storage paths, DB filters, and RPC arguments");
