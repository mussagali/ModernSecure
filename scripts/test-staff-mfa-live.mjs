import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

function secret(file, name) {
  assert.equal(statSync(file).mode & 0o077, 0, `${file} must be private`);
  const line = readFileSync(file, "utf8").split(/\r?\n/).find((part) => part.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, "");
}

function totp(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of value.toUpperCase().replace(/=|\s/g, "")) {
    const index = alphabet.indexOf(char);
    assert.ok(index >= 0, "Invalid TOTP secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const key = Buffer.from(bits.match(/.{8}/g)?.map((byte) => Number.parseInt(byte, 2)) ?? []);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const hash = createHmac("sha1", key).update(counter).digest();
  const offset = hash.at(-1) & 0x0f;
  return ((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

const project = "bdkrihsiprkmukyjyspv";
const url = secret(".env.local", "NEXT_PUBLIC_SUPABASE_URL");
const publishable = secret(".env.local", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const service = secret(".env.local", "SUPABASE_SECRET_KEY");
const user = JSON.parse(readFileSync(".test-accounts.local.json", "utf8")).accounts.lawyer;
assert.equal(url, `https://${project}.supabase.co`);
assert.match(service, /^sb_secret_[A-Za-z0-9_-]{20,}$/);
assert.equal(user.email, "qa-lawyer-modernsecure@example.test");
const dbUrl = new URL(secret(".env.db.local", "DATABASE_URL"));
assert.ok(dbUrl.hostname === `db.${project}.supabase.co` || dbUrl.hostname === "aws-0-ap-northeast-2.pooler.supabase.com");
dbUrl.searchParams.delete("sslmode");
dbUrl.searchParams.delete("sslrootcert");
const db = new pg.Client({ connectionString: dbUrl.toString(), ssl: {
  ca: readFileSync("supabase/certs/prod-ca-2021.crt", "utf8"), rejectUnauthorized: true, servername: dbUrl.hostname,
} });
const options = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(url, service, options);
const cookieJar = new Map();
const browser = createServerClient(url, publishable, { cookies: {
  getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
  setAll: (items) => {
    for (const item of items) {
      if (item.options?.maxAge === 0) cookieJar.delete(item.name);
      else cookieJar.set(item.name, item.value);
    }
  },
} });
let factorId;
let changed = false;

try {
  await db.connect();
  const existing = await admin.auth.admin.mfa.listFactors({ userId: user.id });
  assert.ifError(existing.error);
  assert.equal(existing.data.factors.length, 0, "QA user has an existing factor; do not touch it");
  const original = await db.query("select mfa_required from public.staff_members where user_id=$1 and role='lawyer'", [user.id]);
  assert.equal(original.rows[0]?.mfa_required, false, "QA user MFA flag changed; do not touch it");
  const auditBefore = Number((await db.query(`select count(*) as count from public.audit_events
    where actor_user_id=$1 and action='staff_mfa_verified'`, [user.id])).rows[0].count);
  const signIn = await browser.auth.signInWithPassword({ email: user.email, password: user.password });
  assert.ifError(signIn.error);
  assert.equal(signIn.data.user?.id, user.id);

  await db.query("update public.staff_members set mfa_required=true where user_id=$1", [user.id]);
  changed = true;
  const before = await browser.rpc("staff_mfa_status");
  assert.ifError(before.error);
  assert.equal(before.data.mfa_passed, false);
  const denied = await browser.from("cases").select("id").limit(1);
  assert.equal(denied.status, 403);
  assert.equal(denied.error?.code, "MFA_REQUIRED");
  const earlyPanelResponse = await fetch("http://localhost:3000/staff", {
    headers: { cookie: [...cookieJar].map(([name, value]) => `${name}=${value}`).join("; ") },
    redirect: "manual",
  });
  assert.equal(earlyPanelResponse.status, 307, "AAL1 unexpectedly opened the staff panel");
  assert.equal(new URL(earlyPanelResponse.headers.get("location"), "http://localhost:3000").pathname, "/staff-security");

  const enrolled = await browser.auth.mfa.enroll({ factorType: "totp", friendlyName: "QA — temporary verification" });
  assert.ifError(enrolled.error);
  factorId = enrolled.data.id;
  assert.ok(enrolled.data.totp?.secret);
  const verified = await browser.auth.mfa.challengeAndVerify({ factorId, code: totp(enrolled.data.totp.secret) });
  assert.ifError(verified.error);
  const firstPass = await browser.rpc("staff_mfa_status");
  assert.ifError(firstPass.error);
  assert.equal(firstPass.data.mfa_passed, true);
  const cases = await browser.from("cases").select("id").limit(1);
  assert.ifError(cases.error);
  const panelResponse = await fetch("http://localhost:3000/staff", {
    headers: { cookie: [...cookieJar].map(([name, value]) => `${name}=${value}`).join("; ") },
    redirect: "manual",
  });
  assert.equal(panelResponse.status, 200, "Verified QA session did not open the staff panel");
  const panelText = await panelResponse.text();
  assert.ok(panelText.includes("Рабочее место юриста"), "Staff panel did not render the lawyer role");
  const panelAuditCount = Number((await db.query(`select count(*) as count from public.audit_events
    where actor_user_id=$1 and action='staff_mfa_verified'`, [user.id])).rows[0].count);
  assert.equal(panelAuditCount, auditBefore + 1, "Staff layout did not record one AAL2 entry");
  const firstEntry = await browser.rpc("record_staff_mfa_entry");
  assert.ifError(firstEntry.error);
  assert.equal(firstEntry.data, false, "Staff layout entry was not idempotent");
  const firstRetry = await browser.rpc("record_staff_mfa_entry");
  assert.ifError(firstRetry.error);
  assert.equal(firstRetry.data, false, "Same session created a duplicate MFA entry");
  console.log("OK initial TOTP: AAL1 panel redirect, AAL2 panel opened and audited once");

  const newSession = createClient(url, publishable, options);
  const again = await newSession.auth.signInWithPassword({ email: user.email, password: user.password });
  assert.ifError(again.error);
  assert.equal(again.data.user?.id, user.id);
  const freshStatus = await newSession.rpc("staff_mfa_status");
  assert.ifError(freshStatus.error);
  assert.equal(freshStatus.data.mfa_passed, false);
  const freshDenied = await newSession.from("cases").select("id").limit(1);
  assert.equal(freshDenied.status, 403);
  assert.equal(freshDenied.error?.code, "MFA_REQUIRED");
  const earlyEntry = await newSession.rpc("record_staff_mfa_entry");
  assert.equal(earlyEntry.status, 403, "AAL1 created a verified MFA entry");
  const challenged = await newSession.auth.mfa.challengeAndVerify({ factorId, code: totp(enrolled.data.totp.secret) });
  assert.ifError(challenged.error);
  const finalStatus = await newSession.rpc("staff_mfa_status");
  assert.ifError(finalStatus.error);
  assert.equal(finalStatus.data.mfa_passed, true);
  const secondEntry = await newSession.rpc("record_staff_mfa_entry");
  assert.ifError(secondEntry.error);
  assert.equal(secondEntry.data, true, "A new AAL2 session did not create its own entry");
  const auditAfter = Number((await db.query(`select count(*) as count from public.audit_events
    where actor_user_id=$1 and action='staff_mfa_verified'`, [user.id])).rows[0].count);
  assert.equal(auditAfter, auditBefore + 2);
  console.log("OK repeat login: password alone denied, TOTP restores access");
} finally {
  if (factorId) {
    const factors = await admin.auth.admin.mfa.listFactors({ userId: user.id });
    if (!factors.error && factors.data.factors.some((factor) => factor.id === factorId)) {
      const removed = await admin.auth.admin.mfa.deleteFactor({ userId: user.id, id: factorId });
      if (removed.error) console.error("QA factor cleanup failed:", removed.error.message);
      else console.log("Removed temporary QA factor");
    }
  }
  if (changed) {
    await db.query("update public.staff_members set mfa_required=false where user_id=$1", [user.id]);
    console.log("Restored QA staff MFA flag");
  }
  await db.end().catch(() => {});
}
