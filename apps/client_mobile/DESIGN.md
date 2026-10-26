---
name: ModernSecure native client
description: A calm Russian-language client workspace for legal case progress.
colors:
  ink: "#101C35"
  muted: "#61718B"
  blue: "#0862CB"
  canvas: "#F4F7FB"
  surface: "#FFFFFF"
  green: "#16855D"
  correction: "#B54728"
  divider: "#E7ECF3"
  gradient-start: "#0754B0"
  gradient-end: "#347FC0"
  disabled: "#8196B0"
  login-ice: "#E1EDF6"
  login-light: "#F7FAFD"
  login-blue: "#D7E7F3"
  architecture-screen: "#D7E3EB"
  shield: "#07375B"
  selected: "#EAF2FF"
  incoming: "#E9EEF5"
  action-surface: "#FFF4EA"
typography:
  headline:
    fontFamily: ClientRoboto
    fontSize: 28px
    fontWeight: 700
    letterSpacing: -0.7px
  title:
    fontFamily: ClientRoboto
    fontSize: 22px
    fontWeight: 700
  subtitle:
    fontFamily: ClientRoboto
    fontSize: 16px
    fontWeight: 600
  body:
    fontFamily: ClientRoboto
    fontSize: 16px
    lineHeight: 1.5
  body-medium:
    fontFamily: ClientRoboto
    fontSize: 14px
    lineHeight: 1.45
  caption:
    fontFamily: ClientRoboto
    fontSize: 12px
    lineHeight: 1.4
rounded:
  icon: 14px
  field: 16px
  surface: 20px
  navigation: 26px
  button: 30px
spacing:
  compact: 8px
  group: 12px
  content: 16px
  surface: 18px
  section: 24px
components:
  button-primary:
    textColor: "{colors.surface}"
    rounded: "{rounded.button}"
    height: 52px
    padding: 0px 20px
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: 18px
  field:
    backgroundColor: "rgba(255,255,255,0.85)"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: 18px
  status:
    rounded: "{rounded.surface}"
    padding: 5px 10px
---

# Design System: ModernSecure native client

## Overview

**Creative North Star: "Calm client workspace"**

This scoped record describes the Flutter Android/iOS client in `apps/client_mobile`, extracted from `lib/ui.dart`, `lib/main.dart`, and `lib/workspace.dart`. The pinned visual direction is an icy blue architectural login, a navy shield with company wordmark, and a blue gradient sign-in action. Inside the account, light cards, a case timeline, labeled document statuses, and blue/grey conversation bubbles keep progress legible.

The north-star phrase summarizes the supplied reference; it is not a separately approved brand slogan. Root PRODUCT.md and DESIGN.md describe an older web scope and are not the visual authority for this app. This record captures implementation, not full design acceptance or device certification.

**Key Characteristics:**
- Icy architectural login and restrained navy identity.
- Light surfaces with generous rounded corners.
- Four primary destinations and profile-based secondary navigation.
- Explicit status labels and calm, readable Russian copy.

## Colors

The primary blue drives actions, current progress, selected navigation, and outgoing chat. Ink provides the main reading contrast; muted blue-grey supports dates and secondary text. Canvas and white surfaces distinguish containers without heavy outlines. Green denotes accepted/completed states; correction red-brown denotes required document fixes. The pale warm action surface highlights outstanding work.

**The Status Label Rule.** Pair semantic color with visible status text; color alone must not carry document state.

## Typography

ClientRoboto is the configured Flutter font family. The theme defines headline, title, subtitle, body, medium body, and caption roles in the frontmatter. Values expressed as px here represent Flutter logical pixels, not physical screen pixels. Preserve Cyrillic support and platform text scaling. The login wordmark is a separate compact uppercase treatment, not a body-heading style. Currency amounts use the text suffix `тг`; the bundled font does not support the tenge symbol reliably.

## Layout

Use a vertically scrolling client workspace with safe-area handling. Login has horizontal padding of 28 logical pixels and a maximum content width of 420. Its architectural image occupies the bottom 260 logical pixels with a transparent-to-opaque mask. Account content is capped at 680; the navigation changes from bottom bar to rail at 700 logical pixels. Common account gutters are 16 or 20; surfaces use the shared padding token.

There are exactly four primary destinations: Главная, Дело, Документы, Сообщения. The avatar opens Профиль и ещё, including finance, notifications, profile and help. Chat bubbles cap their width at 77% of the viewport clamped to 300–680 logical pixels.

## Elevation & Depth

Cards are flat white surfaces on the pale canvas. The bottom navigation alone has a subtle upward shadow: offset (0, -3), blur 20, color #0B3154 at alpha 8/255. Login depth comes from the background gradient and faded architecture. The architecture image uses the architecture-screen color with Flutter BlendMode.screen to preserve footer contrast, in addition to its vertical opacity mask. Do not infer additional card shadows or motion tokens: most interactions use Flutter Material 3 defaults.

## Shapes

Shared surfaces and status pills use the surface radius, fields use the field radius, and icon tiles use the icon radius. Primary buttons are capsules. The bottom bar has rounded top corners. Chat bubbles use 20 logical pixel corners with a 4 logical pixel lower corner on the sender's side.

## Components

PrimaryButton combines the documented two-stop horizontal gradient, white label and trailing icon. Its minimum height is 52; busy state replaces the label with a spinner and disables submission. Disabled actions use the disabled color. Text and outlined buttons otherwise retain Material theme behavior.

Surface is the shared card. IconTile is a 46-square tile with a 23-size icon and a 7% tint of its foreground color. Fields have translucent white fill, no resting border, and a blue focused outline; error presentation follows Material defaults.

StatusPill uses a 12-size label and an 8% tint of its status foreground. The timeline uses blue for current, green for visited stages, and grey for future stages, with a thin vertical connector. Outgoing chat is blue with white text; incoming chat is pale grey-blue with ink text and sender metadata.

The four-item navigation uses a pale blue selected indicator, blue selected icons, and Russian labels. EmptyNotice provides an icon, short title, explanatory body, and optional recovery action.

Current limitations: the shield is a Material icon rather than a verified final logo asset; document detail explicitly reports that in-app file upload is unavailable. Public Supabase connection configuration belongs in `lib/config.dart`; it is not a design token. This document does not establish authenticated journey completion, accessibility compliance, or physical-device acceptance. Sidecar HTML is a portable visual approximation of Flutter components, not production UI or proof of native interaction fidelity.

## Do's and Don'ts

- Do preserve the icy architectural login and navy identity.
- Do reuse the shared typography, surface and status treatments.
- Do retain four primary tabs and expose More through the avatar.
- Do show loading, empty, error and read-only states in clear Russian.
- Don't replace this native client direction with the older root web design.
- Don't imply that unavailable document upload or unverified native flows are complete.
