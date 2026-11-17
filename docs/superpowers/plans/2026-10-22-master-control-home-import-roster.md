# Master Control home, import, and roster implementation

Reference plan for [the design](../specs/2026-10-22-master-control-home-import-roster-design.md).

## Decisions

- Continue imported user/assistant text with the DSH standard agent. Vendor tools, instructions, attachments, permissions, and live sync are excluded.
- Discover recent top-level Claude project logs and Codex session logs on the host. Show at most 100 newest candidates; report malformed or oversized files per row. Do not read vendor credentials or databases.
- Preview text and omitted-content limits before importing. Never execute imported instructions during import.
- Use a deterministic DSH identity derived from source and absolute transcript path for duplicate protection. Existing imports are opened or skipped, never replaced.
- Give home sessions a reserved identity prefix, a durable Master Control title, the master preset, and no workspace membership. Resolve on the host, serialize repeated clicks, and recreate after deletion or archival. Do not adopt arbitrary master-preset sessions.
- Use existing workspace membership to group rows, omit the home, sort newest first within groups, and filter title/cwd and current status.
- Preserve the existing uncommitted mesh work as the implementation baseline and include its focused tests in local validation.

## Work

- [x] Inspect existing create, title, history, workspace, and mesh paths and sample external record shapes without displaying private transcript text.
- [x] Implement dedicated home resolution and regression checks for repeated clicks, unrelated master sessions, and archival.
- [x] Implement bounded host discovery, preview, text parsing, duplicate handling, and durable DSH import with balanced history events.
- [x] Add import selection and per-row outcomes to Master Control.
- [x] Add workspace groups and title/cwd/status filters.
- [x] Run focused host and client tests, relevant type checks, and independent Luna Low Ponytail review; fix findings.
- [x] Reconcile this plan with exact evidence and remaining runtime acceptance.

## Acceptance

Automated checks must prove imported text enters derived model history, import does not run a model, duplicate imports preserve the existing session, and parsing failures cannot corrupt other sessions. Browser acceptance must open the same ungrouped home twice, preview/import/open a transcript, show its history, and send a follow-up through DSH. Report automated and live acceptance separately; a green unit suite does not establish a real provider follow-up.

## Validation record

Validated locally on 2026-10-22 in `D:/Projects/MyAIGUI/DeepSeekHarness/git/master-home-import-roster`, branch `feat/master-home-import-roster`, based on PR #121 (`feat/master-control`). The implementation is uncommitted and includes the preserved mesh-work baseline; the original checkout was left unchanged.

- Focused host/client/mesh suite: 11 files, 107 tests passed. Import tests cover no model call during import, duplicate preservation, malformed-file isolation, imported model history, and persistence after follow-up and reopen.
- Chromium scaffold: `apps/web/tests/master-control.e2e.ts` passed with a temporary Claude fixture. It exercised repeated home opening, preview/import/open, workspace grouping, search/status filters, a composer follow-up containing imported user/assistant history, and history after reload. The provider was a MockAdapter.
- Full repository build, final host bundle, host/client TypeScript builds, changed-source lint, frozen offline dependency install, and generated API freshness passed.
- Documentation checks: 19 passed, zero failed or skipped.
- Independent read-only Luna Low Ponytail review found no remaining concrete issue after fixes; delete-list was empty.

Evidence logs and the browser screenshot are retained locally under `.artifacts/`. These results establish the exercised local host/client path and mock-provider continuation. A real provider follow-up and an installed desktop profile were not tested; no installation, commit, push, or merge was performed.
