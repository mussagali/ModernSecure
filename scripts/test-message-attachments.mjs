import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { CANDIDATE_SQL, RECHECK_SQL, MESSAGE_PATH_PATTERN, isMessagePath } from "../lib/message-attachment-cleanup.mjs";

const pg = new PGlite();
const owner = randomUUID();
const outsider = randomUUID();
const caseId = randomUUID();
const hash = "a".repeat(64);
const key = randomUUID();
const attempt = randomUUID();
const fileId = randomUUID();
const file = { id: fileId, path: `messages/${caseId}/${owner}/${attempt}/${fileId}`,
  name: "evidence.pdf", mime: "application/pdf", size: 100, sha256: hash };
const call = "select public.post_case_message_with_attachments($1,$2,$3,$4::jsonb) as result";

async function asUser(user, sql, params = []) {
  await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
  await pg.exec("set role authenticated");
  try { return await pg.query(sql, params); }
  finally { await pg.exec("reset role"); }
}

async function denied(user, body, idempotencyKey, files) {
  await assert.rejects(asUser(user, call, [caseId, body, idempotencyKey, JSON.stringify(files)]));
}

try {
  await pg.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create schema private;
    create schema storage;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to authenticated;
    grant execute on function auth.uid() to authenticated;
    create table public.cases (id uuid primary key, owner_id uuid not null);
    create table public.messages (id uuid primary key default gen_random_uuid(),
      case_id uuid not null, sender_user_id uuid not null, body text not null,
      idempotency_key text not null, unique(case_id,sender_user_id,idempotency_key));
    create table public.message_attachments (id uuid primary key default gen_random_uuid(),
      message_id uuid not null references public.messages(id), storage_path text not null unique,
      original_name text not null, detected_mime_type text,
      size_bytes bigint not null check(size_bytes between 1 and 20971520));
    create table public.staff_message_attachments (storage_path text primary key);
    create table storage.objects (bucket_id text not null, name text not null,
      metadata jsonb, created_at timestamptz not null default now(), primary key(bucket_id,name));
    create function private.can_read_case(p_case_id uuid) returns boolean
      language sql stable security definer set search_path = '' as $$
      select exists(select 1 from public.cases where id = p_case_id and owner_id = auth.uid()) $$;
    create function private.reject_message_change() returns trigger language plpgsql as $$
      begin raise exception 'immutable'; end $$;
    create function public.post_case_message(p_case_id uuid, p_body text, p_idempotency_key text)
      returns uuid language plpgsql security definer set search_path = '' as $$
      declare result uuid;
      begin
        if not private.can_read_case(p_case_id) then raise exception 'Not authorized'; end if;
        insert into public.messages(case_id,sender_user_id,body,idempotency_key)
          values(p_case_id,auth.uid(),btrim(p_body),p_idempotency_key) returning id into result;
        return result;
      end $$;
  `);
  const migration = readFileSync(new URL("../supabase/migrations/20261011004600_message_attachments.sql", import.meta.url), "utf8");
  const legacyMessage = randomUUID();
  const legacyFile = randomUUID();
  await pg.query("insert into public.messages(id,case_id,sender_user_id,body,idempotency_key) values($1,$2,$3,'Legacy',$4)",
    [legacyMessage, caseId, owner, randomUUID()]);
  await pg.query("insert into public.message_attachments(id,message_id,storage_path,original_name,detected_mime_type,size_bytes) values($1,$2,$3,'old.pdf','application/pdf',100)",
    [legacyFile, legacyMessage, `messages/${caseId}/${owner}/${randomUUID()}/${legacyFile}`]);
  await assert.rejects(pg.exec(migration), /Review existing message_attachments/);
  assert.equal((await pg.query("select count(*)::int as n from public.message_attachments")).rows[0].n, 1);
  assert.equal((await pg.query("select count(*)::int as n from information_schema.columns where table_schema='public' and table_name='message_attachments' and column_name='content_sha256'")).rows[0].n, 0);
  await pg.query("delete from public.message_attachments where id=$1", [legacyFile]);
  await pg.exec(migration);
  await pg.query("insert into public.cases values($1,$2)", [caseId, owner]);
  await denied(outsider, "Hello", key, [file]);
  await denied(owner, "Hello", key, [file]);
  await pg.query("insert into storage.objects(bucket_id,name,metadata) values('modernsecure-previews',$1,$2)",
    [file.path, { size: 100, mimetype: "application/pdf" }]);
  await denied(owner, "Hello", key, [file]);
  await pg.query("insert into storage.objects(bucket_id,name,metadata) values('modernsecure-files',$1,$2)",
    [file.path, { size: 99, mimetype: "application/pdf" }]);
  await denied(owner, "Hello", key, [file]);
  await pg.query("update storage.objects set metadata=$2 where bucket_id='modernsecure-files' and name=$1",
    [file.path, { size: 100, mimetype: "application/pdf" }]);
  await denied(owner, "Hello", key, [{ ...file, path: file.path.replace(owner, outsider) }]);
  await denied(owner, "Hello", key, [{ ...file, mime: "text/html" }]);
  await denied(owner, "Hello", key, [{ ...file, name: "../evidence.pdf" }]);
  await denied(owner, "Hello", key, Array(6).fill(file));
  const first = await asUser(owner, call, [caseId, "Hello", key, JSON.stringify([file])]);
  assert.equal(first.rows[0].result.created, true);
  const messageId = first.rows[0].result.id;
  const retryId = randomUUID();
  const retry = await asUser(owner, call, [caseId, "Hello", key,
    JSON.stringify([{ ...file, id: retryId, path: `messages/${caseId}/${owner}/${randomUUID()}/${retryId}` }])]);
  assert.deepEqual(retry.rows[0].result, { id: messageId, created: false });
  await denied(owner, "Changed", key, [file]);
  await denied(owner, "Hello", key, []);
  assert.equal((await pg.query("select count(*)::int as n from public.message_attachments where message_id=$1", [messageId])).rows[0].n, 1);
  await assert.rejects(pg.query("update public.message_attachments set original_name='changed.pdf' where id=$1", [fileId]));
  const absentId = randomUUID();
  await assert.rejects(pg.query(`insert into public.message_attachments
    (id,message_id,storage_path,original_name,detected_mime_type,size_bytes,content_sha256,position)
    values($1,$2,$3,'absent.pdf','application/pdf',100,$4,1)`,
  [absentId, messageId, `messages/${caseId}/${owner}/${randomUUID()}/${absentId}`, hash]));

  // A late attachment insert error must roll the message insert back as well.
  const failedKey = randomUUID();
  await denied(owner, "Atomic", failedKey, [file]);
  assert.equal((await pg.query("select count(*)::int as n from public.messages where idempotency_key=$1", [failedKey])).rows[0].n, 0);

  const oldId = randomUUID();
  const oldOrphan = `messages/${caseId}/${owner}/${randomUUID()}/${oldId}`;
  const recentId = randomUUID();
  const recentOrphan = `messages/${caseId}/${owner}/${randomUUID()}/${recentId}`;
  const malformed = `messages/${caseId}/${owner}/../${randomUUID()}`;
  const staffOrphan = `staff-messages/${caseId}/${owner}/${randomUUID()}/${randomUUID()}`;
  assert(isMessagePath(oldOrphan));
  assert(isMessagePath(staffOrphan));
  assert(!isMessagePath(malformed));
  await pg.query("insert into storage.objects(bucket_id,name,metadata,created_at) values('modernsecure-files',$1,$2,now()-interval '25 hours')",
    [oldOrphan, { size: 100, mimetype: "application/pdf" }]);
  await pg.query("insert into storage.objects(bucket_id,name,metadata,created_at) values('modernsecure-files',$1,$2,now()-interval '25 hours')",
    [staffOrphan, { size: 100, mimetype: "application/pdf" }]);
  await pg.query("insert into storage.objects(bucket_id,name,metadata,created_at) values('modernsecure-files',$1,$2,now()-interval '25 hours')",
    [malformed, { size: 100, mimetype: "application/pdf" }]);
  await pg.query("insert into storage.objects(bucket_id,name,metadata) values('modernsecure-files',$1,$2)",
    [recentOrphan, { size: 100, mimetype: "application/pdf" }]);
  await pg.query("update storage.objects set created_at=now()-interval '25 hours' where bucket_id='modernsecure-files' and name=$1", [file.path]);
  const candidates = await pg.query(CANDIDATE_SQL, ["modernsecure-files", MESSAGE_PATH_PATTERN]);
  assert.deepEqual(candidates.rows.map((row) => row.name).sort(), [oldOrphan, staffOrphan].sort());
  const orphanMessage = randomUUID();
  await pg.query("insert into public.messages(id,case_id,sender_user_id,body,idempotency_key) values($1,$2,$3,'Cleanup',$4)",
    [orphanMessage, caseId, owner, randomUUID()]);
  await pg.query(`insert into public.message_attachments
    (id,message_id,storage_path,original_name,detected_mime_type,size_bytes,content_sha256,position)
    values($1,$2,$3,'aged.pdf','application/pdf',100,$4,0)`, [oldId, orphanMessage, oldOrphan, hash]);
  assert.equal((await pg.query(RECHECK_SQL, ["modernsecure-files", oldOrphan, MESSAGE_PATH_PATTERN])).rows.length, 0);
  await pg.query("insert into public.staff_message_attachments(storage_path) values($1)", [staffOrphan]);
  assert.equal((await pg.query(RECHECK_SQL, ["modernsecure-files", staffOrphan, MESSAGE_PATH_PATTERN])).rows.length, 0);
  console.log("Message attachments: preflight, ACL, validation, retry, rollback and aged-orphan selection passed");
} finally {
  await pg.close();
}
