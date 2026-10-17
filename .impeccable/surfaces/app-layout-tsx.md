---
version: 1
slug: "app-layout-tsx"
primary_target: "app/layout.tsx"
related_targets: ["app/account","app/staff","components","app/login"]
---

# Full application redesign

Mode: Operate. Build path: code. Replace the incumbent UI across auth, client account, staff workspace, case work, chat, settings and security. Preserve working data and role restrictions. Both mobile client and desktop staff are primary.

## Direction contract

THESIS: A familiar business workspace makes the case list and its sections easy to scan and act on. Staff enter the searchable case list; client sections receive equal navigation weight.

OWN-WORLD: White surfaces, cool light-gray canvas, blue actions, dark neutral text. System sans, clear labels, 48px controls, outlined inputs, quiet dividers, compact status badges. No decorative imagery or display typography.

STORY: Find a case, understand its state, switch directly to documents, tasks, messages or payments; reveal secondary forms only when needed.

FIRST VIEWPORT: Desktop has a 248px light sidebar, compact account bar, left-aligned 32px page heading and new-case action, then wide search, filters and readable case rows. Mobile uses a compact brand bar and labeled navigation, full-width search, stacked records. Client case title and five equally visible section links precede content.

FORM: Canon — «Привычный бизнес-интерфейс», selected after the bolder direction round; seed 819b92f6. No approved image comp. User delegates reference choice.

Signature interaction: persistent section navigation with explicit active state; secondary forms expand inline and keep surrounding context. Motion grammar: a single 180ms ease-out disclosure reveal, immediate navigation, subtle color transitions, reduced-motion support.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
