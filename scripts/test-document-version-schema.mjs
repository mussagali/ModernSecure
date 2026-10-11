import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const migration = (name) => readFileSync(`supabase/migrations/${name}`, "utf8");
const client = "00000000-0000-4000-8000-000000000001";
const lawyer = "00000000-0000-4000-8000-000000000002";
const request = "00000000-0000-4000-8000-000000000003";
const caseId = "00000000-0000-4000-8000-000000000004";
try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create schema storage;
    create table storage.buckets (id text primary key, name text not null, public boolean not null,
      file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (bucket_id text not null, name text not null,
      metadata jsonb, user_metadata jsonb, primary key (bucket_id, name));
  `);
  await db.exec(migration("20261010000100_core_schema.sql"));
  await db.exec(migration("20261010000200_access_policies.sql"));
  await db.exec(migration("20261012007200_document_request_version_state.sql"));
  await db.exec(migration("20261012007300_document_partial_retraction.sql"));
  await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'client@example.test',now()),($2,'lawyer@example.test',now())", [client, lawyer]);
  await db.query("insert into public.staff_members(user_id,display_name,role) values($1,'Lawyer','lawyer')", [lawyer]);
  await db.query("insert into public.clients(id,user_id,full_name,linked_by,linked_at) values('10000000-0000-4000-8000-000000000001',$1,'Client',$2,now())", [client, lawyer]);
  await db.exec("insert into public.service_templates(id,code,name) values('10000000-0000-4000-8000-000000000002','QA','QA')");
  await db.exec("insert into public.service_template_versions(id,service_id,version_no) values('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002',1)");
  await db.query("insert into public.cases(id,case_number,client_id,service_version_id,title) values($1,'QA-1','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','Case')", [caseId]);
  await db.query("insert into public.document_requests(id,case_id,title,required) values($1,$2,'Identity',true)", [request, caseId]);
  const state = async () => (await db.query("select private.document_request_current_state($1) as state", [request])).rows[0].state;
  const addFile = async (version, position, status, suffix) => {
    await db.query(`insert into public.document_files(request_id,version_no,file_position,storage_path,
      original_name,detected_mime_type,size_bytes,status,uploaded_by,reviewed_by,reviewed_at,return_reason)
      values($1,$2,$3,$4,'QA.pdf','application/pdf',100,$5,$6,$7,$8,$9)`,
    [request, version, position, `qa/${suffix}.pdf`, status, client,
      ["accepted", "returned"].includes(status) ? lawyer : null,
      ["accepted", "returned"].includes(status) ? new Date() : null,
      status === "returned" ? "Resubmit" : null]);
  };
  assert.equal(await state(), "missing");
  await addFile(1, 1, "accepted", "v1");
  assert.equal(await state(), "accepted");
  await assert.rejects(db.query(`insert into public.upload_sessions(request_id,uploader_user_id,idempotency_key,expires_at)
    values($1,$2,'new-after-accept',now()+interval '1 hour')`, [request, client]), /must be reviewed or retracted/);
  await addFile(2, 1, "returned", "v2");
  assert.equal(await state(), "returned");
  await db.query(`insert into public.upload_sessions(request_id,uploader_user_id,idempotency_key,expires_at)
    values($1,$2,'new-after-return',now()+interval '1 hour')`, [request, client]);
  const closeSql = "update public.cases set status='closed',result_summary='Done',closed_at=now() where id=$1";
  await assert.rejects(db.query(closeSql, [caseId]), /Latest required document versions/);
  await addFile(3, 1, "accepted", "v3a");
  await addFile(3, 2, "under_review", "v3b");
  assert.equal(await state(), "under_review");
  await assert.rejects(db.query(closeSql, [caseId]), /Latest required document versions/);
  await db.query("update public.document_files set status='accepted',reviewed_by=$1,reviewed_at=now() where request_id=$2 and version_no=3 and file_position=2", [lawyer, request]);
  assert.equal(await state(), "accepted");
  await addFile(4, 1, "accepted", "v4a");
  await addFile(4, 2, "retracted", "v4b");
  assert.equal(await state(), "incomplete");
  await assert.rejects(db.query(closeSql, [caseId]), /Latest required document versions/);
  await addFile(5, 1, "accepted", "v5");
  assert.equal(await state(), "accepted");
  await db.query(closeSql, [caseId]);
  assert.equal((await db.query("select status from public.cases where id=$1", [caseId])).rows[0].status, "closed");
  console.log("OK document versions: latest submission, all pages, resubmission gate and close guard");
} finally {
  await db.close();
}
