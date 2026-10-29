# Agent Note: Charcoal dark theme and font family setting

Status: implemented

## Problem

The dark palette is a mid-grey brown and the only text controls are light/dark/system and a size stepper, so the UI looks heavier than Claude Desktop and the default typeface is hard to read for some users.

## Decision

1. **Charcoal palette** — retune the `--dsw-static-neutral-warm-*` steps (base rgb(26,26,25), sidebar rgb(18,18,17)) and the dark literals that cannot reference them (menu fill, drop mask, think gradients, boot canvas `#1a1a19`). The light palette never uses these steps.
2. **Font family** — a new `fontFamily` field in the `ui-theme` settings namespace with five presets: `default`, `readable`, `serif`, `dyslexia`, `mono`. A preset overrides `--dsw-font-family` on `body`; both the boot script and `ThemePresenter` write it. A Font row in Settings > General (order 12) lists the presets, each shown in its own typeface.

## Alternatives considered

**Bundle web fonts.** Rejected: adds download weight and licensing for a first cut; presets name installed system fonts (Atkinson Hyperlegible and OpenDyslexic are used when present, with Verdana and Comic Sans fallbacks).

**Free-text font name.** Rejected: a typo silently falls back, and the value would flow into CSS unvalidated.

## Consequences

- Existing settings documents without `fontFamily` read the schema default (`default`), so no migration is needed.
- Surfaces with hard-coded dark colors outside the token sheets stay as they were.
