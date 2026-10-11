import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const pg = new PGlite();
const client = randomUUID();
const staff = randomUUID();
const outsider = randomUUID();
const requestId = randomUUID();

async function visibleTo(user) {
  await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
  await pg.exec("set role authenticated");
  try {
    const result = await pg.query("select original_name, status, uploaded_by, storage_path from public.document_files order by original_name");
    return result.rows.map((row) => row.original_name);
  } finally {
    await pg.exec("reset role");
  }
}

try {
  await pg.exec(`
    create role authenticated;
    create schema auth;
    create schema private;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.document_requests (id uuid primary key);
    create table public.case_readers (request_id uuid not null, user_id uuid not null);
    create table public.document_files (
      request_id uuid not null, original_name text not null, status text not null,
      uploaded_by uuid not null, storage_path text not null);
    create function private.can_read_document_request(p_request_id uuid)
      returns boolean language sql stable security definer set search_path = '' as $$
      select exists(select 1 from public.case_readers
        where request_id = p_request_id and user_id = (select auth.uid())) $$;
    grant usage on schema public, auth, private to authenticated;
    grant execute on function auth.uid() to authenticated;
    grant execute on function private.can_read_document_request(uuid) to authenticated;
    grant select on public.document_files to authenticated;
    alter table public.document_files enable row level security;
    create policy document_files_case_read on public.document_files for select to authenticated
      using (private.can_read_document_request(request_id));
  `);
  await pg.query("insert into public.document_requests(id) values($1)", [requestId]);
  await pg.query("insert into public.case_readers(request_id,user_id) values($1,$2),($1,$3)",
    [requestId, client, staff]);
  for (const [name, status, uploader] of [
    ["client-draft.pdf", "quarantine", client],
    ["staff-draft.pdf", "quarantine", staff],
    ["client-submitted.pdf", "under_review", client],
    ["staff-submitted.pdf", "accepted", staff],
    ["staff-returned.pdf", "returned", staff],
    ["client-retracted.pdf", "retracted", client],
  ]) {
    await pg.query("insert into public.document_files values($1,$2,$3,$4,$5)",
      [requestId, name, status, uploader, `${requestId}/${name}`]);
  }
  assert.equal((await visibleTo(client)).length, 6, "baseline must reproduce the draft leak");
  await pg.exec(readFileSync(new URL("../supabase/migrations/20261011005100_document_draft_privacy.sql", import.meta.url), "utf8"));
  const submitted = ["client-retracted.pdf", "client-submitted.pdf", "staff-returned.pdf", "staff-submitted.pdf"];
  assert.deepEqual(await visibleTo(client), ["client-draft.pdf", ...submitted]);
  assert.deepEqual(await visibleTo(staff), ["client-retracted.pdf", "client-submitted.pdf",
    "staff-draft.pdf", "staff-returned.pdf", "staff-submitted.pdf"]);
  assert.deepEqual(await visibleTo(outsider), []);
  await pg.query("delete from public.case_readers where request_id=$1 and user_id=$2", [requestId, staff]);
  assert.deepEqual(await visibleTo(staff), [], "a former case reader must lose draft and submitted metadata");
  console.log("OK migration 051 draft-owner privacy and submitted-document case access");
} finally {
  await pg.close();
}
