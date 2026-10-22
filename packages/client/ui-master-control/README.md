# @deepseek-ai/dsh-client-ui-master-control

Master Control for the web client: a sidebar entry above **Plugins** that opens a table of every session with its live state (needs attention, failed, running, idle). A row can be opened, and a running turn can be interrupted.

The table logic lives in `masterRows` (`src/client/rows.ts`). The agent-side counterpart that lets a master agent message and interrupt other sessions is [`@deepseek-ai/dsh-tool-master-control`](../../subagent/tool-master-control/README.md).

## Model Experience

None, as the package is a browser-side surface that registers nothing model-facing.
