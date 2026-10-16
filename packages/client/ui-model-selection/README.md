---
description: "Model selection for the Web GUI: the /model popup and the composer model seat over one per-session provider-grouped directory; for users and maintainers of model routing."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-model-selection

Desktop product events use the optional [product analytics service](../product-analytics/README.md); ordinary Web interactions are excluded.

## Summary

The Web GUI lets users switch the model and reasoning effort for an existing session through either the `/model` popup or the composer's model control. Both surfaces present the same provider-grouped choices, and the selected model determines the available effort names and default. A complete selection applies to the next request; a running step keeps the model and effort it started with. If the selected model is unavailable, the composer stays disabled until the user selects an available model or that exact model becomes available again.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

DeepSeek account and API-key routes appear as separate provider groups, each exposing the same configured model catalog.

The unselected model label uses the same regular weight as an available model name and retains the saved reasoning effort caption for existing and new sessions; effort editing requires an available model. Clicking the unselected trigger opens the picker with the keyboard on the first model; Escape closes it.

Mount this plugin alongside `ui-conversation` and the commands package; the composer then shows the model seat next to the pending indicator, and `/model` opens the same directory as a popup. While the picker is open, `↑`/`↓` move focus across model rows, effort levels, and switches; Tab settles the focused model or effort; Escape and `Shift+Tab` close back to the trigger. The composer shows the catalog name while the selected model is available, the last catalog name seen during this Host generation after it leaves, and its saved `provider/model` ID when no name was seen. The stored provider, model, and reasoning effort remain unchanged.

Mouse selection uses native browser clicks, including their cancellation behavior; a press alone never selects. Opening the menu focuses its trigger, and clicking the trigger again closes the menu and returns focus there. While a selection from either entry is pending, focus stays on the trigger, the trigger shows a spinner in place of its chevron, and each row whose value the selection carries shows one in place of its check; a rejected selection leaves the menu open, and Tab returns to the current row.

### Model and effort

Models stay grouped by provider. The composer menu shows model names with each catalog description as muted meta, and effort names, with DeepSeek Account first and DeepSeek second; third-party providers retain their catalog order. The picker's side column shows the selected model's effort levels as a segmented choice. Ultracode is that choice's last level, offered only for a model that supports it; choosing it sets the Session's Ultracode and the model's highest effort, and choosing another level clears Ultracode. Ultracode asks the agent to run substantive work through the subagent and workflow tools, so it orchestrates only on presets that list them; `lean` and `minimal` list neither, so there the agent plans and checks its own work instead; their complete persona carries the instruction through its prefix. A Claude Code section holds the Fast mode switch and a Claude Code effort choice (Default, Low, Medium, High, XHigh, Max) for the current Session; they affect only Claude Code subagent runs. That section appears only while the Session carries the `claudeCodeRunOptions` capability, meaning a Claude Code provider is installed. Rapid successive changes are applied in order, each built on the latest value shown; a rejected write toasts its error and voids the changes queued behind it, so the display returns to the saved value. Tab leaves the Claude Code switches and effort choice without changing them. A Session value overrides the `subagent-claude-code` Profile default, and the client does not see the Profile default, so a known limitation is that an unset Ultracode level and trigger tag show off even when the Profile sets `ultracode: true`; choosing the level writes an explicit `true` that leaves runs unchanged. The `/model` popup shows provider names and catalog descriptions; it localizes the two built-in DeepSeek descriptions and leaves external provider descriptions verbatim. The popup applies the selected model's default effort; the composer can then choose any advertised effort. An adapter without reasoning metadata shows a no-effort note in place of the levels; there is no arbitrary effort input. The composer model list has a local search field; stars persist favorites in the browser profile and move them into a Favorites section.

The composer replaces the model and effort text with the Models icon when the expanded controls cannot share one line, and restores the text when space permits. The trigger shows an Ultracode tag with the effective effort (for example "Ultracode · Max") while Ultracode is on for a model that supports it, and a Fast tag as well when a Claude Code provider is installed. The full selection remains available in the trigger's accessible name, tooltip, and menu.

### Unroutable sessions

Catalog availability does not block sending with a saved selection; request execution reports missing credentials or unavailable models. The picker lists an unavailable saved selection as a disabled, checked row under Current session, and the trigger's accessible name says it is unavailable. When the selected model is not routable, the trigger shows a warning glyph and warning-colored label, and its tooltip says whether the provider is not configured or the model is missing from that provider's catalog. Refreshes and refresh failures retain the last displayed selection and groups. A Host reset clears that display. Sign-out hides the account provider from the picker while preserving the saved provider/model ID and reasoning effort. Signing in restores the catalog name when that model is available again. Existing session logs remain unchanged.

### Selection failures

When another writer owns the Session, model-selection failures tell the user to quit other running DSH instances and retry.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

Menus use the shared `MenuSurface` material, including the macOS backing for background blur; custom content follows the [menu rules](../../../docs/web-styling.md#component-rules).

<details>
<summary>Implementation internals — click to expand</summary>

Two entries over ONE per-session directory owned by `ModelDirectoryResolver` (`ctx.modelDirectories`): the `/model` popupSelect contribution (registered through `ctx.commandUi`) and the composer's named `conversation.input.model` seat both load the session's available directory through `session.models` and submit through `session.selectModel` via the same `ModelDirectory` instance, so a switch made in either entry is what the other shows next. Directory loads and selections share a generation counter so an older response never overwrites a newer one. The directory publishes the latest submitted selection as `pending` until it settles or a connection reset invalidates it; a connection reset drops every resident projection and repulls the Host-restored selection before display. Directories are per-session, resolved lazily, and disposed with the session scope; addressed subagent sessions expose neither entry. Every resident directory refetches directly on forwarded `llm/adapters-updated`, `settings/document-updated`, and credential update events.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the model surface is not enough. They move from the browser surfaces to the command popup shell and the selection contract.

- [ui-commands](../ui-commands/README.md) — the popupSelect shell the `/model` contribution registers into.
- [ui-conversation](../ui-conversation/README.md) — declares the composer's `conversation.input.model` seat.
- [dsh-agent-default-model](../../core/agent-default-model/README.md) — the default-model service for sessions that never choose.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `session.selectModel` selection both entries submit: the Host snapshots the complete `ModelSelection` at the next prompt-assembly boundary and owns the model-visible effect, while a running step keeps its assembled selection.

#### KV Cache effect

Switching the route can reduce or invalidate provider-side cache reuse for subsequent requests; the prompt prefix itself is untouched.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the current model surface. They are current package constraints, not a general model-router comparison or a task backlog.

- **No create-time or addressed-subagent selection** — both entries require an existing ordinary session's Agent; there is no draft-phase model choice to fold into session creation, and subagent continuation deliberately exposes no independent model-selection contract.
- **Directory names are presentation-only** — selection and persistence use provider/model/effort ids; a provider whose catalog or exact-model metadata lookup fails lists as an unselectable failure row until reload.
- **No arbitrary effort input** — the composer offers only the exact model's adapter-advertised levels; an adapter without reasoning metadata shows a no-effort note in place of the levels.
- **Picker locked by Orchestrator & Subagent Setup** — while a Session's effective Orchestrator & Subagent Setup (its own, else the global default) is enabled, the composer picker is disabled, its link opens Orchestrator & Subagent Setup, and `/model` is hidden. Models are chosen there, and a fixed orchestrator is written through the same selection command.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The plugin registers a single command contribution, and the HMR-safety spec proves that the registration is disposed correctly. The plugin emits no Cordis events and owns no cross-plugin mutable state.
