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
const account = JSON.parse(readFileSync(".test-accounts.local.json", "utf8")).accounts.client;
const base = new URL(process.env.TEST_BASE_URL ?? "http://localhost:3000");
assert.equal(base.protocol, "http:");
assert.ok(["localhost", "127.0.0.1"].includes(base.hostname), "Live test only supports a local server");
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

try {
  const login = await client.auth.signInWithPassword({ email: account.email, password: account.password });
  assert.ifError(login.error);
  assert.equal(login.data.user?.id, account.id);

  const { data: cases, error } = await client.from("cases")
    .select("id, case_number, title, client_id, service_version_id").order("updated_at", { ascending: false });
  assert.ifError(error);
  assert.ok(cases && cases.length >= 2, "QA client needs two cases for switch test");

  const headers = { cookie: [...jar].map(([name, cookieValue]) => `${name}=${cookieValue}`).join("; ") };
  const { data: clientCard, error: cardError } = await client.from("clients")
    .select("full_name, iin").eq("user_id", account.id).single();
  assert.ifError(cardError);
  const profileResponse = await fetch(new URL("/account/profile", base), { headers, redirect: "manual" });
  assert.equal(profileResponse.status, 200, "Cannot open client profile");
  const profileHtml = await profileResponse.text();
  assert.ok(profileHtml.includes(clientCard.full_name), "Profile lacks the linked client's verified name");
  if (clientCard.iin) {
    assert.ok(profileHtml.includes(clientCard.iin.slice(-4)), "Profile lacks the masked IIN suffix");
    assert.ok(!profileHtml.includes(clientCard.iin), "Profile exposed the full IIN");
  }
  let versionedTerms = 0;
  for (const selected of cases) {
    const response = await fetch(new URL(`/account/cases/${selected.id}`, base), { headers, redirect: "manual" });
    assert.equal(response.status, 200, `Cannot open case ${selected.case_number}`);
    const html = await response.text();
    assert.ok(html.includes(`<h1>${selected.title}</h1>`), `Wrong case heading for ${selected.case_number}`);
    assert.ok(html.includes("Что нужно сделать"), "Case overview has no next-action section");
    assert.ok(html.includes("ОТВЕТСТВЕННЫЙ ЮРИСТ") && html.includes("ПОСЛЕДНЕЕ ОБНОВЛЕНИЕ ДЕЛА"),
      "Case overview lacks the assigned lawyer or update date");
    const { data: version, error: versionError } = await client.from("service_template_versions")
      .select("service_id").eq("id", selected.service_version_id).single();
    assert.ifError(versionError);
    const { data: service, error: serviceError } = await client.from("service_templates")
      .select("name").eq("id", version.service_id).single();
    assert.ifError(serviceError);
    assert.ok(html.includes(service.name), "Case overview does not show its actual service");
    assert.ok(html.includes(`aria-label="Разделы дела № ${selected.case_number}"`), "Case tabs have wrong context");
    assert.ok(html.includes(`href="/account/cases/${selected.id}/documents"`), "Documents tab lost case scope");
    assert.ok(html.includes(`href="/account/cases/${selected.id}/messages"`), "Conversation tab lost case scope");

    const labelAt = html.indexOf('aria-label="Переключить дело"');
    assert.ok(labelAt >= 0, `Case switcher is missing for ${selected.case_number}; listed=${cases.length}, client_cards=${new Set(cases.map((item) => item.client_id)).size}, markup=${html.includes("account-case-switcher")}, encoded=${html.includes("Переключить дело")}`);
    const end = html.indexOf("</nav>", labelAt);
    assert.ok(end > labelAt, "Case switcher markup is incomplete");
    const switcher = html.slice(labelAt, end);
    for (const choice of cases) {
      assert.ok(switcher.includes(`href="/account/cases/${choice.id}"`),
        `Case ${choice.case_number} missing from switcher`);
    }

    const paymentsResponse = await fetch(new URL(`/account/cases/${selected.id}/payments`, base),
      { headers, redirect: "manual" });
    assert.equal(paymentsResponse.status, 200, `Cannot open payments for ${selected.case_number}`);
    const paymentsHtml = await paymentsResponse.text();
    assert.ok(paymentsHtml.includes("Договор и оплаты"), "Payments page lost case context");
    const { data: terms, error: termsError } = await client.from("payment_schedule")
      .select("contract_id").eq("case_id", selected.id);
    assert.ifError(termsError);
    const { data: contracts, error: contractsError } = await client.from("contracts")
      .select("id, contract_number, version_no").eq("case_id", selected.id);
    assert.ifError(contractsError);
    const byId = new Map((contracts ?? []).map((contract) => [contract.id, contract]));
    for (const term of terms ?? []) {
      const contract = term.contract_id ? byId.get(term.contract_id) : null;
      if (contract) {
        versionedTerms += 1;
        assert.ok(paymentsHtml.includes(`Договор № ${contract.contract_number} · версия ${contract.version_no}`),
          `Schedule lost contract version in ${selected.case_number}`);
      }
    }
  }
  assert.ok(versionedTerms > 0, "QA client needs a schedule tied to a contract version");
  console.log(`OK live client case switch: ${cases.length} scoped cases, ${versionedTerms} versioned payment terms`);
} finally {
  await client.auth.signOut().catch(() => {});
}
