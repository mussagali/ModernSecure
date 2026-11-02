---
name: "Modern Secure"
description: "Searchable legal workspaces with stable navigation and clear records across every web role."
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
typography:
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
spacing:
  compact: "4px"
  small: "8px"
  medium: "12px"
  gutter: "16px"
  inset: "20px"
  panel: "24px"
  page: "28px"
  large: "32px"
components:
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
---

# Design System: Modern Secure

## Overview

**Creative North Star: "The searchable workspace"**

«Современная защита» is a stable place for legal work: find a destination, narrow a directory, then open the relevant record. The searchable directory supplies the visual grammar—aligned information, quiet separators, compact controls, and details revealed in context. Familiar application navigation remains the durable commitment established by the user’s Instagram, Telegram, and ChatGPT references.

A dark slate rail anchors the light workspace. Restrained green marks actions and current location; system typography supports readable Russian copy. Authentication, client and staff spaces share the same visual world, with equal attention to every section. These responsive web pages also appear inside the existing WebView shells; this directory redesign does not retheme or rebuild native binaries. The legacy `apps/client_mobile` project remains outside this implementation.

**Key Characteristics:**

- Stable navigation and a consistent search entry across client and staff workspaces.
- Compact headings, aligned directory rows, and secondary controls disclosed within records.
- URL-backed search, filters, and bounded lists with readable result counts.
- Labeled mobile destinations, visible focus, and truthful loading, empty, and error states.

The frontmatter is normative for the implemented web system. Base primitives come from `app/globals.css`; `app/workspace-design.css`, imported last in `app/layout.tsx`, supplies the current palette, density, shell, and directory overrides. Role styles and conversation modules retain their documented component exceptions. The sidecar contains behavior and self-contained component examples. Surface composition belongs in `.impeccable/surfaces/app-layout-tsx.md`; evidence and release limits belong in `PRODUCT.md`.

## Colors

### Primary

Deep green marks primary actions, active tabs, links, and conversation authors. The darker accent is its hover state; soft green carries selection and outgoing messages. Rail selection uses a darker green ink to remain distinct within the pale selected item.

### Neutral

Dark slate anchors desktop navigation and the large-screen authentication companion panel. Pale rail text and muted rail text carry destinations and supporting identity; the lighter slate hover remains within that surface. The brand tile uses its own lighter slate. Cool gray canvas surrounds white work surfaces. Graphite ink carries primary content; muted slate supports metadata, help, and timestamps. Soft neutral surfaces group quiet controls and read-only fields. Light rules separate records, while stronger rules outline fields.

### Semantic feedback

Success, warning, and danger retain their existing green, warm brown, and red pairs. Success tokens remain distinct from the refreshed action tokens. Written feedback establishes meaning; a colored dot or background never carries the status alone.

**The Action Color Rule.** Use green for actionable or selected elements and named success states; keep ordinary records neutral and navigation chrome slate.

## Typography

Use the system sans stack for every text role. It follows platform UI typography and supports Cyrillic without downloading a display face. Establish hierarchy through scale, weight, placement, and spacing within this family.

Page headlines use the frontmatter headline role, with the mobile role below 700px. Staff headings use an intermediate 26px size at 701–900px. Section titles generally use the title role; compact list headings use 17px. Record names are 15–16px at weight 600, supporting metadata 12–13px, and form labels 14px. Body text and ordinary field values are 16px. Directory search values are 15px on desktop and 16px on phones; the desktop header search is 14px. Bottom navigation uses 11–12px labels.

Authentication is a deliberate exception: the large-screen companion heading is 34px and form heading 30px; the compact phone form heading is 27px. Message text uses a 1.55 line height. Tabular numerals support counts, dates, and amounts where implemented. Supporting page copy normally stays within 65ch.

**The Reading Hierarchy Rule.** Establish importance through size, weight, and placement within the same sans family; keep operational headings compact.

## Layout

Desktop client and staff spaces share a fixed slate navigation rail (240px), reducing to 216px between 901px and 1200px. The staff rail keeps its identity footer visible while destinations scroll independently. A white header (72px minimum on desktop) holds workspace search and account actions. Staff content is capped at 1480px with 32px horizontal padding, reducing to 24px at narrower desktop widths. Client content is capped at 1180px with 32px desktop gutters.

At 900px and below, both rails yield to labeled bottom navigation; the header exposes a 44px search icon linking to the search page. The staff header has a 68px minimum. Staff and client content use 20px side gutters, falling to 16px below 700px. Page bottoms reserve navigation height and the bottom safe-area inset. Staff secondary destinations open in the scrollable «Ещё» menu; clients use a dedicated «Ещё» list. At compact widths, a page title and its icon action occupy separate columns so long headings can wrap without colliding.

Directories place the page heading, section tabs, search and filters before one enclosing list surface. Desktop rows align identity, role or record metadata, status, and disclosure. Team rows have an 86px minimum height and 22px horizontal padding. Below 700px, column headings disappear and each record stacks its labeled information with 16px side padding. Details expand below the selected record. Lists use 25 records per page by default; result ranges and page links remain separate from record actions. Tabs can scroll horizontally without widening the page.

Authentication has a slate product companion and white form area at 1000px and above. The ordinary form area is capped at 500px; wide forms may expand to 720px. Below that breakpoint, the companion is hidden and the form uses a single centered column capped at 480px. Below 700px, the form joins the white page without an enclosing border. The phone viewport prioritizes the form and legal links.

Conversations retain independently scrolling history and a persistent composer. Staff chat uses the available height below the desktop header, a 300px conversation list reduced to 260px below 1100px, and a list-or-conversation layout below 800px. Search and conversation tabs sit above the list, with page controls below it. Existing native shells continue to handle system bars, display cutouts, and keyboard insets; browser layout does not establish native runtime acceptance.

## Elevation & Depth

Work panels, directories, and messages are flat. Solid tones, borders, and spacing provide hierarchy. Only overlapping controls and menus use the existing shadows:

- Shared case-chat jump control: `0 8px 28px rgb(23 43 54 / 12%)`.
- Staff mobile «Ещё» menu: `0 8px 32px rgba(23,43,54,.18)`.
- Staff-chat jump control: `0 4px 16px rgba(23,43,54,.14)`.

**The Floating Layer Rule.** Add elevation only when an element overlaps the work surface; ordinary panels remain shadow-free.

## Shapes

Controls use the control radius; grouped work surfaces use the panel radius. Rail links use their slightly tighter radius. Records stay rectangular inside the enclosing rounded list, separated by one rule. Avatars are circular; tags and pagination use smaller corners.

Message and composer exceptions remain intentional. Case-message bubbles use 14px corners with one 4px lower corner; staff messages use 16px with one 4px lower corner. The case composer retains 18px rounding and its attachment/send controls retain 14px corners. Authentication’s intermediate-width panel retains 16px rounding; large-screen and phone form areas are unframed.

## Components

### Buttons

Primary actions use green and white; secondary actions use white, ink, and a light border. Shared buttons have a 44px minimum height, rising to 48px below 700px. Authentication submit buttons and conversation attachment/send controls are 48px high; conversation controls are also 48px wide. Compact heading actions deliberately use a 44px square on phones and retain an accessible name when their visible label is hidden. Hover changes color; disabled buttons use 0.55 opacity. Keyboard focus is a 3px accent outline with a 3px offset.

### Inputs / Fields

Fields use white surfaces, a strong border, visible labels, and 16px values. Shared minimum height is 46px; authentication fields use 48px. Read-only fields use soft neutral and muted text. Password toggles retain accessible names and pressed states. Feedback uses semantic colors and a written explanation.

### Navigation

Desktop destinations combine authored SVG icons and text on the slate rail. Current destinations use soft green and darker green ink. Staff navigation can be filtered by its visible Russian label; its empty result has a clear message. Rail focus uses a pale green outline so it stays visible on the dark background, with a 1px offset within the staff destination list. Mobile destinations retain visible labels and current-location state. Staff bottom navigation highlights an icon capsule; client bottom navigation highlights the item. Preserve role-specific destinations and server-controlled availability.

### Workspace and list search

The desktop header search is a bordered canvas field up to 550px wide. Cmd/Ctrl+K focuses it; where the field is hidden, the shortcut opens the search destination. The mobile icon uses the same destination. Staff search covers permission-scoped cases, clients, and available sections; client search opens the user’s case directory. List searches use a labeled GET form, optional filters, a submit action, and an explicit reset when active. Search terms are capped at 120 characters.

### Tabs, pagination, and directory disclosure

Tabs use a bottom rule with a green active underline. Team management separates employees, access requests, and invitations; access requests appear only for the main administrator. Member search filters by name, role, and access state. Rows show name, email, role, and written status before expansion; access and payment forms remain inside a second disclosure. Page links preserve query state. Counts use tabular numerals. An obsolete page request resolves to an available page, while empty results explain how to reset the search.

### Chips / Counts

Role and status tags are small neutral rounded labels; semantic variants use their corresponding foreground/background pairs. Directory access state combines a small dot and written label. Unread counts use green pills with white text and supplement an explicit accessible label.

### Cards / Containers

Containers use white, a light border, and the panel radius. Repeated records share one enclosing surface with separators. Empty states describe the actual absence of work and an available next action. The authentication companion names real capabilities—cases, documents, and communication—and does not invent activity or statistics.

### Conversations, motion, and identity

Incoming messages are white and outgoing messages soft green, with readable text and timestamps. Attachment cards show a filename and metadata. The composer retains attachment, text, send, queued-file, and feedback states. Focus-within turns its border green. Attachment, send, and queued-file removal targets retain their implemented 48px dimensions.

Control color transitions last 140ms, disclosure entry 160ms, and skeleton opacity alternates over 1.6s. Reduced-motion preference removes animations and transitions. No new decorative raster imagery is part of this directory redesign.

The shield/check artwork comes from `components/Brand.tsx`. Existing Android launcher/offline assets reuse that geometry. The previously generated iOS raster `apps/mobile_webview/ios/Sources/Assets.xcassets/AppIcon.appiconset/AppIcon.png` is produced by `apps/mobile_webview/ios/scripts/generate-app-icon.swift`, deriving its paths from that vector. Rebuild from the iOS directory with `swift scripts/generate-app-icon.swift`; iOS supplies its icon mask. This provenance is historical native asset evidence, not a claim that native chrome was updated in the directory pass.

## Do's and Don'ts

### Do:

- Do share the system sans, green actions, slate desktop rail, and light work surfaces across every web role.
- Do keep search available from the header and preserve URL state when navigating list pages.
- Do keep primary mobile destinations visible, labeled, and clear of the bottom safe area.
- Do use aligned rows, separators, and inline disclosures to make real work easy to scan.
- Do retain visible keyboard focus on both dark and light surfaces, readable values, and textual status feedback.
- Do use actual data, useful empty states, and honest unpublished legal notices.
- Do preserve the shield/check vector provenance when rebuilding native icons.

### Don't:

- Don't restore the discarded blue action accent, square controls, or serif authentication headline.
- Don't place every administrative form above the directory or turn each record into a separate promotional card.
- Don't invent statistics, records, or product capabilities to fill a workspace or the authentication companion panel.
- Don't hide primary phone navigation behind a menu or let the composer overlap the bottom bar.
- Don't add gradients, glass effects, or shadows to ordinary work surfaces.
- Don't treat browser snapshots or build success as acceptance of populated case workflows, concurrent-user capacity, or native runtime.
