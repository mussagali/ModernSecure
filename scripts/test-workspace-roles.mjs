import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(file, dependencies = {}) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports = {};
  vm.runInNewContext(outputText, { exports, process, URL, require(name) {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  } });
  return exports;
}
const returns = load("../lib/return-path.ts");
const { workspaceDestination } = load("../lib/workspace-destination.ts", { "./return-path": returns });
for (const invalid of ["https://evil.test", "//evil.test", "/staff/../../evil", "/staff/%2f%2fevil", "/staff\\evil", "/staffing", "/account"]) {
  assert.equal(returns.safeStaffReturn(invalid), "/staff");
}
assert.equal(workspaceDestination(null, "/staff/team"), "/account");
assert.equal(workspaceDestination(null, "/account/documents"), "/account/documents");
let staff = null;
let error = null;
let inviteError = null;
let signedIn = true;
let signedOut = false;
const redirect = path => { throw new Error(`redirect:${path}`); };
const db = {
  auth: {
    getClaims: async () => ({ data: { claims: signedIn ? { sub: "user", email: "user@example.test" } : null } }),
    signInWithPassword: async () => ({ error: null }),
    signOut: async () => { signedOut = true; },
  },
  rpc: async name => name === "claim_staff_invite" ? { error: inviteError } : { data: staff, error },
};
const staffModule = load("../lib/staff.ts", {
  // Each call below represents a separate server request.
  react: { cache: fn => fn },
  "next/navigation": { redirect, notFound: () => { throw new Error("404"); } },
  "./application-scope": { staffWorkspaceEnabled: true },
  "./supabase/server": { createClient: async () => db },
});
const { loginAction } = load("../app/login/actions.ts", {
  "../../lib/workspace-destination": { workspaceDestination },
  "next/navigation": { redirect },
  "../../lib/supabase/server": { createClient: async () => db },
  "../../lib/staff": staffModule,
});
const form = new FormData();
form.set("email", "user@example.test"); form.set("password", "test-password"); form.set("next", "/staff/cases");
await assert.rejects(loginAction(null, form), /redirect:\/account$/);
for (const role of ["admin", "manager", "lawyer"]) {
  staff = { role, active: true, mfa_passed: true };
  await assert.rejects(loginAction(null, form), /redirect:\/staff\/cases$/);
  assert.equal((await staffModule.requireStaff()).staff.role, role);
  staff.mfa_passed = false;
  await assert.rejects(loginAction(null, form), /redirect:\/staff-security$/);
  await assert.rejects(staffModule.requireStaff(), /redirect:\/staff-security$/);
  staff.active = false;
  await assert.rejects(loginAction(null, form), /redirect:\/access-denied$/);
}
staff = { role: "manager", active: true, mfa_passed: true };
await assert.rejects(staffModule.requireStaff(["admin"]), /redirect:\/staff\?error=forbidden$/);
staff = null;
await assert.rejects(staffModule.requireStaff(), /redirect:\/account\?staffAccess=denied$/);
signedIn = false;
await assert.rejects(staffModule.requireStaff(), /redirect:\/login$/);
signedIn = true;
error = { code: "unavailable" };
assert.equal((await loginAction(null, form)).status, "error");
assert.equal(signedOut, true);
error = null; signedOut = false; inviteError = { code: "unavailable" };
assert.equal((await loginAction(null, form)).status, "error");
assert.equal(signedOut, true);
assert.equal(workspaceDestination({ role: "unknown", active: true, mfa_passed: true }), "/access-denied");
console.log("PASS: all role destinations, invitations, MFA, disabled accounts, role boundaries and safe redirects");
