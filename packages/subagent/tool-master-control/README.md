---
description: "Mesh messaging, live status, and interruption for enrolled loaded DSH sessions."
kind: "package-reference"
---
# Master Control tools

## Summary

The `mc_list_sessions`, `mc_send`, and `mc_interrupt` tools let enrolled loaded sessions inspect and coordinate peers. Only the shipped master preset mounts them, with every loaded peer enrolled; the standard and lean presets mount no mesh tools, so an ordinary session cannot reach another session. A selective deployment can disable `managedAll` and supply explicit session ids.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount the plugin in the agent's preset and enroll targets through `Config.managed` or `Config.managedAll`. `mc_list_sessions` reports enrolled peers and a bounded last-reply excerpt. `mc_send` steers the target; `wait` returns the reply produced by the turn that ran the message, so a failed or cancelled turn reports a note instead of an earlier answer. `mc_interrupt` stops its current turn. Self-targeting and unenrolled targets are rejected.

Two guards bound relay loops. A wait whose target is already waiting back on the caller is refused before it blocks, and a session that sends more than twelve settled relays to one peer inside a minute is refused as a message loop. The [Master Control UI](../../client/ui-master-control/README.md) opens chats and supervises the roster.

## Model Experience

### Mesh tools

#### What the model sees

The model receives the `mc_list_sessions`, `mc_send`, and `mc_interrupt` schemas. List results expose peer ids, state, and last-reply excerpts; send results report delivery plus either the delivered turn's reply or a note naming that turn's ending; a refused relay or wait returns a tool error that names the loop. Incoming peer messages name their sending agent.

#### Token effect

Tool schemas contribute to the prompt, and results and delivered messages contribute to conversation history. List reply excerpts are limited to 280 characters.

#### KV Cache effect

Tool schemas remain stable within a preset. New peer messages and results extend the session history.

## Known Limitations and Deferred Work

- Targets must be loaded in the current agent registry. Waiting for a reply can time out while the target keeps working; that timeout is reported as a tool error. Enrollment is explicit deployment policy; these tools do not discover or import external vendor transcripts. The relay window and limit are fixed safety bounds, not configuration.

### Dev Note

See [code notes](../../../docs/code-notes/deepseek-harness.md) for anchored implementation decisions.
