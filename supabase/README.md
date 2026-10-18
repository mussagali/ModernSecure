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

Message uploads use the private `modernsecure-files` bucket. If an upload or database commit fails, only the aged orphan sweeper may remove unreferenced attempt paths; ambiguous commits must not trigger eager deletion. A Storage deletion or database lookup can also fail, so run `npm run messages:cleanup` to inspect aged orphans and `npm run messages:cleanup -- --apply` to delete eligible objects in batches of at most 100. The command requires the restricted local database and Storage credentials. It only considers exact `messages/<case>/<user>/<attempt>/<file>` paths older than 24 hours, rechecks that no attachment row refers to each object, and shares a path lock with the insertion guard. Schedule or repeat this command operationally; it was not run against the live project as part of this change.

- Registration creates a private `profiles` row. Migration `085` exposes unlinked non-staff accounts through the admin-only `admin_client_registrations` queue, including historical accounts and unconfirmed emails. `admin_approve_client_registration` creates and links a new card atomically, without requiring IIN or email confirmation. Auth still requires email confirmation to sign in. Existing cards require the separate verified-email linking workflow; matching an email alone never grants case access. Active staff invitations are excluded from the queue.
- `complete_own_client_identity` accepts optional 12-digit IIN before approval or later when the approved card has no IIN. Once an approved card has IIN, self-service identity changes are closed. Contact changes sync to the linked card. Full IIN is omitted from queue responses and audit payloads. `node scripts/test-client-registration.mjs` covers the workflow locally; `node scripts/test-client-registration-live.mjs` checks the connected database inside a rolled-back transaction.
- Browser users read only data allowed by RLS and perform audited writes through role-scoped RPCs or server routes. A confirmed email alone does not grant case access. Staff assignments and finance permissions are checked separately.
- `modernsecure-files` and `modernsecure-previews` are private buckets with no broad browser-access Storage policy. Authorized file routes validate access and integrity before serving bytes; HEIC/HEIF preview is converted to JPEG while the original stays unchanged. The owner declined a separate malware scanner, so type/size/signature checks must not be described as antivirus protection. Existing broad Storage policies in a reused project must be reviewed.
- Accepted document versions, messages and audit rows are protected against direct update/delete by triggers. Operational archiving/retention needs a separately reviewed procedure.
- The user clarified that the Kazakhstan residency line in the original brief was an error; this project has no regional hosting restriction. Before real customer data is added, review retention, backups, access, and personal-data processing requirements.

## Audit fixes, 2026-10-16

Migrations `078`–`082` add payment deadline reminders, reasoned task/document-request closure, conflict checks for contact and FAQ edits, versioned client consents, and document-upload tasks linked to document review. Deadlines entered in the staff forms use explicit Almaty time (UTC+5); existing saved timestamps are not rewritten. `npm run db:cron-status` checks both hourly reminder jobs. Payment reminders account for confirmed partial payments and deduplicate repeated runs.

The owner subsequently requested password-only access. Migration `083` disables mandatory MFA for existing staff and sets it off by default for new staff. An employee can still opt in by confirming an authenticator at `/staff-security`; a verified factor continues to require MFA. Unfinished enrollment does not block password login. Missing assurance claims fail the check when MFA is required. QA tests use temporary factors only on the named QA accounts and remove them afterward; they never enroll an authenticator for a real employee.

The administrator can publish approved terms, personal-data consent and optional marketing consent at `/staff/settings/legal`. No legal text is seeded: the owner has no approved texts yet. Publishing a mandatory version requires clients to accept it on opening the cabinet, with its version and hash recorded. This is a cabinet UI gate, not a global API consent restriction. Marketing withdrawal and legal review remain separate work.

Bank/payment instructions can be configured in staff settings. The client cabinet now places required actions first, displays deadline times, and uses larger controls and responsive navigation. An expired session returns to the requested account page after ordinary password login.

## Workflow corrections, 2026-10-18

Migrations `086`-`088` add staff identity correction with reason/version checks, field-specific contact synchronization and contact seeding when an existing card is linked. Required document templates may be waived with `not_required` and a reason; cancelling a mistaken request still does not satisfy a required template. Both the close RPC and row trigger check the latest complete document version.

Payments remain unique bank transactions. `payment_allocations` distributes one transaction across active installments in due-date order, retaining reference/receipt uniqueness and idempotency. Financial operations remain available when legal work is closed or suspended. Cancelled schedule entries retain original amounts and historical allocations but no longer create debt or reminders. New/edited schedules cannot exceed the latest contract price minus confirmed money. To revise obligations, cancel superseded outstanding entries with a reason, then add replacement terms. Uploading another contract alone does not silently waive existing obligations.

The client next-actions list includes payment obligations and pending receipt review. Pending or accepted-but-unlinked receipts suppress payment reminders until verification is resolved. Company contacts and bank details remain empty by the owner's instruction; administrators can maintain them under `/staff/settings#contacts`, with an incomplete-settings notice. No sample payment details are seeded.

File forms use authorized upload tickets and a separate private staging bucket. Tickets are bound to the user, endpoint and case/thread/document context, expire in two hours and are limited to 100 per account per day. Signed URLs cannot overwrite existing staged objects. The final route rechecks authorization and actual bytes before copying to permanent storage; client-supplied hashes or metadata do not establish trust. Downloads stream only after integrity verification and audit. `npm run staging:cleanup -- --apply` removes temporary copies older than 24h, after all signed upload capabilities have expired; schedule it operationally. This does not remove permanent documents.

Focused regressions: `test-workflow-corrections.mjs` and `test-workflow-corrections-live.mjs` share scenarios; the live version rolls back all data. `test-staged-uploads.mjs` covers 20MB transfer/stream integrity and ticket scope. `test-staged-storage-live.mjs` checks actual 20MB Storage uploads and cleans its temporary object. `test-financial-flow-live.mjs` runs the local HTTP/Storage/DB chain using an isolated, clearly labelled test case and removes only its own fixtures afterward.

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
