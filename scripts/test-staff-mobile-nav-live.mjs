import { signInQa } from "./qa-login.mjs";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { createServerClient } from "@supabase/ssr";

assert.equal(statSync(".env.local").mode & 0o077, 0, "Supabase keys file must be private");
assert.equal(statSync(".test-accounts.local.json").mode & 0o077, 0, "QA credentials file must be private");
const env = readFileSync(".env.local", "utf8");
function value(name) {
  return env.split(/\r?\n/).find((line) => line.startsWith(`${name}=`))
    ?.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, "");
}
const url = value("NEXT_PUBLIC_SUPABASE_URL");
const key = value("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
assert.equal(url, "https://bdkrihsiprkmukyjyspv.supabase.co");
const accounts = JSON.parse(readFileSync(".test-accounts.local.json", "utf8")).accounts;

async function navFor(account) {
  const jar = new Map();
  const client = createServerClient(url, key, { cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (items) => {
      for (const item of items) {
        if (item.options?.maxAge === 0) jar.delete(item.name);
        else jar.set(item.name, item.value);
      }
    },
  } });
  try {
    const login = await signInQa(client, { email: account.email, password: account.password });
    assert.ifError(login.error);
    assert.equal(login.data.user?.id, account.id);
    const response = await fetch("http://localhost:3000/staff", {
      headers: { cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; ") },
      redirect: "manual",
    });
    assert.equal(response.status, 200, "QA account did not reach the staff panel");
    const html = await response.text();
    const label = 'aria-label="Основные разделы панели"';
    const labelAt = html.indexOf(label);
    assert.ok(labelAt >= 0, "Mobile navigation is missing");
    const start = html.lastIndexOf("<nav", labelAt);
    const end = html.indexOf("</nav>", labelAt);
    assert.ok(start >= 0 && end > start, "Mobile navigation markup is incomplete");
    const nav = html.slice(start, end);
    const hrefs = [...nav.matchAll(/href="(\/staff(?:\/[a-z-]+)?)"/g)].map((match) => match[1]);
    assert.equal((nav.match(/class="staff-mobile-primary-link/g) ?? []).length, 5,
      "Mobile navigation must have four main links and More");
    return new Set(hrefs);
  } finally {
    await client.auth.signOut().catch(() => {});
  }
}

const lawyer = await navFor(accounts.lawyer);
for (const href of ["/staff/overview", "/staff/cases", "/staff/inbox", "/staff/chat", "/staff/review", "/staff/notifications"]) {
  assert.ok(lawyer.has(href), `Lawyer is missing ${href}`);
}
for (const href of ["/staff/clients", "/staff/services", "/staff/team", "/staff/audit", "/staff/settings"]) {
  assert.ok(!lawyer.has(href), `Lawyer sees admin/manager link ${href}`);
}

const manager = await navFor(accounts.manager);
for (const href of ["/staff/clients", "/staff/notifications", "/staff/chat"]) {
  assert.ok(manager.has(href), `Manager is missing ${href}`);
}
for (const href of ["/staff/review", "/staff/services", "/staff/team", "/staff/audit", "/staff/settings"]) {
  assert.ok(!manager.has(href), `Manager sees restricted link ${href}`);
}
console.log("OK live mobile navigation: five top-level items, lawyer/manager links respect roles");
