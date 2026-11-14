---
name: "Modern Secure"
description: "Role-separated casework and Kazakhstan authentication with reference typography and styling."
colors:
  canvas: "#f5f7f9"
  surface: "#ffffff"
  surface-soft: "#edf2f5"
  ink: "#20323d"
  muted: "#586b78"
  line: "#dce4e9"
  line-strong: "#a9b8c2"
  accent: "#176654"
  accent-hover: "#104d40"
  accent-ink: "#176654"
  accent-soft: "#e5f1ec"
  success: "#176b5b"
  success-soft: "#e7f3ed"
  warning: "#92520b"
  warning-soft: "#fff3dd"
  danger: "#b43240"
  danger-soft: "#fff0f1"
  rail: "#203944"
  rail-hover: "#2c4854"
  rail-text: "#dbe7eb"
  rail-muted: "#afc3cc"
  rail-active-ink: "#174f45"
  brand-rail: "#345965"
  client-canvas: "#f3f4f6"
  client-ink: "#030712"
  client-muted: "#6b7280"
  client-line: "#e5e7eb"
  client-line-strong: "#d1d5db"
  client-accent: "#4c53a0"
  client-accent-ink: "#414788"
  client-accent-hover: "#373c6d"
  client-accent-soft: "#eff0f9"
  client-action: "#2b2b2b"
  client-action-hover: "#1a1a1a"
  client-focus: "#2563eb"
  client-icon-soft: "#e0e2f2"
  client-success: "#047857"
  client-success-soft: "#d1fae5"
  client-warning: "#b45309"
  client-warning-soft: "#fef3c7"
  client-danger: "#dc2626"
  client-danger-soft: "#fee2e2"
  auth-ink: "#111827"
  auth-field: "#f8f9fb"
  auth-label: "#4b5563"
  auth-outline: "#a3a9d7"
typography:
  auth-brand:
    fontFamily: "Garet, sans-serif"
    fontSize: "38px"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  auth-brand-wide:
    fontFamily: "Garet, sans-serif"
    fontSize: "34px"
    fontWeight: 400
    lineHeight: 1.25
  auth-location:
    fontFamily: "Garet, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.65
  auth-title:
    fontFamily: "Garet, sans-serif"
    fontSize: "20px"
    fontWeight: 400
    lineHeight: 1.4
  auth-body:
    fontFamily: "Garet, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  auth-description:
    fontFamily: "Garet, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
  auth-footer:
    fontFamily: "Garet, sans-serif"
    fontSize: "12px"
    fontWeight: 400
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "28px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "19px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.5
  action:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "13px"
    lineHeight: 1.5
  headline-mobile:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "25px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  record:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.5
  client-headline:
    fontFamily: "Garet, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: "2rem"
  client-title:
    fontFamily: "Garet, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: "1.75rem"
  client-body:
    fontFamily: "Garet, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: "1.5"
  client-label:
    fontFamily: "Garet, sans-serif"
    fontSize: ".875rem"
    fontWeight: 400
    lineHeight: "1.25rem"
  client-action:
    fontFamily: "Garet, sans-serif"
    fontSize: ".875rem"
    fontWeight: 600
    lineHeight: "1.25rem"
rounded:
  tag: "6px"
  small: "8px"
  control: "8px"
  panel: "12px"
  menu: "16px"
  composer: "18px"
  badge: "20px"
  avatar: "50%"
  rail-link: "7px"
  message: "14px"
  client-control: ".5rem"
  client-card: ".75rem"
  client-panel: "1rem"
  client-status: ".375rem"
spacing:
  compact: "4px"
  small: "8px"
  medium: "12px"
  gutter: "16px"
  inset: "20px"
  panel: "24px"
  page: "28px"
  large: "32px"
  client-gutter: "1rem"
  client-card: "1.25rem"
  client-panel: "1.75rem"
components:
  auth-submit:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.client-accent}"
    typography: "{typography.auth-body}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  auth-input:
    backgroundColor: "{colors.auth-field}"
    textColor: "{colors.auth-ink}"
    typography: "{typography.auth-body}"
    rounded: "{rounded.control}"
    padding: "10px 14px 10px 42px"
  auth-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.auth-ink}"
    rounded: "{rounded.menu}"
    padding: "28px"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.surface}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-attach:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.message}"
    padding: "10px"
    width: "48px"
    height: "48px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "24px"
  navigation-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.rail-active-ink}"
    rounded: "{rounded.rail-link}"
    padding: "9px 12px"
  bottom-navigation:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    padding: "6px 8px calc(6px + env(safe-area-inset-bottom))"
  tag:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.muted}"
    rounded: "{rounded.tag}"
    padding: "5px 9px"
  conversation-composer:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.composer}"
  workspace-search:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "0 12px"
  directory-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.record}"
    padding: "16px 22px"
  client-button-primary:
    backgroundColor: "{colors.client-action}"
    textColor: "{colors.surface}"
    typography: "{typography.client-action}"
    rounded: "{rounded.client-control}"
    padding: ".5rem 1rem"
  client-button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.client-accent-ink}"
    typography: "{typography.client-action}"
    rounded: "{rounded.client-control}"
    padding: ".5rem 1rem"
  client-input:
    backgroundColor: "{colors.surface}"
    textColor: "#111827"
    typography: "{typography.client-label}"
    rounded: "{rounded.client-control}"
    padding: ".5rem 1rem"
  client-navigation-active:
    backgroundColor: "{colors.client-line}"
    textColor: "{colors.client-ink}"
    rounded: "{rounded.client-control}"
    padding: ".625rem .875rem"
  client-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.client-ink}"
    rounded: "{rounded.client-panel}"
    padding: "1.75rem"
  client-status:
    backgroundColor: "{colors.client-warning-soft}"
    textColor: "{colors.client-warning}"
    rounded: "{rounded.client-status}"
    padding: ".25rem .5rem"
  staff-button-primary:
    backgroundColor: "{colors.client-action}"
    textColor: "{colors.surface}"
    typography: "{typography.client-action}"
    rounded: "{rounded.client-control}"
    padding: ".5rem 1rem"
  staff-navigation-active:
    backgroundColor: "{colors.client-line}"
    textColor: "{colors.client-ink}"
    typography: "{typography.client-label}"
    rounded: "{rounded.client-control}"
    padding: ".625rem .875rem"
  staff-directory-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.client-ink}"
    typography: "{typography.client-label}"
    padding: "1rem"
  client-security-banner:
    backgroundColor: "{colors.client-accent-soft}"
    textColor: "{colors.client-ink}"
    rounded: "{rounded.client-panel}"
    padding: "1rem"
---

# Design System: Modern Secure

## Overview

**Creative North Star: "The casework portal"**

The user retains the visual language of `https://sovz-lk.ru` for the authorized Kazakhstan subsidiary: Garet typography, light gray rails, white rounded panels, purple accents, dark buttons, original logo, and icon geometry. The corrected brief separates that styling from product scope. Client `/account` and staff `/staff` are distinct role-guarded workspaces; cabinet mode switches, advertising, and promotional photo rails are excluded.

The reference world covers `.sovz` client pages and every `/staff` route. `app/reference-design.css` supplies shared primitives; `components/StaffReferenceShell.tsx` and `app/staff-reference.css` adapt role-aware staff navigation, forms, directories, and conversations to that same world. `app/staff/layout.tsx` selects the reference shell, retaining `lawyer-shell` where required. `AuthFrame`, `AuthForm`, and the last-imported `app/auth-reference.css` extend the reference language to Kazakhstan authentication. **Keys prefixed `client-` are shared reference tokens despite their historical name; `staff-` component keys record staff-specific variants. `auth-` keys describe the current entry surfaces. Unprefixed tokens retain the legacy base layer, not current staff or reference authentication appearance.** White `surface` is shared. CSS remains the implementation source, including component exceptions.

**Key Characteristics:**

- Separate client and staff navigation, with a full-width working area beside the light rail.
- Real Supabase cases, tasks, documents, conversations, contracts, manual payments, and receipts in ₸.
- Optional client MFA setup with a dismissible prompt; server-controlled staff security remains intact.
- Role-aware staff search, bounded lists, and conversation behavior within the reference shell.

This document records built source, not pixel-for-pixel acceptance. No current browser/render review was available. Earlier directory screenshots are historical evidence only. See the surface brief for the direction contract and bounded finish evidence. Native shell chrome and binaries were not redesigned in this pass; `apps/client_mobile` remains outside scope.

## Colors

### Primary

Reference accents use the muted purple family for links, stage emphasis, and soft feedback. Primary buttons and selected case-section tabs are charcoal with white text. The selected light-rail destination uses neutral gray. Do not restore legacy green actions or the dark rail in `/staff`.

Authentication uses purple outlined submit actions and the existing turquoise logo on white. Links and soft hover states share the reference purple palette.

### Neutral

The reference canvas and rail share light gray; panels are white, primary ink is near black, and supporting text is medium gray. Light gray borders separate panels and fields. Authentication uses a white canvas and card, pale gray icon fields, dark reading ink, gray labels, and a soft purple submit outline.

### Semantic feedback

Both scopes use written feedback with their own success, warning, and danger pairs. Client stage icons may use purple, blue, green, or pink backgrounds as implemented. Color alone does not establish payment, case, or request status.

## Typography

Reference typography uses self-hosted `public/fonts/garet/Garet-Book.otf`, declared as **Garet normal weight 400**, matching the available Book face. The implementation requests 500/600 for selected labels and headings; those are not separately supplied font files. Preserve the correct 400 declaration rather than declaring Book as a variable weight range. Headline, section, body, and control sizes are recorded in the client roles above.

Reference root sizing is 16px by default and `clamp(13px, calc(7px + .46875vw), 16px)` from 1024px. Rem-based dimensions scale together. At 700px and below, form controls explicitly use 16px.

Staff uses the same Garet headline, section, and control roles, with 1.125rem tertiary headings and .875rem directory text. Authentication uses Garet Book throughout; its brand, location, title, body, description, and footer roles are recorded above. The location is uppercase brand context; form labels remain sentence case.

## Layout

Client desktop layout has a fixed light left rail and a single work column filling the remaining width. Rail width is `clamp(13.5rem,16.67vw,20rem)` and workspace padding is `1rem`. There is no centered cabinet switch or promotional column. Main panels use `1.75rem` padding and `1rem` corners; case cards use three columns where space permits.

At 1023px and below the client rail is 216px and case/profile layouts collapse. At 700px and below the light rail becomes a toggled drawer with backdrop, workspace margins disappear, main panel padding is `1.25rem`, and client buttons have a 44px minimum height. This drawer replaces the earlier client bottom navigation. Responsive rules are implemented but current rendered acceptance is pending.

Staff shares the light rail and full-width working area. Its top bar contains search and the existing role-specific action; navigation remains permission-scoped. Administrator/manager overview uses real profile and work data; lawyers retain their role-specific dashboard. Staff panels use 1.75rem outer or 1.25rem nested padding. At 1023px the overview lower grid collapses; at 700px the drawer and existing labeled staff bottom navigation remain available in reference colors. Search remains accessible from the top control and Cmd/Ctrl+K. Directory lists retain 25-record default pagination, URL-preserving search/filter controls, and inline disclosure.

Staff conversation routes use a viewport-bounded flex chain through workspace, columns, page, lawyer wrapper, and conversation. The footer is hidden there so history can scroll while the composer remains visible. This structural behavior is source-reviewed; current browser confirmation is still pending.

Authentication centers a 840px grid of 376px brand and 400px form columns with a 64px gap. Wide consent uses a 984px grid with 280px and 640px columns. At 900px and below the brand hides; forms remain at most 400px, or 640px for consent. At 480px and below the card uses 24px 20px padding and the page accounts for the bottom safe-area inset. WebView behavior has not received renewed device acceptance.

## Elevation & Depth

Client ordinary panels use borders and tone. The mobile drawer uses `8px 0 30px #0002`; dialogs use `0 20px 25px #0003` with a `#0008` backdrop. Preserve these source-specific exceptions.

Staff reference work panels, directory rows, and the mobile secondary-navigation panel remain flat; the latter uses a light border. Existing chat jump controls retain shadows: shared chat jump control `0 8px 28px rgb(23 43 54 / 12%)` and staff chat jump control `0 4px 16px rgba(23,43,54,.14)`.

Authentication cards use `0 12px 32px #1118270d` ambient depth on white, without a border.

**The Borderless Entry Card Rule.** Authentication cards use soft shadow; gray borders belong to fields and purple outlines to submit actions.

## Shapes

Client controls and navigation use `.5rem` corners, nested cards/stages `.75rem`, main panels/dialogs `1rem`, and status labels `.375rem`. Avatars are circular. Dashed outlines remain part of financial fact containers.

Staff reference controls and rail links use .5rem corners, nested panels .75rem, and page panels 1rem. Authentication cards use 16px corners; fields, submit actions, and feedback use 8px corners. Case composers retain 18px corners and 48px attachment/send controls; message bubbles retain their scoped exceptions. Do not globally replace either world's shape tokens with the other.

## Components

### Buttons and fields

Client primary buttons are charcoal; outlined buttons use white, light borders, and purple ink. Their desktop minimum height is `2.25rem`, rising to 44px on phones. Disabled client buttons use `.6` opacity. Client keyboard focus is a 2px blue outline with a 2px offset. Fields use a gray border and `.5rem` radius; focused borders turn purple. Errors have written copy and a red feedback treatment.

Authentication fields and submit actions have a 48px minimum height and 16px values. Icon fields reserve 42px at the left; password toggles are 44px square. Submit actions use a 1.5px purple outline, white background, soft purple hover, and `.65` disabled opacity. Keyboard focus uses a 2px purple outline with a 3px offset. Labels, password visibility, pending text, and written feedback remain explicit.

### Navigation and panels

The client left rail groups original outline icons with Russian labels, gray active destinations, and dividers. Client and staff cabinets are separated by existing role guards, without a mode switch. Case section links retain the segmented pattern. Main content uses large white panels, case fact cards, stage disclosures, and real case-selection flows when more than one case is available.

Staff uses charcoal primary buttons, purple outlined actions, gray active rail destinations, white rounded forms, and Garet controls. Desktop actions start at 2.25rem and phone buttons at 44px; phone fields use 16px values. Search, tabs, pagination, and directory disclosure retain their existing behavior. Cmd/Ctrl+K opens/focuses search; list queries stay permission-scoped. Obsolete page numbers recover to an available page.

The primary administrator's `/staff/accounts` directory and deletion screen reuse the existing list search, pagination, white staff panels, fields, and submit control. The confirmation names the account, requires its email and a reason, explains which company records remain, and exposes protected-account or assignment blockers before submission. This adds no new visual system; rendered acceptance remains pending.

### Security, consent, and conversations

Login, registration, password recovery/reset, pending approval, consent, and access denial share the entry frame. Login remains email/password; registration and reset retain password confirmation. Existing Server Actions, role assignment, approval, consent transitions, and MFA routing remain authoritative. No role chooser or simulated CAPTCHA is introduced.

The client MFA prompt appears on eligible case overview pages only when no second factor is present; «Позже» dismisses it and «Подключить» opens `/account-security`. MFA status comes from actual state. Optional client enrollment does not weaken staff MFA enforcement.

Legal links preserve real publication state. The consent footer opens `/consent?view=1` for reading rather than forcing a new acceptance flow. Registration query handling remains separate from visual navigation. Existing case, document, contract, and manual payment flows use actual server data and permissions. Conversations show real messages and surface list/load/send errors. Never copy reference balances, case facts, or sample legal text into operational data.

### Imagery and motion

Public reference HTML/CSS and Vite component extracts are cached in `.impeccable/reference/`, including `source.css`. The displayed reference logo is `public/reference/logo.png`; icon geometry is carried by `components/ReferenceIcon.tsx`, with its license in `public/reference/LUCIDE-LICENSE.txt`. Provenance is recorded in `public/reference/SOURCES.md`. The shared icon set also includes added semantic outline glyphs for search, menu, and staff destinations; these extend the reference style and are not all extracted from the reference site. Archived promotional rasters are not part of the active interface and must not be reintroduced as ads, photo rails, or product features.

Reference reduced-motion CSS removes animations and smooth scrolling. Staff retains 140ms color transitions, 160ms disclosure entry, and 1.6s skeleton opacity, with its reduced-motion overrides.

Native shield/check assets retain their older provenance from `components/Brand.tsx`; the iOS generator remains `apps/mobile_webview/ios/scripts/generate-app-icon.swift`. That native identity is separate from the new web reference logo.

## Do's and Don'ts

### Do:

- Do retain Garet Book, light rails, white panels, purple accents, charcoal actions, and original logo/icon geometry.
- Do keep client `/account` and staff `/staff` separate under their existing role guards.
- Do preserve staff permissions, search, pagination, and chat behavior within the light reference shell.
- Do use real account data, ₸ amounts, permission checks, and honest errors or empty states.
- Do retain visible focus, readable control values, and actual security/legal state.

### Don't:

- Don't add cabinet mode switches, advertising, or promotional photo rails anywhere.
- Don't turn reference-only features into product requirements; use `Sovremennaya_Zashchita_AI_Agent_Spec.md` for scope.
- Don't restore the old slate/green staff shell or legacy authentication composition.
- Don't invent balances, cases, receipts, or published legal documents to match screenshots.
- Don't call source review, successful builds, or HTTP checks rendered or pixel-perfect acceptance.
- Don't treat this pass as native release, load-test, or physical-device acceptance.
