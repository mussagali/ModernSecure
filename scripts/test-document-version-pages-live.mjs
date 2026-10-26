import { signInQa } from "./qa-login.mjs";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { createServerClient } from "@supabase/ssr";
import { documentRequestLabels, documentRequestState, latestDocumentVersion } from "../lib/document-request-state.ts";

assert.equal(statSync(".env.local").mode & 0o077, 0);
assert.equal(statSync(".test-accounts.local.json").mode & 0o077, 0);
const env = readFileSync(".env.local", "utf8");
const value = (name) => env.split(/\r?\n/).find((line) => line.startsWith(`${name}=`))
  ?.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, "");
const url = value("NEXT_PUBLIC_SUPABASE_URL");
const key = value("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
assert.equal(url, "https://bdkrihsiprkmukyjyspv.supabase.co");
const accounts = JSON.parse(readFileSync(".test-accounts.local.json", "utf8")).accounts;
const base = new URL(process.env.TEST_BASE_URL ?? "http://localhost:3001");
assert.equal(base.protocol, "http:");
assert.ok(["localhost", "127.0.0.1"].includes(base.hostname));

async function session(account) {
  const jar = new Map();
  const supabase = createServerClient(url, key, { cookies: {
    getAll: () => [...jar].map(([name, cookieValue]) => ({ name, value: cookieValue })),
    setAll: (items) => {
      for (const item of items) {
        if (item.options?.maxAge === 0) jar.delete(item.name);
        else jar.set(item.name, item.value);
      }
    },
  } });
  const login = await signInQa(supabase, { email: account.email, password: account.password });
  assert.ifError(login.error);
  assert.equal(login.data.user?.id, account.id);
  return { supabase, jar };
}
const cookies = (jar) => [...jar].map(([name, cookieValue]) => `${name}=${cookieValue}`).join("; ");
const client = await session(accounts.client);
const lawyer = await session(accounts.lawyer);
try {
  const { data: cases, error: caseError } = await client.supabase.from("cases").select("id, case_number");
  assert.ifError(caseError);
  let checked = 0;
  const seen = new Set();
  for (const item of cases ?? []) {
    const { data: requests, error: requestError } = await client.supabase.from("document_requests")
      .select("id, title, status").eq("case_id", item.id);
    assert.ifError(requestError);
    if (!requests?.length) continue;
    const { data: files, error: filesError } = await client.supabase.from("document_files")
      .select("request_id, version_no, status").in("request_id", requests.map((request) => request.id));
    assert.ifError(filesError);
    const clientResponse = await fetch(new URL(`/account/cases/${item.id}/documents`, base),
      { headers: { cookie: cookies(client.jar) }, redirect: "manual" });
    const lawyerResponse = await fetch(new URL(`/staff/cases/${item.id}/documents`, base),
      { headers: { cookie: cookies(lawyer.jar) }, redirect: "manual" });
    assert.equal(clientResponse.status, 200, `Client cannot open ${item.case_number} documents`);
    assert.equal(lawyerResponse.status, 200, `Lawyer cannot open ${item.case_number} documents`);
    const clientHtml = (await clientResponse.text()).replaceAll("<!-- -->", "");
    const lawyerHtml = (await lawyerResponse.text()).replaceAll("<!-- -->", "");
    for (const request of requests) {
      if (request.status !== "active") continue;
      const requestFiles = (files ?? []).filter((file) => file.request_id === request.id);
      const state = documentRequestState(requestFiles);
      const label = documentRequestLabels[state];
      assert.ok(clientHtml.includes(`<span>${label}</span>`), `Client has no ${label} status`);
      assert.ok(lawyerHtml.includes(`>${label}</span>`), `Lawyer has no ${label} status`);
      const version = latestDocumentVersion(requestFiles);
      if (version) {
        assert.ok(clientHtml.includes(`текущая версия ${version}`));
        assert.ok(lawyerHtml.includes(`текущая версия ${version}`));
      }
      seen.add(state);
      checked += 1;
    }
  }
  assert.ok(checked >= 2, "QA client needs at least two document requests");
  assert.ok(seen.has("accepted") && seen.has("under_review"),
    "QA data must include accepted and pending document versions");
  console.log(`OK live document pages: ${checked} requests, client/lawyer statuses ${[...seen].join(", ")}`);
} finally {
  await Promise.all([client.supabase.auth.signOut(), lawyer.supabase.auth.signOut()]);
}
