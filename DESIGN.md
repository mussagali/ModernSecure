---
name: "Современная защита"
description: "Привычный бизнес-интерфейс для работы клиента и команды по юридическому делу."
colors:
  canvas: "#f3f4f6"
  surface: "#ffffff"
  surface-soft: "#f8fafc"
  ink: "#111827"
  muted: "#526075"
  line: "#dce1e9"
  line-strong: "#aeb9c9"
  accent: "#2563eb"
  accent-hover: "#1d4ed8"
  accent-soft: "#eff6ff"
  accent-ink: "#1e40af"
  success: "#166534"
  success-soft: "#f0fdf4"
  warning: "#92400e"
  warning-soft: "#fffbeb"
  danger: "#b42318"
  danger-soft: "#fff1f2"
  nav-active: "#e8efff"
  status-neutral: "#e9edf3"
  message-own: "#edf3ff"
  message-own-line: "#cbdafa"
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "clamp(26px, 2.7vw, 34px)"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-.02em"
  section:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "22px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-.02em"
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "18px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-.02em"
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.55
  button:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
  metadata:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  badge: "5px"
  compact: "6px"
  tab: "7px"
  control: "8px"
  panel: "12px"
  auth: "16px"
spacing:
  tight: "4px"
  icon: "8px"
  compact: "12px"
  field: "16px"
  mobile-panel: "20px"
  panel: "24px"
  client-panel: "28px"
  page: "32px"
  section: "40px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-soft}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.accent-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "10px 0"
  field:
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
  status:
    backgroundColor: "{colors.status-neutral}"
    textColor: "{colors.muted}"
    rounded: "{rounded.badge}"
    padding: "5px 9px"
  case-navigation-active:
    backgroundColor: "{colors.nav-active}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.tab}"
    padding: "10px 14px"
  disclosure:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.panel}"
    padding: "16px 20px"
  message-own:
    backgroundColor: "{colors.message-own}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: "14px 16px 10px"
---

# Design System: Современная защита

## Overview

**Creative North Star: "Привычный бизнес-интерфейс"**

A calm, familiar workspace for a client and the team handling a legal case. White surfaces sit on a cool gray canvas; blue identifies actions and the current location. The same visual vocabulary supports mobile client work and the denser staff workspace, with readable text, explicit labels, and functional grouping.

The user selected a code-led replacement of the previous visual identity and explicitly chose a system sans interface. The retained brand commitment is the name «Современная защита». The built identity adds an outlined shield-and-check SVG within a blue rounded tile; navigation uses the existing authored outline SVG set. There is no decorative photography, raster illustration, display-font treatment, or simulated material.

**Key Characteristics:**
- White outlined panels on a cool gray canvas.
- Blue actions and clearly tinted current navigation.
- System sans text with restrained weight and size hierarchy.
- Labeled controls, spacious hit areas, and contextual inline disclosures.
- Shared component language across client, staff, authentication, and chat.

Source of truth: `app/globals.css`, `app/auth.css`, `app/case-workspace.css`, `app/chat-screen.css`, `app/staff/staff.css`, `app/staff-security/security.css`, and the shared component styles. `.impeccable/design.json` adds preview snippets, motion, breakpoints, and shadow metadata. Its generated tonal ramps are visualization aids, not additional application colors.

## Colors

The palette combines cool neutrals with a clear business blue and restrained semantic feedback colors. The frontmatter preserves the source hex values; most correspond directly to root CSS custom properties. The navigation, status, and message colors are repeated component literals.

### Primary
- **Action Blue** (`accent`): primary buttons, the brand tile, focus rings, progress, and unread counts.
- **Action Blue Hover** (`accent-hover`): the darker state of filled primary controls and links.
- **Blue Wash** (`accent-soft`): informational feedback, hover areas, and subtle selection.
- **Readable Blue** (`accent-ink`): links and text on pale blue surfaces.
- **Navigation Blue Wash** (`nav-active`): the current section and initial-based chat avatars.
- **Outgoing Message Blue** (`message-own`, `message-own-line`): outgoing chat bubbles and their border.

### Neutral
- **Cool Canvas** (`canvas`): the application ground.
- **White Surface** (`surface`): panels, headers, fields, and incoming messages.
- **Soft Surface** (`surface-soft`): chat timelines, list headings, quiet hover states, and read-only fields.
- **Ink** (`ink`): main text and headings.
- **Muted Slate** (`muted`): supporting copy, labels, timestamps, and unselected navigation.
- **Quiet Line** (`line`) and **Field Line** (`line-strong`): separators and more visible form boundaries.
- **Neutral Status** (`status-neutral`): compact case and role badges.

Success, warning, and danger each pair dark text with a pale background. They communicate a stated condition in badges, notices, document review, payments, or connection feedback. Their meaning is supported by text.

**The Action and State Rule.** Use blue for actions and location; use success, warning, and danger colors for the condition the accompanying text names.

## Typography

**Interface Font:** the platform system sans stack in the frontmatter. Headings and body text share the same family. There is no separate display face or imported web font.

### Hierarchy
- **Headline:** the fluid page-title role; compact chat shells reduce their case title to preserve working space.
- **Section:** the main content heading; staff panel headings also use a compact size (20px).
- **Title:** the smaller section-heading role.
- **Body:** the reading baseline (16px); inputs and message text preserve this size. Supporting copy is commonly (14–15px). Longer descriptions are bounded at roughly (65–75ch).
- **Label and button:** medium-weight control text, with the button's tighter line height recorded separately.
- **Metadata:** compact timestamps, identifiers, and secondary facts. Badges and chat timestamps use smaller contextual sizes; these do not redefine the reading baseline.

The authentication introduction has a larger functional heading (`clamp(36px, 4vw, 52px)`, line height `1.12`) on wide screens; it disappears when the auth layout becomes a single column. Authentication form titles use (28px). Case counts and monetary summaries use tabular numerals.

**The Reading Baseline Rule.** Keep body text, typed field values, and chat messages at 16px; express secondary hierarchy through supporting roles rather than shrinking the main reading task.

## Layout

Desktop staff navigation occupies a fixed left rail (248px), reducing to (224px) at the (1150px) breakpoint. The workspace has a quiet top bar (72px minimum), a content maximum (1360px), and page padding (32px). At (900px), a compact brand bar and sticky labeled navigation replace the rail. At (700px), form columns, list metadata, audit rows, and service grids stack; staff page padding becomes (24px 16px 48px).

Client content is centered within (1120px), with desktop side clearance (32px) and mobile clearance (16px). The case list changes from two columns to one at (700px). Client case navigation gives all five destinations equal cells; at (700px) and below it uses three equal columns across two rows, full labels (14px), and a minimum cell height (60px). The final row keeps the same column widths.

Authentication uses a two-column introduction and form layout, with a form column (440px), then switches to one column at (850px). Security and recovery screens use narrower centered reading and form widths. Chat fills the available viewport with independently scrollable message history and a visible composer. Its containers use the full workspace width with 16px desktop and 8px mobile clearance, without a fixed minimum height. Case messages omit the repeated outer case heading; the conversation header retains the case context. On screens at most 700px wide, message-page section links use one horizontally scrollable row that keeps the current section in view; other case pages retain their equal-cell navigation. Team chat uses a 280px people list and switches between the list and selected conversation at 800px.

Repeated spacing is recorded in the frontmatter. Use (16–24px) for related content groups and panel interiors, with (28–40px) for broader page separation. The implementation also uses local fitting values; this is an extracted vocabulary, not a claim that every measurement belongs to a rigid grid.

**The Context Stays Rule.** Expand secondary forms inline within the surrounding workspace, and preserve visible navigation when changing case sections.

## Elevation & Depth

Surfaces are flat at rest. White and soft-gray fills, thin borders, and quiet dividers establish grouping. The single menu shadow belongs to floating case-switcher menus, the staff mobile overflow panel, and chat jump controls. Cards and primary actions do not gain decorative shadows.

### Shadow Vocabulary
- **Floating menu:** `0 12px 32px #1118271a`, supplied by `--shadow-menu`.
- **Keyboard focus:** a blue solid outline (3px) with an offset (3px). Clipped clickable record rows bring it inside the boundary; chat textareas use a closer, thinner outline.

**The Flat Workspace Rule.** Keep ordinary surfaces flat; reserve the menu shadow for controls that float above the workspace.

## Shapes

The system uses gently rounded rectangles: control corners, larger panel corners, small badge corners, and a softer authentication container. Thin borders define surfaces. Pills are not the default silhouette. Circles are reserved for avatars, stage indices, and status dots.

Outline navigation icons share a square view box (24px), rounded stroke caps and joins, and stroke weight (1.8). Their default rendered size is (19px); mobile case navigation uses (18px), and chat action icons use (22px). The geometric brand is authored SVG, with a shield and check inside a rounded blue tile.

## Components

### Buttons

Clear, labeled, and easy to target. Filled primary buttons use Action Blue with white text; secondary actions use a white surface and quiet border. Text actions use Readable Blue and an underline on hover; destructive actions use the danger vocabulary in their specific workflow.

Controls have a minimum height (48px). The shared primary padding and corner radius are normative frontmatter tokens; link-style primary actions use slightly wider padding (11px 18px). Disabled buttons reduce opacity to (.55) and use the disabled cursor. Filled primary hover changes color over (150ms ease-out); focus follows the shared outline.

### Chips

Compact and factual. Case status and role tags use muted text on a neutral fill. Warning, unread, overdue, and success variants apply the relevant text-and-fill pair. Chips carry short labels rather than decorative emphasis; they are not automatically interactive.

### Cards / Containers

White, outlined, and flat. Staff work panels use the panel padding token; client detail panels use the client-panel token. At the narrow layout breakpoint these generally reduce to the mobile-panel token. Clickable case cards change border color on hover; clickable rows use a soft background and preserve their focus outline inside clipped lists.

### Inputs / Fields

White outlined fields use Field Line, the control radius, and the body role. Textareas allow vertical resizing. Read-only fields use Soft Surface and muted text. Labels stay visible above fields; placeholder text supplements them. Errors use written feedback with the danger pair. File pickers use a dashed border and soft fill, followed by file names, per-file controls, and upload progress.

### Navigation

Desktop sidebar links combine an outline SVG and a text label. The current item has a blue wash, readable blue text, and an explicit current-page state. Case-section navigation uses equal-weight links within a white outlined container; its active state changes fill and text without changing cell size. Mobile client case links preserve full names. Staff mobile navigation uses compact labeled primary destinations plus an overflow disclosure for role-dependent sections.

### Inline Disclosures

Secondary forms sit behind a labeled summary within an outlined panel or a divided section. Opening retains the surrounding case or list context. Disclosure content moves into place over (180ms) with `cubic-bezier(.16,1,.3,1)`; the create-case plus turns through (45deg). Reduced-motion preference removes transitions and animations.

### Chat and Attachments

Incoming messages are white; outgoing messages use the pale blue pair and align to the opposite side. Bubble corners are asymmetric, with a small lower corner pointing toward their author. Message bodies preserve the body role. Attachments use compact soft-surface file rows with outline SVGs and readable file information. The outlined composer contains a textarea plus attachment and send controls (48px square); a blue border marks focus within it.

## Do's and Don'ts

### Do:
- **Do** reuse the shared cool neutrals, action blue, and semantic feedback pairs.
- **Do** retain 16px body, input, and message text and the shared visible focus treatment.
- **Do** keep repeated controls at least 48px high and mobile client case navigation cells at least 60px high.
- **Do** preserve full client case-section names, equal cell widths, and an explicit active state.
- **Do** use the authored outline SVG components and the existing geometric brand mark.
- **Do** keep secondary forms contextual and honor reduced-motion preferences.

### Don't:
- **Don't** add decorative imagery or display typography to this selected interface world.
- **Don't** turn flat working panels into raised promotional cards.
- **Don't** encode status solely through color or replace navigation labels with icons alone.
- **Don't** treat generated sidecar tonal ramps as additional approved application tokens.

Not canonized: compact staff mobile navigation labels (11px) and chat microcopy (11–12px) are observed contextual exceptions, not a new global label or reading-size rule. No remaining material defect was reported in the scoped finish verdict; the documenter inspected source and did not independently repeat browser or runtime testing.
