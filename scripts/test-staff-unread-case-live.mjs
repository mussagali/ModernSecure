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

async function check(account, role) {
  const jar = new Map();
  const client = createServerClient(url, key, { cookies: {
    getAll: () => [...jar].map(([name, stored]) => ({ name, value: stored })),
    setAll: (items) => {
      for (const item of items) {
        if (item.options?.maxAge === 0) jar.delete(item.name);
        else jar.set(item.name, item.value);
      }
    },
  } });
  try {
    const login = await client.auth.signInWithPassword({ email: account.email, password: account.password });
    assert.ifError(login.error);
    assert.equal(login.data.user?.id, account.id);
    const count = await client.rpc("staff_unread_case_count");
    if (role === "client") {
      assert.ok(count.error, "Client must not call the staff unread counter");
      return;
    }
    assert.ifError(count.error);
    const list = await client.rpc("staff_case_worklist", { p_attention: "unread", p_page: 1 });
    assert.ifError(list.error);
    assert.equal(Number(count.data), Number(list.data?.[0]?.total_count ?? 0),
      `${role} badge differs from the unread inbox filter`);
  } finally {
    await client.auth.signOut().catch(() => {});
  }
}

await check(accounts.lawyer, "lawyer");
await check(accounts.manager, "manager");
await check(accounts.client, "client");
console.log("OK live unread badge matches inbox for lawyer/manager; client denied");
