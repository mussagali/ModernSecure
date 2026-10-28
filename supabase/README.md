# ModernSecure database

The ordered files in `migrations/` define the current schema, role-scoped RLS, private Storage buckets, and audited workflows for clients, cases, staff, documents, chats, tasks, payments and notifications. Keep them in order; do not edit a migration already applied to the project.

Applied to Supabase project `bdkrihsiprkmukyjyspv` (Seoul, `ap-northeast-2`). On 2026-10-16, all 83 migrations were applied and `npm run db:verify` reported 37 RLS-enabled tables, 74 RLS policies, two private buckets, 82 workflow functions and 18 workflow triggers. The web app uses Supabase Auth and live case/file data. On 2026-10-17 the owner explicitly requested a reset of this connected project. Migration `084` adds a protected primary-administrator flag; the reset removes prior users, business data and stored files, then creates five new accounts and one linked client card. Runtime schemas, RLS and private buckets remain in place. By the owner's explicit handoff request, current application/database credentials and the five prepared accounts are also stored under `handoff/` in the private repository. `npm run setup:local` copies them to Git-ignored local files with mode 600 on Unix. The original owner's `.workspace-accounts.local.json` additionally records a local backup path; that machine-specific path and the old-data backup are not part of the handoff. See the root README for recipient setup.

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

## Audit fixes, 2026-10-16

Migrations `078`–`082` add payment deadline reminders, reasoned task/document-request closure, conflict checks for contact and FAQ edits, versioned client consents, and document-upload tasks linked to document review. Deadlines entered in the staff forms use explicit Almaty time (UTC+5); existing saved timestamps are not rewritten. `npm run db:cron-status` checks both hourly reminder jobs. Payment reminders account for confirmed partial payments and deduplicate repeated runs.

The owner subsequently requested password-only access. Migration `083` disables mandatory MFA for existing staff and sets it off by default for new staff. An employee can still opt in by confirming an authenticator at `/staff-security`; a verified factor continues to require MFA. Unfinished enrollment does not block password login. Missing assurance claims fail the check when MFA is required. QA tests use temporary factors only on the named QA accounts and remove them afterward; they never enroll an authenticator for a real employee.

The administrator can publish approved terms, personal-data consent and optional marketing consent at `/staff/settings/legal`. No legal text is seeded: the owner has no approved texts yet. Publishing a mandatory version requires clients to accept it on opening the cabinet, with its version and hash recorded. This is a cabinet UI gate, not a global API consent restriction. Marketing withdrawal and legal review remain separate work.

Bank/payment instructions can be configured in staff settings. The client cabinet now places required actions first, displays deadline times, and uses larger controls and responsive navigation. An expired session returns to the requested account page after ordinary password login.

## Verification

- `npm test`: local test scripts, including migration/workflow tests against PGlite.
- `node scripts/test-primary-admin-live.mjs`: hierarchy and escalation checks against the connected database, all inside a rolled-back transaction.
- `npm run test:live`: historical scripts against the running app and connected Supabase. Their old QA users and case fixtures were removed by the requested reset, so the full suite requires deliberately provisioning new fixtures; `TEST_BASE_URL` defaults to `http://localhost:3000`. These scripts exercise shared QA records and must run sequentially.
- `npm run build` and `npm run lint`: application build and static checks.
- `npm run db:verify`, `npm run db:role-smoke`, `npm run db:document-smoke`, `npm run db:finance-smoke`, and `npm run db:cron-status`: schema, authorization, document/payment workflows and reminder jobs. The three smoke workflows roll back their test transactions.

All checks above passed on 2026-10-16. Both reminder jobs had successful executions. Desktop and 360 px mobile previews were checked in Chrome; this is not real-device WebView acceptance. The web changes were tested locally and were not publicly deployed.

## Release work still open

The database and web workflows are not sufficient proof of release readiness. Complete the scenario-by-scenario web acceptance, approved legal texts, corporate SMTP and email recovery, Storage orphan-cleanup schedule, monitoring, backup/restore drill and load testing. MFA is optional by the owner's subsequent request; authenticator enrollment is needed only when opting in. Android WebView and iOS WKWebView require separate real-device acceptance, including camera/gallery and file preview. Configurable stage transitions and stage deadlines, notification-template editing, configurable upload limits, sample document templates, a separate archive, full localization, client time-zone settings and password-recovery return routing remain outside these fixes. Do not infer that `db:verify` covers these features or runtime checks. Corporate SMTP remains deferred until the company mailbox is available; do not disable email confirmation in the meantime.

The operator-only `scripts/reset-workspace.mjs` defaults to no mutation and supports `--plan`. Applying requires `--apply` plus the exact project ID, checks the table inventory, backs up private data/files locally, and refuses to run again when the saved reset state exists. It is never run by the application or migrations.
