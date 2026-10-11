# ModernSecure database

The ordered files in `migrations/` define the current schema, role-scoped RLS, private Storage buckets, and audited workflows for clients, cases, staff, documents, chats, tasks, payments and notifications. Keep them in order; do not edit a migration already applied to the project.

Applied to Supabase project `bdkrihsiprkmukyjyspv` (Seoul, `ap-northeast-2`). On 2026-10-12, `npm run db:verify` reported 35 RLS-enabled tables, 70 RLS policies, two private buckets, 69 workflow functions and 12 workflow triggers. The web app uses Supabase Auth and live case/file data. The project contains explicitly marked QA records; never treat it as an empty database.

## Before applying

1. Put the full database URL in `.env.db.local` as `DATABASE_URL=...`. Never put the password in chat, source code or a `NEXT_PUBLIC_` variable. The file is ignored by Git.
2. Verify the target project and region in the Supabase Dashboard. These migrations assume a new/empty project; inspect existing `public` tables and Storage policies before applying to anything else.
3. Use `npm run db:inspect`, `npm run db:plan`, `npm run db:apply`, then `npm run db:verify`. The local script verifies the target, uses the official Supabase root CA from `certs/`, and prevents reapplying to an existing ModernSecure schema. Never run `db reset --linked` against a project with data.
4. Configure Supabase Auth email/password + email confirmation, production SMTP, redirect URLs and staff MFA in the project settings. SQL alone does not configure these services.
5. For subsequent migrations on this existing project, run `npm run db:migrate`. It checks the baseline, prints the CLI dry run, applies pending migrations and verifies the baseline again.

## Security model

### Message attachment recovery

Message uploads use the private `modernsecure-files` bucket. If an upload or database commit fails, the request route removes its unreferenced attempt paths. A Storage deletion or database lookup can also fail, so run `npm run messages:cleanup` to inspect aged orphans and `npm run messages:cleanup -- --apply` to delete eligible objects in batches of at most 100. The command requires the restricted local database and Storage credentials. It only considers exact `messages/<case>/<user>/<attempt>/<file>` paths older than 24 hours, rechecks that no attachment row refers to each object, and shares a path lock with the insertion guard. Schedule or repeat this command operationally; it was not run against the live project as part of this change.

- Registration creates only a `profiles` row. A staff-controlled server operation must link `clients.user_id` to a verified account before any case becomes visible. Matching an email does not grant case access.
- Browser users read only data allowed by RLS and perform audited writes through role-scoped RPCs or server routes. A confirmed email alone does not grant case access. Staff assignments and finance permissions are checked separately.
- `modernsecure-files` and `modernsecure-previews` are private buckets with no broad browser-access Storage policy. Authorized file routes validate access and integrity before serving bytes; HEIC/HEIF preview is converted to JPEG while the original stays unchanged. The owner declined a separate malware scanner, so type/size/signature checks must not be described as antivirus protection. Existing broad Storage policies in a reused project must be reviewed.
- Accepted document versions, messages and audit rows are protected against direct update/delete by triggers. Operational archiving/retention needs a separately reviewed procedure.
- The user clarified that the Kazakhstan residency line in the original brief was an error; this project has no regional hosting restriction. Before real customer data is added, review retention, backups, access, and personal-data processing requirements.

## Release work still open

The database and web workflows are not sufficient proof of release readiness. Complete the scenario-by-scenario web acceptance, corporate SMTP and email recovery, staff MFA rollout, Storage orphan-cleanup schedule, monitoring, backup/restore drill and load testing. Android WebView and iOS WKWebView require separate real-device acceptance, including camera/gallery and file preview. See the current readiness report in the work plan outputs; do not infer that `db:verify` covers these runtime checks. Corporate SMTP remains deferred until the company mailbox is available; do not disable email confirmation in the meantime.
