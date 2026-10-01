---
description: "Bounded GitNexus and Graphify retrieval and explicit learning writes."
kind: "package-reference"
---

# @deepseek-ai/dsh-knowledge-router

English | [中文](README.zh.md)

## Summary

Retrieve bounded knowledge from configured GitNexus and Graphify MCP servers. Manual mode exposes retrieval; assisted mode also delegates tasks with retrieved packets. Providers and learning writes require explicit enablement. Memorix remains a separate MCP integration.

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

Mount the router after the configured MCP clients.

### When to choose it

Use the router for bounded code queries or earlier findings.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-knowledge-router'
  config:
    mode: manual
    gitnexus: { enabled: true, serverName: gitnexus }
```

| Field | Default | Meaning |
|---|---|---|
| `mode` | `off` | Enables manual retrieval or assisted delegation. |
| `gitnexus.enabled` / `graphify.enabled` | `false` | Admits the provider to retrieval. |
| `maxPacketBytes` | `4096` | Bounds the packet in UTF-8 bytes. |
| `learning.enabled` | `false` | Registers supervisor learning writes. |

The [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-knowledge-router) lists every field. The [optional overlay](../../../apps/cli/config/examples/knowledge/graphify-gitnexus.cordis.yml) requires separately installed provider commands.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Nested provider calls retain their enclosing execution. Assisted workers obey the subagent service's depth limit. Learning rejects delegated workers, appends validator identity to the saved answer, and reports reflection failure separately after a successful save.

| Source | Responsibility |
|---|---|
| [src/index.ts](src/index.ts) | Configuration, retrieval, and delegation. |
| [src/packet.ts](src/packet.ts) | Rendering and byte limits. |
| [src/graphify-learn.ts](src/graphify-learn.ts) | Learning and freshness commands. |

No runtime invariant companion is published: packets derive from registry and provider results without independently maintained state.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Knowledge packages](../README.md)
- [MCP client](../../mcp/mcp-client/README.md)
- [Tools subsystem](../../../docs/subsystems/tools.md)

-----

<a id="model-experience"></a>
## Model Experience

### Tools

#### What the model sees

`knowledge_query` retrieves a bounded packet. `knowledge_delegate` starts a continuable worker with that packet or the original task. Disabled and disconnected providers are unavailable. Optional `knowledge_record` saves findings; `reflectionError` reports a reflection failure after a successful save.

#### Token effect

Enabled tools add schemas to requests and recorded results to the conversation. No system-prompt text is added.

#### KV Cache effect

Mode and learning changes alter the tool-definition prefix. Results extend the conversation after its reusable prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

Providers and their data belong to the deployment.

- Provider executables are not bundled. Real-provider tests skip when commands are unavailable; fixtures validate the router independently.
- Graphify learning runs a configured host command outside the filesystem sandbox. Enable it only for a trusted provider and memory location.
- Auto permission review does not support generic nested provider dispatch; these calls fail closed.
- Missing provider freshness remains `unknown`. Lesson freshness for a custom Graphify memory directory remains unknown because `explain` cannot select that directory.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
