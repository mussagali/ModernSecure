# Legal and account deletion extension

Reuse the incumbent visual world: `/delete-account` uses `AuthFrame`, `/deletion-policy` and the public legal documents use `legal-page`, and the primary-admin queue uses `staff-form-panel`. Preserve existing typography, responsive behavior, surfaces, controls, and focus treatments; introduce no design or token changes. Legal sections use semantic `h2` headings.

Operator: user-confirmed ТОО «Современная Защита», БИН 220140025162. Public contacts come from the sourced company record in `content/legal/documents.ru.json`, with public environment overrides; never use private Apple ID/account contacts.

The deletion page explains the manual process, retention exceptions, and expected deadline before the action. Visitors can read the explanation and recover access; authenticated users confirm a request for their own account. The own-only RPC is idempotent for an open request. Show its number, status, deadline, and response truthfully. Submission does not automatically destroy an account or data. The primary-admin queue has pagination and requires a substantive response plus confirmation of actual processing before completion.

Baseline comparison: the extension reuses incumbent components and classes. `AuthFrame` adds a deletion footer link; public legal navigation expands and legal body rendering gains semantic sections. No unrelated visual drift was established by this source review, and none was repaired. `PRODUCT.md`, `DESIGN.md`, and `.impeccable/design.json` remain unchanged.

Evidence and limits: source-review findings for pagination, semantic headings, and successful completion tests are resolved. Live `/privacy` and `/terms` were published through the authenticated admin RPC and verified against the exact source text. The new deletion forms/queue migration is not deployed because database SQL connectivity is unavailable. Browser access to the host was also unavailable: there are no screenshots or visual approval, and rendered review remains pending. Recapture desktop/phone legal pages, deletion form/status/error states, and queue pagination/completion feedback before claiming visual acceptance.
