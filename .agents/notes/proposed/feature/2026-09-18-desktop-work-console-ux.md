# Agent Note: Desktop work console UX

Status: proposed

English | [中文](2026-09-18-desktop-work-console-ux.zh.md)

## Problem

The Electron shell already provides a secure local application window, native title bars, update handling, recovery, and an authenticated Host proxy, but the primary work surface still behaves like a dense browser tree. The current workspace browser makes users infer agent state from small status dots, reveals many row actions only on hover, scrolls long session titles on hover, and swaps the workspace folder glyph for the disclosure chevron on hover. The root layout store does not persist user-selected sidebar or right-panel widths. There is no single keyboard surface for switching among sessions, workspaces, and commands, and desktop attention is not used for agent approvals, questions, completion, or failures.

Current source evidence:

- `packages/client/ui-workspace/src/client/rows/Rows.tsx` derives approval, plan-review, question, running, subagent, completed, and idle status but normal rows present the primary state mainly through `StateDot`.
- `packages/client/ui-workspace/src/client/rows/Rows.module.css` hides row actions until hover, hides the workspace disclosure chevron until hover, swaps the folder glyph out on hover, and enables horizontal title scrolling on hover.
- `packages/client/ui-layout/src/client/stores.ts` has no `persist` key, while `packages/client/ui-workspace/src/client/stores.ts` already persists browser preferences.
- `packages/client/web/src/boot-page.ts` exposes only generic plugin-loading copy even though the desktop launch sequence has distinct Host and application phases.
- `apps/desktop/src/main.ts` owns native attention mechanisms for updates but does not project agent attention into desktop notifications.
- `packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx` is 1,406 lines, `Rows.tsx` is 545 lines, and `apps/desktop/src/main.ts` is 788 lines. These files combine multiple responsibilities and make focused UX changes harder to review.

These observations are the baseline for the work below. Product behavior changes must add focused tests before replacing the observed behavior, then run the narrow GUI and desktop checks that cover the changed surface.

## Proposal

Turn the desktop product into an agent work console without replacing the existing Electron or client-plugin architecture.

1. Make session attention explicit in the workspace browser. Show compact text states for running, needs-attention, completed, and idle sessions. Keep status semantics derived from the existing session state.
2. Keep disclosure controls stable. Do not move the workspace chevron or row actions solely because the pointer entered a row. Replace title marquee behavior with stable truncation plus existing hover detail.
3. Persist user-selected layout preferences while keeping responsive concessions transient.
4. Add a focus presentation that collapses navigation and secondary panels around the current session using the existing layout store.
5. Add a command switcher for sessions, workspaces, and existing commands on `Ctrl/Cmd+K`.
6. Add a compact activity view grouped by needs-attention, running, and recently finished work.
7. Add desktop notifications for approval, question, plan-review, completion, and failure transitions. Notification activation restores the existing window and selects the related session.
8. Replace the generic desktop boot presentation with visible startup phases when the Electron boot API can report them.
9. Split the large workspace-browser and Electron-main files only where the extraction supports these features and keeps each new source file focused.

The work reuses the existing session status derivation, slot system, layout store, command package, Electron preload model, and update-attention pattern. It does not introduce a second UI framework or a second desktop state model.

## Staging

The PR is intentionally developed in reviewable slices on one draft branch:

1. Baseline tests and navigation-row clarity.
2. Layout persistence and focus mode.
3. Command switcher and activity view.
4. Desktop notifications.
5. Desktop boot phases.
6. File extractions needed by the completed behavior.
7. Exact-head verification and visual review.

Each slice must leave the prior behavior traceable through tests and must not replace unrelated Electron update, signing, Host-authentication, or recovery code.

## Alternatives considered

**Rewrite the Electron application around a desktop-only UI.** Rejected because the existing client plugin, slot, session-status, and layout systems already expose the required state and behavior. A second UI stack would duplicate routing, accessibility, localization, and state ownership.

**Keep the existing sidebar and add only cosmetic styling.** Rejected because the main problems are information priority and interaction cost, not color or spacing. Status hidden behind hover and color-only indicators would remain.

**Create a separate desktop state model for activity and notifications.** Rejected because the unified Session status projection already owns running, pending-interaction, and completion facts. Desktop behavior should consume that projection rather than maintain another source of truth.

## Acceptance criteria

- A session that needs approval, an answer, or plan review is identifiable without hover.
- A running session is identifiable without interpreting a color-only dot.
- Workspace disclosure controls remain visible and do not swap with folder icons on pointer hover.
- Long session names remain stable under hover and expose full text through the existing detail surface.
- User-selected sidebar and right-panel widths survive a reload; responsive auto-collapse does not overwrite those preferences.
- Focus mode can be entered and exited without losing the current session or saved panel widths.
- `Ctrl/Cmd+K` opens one searchable surface that can navigate to sessions and workspaces and execute registered commands.
- The activity view separates needs-attention, running, and recent completed work using existing session state.
- Desktop notifications fire only on meaningful attention transitions and do not duplicate on ordinary state refreshes.
- Desktop boot reports meaningful launch phases and retains the existing failure path.
- Changed source files remain focused and are split when a file would otherwise stay substantially above 500 lines without a maintenance reason.
- Focused tests cover every changed behavior, followed by `pnpm run test:gui`; assembled visible changes also run `DSH_SNAPSHOT=replay pnpm run test:web`. Desktop shell changes run the relevant `apps/desktop` unit tests and local Electron qualification where applicable.

## Risks

- Persisted layout preferences can restore stale geometry if responsive state is stored with them; startup must reset runtime-only state while retaining explicit width preferences.
- Focus mode can hide the only visible escape control on platform-specific titlebars; every supported desktop layout must keep a direct exit affordance.
- Activity and notification projections can become noisy if ordinary refreshes are treated as transitions; notifications must deduplicate stable state.
- A command switcher can overwrite or steal focus from an unsent composer draft if implemented through the composer; it needs an independent navigation surface.
- Splitting large files while changing behavior can obscure regressions; extraction should follow proven behavior boundaries.
