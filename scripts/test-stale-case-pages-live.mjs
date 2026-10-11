import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { createServerClient } from "@supabase/ssr";

for (const path of [".env.local", ".test-accounts.local.json"]) {
  assert.equal(statSync(path).mode & 0o077, 0, `${path} must remain private`);
}
const lines = readFileSync(".env.local", "utf8").split(/\r?\n/);
const value = (name) => lines.find((line) => line.startsWith(`${name}=`))
  ?.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, "");
const url = value("NEXT_PUBLIC_SUPABASE_URL");
const key = value("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
assert.equal(url, "https://bdkrihsiprkmukyjyspv.supabase.co");
const accounts = JSON.parse(readFileSync(".test-accounts.local.json", "utf8")).accounts;
const base = new URL(process.env.TEST_BASE_URL ?? "http://localhost:3001");
assert.equal(base.protocol, "http:");
assert.ok(["localhost", "127.0.0.1"].includes(base.hostname));

async function withAccount(account, check) {
  const jar = new Map();
  const client = createServerClient(url, key, { cookies: {
    getAll: () => [...jar].map(([name, cookieValue]) => ({ name, value: cookieValue })),
    setAll: (items) => {
      for (const item of items) {
        if (item.options?.maxAge === 0) jar.delete(item.name);
        else jar.set(item.name, item.value);
      }
    },
  } });
  const open = (path) => fetch(new URL(path, base), {
    headers: { cookie: [...jar].map(([name, cookieValue]) => `${name}=${cookieValue}`).join("; ") },
    redirect: "manual",
  });
  try {
    const login = await client.auth.signInWithPassword({ email: account.email, password: account.password });
    assert.ifError(login.error);
    assert.equal(login.data.user?.id, account.id);
    await check(client, open);
  } finally {
    await client.auth.signOut().catch(() => {});
  }
}

for (const role of ["lawyer", "manager"]) {
  await withAccount(accounts[role], async (client, open) => {
    const { data: rows, error } = await client.rpc("staff_stale_case_page", { p_page: 1 });
    assert.ifError(error);
    assert.ok(Array.isArray(rows));
    const dashboard = await open("/staff");
    assert.equal(dashboard.status, 200, `${role} cannot open dashboard`);
    assert.ok((await dashboard.text()).includes('href="/staff/cases/stale"'), `${role} dashboard has no stale queue link`);
    const queue = await open("/staff/cases/stale");
    assert.equal(queue.status, 200, `${role} cannot open stale queue`);
    const html = await queue.text();
    assert.ok(html.includes("Дела без обновлений"));
    for (const row of rows) assert.ok(html.includes(`href="/staff/cases/${row.case_id}"`));
    const settings = await open("/staff/settings");
    assert.notEqual(settings.status, 200, `${role} reached admin-only settings`);
  });
}
await withAccount(accounts.client, async (client, open) => {
  const { error } = await client.rpc("staff_stale_case_page", { p_page: 1 });
  assert.ok(error, "Client reached internal stale-case queue RPC");
  const queue = await open("/staff/cases/stale");
  assert.notEqual(queue.status, 200, "Client reached staff stale-case page");
});
console.log("OK live stale queue: lawyer/manager pages and role isolation; client denied");
