import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// Match PostgREST's lossless timestamp strings when testing microsecond cursors.
const pg = new PGlite({ parsers: { 1184: value => value } });
const migration = (name) => readFileSync(`supabase/migrations/${name}`, "utf8");
async function asUser(id, sql, params = []) {
  await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  await pg.exec("set role authenticated");
  try { return await pg.query(sql, params); }
  finally { await pg.exec("reset role"); }
}

const client = "00000000-0000-4000-8000-000000000001";
const lawyer = "00000000-0000-4000-8000-000000000002";
const manager = "00000000-0000-4000-8000-000000000003";
const other = "00000000-0000-4000-8000-000000000004";
const key = "10000000-0000-4000-8000-000000000001";

try {
  await pg.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth, public to authenticated;
    grant execute on function auth.uid() to authenticated;
    create schema storage;
    create table storage.buckets (id text primary key, name text not null, public boolean not null, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (bucket_id text not null, name text not null, metadata jsonb, user_metadata jsonb, primary key (bucket_id, name));
  `);
  await pg.exec(migration("20261010000100_core_schema.sql"));
  await pg.exec(migration("20261010000200_access_policies.sql"));
  for (const [id, email] of [[client, "client@example.test"], [lawyer, "lawyer@example.test"], [manager, "manager@example.test"], [other, "other@example.test"]]) {
    await pg.query("insert into auth.users (id,email,email_confirmed_at) values ($1,$2,now())", [id, email]);
  }
  await pg.query("insert into public.staff_members (user_id,display_name,role) values ($1,'Lawyer','lawyer'),($2,'Manager','manager'),($3,'Other','lawyer')", [lawyer, manager, other]);
  await pg.exec(migration("20261011005400_staff_direct_messages.sql"));
  await pg.exec(migration("20261011005500_staff_chat_hardening.sql"));
  await pg.exec(migration("20261011005600_staff_chat_paging.sql"));
  await pg.exec(migration("20261011005700_staff_chat_sidebar.sql"));
  await pg.exec(migration("20261011005800_staff_chat_attachments.sql"));
  await pg.exec(`create function private.staff_mfa_passed() returns boolean
    language sql stable as $$ select true $$`);
  await pg.exec(migration("20261012007100_staff_case_message_links.sql"));
  const caseId = "30000000-0000-4000-8000-000000000001";
  const serviceId = "30000000-0000-4000-8000-000000000002";
  const versionId = "30000000-0000-4000-8000-000000000003";
  const clientId = "30000000-0000-4000-8000-000000000004";
  await pg.query("insert into public.clients(id,full_name) values($1,'Case client')", [clientId]);
  await pg.query("insert into public.service_templates(id,code,name) values($1,'QA','QA service')", [serviceId]);
  await pg.query("insert into public.service_template_versions(id,service_id,version_no) values($1,$2,1)", [versionId, serviceId]);
  await pg.query("insert into public.cases(id,case_number,client_id,service_version_id,title) values($1,'QA-1',$2,$3,'Private case')", [caseId, clientId, versionId]);
  await pg.query("insert into public.case_assignments(case_id,staff_user_id) values($1,$2),($1,$3)", [caseId, lawyer, manager]);

  await assert.rejects(asUser(client, "select * from public.staff_directory()"), /Not authorized/);
  await assert.rejects(asUser(client, "select * from public.staff_chat_sidebar()"), /Not authorized/);
  await assert.rejects(asUser(client, "select public.staff_open_thread($1)", [lawyer]), /Not authorized/);
  const directory = await asUser(lawyer, "select user_id from public.staff_directory()");
  assert.deepEqual(directory.rows.map((row) => row.user_id), [manager, other]);
  const thread = (await asUser(lawyer, "select public.staff_open_thread($1) as id", [manager])).rows[0].id;
  assert.equal((await asUser(lawyer, "select public.staff_can_reference_case($1,$2) as allowed", [thread, caseId])).rows[0].allowed, true);
  const caseKey = "30000000-0000-4000-8000-000000000005";
  const caseMessage = (await asUser(lawyer, "select public.staff_send_case_message($1,$2,$3,$4) as id", [thread, "About this case", caseKey, caseId])).rows[0].id;
  assert.equal((await asUser(manager, "select case_id from public.staff_message_case_refs where message_id=$1", [caseMessage])).rows[0].case_id, caseId);
  assert.equal((await asUser(client, "select * from public.staff_message_case_refs")).rowCount, 0);
  assert.equal((await asUser(other, "select * from public.staff_message_case_refs")).rowCount, 0);
  assert.equal((await asUser(lawyer, "select public.staff_send_case_message($1,$2,$3,$4) as id", [thread, "About this case", caseKey, caseId])).rows[0].id, caseMessage);
  await assert.rejects(asUser(lawyer, "select public.staff_send_case_message($1,$2,$3,$4)", [thread, "changed", caseKey, caseId]), /Message retry conflict/);
  await assert.rejects(asUser(other, "select public.staff_send_case_message($1,$2,$3,$4)", [thread, "Intrusion", key, caseId]), /Case link unavailable/);
  await assert.rejects(asUser(client, "select public.staff_send_case_message($1,$2,$3,$4)", [thread, "Intrusion", key, caseId]), /Case link unavailable/);
  assert.equal((await asUser(manager, "select public.staff_open_thread($1) as id", [lawyer])).rows[0].id, thread);
  assert.equal((await asUser(other, "select * from public.staff_threads")).rowCount, 0);
  assert.equal((await asUser(client, "select * from public.staff_threads")).rowCount, 0);
  await assert.rejects(asUser(other, "select public.staff_send_message($1,$2,$3)", [thread, "Intrusion", key]), /Not authorized/);
  await assert.rejects(asUser(lawyer, "insert into public.staff_messages (thread_id,sender_user_id,body,idempotency_key) values ($1,$2,$3,$4)", [thread, lawyer, "Direct write", key]), /permission denied/);
  const message = (await asUser(lawyer, "select public.staff_send_message($1,$2,$3) as id", [thread, "  Hello team  ", key])).rows[0].id;
  await assert.rejects(asUser(lawyer, "select public.staff_send_case_message($1,$2,$3,$4)", [thread, "Hello team", key, caseId]), /key cannot be reused/);
  assert.equal((await asUser(lawyer, "select public.staff_send_message($1,$2,$3) as id", [thread, "  Hello team  ", key])).rows[0].id, message);
  await assert.rejects(asUser(lawyer, "select public.staff_send_message($1,$2,$3)", [thread, "Changed body", key]), /Message retry conflict/);
  assert.equal((await asUser(manager, "select body from public.staff_messages where id=$1", [message])).rows[0].body, "Hello team");
  assert.equal((await asUser(other, "select * from public.staff_messages")).rowCount, 0);
  assert.equal((await asUser(client, "select * from public.staff_messages")).rowCount, 0);
  const managerSummary = (await asUser(manager, "select * from public.staff_chat_sidebar() where user_id=$1", [lawyer])).rows[0];
  assert.equal(managerSummary.thread_id, thread);
  assert.equal(managerSummary.last_message_body, "Hello team");
  assert.equal(Number(managerSummary.unread_count), 2);
  assert.equal((await pg.query("select count(*)::int as n from public.staff_messages")).rows[0].n, 2);
  const page = await asUser(manager, "select * from public.staff_message_page($1,null,null,2)", [thread]);
  assert.equal(page.rowCount, 2);
  assert.equal(page.rows[0].id, message);
  const cursor = page.rows[0];
  assert.equal((await asUser(manager, "select * from public.staff_message_page($1,$2,$3,2)", [thread, cursor.created_at, cursor.id])).rows[0].id, caseMessage);
  await assert.rejects(asUser(other, "select * from public.staff_message_page($1,null,null,2)", [thread]), /Not authorized/);
  await assert.rejects(asUser(client, "select * from public.staff_message_page($1,null,null,2)", [thread]), /Not authorized/);
  await assert.rejects(asUser(manager, "select * from public.staff_message_page($1,now(),null,2)", [thread]), /invalid page/);
  const audit = await pg.query("select after_data, body from (select after_data, after_data::text as body from public.audit_events where entity_type='staff_message') a");
  assert.equal(audit.rowCount, 2);
  assert(!audit.rows[0].body.includes("Hello team"));
  await asUser(manager, "select public.staff_mark_thread_read($1)", [thread]);
  await pg.exec(migration("20261012007500_staff_read_cursor.sql"));
  await pg.exec(migration("20261028009400_staff_message_append_order.sql"));
  assert.equal((await asUser(manager, "select last_read_message_id from public.staff_thread_reads where thread_id=$1", [thread])).rows[0].last_read_message_id, message,
    "Existing read timestamp must migrate to the last already-read message");
  assert.equal(Number((await asUser(manager, "select unread_count from public.staff_chat_sidebar() where user_id=$1", [lawyer])).rows[0].unread_count), 0);
  assert.equal((await asUser(manager, "select * from public.staff_thread_reads where thread_id=$1", [thread])).rowCount, 1);
  assert.equal((await asUser(lawyer, "select * from public.staff_thread_reads where thread_id=$1", [thread])).rowCount, 0);
  await assert.rejects(asUser(client, "select public.staff_mark_thread_read($1,$2)", [thread, message]), /Not authorized/);
  // Pin the same transaction timestamp and descending UUIDs to reproduce the
  // real same-clock race deterministically, without relying on machine speed.
  await pg.exec("begin; alter table public.staff_messages alter column id set default 'f0000000-0000-4000-8000-000000000002'::uuid");
  const secondId = (await asUser(manager, "select public.staff_send_message($1,$2,$3) as id", [thread, "Second", "10000000-0000-4000-8000-000000000002"])).rows[0].id;
  await pg.exec("alter table public.staff_messages alter column id set default '10000000-0000-4000-8000-000000000003'::uuid");
  const thirdId = (await asUser(lawyer, "select public.staff_send_message($1,$2,$3) as id", [thread, "Third", "10000000-0000-4000-8000-000000000003"])).rows[0].id;
  await pg.exec("alter table public.staff_messages alter column id set default gen_random_uuid(); commit");
  const chronology = await pg.query("select id, body, created_at::text from public.staff_messages where id in ($1,$2) order by created_at,id", [secondId, thirdId]);
  assert.deepEqual(chronology.rows.map(row => row.id), [secondId, thirdId], "Append order must not depend on random UUID order");
  await asUser(manager, "select public.staff_mark_thread_read($1,$2)", [thread, secondId]);
  assert.equal(Number((await asUser(manager, "select unread_count from public.staff_chat_sidebar() where user_id=$1", [lawyer])).rows[0].unread_count), 1,
    `A message arriving after the rendered cursor must remain unread: ${JSON.stringify(chronology.rows)}`);
  assert.equal((await asUser(manager, "select read_at from public.notifications where dedupe_key=$1", [`staff-message:${thirdId}`])).rows[0].read_at, null,
    "An unseen message notification must remain unread");
  await asUser(manager, "select public.staff_mark_thread_read($1,$2)", [thread, thirdId]);
  assert.equal(Number((await asUser(manager, "select unread_count from public.staff_chat_sidebar() where user_id=$1", [lawyer])).rows[0].unread_count), 0);
  await asUser(manager, "select public.staff_mark_thread_read($1,$2)", [thread, caseMessage]);
  assert.equal((await asUser(manager, "select last_read_message_id from public.staff_thread_reads where thread_id=$1", [thread])).rows[0].last_read_message_id, thirdId,
    "An older read request must not move the cursor backwards");
  await assert.rejects(asUser(manager, "select public.staff_mark_thread_read($1,$2)", [thread, "40000000-0000-4000-8000-000000000099"]),
    /Message is not in this thread/);
  const latest = await asUser(manager, "select * from public.staff_message_page($1,null,null,2)", [thread]);
  assert.equal(latest.rowCount, 2);
  const older = await asUser(manager, "select * from public.staff_message_page($1,$2,$3,2)", [thread, latest.rows[1].created_at, latest.rows[1].id]);
  assert.deepEqual(older.rows.map((row) => row.id), [message, caseMessage]);
  await pg.query(`insert into public.staff_messages
    (thread_id, sender_user_id, body, idempotency_key, created_at)
    select $1, $2, 'History ' || n, gen_random_uuid(), now() - interval '2 days' + n * interval '1 second'
      from generate_series(1, 205) as g(n)`, [thread, lawyer]);
  const allIds = new Set();
  let beforeAt = null;
  let beforeId = null;
  let pageNo = 0;
  do {
    const rows = (await asUser(manager, "select * from public.staff_message_page($1,$2,$3,101)", [thread, beforeAt, beforeId])).rows;
    assert(rows.length > 0);
    const visible = rows.slice(0, 100);
    for (const row of visible) {
      assert(!allIds.has(row.id), "History page repeated a message");
      allIds.add(row.id);
    }
    pageNo += 1;
    if (pageNo === 1) {
      await pg.query(`insert into public.staff_messages
        (thread_id, sender_user_id, body, idempotency_key, created_at)
        values ($1,$2,'New after page one',gen_random_uuid(),now() + interval '1 second')`, [thread, lawyer]);
    }
    if (rows.length <= 100) break;
    beforeAt = visible.at(-1).created_at;
    beforeId = visible.at(-1).id;
  } while (pageNo < 10);
  assert.equal(allIds.size, 209);
  assert.equal(pageNo, 3);
  const attachmentId = "20000000-0000-4000-8000-000000000001";
  const attachmentKey = "20000000-0000-4000-8000-000000000002";
  const attempt = "20000000-0000-4000-8000-000000000003";
  const path = `staff-messages/${thread}/${lawyer}/${attempt}/${attachmentId}`;
  const file = { id: attachmentId, path, name: "QA.pdf", mime: "application/pdf", size: 100, sha256: "a".repeat(64) };
  await pg.query("insert into storage.objects(bucket_id,name,metadata) values('modernsecure-files',$1,$2)",
    [path, { size: 100, mimetype: "application/pdf" }]);
  const fileCall = "select public.staff_send_message_with_attachments($1,$2,$3,$4::jsonb) as result";
  const attached = await asUser(lawyer, fileCall, [thread, "Вложение", attachmentKey, JSON.stringify([file])]);
  assert.equal(attached.rows[0].result.created, true);
  const attachedMessageId = attached.rows[0].result.id;
  await assert.rejects(asUser(lawyer,
    "select public.staff_send_case_message_with_attachments($1,$2,$3,$4::jsonb,$5)",
    [thread, "Вложение", attachmentKey, JSON.stringify([file]), caseId]), /key cannot be reused/);
  assert.equal((await asUser(manager, "select * from public.staff_message_attachments where message_id=$1", [attachedMessageId])).rowCount, 1);
  assert.equal((await asUser(client, "select * from public.staff_message_attachments")).rowCount, 0);
  assert.equal((await asUser(other, "select * from public.staff_message_attachments")).rowCount, 0);
  const retried = await asUser(lawyer, fileCall, [thread, "Вложение", attachmentKey, JSON.stringify([file])]);
  assert.deepEqual(retried.rows[0].result, { id: attachedMessageId, created: false });
  assert.equal((await pg.query("select t.last_message_at = m.created_at as same from public.staff_threads t join public.staff_messages m on m.id=$2 where t.id=$1", [thread, attachedMessageId])).rows[0].same, true,
    "Attachment sends and retry preserve the same persisted thread/message timestamp");
  await asUser(manager, "select public.staff_mark_thread_read($1,$2)", [thread, attachedMessageId]);
  assert.equal(Number((await asUser(manager, "select unread_count from public.staff_chat_sidebar() where user_id=$1", [lawyer])).rows[0].unread_count), 0);
  const caseFileKey = "30000000-0000-4000-8000-000000000007";
  const caseFile = { ...file, id: "30000000-0000-4000-8000-000000000008",
    path: `staff-messages/${thread}/${lawyer}/${caseFileKey}/30000000-0000-4000-8000-000000000008` };
  await pg.query("insert into storage.objects(bucket_id,name,metadata) values('modernsecure-files',$1,$2)",
    [caseFile.path, { size: 100, mimetype: "application/pdf" }]);
  const caseFileCall = "select public.staff_send_case_message_with_attachments($1,$2,$3,$4::jsonb,$5) as result";
  const caseAttached = await asUser(lawyer, caseFileCall,
    [thread, "Case file", caseFileKey, JSON.stringify([caseFile]), caseId]);
  assert.equal(caseAttached.rows[0].result.created, true);
  assert.equal((await asUser(manager, "select case_id from public.staff_message_case_refs where message_id=$1",
    [caseAttached.rows[0].result.id])).rows[0].case_id, caseId);
  assert.deepEqual((await asUser(lawyer, caseFileCall,
    [thread, "Case file", caseFileKey, JSON.stringify([caseFile]), caseId])).rows[0].result,
  { id: caseAttached.rows[0].result.id, created: false });
  assert.equal(Number((await asUser(manager, "select unread_count from public.staff_chat_sidebar() where user_id=$1", [lawyer])).rows[0].unread_count), 1,
    "A case-reference attachment after the rendered attachment cursor remains unread, including on retry");
  await assert.rejects(asUser(lawyer, fileCall, [thread, "Вложение", attachmentKey,
    JSON.stringify([{ ...file, sha256: "b".repeat(64) }])]), /key cannot be reused/);
  await assert.rejects(pg.query("update public.staff_message_attachments set original_name='changed.pdf' where id=$1", [attachmentId]), /immutable/);
  await assert.rejects(pg.query("update public.staff_messages set body='Changed' where id=$1", [attachedMessageId]), /immutable/);
  await pg.query("update public.case_assignments set revoked_at=now() where case_id=$1 and staff_user_id=$2", [caseId, manager]);
  assert.equal((await asUser(manager, "select * from public.staff_message_case_refs")).rowCount, 0);
  assert.equal((await asUser(lawyer, "select public.staff_can_reference_case($1,$2) as allowed", [thread, caseId])).rows[0].allowed, false);
  await assert.rejects(asUser(lawyer, "select public.staff_send_case_message($1,$2,$3,$4)",
    [thread, "After case revoke", "30000000-0000-4000-8000-000000000006", caseId]), /Case link unavailable/);
  const tiedThread = (await asUser(lawyer, "select public.staff_open_thread($1) as id", [other])).rows[0].id;
  const tiedFirst = "40000000-0000-4000-8000-000000000001";
  const tiedSecond = "40000000-0000-4000-8000-000000000002";
  await pg.query(`insert into public.staff_messages(id,thread_id,sender_user_id,body,idempotency_key,created_at)
    values ($1,$3,$4,'First',gen_random_uuid(),'2026-10-11T00:00:00Z'),
      ($2,$3,$4,'Second',gen_random_uuid(),'2026-10-11T00:00:00Z')`,
  [tiedFirst, tiedSecond, tiedThread, lawyer]);
  await asUser(other, "select public.staff_mark_thread_read($1,$2)", [tiedThread, tiedFirst]);
  assert.equal(Number((await asUser(other, "select unread_count from public.staff_chat_sidebar() where user_id=$1", [lawyer])).rows[0].unread_count), 1,
    "Messages with the same timestamp must use their ID as the cursor tie-breaker");
  await asUser(other, "select public.staff_mark_thread_read($1,$2)", [tiedThread, tiedSecond]);
  assert.equal(Number((await asUser(other, "select unread_count from public.staff_chat_sidebar() where user_id=$1", [lawyer])).rows[0].unread_count), 0);
  await pg.query("update public.staff_members set active=false where user_id=$1", [manager]);
  assert.equal((await asUser(manager, "select * from public.staff_messages where thread_id=$1", [thread])).rowCount, 0);
  assert((await asUser(lawyer, "select user_id from public.staff_directory()")).rows.some((row) => row.user_id === manager));
  assert(!(await asUser(other, "select user_id from public.staff_directory()")).rows.some((row) => row.user_id === manager));
  assert((await asUser(lawyer, "select user_id from public.staff_chat_sidebar()")).rows.some((row) => row.user_id === manager));
  assert(!(await asUser(other, "select user_id from public.staff_chat_sidebar()")).rows.some((row) => row.user_id === manager));
  await assert.rejects(asUser(lawyer, "select public.staff_send_message($1,$2,$3)", [thread, "After revoke", "10000000-0000-4000-8000-000000000002"]), /Recipient inactive/);
  console.log("OK staff directory, private threads, RLS, retry, notifications, audit, read state and revocation");
} finally {
  await pg.close();
}
