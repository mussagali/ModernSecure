import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { uuidPattern } from "../lib/uuid.ts";

const origin = "https://modernsecure.test";
const caseId = randomUUID();
const userId = randomUUID();
const source = readFileSync(new URL("../app/api/message-attachments/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function routeFor(state, form) {
  const bucket = {
    async upload(path, bytes) {
      state.uploads++;
      if (state.failUploadAt === state.uploads) return { error: new Error("upload failed") };
      state.objects.set(path, Buffer.from(bytes));
      return { error: null };
    },
    async download(path) {
      if (state.failDownloadAt === state.uploads) return { data: null, error: new Error("read failed") };
      return { data: new Blob([state.objects.get(path)]), error: null };
    },
    async remove() {
      state.removals++;
      throw new Error("unsafe immediate removal");
    },
  };
  const supabase = {
    auth: { getClaims: async () => ({ data: { claims: { sub: userId } } }) },
    from(table) {
      assert.equal(table, "cases", "the route must not use a stale attachment-reference query");
      const query = {
        select: () => query,
        eq: () => query,
        async maybeSingle() {
          state.caseReads++;
          return { data: state.loseAccessAt === state.caseReads ? null : { id: caseId }, error: null };
        },
      };
      return query;
    },
    async rpc(name, args) {
      assert.equal(name, "post_case_message_with_attachments");
      state.rpcFiles = args.p_files;
      if (state.rpcMode === "timeout") return { data: null, error: new Error("network timeout") };
      if (state.rpcMode === "replay") return { data: { created: false }, error: null };
      return { data: { created: true }, error: null };
    },
  };
  const checked = async (file) => {
    const bytes = Buffer.from(await file.arrayBuffer());
    return { name: file.name, mime: "application/pdf", size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"), bytes };
  };
  const dependencies = {
    "node:crypto": { randomUUID },
    "../../../lib/document-files": { checkDocumentFile: checked,
      storageAdmin: () => ({ storage: { from: () => bucket }, from: () => { throw new Error("unsafe reference check"); } }) },
    "../../../lib/upload-request": { readBoundedFormData: async () => form, UploadInputError: class extends Error {} },
    "../../../lib/supabase/server": { createClient: async () => supabase },
    "../../../lib/uuid": { uuidPattern },
  };
  const routeModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: routeModule, exports: routeModule.exports,
    require: (name) => {
      assert(Object.hasOwn(dependencies, name), `unexpected import ${name}`);
      return dependencies[name];
    },
    Buffer, Blob, File, Request, Response, URL, process: { env: { APP_ORIGIN: origin } },
  }, { filename: "message-attachments/route.ts" });
  return routeModule.exports.POST;
}

async function run(options) {
  const state = { objects: new Map(), uploads: 0, removals: 0, caseReads: 0,
    rpcFiles: null, ...options };
  const form = new FormData();
  form.set("caseId", caseId);
  form.set("key", randomUUID());
  form.set("body", "Evidence");
  form.append("files", new File(["first"], "first.pdf"));
  form.append("files", new File(["second"], "second.pdf"));
  const post = routeFor(state, form);
  const response = await post(new Request(`${origin}/api/message-attachments`, {
    method: "POST", headers: { origin, accept: "application/json" },
  }));
  return { response, state };
}

for (const [options, expectedStatus, expectedObjects] of [
  [{ failUploadAt: 2 }, 503, 1],
  [{ failDownloadAt: 1 }, 503, 1],
  [{ loseAccessAt: 3 }, 404, 1],
  [{ rpcMode: "timeout" }, 400, 2],
  [{ rpcMode: "replay" }, 200, 2],
  [{}, 200, 2],
]) {
  const { response, state } = await run(options);
  assert.equal(response.status, expectedStatus);
  assert.equal(state.objects.size, expectedObjects);
  assert.equal(state.removals, 0);
  if (options.rpcMode === "timeout") {
    assert.equal(state.rpcFiles.length, 2);
    // Model the server-side transaction committing after the caller times out.
    assert(state.rpcFiles.every((file) => state.objects.has(file.path)));
  }
}
console.log("OK message route defers all failure cleanup and preserves late-commit objects");
