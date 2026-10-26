---
name: Modern Secure Web
description: Cool light legal workspaces with navy text and a blue action accent.
colors:
  canvas: "#f3f7fc"
  surface: "#fbfcff"
  surface-soft: "#edf3fb"
  ink: "#0c193f"
  muted: "#526b96"
  line: "#dce5f2"
  line-strong: "#8094b3"
  accent: "#005bea"
  accent-hover: "#0047bd"
  accent-soft: "#e5efff"
  success: "#08765d"
  success-soft: "#edf7f3"
  warning: "#995019"
  warning-soft: "#fcf3eb"
  danger: "#b53235"
typography:
  display:
    fontFamily: '"PT Serif", serif'
    fontSize: "clamp(40px, 4.8vw, 64px)"
    fontWeight: 400
    lineHeight: 1.12
    letterSpacing: "-0.025em"
  body:
    fontFamily: '"Segoe UI", Arial, sans-serif'
    fontSize: "16px"
    lineHeight: 1.55
  headline:
    fontFamily: '"Segoe UI", Arial, sans-serif'
    fontSize: "clamp(26px, 2.7vw, 34px)"
    fontWeight: 650
    lineHeight: 1.25
  label:
    fontFamily: '"Segoe UI", Arial, sans-serif'
    fontSize: "14px"
    fontWeight: 600
rounded:
  square: "0"
spacing:
  small: "8px"
  control: "16px"
  panel: "24px"
  large: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.square}"
    padding: "10px 16px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.square}"
    padding: "10px 16px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.square}"
    padding: "10px 12px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.square}"
    padding: "24px"
---

# Design System: Modern Secure Web

## Overview

**Creative North Star: "Cool light legal workspace"**

The web application uses cool light surfaces, navy text, straight boundaries, and one dark blue accent. Authentication, client, lawyer, manager, and administrator workspaces share this visual language. This root system replaces the former blue, rounded web styles; the separately scoped native application in apps/client_mobile is unchanged.

The design favors readable work records, visible labels, bordered forms, and honest empty states. Source authority is app/role-design.css, loaded after the root styles, together with the flattened web component styles. Staff and client source coverage does not imply authenticated visual acceptance.

**Key Characteristics:**

- Cool light canvas and solid cool surfaces.
- Graphite text and blue actions or current location.
- Square boundaries and flat functional grouping.
- Labeled controls, visible focus, loading skeletons, and legal links.

## Colors

### Primary

Blue identifies primary actions and active navigation. Its deeper state supports immediate hover feedback without motion.

### Neutral

Cool light is the page canvas; off-white blue is the solid content surface. Navy carries primary text and muted blue carries supporting text. Two border strengths distinguish ordinary rows from major boundaries.

Success green, warning brown and danger red communicate named conditions only, not decorative accents.

**The One Accent Rule.** Reserve blue for actions and location; success, warning and danger remain semantic feedback, accompanied by text.

## Typography

Operational text uses Segoe UI with Arial and sans-serif fallbacks. Body text and fields use the body token; headings use restrained sans-serif weights. Supporting labels are typically 14px and small annotations 13px. Existing workspace-specific title sizes remain source-defined.

The authentication introduction uses the approved PT Serif display token with a serif fallback, reduced to 36px at the auth breakpoint. PT Serif regular is self-hosted at public/fonts/pt-serif/regular.ttf with its OFL license; the font face uses font-display: swap. This display treatment belongs to the login introduction; operational forms and workspace text retain the sans-serif hierarchy.

## Layout

Workspaces retain their role-specific navigation and task structures. Shared panels use 24px padding, with straight ruled rows for related records. The lawyer overview stacks work sections; its metrics form a wrapping horizontal strip. Role descriptions form rows rather than feature cards.

Authentication uses a maximum 1140px two-column layout with a 90px gap and a 340px to 420px form column. At 850px and below it becomes a single column capped at 480px, with the form before the introduction, 16px page gutters, and 24px form padding. Legal content uses a readable 72ch measure within a 980px outer container. These are surface-specific compositions, not mandatory layouts for every workspace.

## Elevation & Depth

Depth comes from solid tones, spacing, and borders. Menus and working surfaces have no shadow; no glass or blur is part of this system.

**The Flat Surface Rule.** Separate content with solid tone, spacing, and straight borders; do not add shadows or translucency.

## Shapes

Use square corners on panels, buttons, inputs, badges, and navigation. Borders are thin and continuous. Do not add decorative colored side stripes.

## Components

### Buttons

Primary buttons use blue with light text. Secondary actions use a cool surface and border. Shared controls have a 48px minimum height. Disabled buttons use reduced opacity and a disabled cursor. Hover changes the solid color immediately; focus uses a 3px blue outline with a 3px offset.

### Inputs / Fields

Fields have a solid cool background, square corners, a strong border, and 16px values. Read-only fields use the softer neutral and muted text. Keep labels visible and errors expressed in text.

### Navigation

Retain authored SVG icons with text labels. Staff current navigation uses blue with light text; client bottom navigation remains solid cool with a strong boundary. Role-specific responsive navigation structures remain intact.

### Chips / Counts

Small counts are square blue indicators with light text. They supplement an explicit navigation label and do not replace it.

### Cards / Containers

Working panels are flat, square, bordered cool surfaces. Use lists and ruled groups for repeated work rather than promotional layouts.

### Loading and Legal Links

Workspace skeletons use neutral heading, toolbar, and row blocks. Their 1.6-second opacity pulse stops under reduced motion. Terms and privacy links appear in authentication and legal navigation; the public pages show current database documents or an explicit unpublished notice.

## Do's and Don'ts

### Do:

- Do use the shared cool neutrals and blue action accent across web roles.
- Do preserve visible focus, readable field values, and text descriptions of status.
- Do show skeleton loading states and accessible terms and privacy links.
- Do show real empty states and the unpublished notice when a legal document is unavailable.
- Do keep native application design documentation scoped to apps/client_mobile.

### Don't:

- Don't add gradients, glass, shadows, rounded corners, pure white, purple and black palettes, rainbow colors, neon, or pastels.
- Don't use Lucide, emoji, sparkle decoration, dot grids, radial orbs, terminal styling, colored side stripes, or checkmark bullets.
- Don't add bento layouts, three feature cards, pricing tiers, fabricated testimonials, or animated arrows and hover motion.
- Don't introduce Inter, Geist, Space Grotesk, or em dash punctuation.
- Don't turn generated sidecar tonal ramps into approved application colors.


## Authentication refinement, 23 October 2026

The latest user request permits modest rounding on authentication pages: 12px for the form surface and 8px for inputs and buttons. These surfaces have no enclosing border or shadow. Remove decorative header/footer and form-switch rules, the role-description list, workspace label and role-assignment footnote. Keep input boundaries and keyboard focus indicators. Password fields use authored SVG eye toggles with accessible labels, pressed state and independent visibility for password confirmation. Apply the shared treatment to login, registration and password recovery. Other workspaces retain their existing geometry.
