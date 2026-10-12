# Agent Note: Remove the launch credential gate

Status: implemented

## Problem

Launching the Desktop or Web client showed a welcome window or first-run onboarding dialog that asked for a DeepSeek sign-in or API key before the workspace opened. Users who wanted to start with the harness had to get past a credential menu first, and the onboarding step ordering (welcome notice, credential, account introduction) kept growing with every new entry.

## Decision

The launch path opens the workspace directly. The Desktop welcome window, the Desktop onboarding overlay, the Web welcome notice, and the DeepSeek onboarding dialog are removed together with their wiring, locales, analytics events, and tests. Sign-in stays reachable from the account menu, and API-key entry stays reachable from Settings > Models, where the Models page keeps its first-run setup card for a provider without a key.

The `settings.onboarding` and `settings.models.sign-in` slots are removed. Persisted settings from earlier installs keep loading: the settings schemas are non-strict, so a retired `welcomeNoticeVersion` or `ui-onboarding` value passes through as an unknown key.

## Alternatives considered

- Hide the onboarding behind a configuration flag. Rejected: the dead components, slots, and locales would still ship and need maintenance for a path no user takes.
- Keep the welcome window and skip it when a credential exists. Rejected: a signed-out user still meets the gate on first launch, which is the behavior being removed.
- Delete the setup card on the Models page as well. Rejected: it is an in-page posture for a provider without a key, not a launch gate, and removing it would leave no obvious place to add a first key.

## Consequences

- Launch no longer depends on a credential; a signed-out user reaches the workspace and can sign in or enter a key later.
- The notice-version field stays declared in the `ui-settings-general` Config so older configuration files load. No current code reads or writes it.
- The desktop and web e2e suites that drove the removed dialogs are deleted; the remaining Models and account specs cover the reachable entry points.
