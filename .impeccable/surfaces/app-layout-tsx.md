---
version: 1
slug: "app-layout-tsx"
primary_target: "app/layout.tsx"
related_targets: ["app/account", "app/staff", "components", "app/login", "app/workspace-design.css"]
---

# Directory workspace redesign, 28 October 2026

This is the current surface direction for the whole web application. The user requested comfort and visual clarity with many users, with equal priority for every section. Familiar application navigation, Russian copy, and restrained green remain the durable brand commitments. Roles, account activation, MFA, legal publication state, authorization, and file-security behavior remain product constraints. Existing Android/iOS shells display these responsive pages; native binary changes are outside this pass.

## Direction contract

THESIS: A stable place for work, with searchable directories and details disclosed in context.

OWN-WORLD: A dark slate desktop rail anchors white work surfaces and cool gray canvas. Green marks actions and current location. System sans, compact headings, aligned columns, separators, and moderate corners define the world. The final normative palette and component tokens are in root `DESIGN.md`, extracted from the final overrides in `app/workspace-design.css`.

STORY: Find a section or record, narrow the list, then open the case or member without losing the query context. Clients move from a recent list to their full case directory. Team management separates employees, access requests, and invitations. Secondary administrative forms expand within the relevant record.

FIRST VIEWPORT: Desktop has a 240px slate rail (216px at 901–1200px), a 72px search header, compact page heading, useful tabs/search, and readable rows. Both client and staff spaces share that grammar. At 900px and below, a search icon opens the search destination and labeled bottom navigation preserves the main destinations. At phone widths, 16px gutters and stacked record metadata replace desktop columns. Large-screen login uses the slate companion panel to describe actual capabilities beside the form; phones prioritize the form.

FORM: Code-led direction. Concept seed 426eb9b9 assigned the searchable directory/archive index. Alternatives considered were the conversation inbox, file manager, bank workspace, calendar, case dossier, and transit wayfinding. The directory contributes stable columns, search before scrolling, bounded lists, and progressive disclosure. Familiar application references supersede literal physical motifs.

SIGNATURE INTERACTION: Permission-scoped search, URL-backed filters and pagination, keyboard search access, and compact expandable records. Team lists default to 25 records per page and recover from obsolete page requests. Desktop staff navigation has a local section filter. Chats have server-filtered lists and page controls. Reduced-motion preferences remain respected. Empty, error, denied, and loading states describe the real situation.

REACH: Staff shell, client shell, authentication, team, clients, cases, messages, documents, tasks, payments, calendar, services, and shared case details. This breadth records implementation scope; it does not claim that every populated state has passed visual acceptance.

## Current finish evidence

Desktop and phone screenshots, the original browser report, and the resume report are under `.impeccable/review/directory/`. The saved `browser-report.json` and `resume-browser-report.json` together cover 41 live route views across the owner, client, lawyer, and manager roles (29 and 12 respectively). Search, team role/access filters, browser Back, section filtering, the search shortcut, obsolete-page recovery, and selected chat navigation have been exercised. The repeat report records no JavaScript errors or horizontal overflow. A 25-row synthetic browser fixture is density evidence only and does not mutate the database.

The independent finish review returned `ship` for available states and responsive layout after inspecting 40 desktop/mobile PNGs, source, and reports. All three material corrections passed: mobile heading layout, light focus on the dark rail (10.48:1 contrast with 4px list padding and 1px outline offset), and obsolete-page recovery. No UI findings remain within that scope. The last full pre-pause run passed all 38 local scripts, lint, and the production build including TypeScript; only the 1px focus-offset CSS changed afterward. The resumed pass changed capture harness/documentation only, and the reviewer independently reran the list-page test successfully. Current documentation records the directory system in `DESIGN.md` and `.impeccable/design.json`.

The database has no cases, documents, or services; populated case/document/payment workflows have not received visual acceptance. Browser checks do not establish concurrent-user capacity, native runtime, physical-device behavior, open-keyboard behavior, or enlarged text coverage. Business data was not created for screenshots.

## Historical context

The earlier pass used a light sidebar and a messenger-led workspace; its screenshots and bounded five-fix finish verdict remain in `.impeccable/review/redesign/`. That pass also exercised Android on Pixel 7 API 36 and performed iOS parse-only checks. Those are historical native facts, not acceptance of the current directory redesign. Native icon provenance remains the existing shield/check vector and its deterministic iOS generator, documented in `PRODUCT.md` and `DESIGN.md`.
