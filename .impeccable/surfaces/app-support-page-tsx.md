# Public support: `/support`

Purpose: provide support without authentication, including the App Store Support URL. This narrow extension reuses the incumbent `AuthFrame` and the authentication rules in `DESIGN.md`; it introduces no visual system or token changes. Preserve the existing brand header, desktop companion, responsive content column, typography, links, and footer treatment.

Show only owner-approved `PUBLIC_SUPPORT_EMAIL`, `PUBLIC_SUPPORT_PHONE`, and optional `PUBLIC_SUPPORT_HOURS`. Valid email/phone values become contact links; hours appear only with an available contact. With neither valid contact, show the truthful unpublished-contact state. Never fall back to private account contacts or staff-only settings. Password recovery and login remain available below the contact section.

Baseline comparison: source review found no material defects. Relative to Git HEAD, `AuthFrame` adds the support footer link and broadens its navigation label; its structure and styling otherwise remain unchanged. `PRODUCT.md`, `DESIGN.md`, and `.impeccable/design.json` have no current diff. No unrelated design drift was established by this limited source comparison; rendered drift remains unassessed.

Visual verification is pending. Browser access to the host was unavailable, so no screenshots were captured. Finish review returned `recapture`, with no visual approval. Recapture desktop and phone layouts with configured contacts and the unpublished-contact state; check footer wrapping, contact wrapping, focus visibility, and overflow before claiming rendered review complete.
