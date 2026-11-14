---
version: 1
slug: "app-layout-tsx"
primary_target: "app/layout.tsx"
related_targets: ["app/account", "components/ClientShell.tsx", "components/ReferenceCaseView.tsx", "components/PortalShared.tsx", "app/reference-design.css", "app/staff", "components/StaffReferenceShell.tsx", "app/staff-reference.css", "app/login", "components/AuthFrame.tsx", "components/AuthForm.tsx", "app/auth-reference.css", "app/workspace-design.css"]
---

# Role-separated casework portal, 14 November 2026

The user’s correction retains `sovz-lk.ru` styling while restoring the product scope in `Sovremennaya_Zashchita_AI_Agent_Spec.md`. Client `/account` and staff `/staff` remain separate under existing role guards. Cabinet mode switches, ads, and promotional photo rails are excluded everywhere. The preview entry point remains `http://localhost:3000/staff/overview`.

## Direction contract

THESIS: Role-separated casework without marketing, using the existing reference visual language.

OWN-WORLD: Garet Book; light gray canvas and navigation; white rounded panels; purple accents; charcoal primary actions; original logo and icon geometry. Shared reference tokens in `DESIGN.md` retain their historical `client-` prefix; staff-specific variants use `staff-`. Authentication extends this world with white canvas, Garet, the existing turquoise logo, gray icon fields, a softly shadowed borderless card, and purple outlined submit actions.

STORY: Home leads to the client’s actual case, tasks, documents, chat, contracts, manual payments, and receipts. Notifications, profile, contacts, and help support that work. Staff retain existing role menus, search, and permitted actions. Amounts use ₸ and actual records.

FIRST VIEWPORT: Fixed light left navigation beside a workspace that fills the available width. There is no centered cabinet switch or right promotional rail. The client MFA prompt reflects actual enrollment state and can be dismissed. At 700px the sidebar becomes a drawer; staff retain their existing labeled bottom navigation. Staff search and role-specific actions remain in the top bar.

FORM: Apply the reference typography, logo, icons, panels, and palette to existing server-backed functions only. `Sovremennaya_Zashchita_AI_Agent_Spec.md` controls feature scope. Reference HTML/CSS remain in `.impeccable/reference/`; asset provenance remains in `public/reference/SOURCES.md`. Archived promotional images do not authorize promotional UI or new functions.

SIGNATURE INTERACTION: Grouped light navigation, expandable case stages, existing document and manual payment flows, and real chat. Preserve permission checks, readable failures, honest empty states, and legal publication state. Client MFA is optional; staff MFA remains enforced by server state. Consent footer opens read mode through `/consent?view=1`.

REACH: `ClientShell`, `ReferenceCaseView`, `PortalShared`, client account routes, and `app/reference-design.css`; `StaffReferenceShell`, `app/staff/layout.tsx`, and `app/staff-reference.css` cover staff routes. Staff permissions, role navigation, search, bounded lists, and conversation scrolling remain intact. Authentication now joins this scope through `AuthFrame`, `AuthForm`, and the last-imported `app/auth-reference.css`; native binaries/chrome remain outside this correction.

## Kazakhstan authentication extension

THESIS: A cohesive Kazakhstan entry preserves the existing signup/login logic.

FIRST VIEWPORT: Large brand and Kazakhstan location at left; a white, borderless card with the small existing logo, light gray icon inputs, and purple outline submit at right.

FORM: The standard 840px grid uses 376px/400px columns and a 64px gap; wide consent uses 984px with 280px/640px columns. The brand hides at 900px; at 480px the card compacts to 24px 20px padding.

REACH: Login, registration, forgot/reset password, pending approval, consent, and access denial share the frame. Email/password, password confirmation, Server Actions, role assignment, approval, consent, and MFA retain their existing behavior. No role chooser or simulated CAPTCHA.

## Scope correction

Removed reference-only partner, recommendation, post, BKI, director, Russian sample-document, and invoice-request routes/actions, plus their staff request inbox. Migration 099 revokes the two related RPCs while retaining data. Case document requests, contracts, and manual payment/receipt workflows remain in product scope.

## Current evidence and limits

The independent reviewer found no material source issues and returned **ship at source-review scope**. Lint, production build, migration audit, consent-transition tests, and MFA-routing tests passed. Authenticated HTTP checks on `localhost:3000` returned 200 for eight staff and six client pages without switches or promos; removed routes returned 404, cross-role cabinet redirects worked, and retired RPCs denied calls from both roles. The client test account had no visible cases, so case-detail HTTP checks were not run.

For the authentication extension, source review returned **ship** without findings. Lint, production build, consent-transition and MFA-routing tests passed, as did HTTP checks of six public pages and protected-route redirects. The initial detector advisories in `.impeccable/review/auth-reference/detector.json` describe authentication typography/color additions. Documentation reflects the subsequent user-requested compact sizing in the final CSS; those source-evidenced rules are recorded in `DESIGN.md` and its sidecar.

The browser was unavailable. No current rendered, responsive-overflow, keyboard, or 1:1 visual verification is claimed. Source, build, and HTTP evidence do not establish those results.

## Historical context and limits

Earlier client and staff HTTP reports remain in `.impeccable/review/reference/` and `.impeccable/review/staff-reference/`; they describe preceding implementations. Earlier directory, redesign, and workflow screenshots remain historical evidence, not acceptance of this corrected shell. Earlier native Android-emulator and iOS parse-only checks remain bounded to their original scope.

This pass does not certify physical devices, open-keyboard layouts, enlarged text, concurrent-user capacity, push delivery, store readiness, or new production deployment. Native shield/check provenance remains separate from the reference web logo. Existing security, consent, file protection, and native constraints remain recorded in `PRODUCT.md`.
