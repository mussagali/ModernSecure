import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pg = new PGlite();
const client = randomUUID();
const staff = randomUUID();
const stranger = randomUUID();
const caseId = randomUUID();
const clientId = randomUUID();

async function asUser(userId, sql, params = []) {
  await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await pg.exec("set role authenticated");
  try { return await pg.query(sql, params); }
  finally { await pg.exec("reset role"); }
}

async function post(userId, body, key) {
  const result = await asUser(userId,
    "select public.post_case_message($1, $2, $3) as id", [caseId, body, key]);
  return result.rows[0].id;
}

async function totals() {
  const result = await pg.query(`select
    (select count(*)::integer from public.messages) as messages,
    (select count(*)::integer from public.audit_events) as audits,
    (select count(*)::integer from public.notifications) as notifications`);
  return result.rows[0];
}

try {
  await pg.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create schema private;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth, public to authenticated;
    grant execute on function auth.uid() to authenticated;
    create type public.case_status as enum ('open', 'closed', 'cancelled');
    create table public.clients (id uuid primary key, user_id uuid not null);
    create table public.cases (id uuid primary key, client_id uuid not null,
      status public.case_status not null default 'open', is_suspended boolean not null default false);
    create table public.staff_access (user_id uuid not null, case_id uuid not null);
    create table public.messages (id uuid primary key default gen_random_uuid(), case_id uuid not null,
      sender_user_id uuid not null, body text not null, idempotency_key text not null,
      created_at timestamptz not null default now(),
      unique (case_id, sender_user_id, idempotency_key));
    create table public.audit_events (actor_user_id uuid, case_id uuid, entity_type text,
      entity_id uuid, action text);
    create table public.notifications (recipient_user_id uuid, case_id uuid, kind text,
      title text, target_path text, dedupe_key text);
    create function private.is_staff_for_case(p_case_id uuid) returns boolean
      language sql stable security definer set search_path = '' as $$
        select exists (select 1 from public.staff_access sa
          where sa.case_id = p_case_id and sa.user_id = auth.uid())
      $$;
    create function private.can_read_case(p_case_id uuid) returns boolean
      language sql stable security definer set search_path = '' as $$
        select exists (select 1 from public.cases c join public.clients cl on cl.id = c.client_id
          where c.id = p_case_id and cl.user_id = auth.uid())
          or private.is_staff_for_case(p_case_id)
      $$;
    create function private.notify_case_staff_or_admins(
      p_case_id uuid, p_kind text, p_title text, p_section text, p_dedupe_key text
    ) returns void language sql security definer set search_path = '' as $$
      insert into public.notifications (recipient_user_id, case_id, kind, title, target_path, dedupe_key)
      select sa.user_id, p_case_id, p_kind, p_title,
        '/staff/cases/' || p_case_id::text || '/' || p_section, p_dedupe_key
      from public.staff_access sa where sa.case_id = p_case_id
    $$;
  `);
  await pg.exec(readFileSync(path.join(root, "supabase/migrations/20261011001700_message_rate_limit.sql"), "utf8"));
  await pg.exec(readFileSync(path.join(root, "supabase/migrations/20261011005000_case_message_state.sql"), "utf8"));
  await pg.query("insert into public.clients (id, user_id) values ($1, $2)", [clientId, client]);
  await pg.query("insert into public.cases (id, client_id) values ($1, $2)", [caseId, clientId]);
  await pg.query("insert into public.staff_access (user_id, case_id) values ($1, $2)", [staff, caseId]);

  const clientMessage = await post(client, "Client message", "client-key");
  const staffMessage = await post(staff, "Staff message", "staff-key");
  assert.equal(await post(client, "Client message", "client-key"), clientMessage);
  await assert.rejects(post(client, "Changed body", "client-key"));
  await assert.rejects(post(stranger, "No access", "stranger-key"));
  assert.deepEqual(await totals(), { messages: 2, audits: 2, notifications: 2 });

  await pg.query("update public.cases set is_suspended = true where id = $1", [caseId]);
  const beforeSuspendedRetries = await totals();
  assert.equal(await post(client, "Client message", "client-key"), clientMessage);
  assert.equal(await post(staff, "Staff message", "staff-key"), staffMessage);
  await assert.rejects(post(client, "Changed body", "client-key"));
  await assert.rejects(post(client, "New while suspended", "suspended-client-key"));
  await assert.rejects(post(staff, "New while suspended", "suspended-staff-key"));
  assert.deepEqual(await totals(), beforeSuspendedRetries);

  await pg.query("update public.cases set is_suspended = false where id = $1", [caseId]);
  const resumedMessage = await post(client, "After resumption", "resumed-key");
  await pg.query("update public.cases set status = 'closed' where id = $1", [caseId]);
  const beforeClosedRetries = await totals();
  assert.equal(await post(client, "After resumption", "resumed-key"), resumedMessage);
  assert.equal(await post(staff, "Staff message", "staff-key"), staffMessage);
  await assert.rejects(post(client, "Changed body", "resumed-key"));
  await assert.rejects(post(client, "New after closure", "closed-client-key"));
  await assert.rejects(post(staff, "New after closure", "closed-staff-key"));
  assert.deepEqual(await totals(), beforeClosedRetries);

  await pg.query("update public.cases set status = 'cancelled' where id = $1", [caseId]);
  await assert.rejects(post(client, "New after cancellation", "cancelled-key"));
  await pg.query("update public.cases set status = 'open' where id = $1", [caseId]);
  await pg.query("select set_config('request.jwt.claim.sub', '', false)");
  await pg.query("insert into public.messages (case_id, sender_user_id, body, idempotency_key) select $1, $2, 'Rate seed', 'rate-key-' || n from generate_series(1, 18) n", [caseId, client]);
  await assert.rejects(post(client, "Rate exceeded", "rate-key-21"), /Message rate limit exceeded/);
  assert.equal(await post(client, "Client message", "client-key"), clientMessage);
  console.log("OK case message state: access, exact retries, lifecycle, rate limit");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await pg.close();
}
