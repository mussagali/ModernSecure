import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const pg = new PGlite();
const admin = "10000000-0000-4000-8000-000000000001";
const lawyer = "10000000-0000-4000-8000-000000000002";
const newStaff = "10000000-0000-4000-8000-000000000003";
const client = "10000000-0000-4000-8000-000000000004";

async function asUser(userId, aal, path, sql, params = []) {
  await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await pg.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: userId, role: "authenticated", aal })]);
  await pg.query("select set_config('request.path', $1, false)", [path]);
  await pg.exec("set role authenticated");
  try { return await pg.query(sql, params); }
  finally { await pg.exec("reset role"); }
}

try {
  await pg.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create role authenticator;
    create schema auth;
    create schema private;
    create schema storage;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select nullif(current_setting('request.jwt.claims', true), '')::jsonb
    $$;
    grant usage on schema auth, public, private, storage to authenticated;
    grant execute on function auth.uid(), auth.jwt() to authenticated;
    create type public.staff_role as enum ('lawyer', 'manager', 'admin');
    create table public.staff_members(user_id uuid primary key,
      display_name text not null, role public.staff_role not null,
      active boolean not null default true);
    create table public.cases(id uuid primary key, owner_user_id uuid not null);
    create table auth.mfa_factors(id uuid primary key, user_id uuid not null, status text not null);
    create table storage.objects(bucket_id text not null, name text not null,
      primary key(bucket_id,name));
    alter table public.staff_members enable row level security;
    alter table public.cases enable row level security;
    alter table storage.objects enable row level security;
    create policy staff_self on public.staff_members for select to authenticated
      using(user_id=auth.uid());
    create policy case_owner on public.cases for select to authenticated
      using(owner_user_id=auth.uid());
    create policy storage_owner on storage.objects for select to authenticated
      using(name=auth.uid()::text);
    grant select on public.staff_members, public.cases to authenticated;
    grant select on storage.objects to authenticated;
  `);
  await pg.query("insert into public.staff_members values ($1,'Admin','admin',true),($2,'Lawyer','lawyer',true)", [admin, lawyer]);
  await pg.exec(readFileSync("supabase/migrations/20261011006200_staff_mfa_gate.sql", "utf8"));
  await pg.exec(readFileSync("supabase/migrations/20261011006300_staff_mfa_api_error.sql", "utf8"));
  await pg.query("insert into public.staff_members(user_id,display_name,role) values ($1,'New employee','manager')", [newStaff]);
  await pg.query("insert into public.cases values (gen_random_uuid(),$1),(gen_random_uuid(),$2)", [newStaff, client]);
  await pg.query("insert into storage.objects values('modernsecure-files',$1)", [newStaff]);

  const status = "select public.staff_mfa_status() as state";
  const gate = "select public.enforce_staff_mfa_request()";
  assert.equal((await asUser(admin, "aal1", "staff_members", status)).rows[0].state.mfa_required, false);
  assert.equal((await asUser(admin, "aal1", "staff_members", gate)).rowCount, 1);
  assert.equal((await asUser(newStaff, "aal1", "rpc/staff_mfa_status", status)).rows[0].state.mfa_passed, false);
  assert.equal((await asUser(newStaff, "aal1", "rpc/staff_mfa_status", gate)).rowCount, 1);
  assert.equal((await asUser(newStaff, "aal1", "/rpc/staff_mfa_status", gate)).rowCount, 1);
  assert.equal((await asUser(newStaff, "aal1", "rpc/claim_staff_invite", gate)).rowCount, 1);
  await assert.rejects(asUser(newStaff, "aal1", "cases", gate), /Complete staff two-factor authentication/);
  assert.equal((await asUser(newStaff, "aal1", "cases", "select * from public.cases")).rowCount, 0);
  assert.equal((await asUser(newStaff, "aal1", "storage", "select * from storage.objects")).rowCount, 0);
  assert.equal((await asUser(client, "aal1", "cases", "select * from public.cases")).rowCount, 1);
  assert.equal((await asUser(client, "aal1", "cases", gate)).rowCount, 1);

  await pg.query("insert into auth.mfa_factors values (gen_random_uuid(),$1,'verified'),(gen_random_uuid(),$2,'verified')", [newStaff, lawyer]);
  assert.equal((await asUser(lawyer, "aal1", "rpc/staff_mfa_status", status)).rows[0].state.mfa_required, true);
  await assert.rejects(asUser(lawyer, "aal1", "cases", gate), /Complete staff two-factor authentication/);
  assert.equal((await asUser(newStaff, "aal2", "rpc/staff_mfa_status", status)).rows[0].state.mfa_passed, true);
  assert.equal((await asUser(newStaff, "aal2", "cases", gate)).rowCount, 1);
  assert.equal((await asUser(newStaff, "aal2", "cases", "select * from public.cases")).rowCount, 1);
  assert.equal((await asUser(newStaff, "aal2", "storage", "select * from storage.objects")).rowCount, 1);
  await pg.query("update auth.mfa_factors set status='unverified' where user_id=$1", [newStaff]);
  assert.equal((await asUser(newStaff, "aal2", "rpc/staff_mfa_status", status)).rows[0].state.mfa_passed, false);
  await assert.rejects(asUser(newStaff, "aal2", "cases", gate), /Complete staff two-factor authentication/);
  const guardedTables = await pg.query("select count(*)::int as n from pg_policies where schemaname='public' and policyname='staff_mfa_guard'");
  assert.equal(guardedTables.rows[0].n, 2);
  console.log("OK staff MFA gate: staged rollout, Data API, RLS, Storage and stale factor revocation");
} finally {
  await pg.close();
}
