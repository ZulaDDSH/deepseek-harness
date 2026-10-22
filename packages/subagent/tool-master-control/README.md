# @deepseek-ai/dsh-tool-master-control

Three tools for a root "master" agent: `mc_list_sessions`, `mc_send` (steers a session, starting a turn if it is idle) and `mc_interrupt` (stops the current turn). Unlike `send_message` and `interrupt_agent`, they reach any enrolled session, not just direct children.

Only a root agent may call them. The shipped `master` agent preset mounts this plugin with `managedAll: true` so every loaded session is enrolled. For a selective list, set `managedAll: false` and `managed` to session ids. Only sessions that are currently loaded can be reached.

## Model Experience

The model sees three tools, `mc_list_sessions`, `mc_send` and `mc_interrupt`, only in the shipped `master` preset. Their descriptions add a few hundred tokens to the tool list of that preset's sessions; no other preset is affected.
