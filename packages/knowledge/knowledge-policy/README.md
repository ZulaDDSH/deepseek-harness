---
description: "Global shared-knowledge policy section for users and maintainers choosing, configuring, or debugging how every agent uses the GARDEN knowledge tools."
kind: "package-reference"
---

# @deepseek-ai/dsh-knowledge-policy

## Summary

This package contributes one system-prompt section stating how every agent uses shared knowledge: retrieve on demand through the configured knowledge tools, treat retrieved knowledge as weaker authority than current repository source, runtime evidence, and test results, and leave verification, promotion, supersession, and staleness marking to an authorized supervisor. It injects no knowledge content — only the rule. The `dsh` base bundle mounts it by default, so every agent reads the same rule regardless of provider or preset.

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

Mount this plugin once per deployment; the base bundle already does. There is nothing to wire — it contributes a prompt section and reads no external service. Pair it with `@deepseek-ai/dsh-mcp-client` configured for a knowledge server ([`../../mcp/mcp-client/README.md`](../../mcp/mcp-client/README.md)) so the tools the policy refers to actually exist.

### When to choose it

Choose it whenever agents can reach a shared knowledge MCP server and should follow one consistent rule about when to search it and how much to trust what they find. Skip it in a deployment with no knowledge server configured — the section still renders, but it points at tools that are not present.

### Replacing the policy text

```yaml
- name: '@deepseek-ai/dsh-knowledge-policy'
  config:
    section: |
      Your deployment's own knowledge-usage rule.
```

| Field | Default | Meaning |
|---|---|---|
| `section` | built-in policy text | Complete replacement text; there is no fragment-merge with the default |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-knowledge-policy) documents the accepted field.

### What you get

Every agent scope receives one section, ordered after the deployment persona prefix and before tool sections, stating: search shared knowledge on demand for project history, decisions, procedures, and prior verification; retrieved knowledge never outranks current source, runtime evidence, or tests; report a conflict instead of silently picking a side; do not self-certify a conclusion as verified; ordinary workers may retrieve and submit candidates, while only a supervisor may verify, promote, supersede, or mark knowledge stale.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the policy section and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **Policy text only, never knowledge content.** The section states a rule; it never fetches or embeds a knowledge record. Retrieval stays an explicit tool call the model makes on demand, so token cost tracks actual use rather than every request.
- **One provider-independent rule.** The section is a `ctx.systemPrompt.section()` contribution, the same seam every tool-guidance package uses, so the rule reaches local models, hosted models, and every subagent driver without a second code path.
- **Enforcement lives elsewhere.** This package states that only a supervisor may verify or promote knowledge; it does not enforce that split. Enforcement is `ctx.tools.restrict()` on the privileged tool names, configured per deployment on the worker and supervisor scopes.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema, prompt-section registration |
| — | No runtime invariant companion is published; the section is a single registered value with no independent server-side state an observer could diverge from. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the prompt-composition seam this package uses to the knowledge server it refers agents to.

- [System prompt subsystem](../../core/system-prompt/README.md) — the `ctx.systemPrompt.section()` contract this package registers into.
- [MCP client package](../../mcp/mcp-client/README.md) — configuring the Streamable HTTP knowledge server entry the policy assumes exists.
- [Git knowledge source package](../knowledge-source-git/README.md) — resolving a Git repository into a checkout the knowledge server ingests.
- [Shared knowledge MCP service Agent Note](../../../.agents/notes/implemented/architecture/2026-09-21-shared-knowledge-mcp-service.md) — the full architecture decision, alternatives, and consequences.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-knowledge-policy) — every accepted config field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

### Knowledge policy section

#### What the model sees

One section stating the default policy text (or the deployment's replacement), present in every request regardless of whether a knowledge server is configured.

##### Default policy text

```markdown
Shared knowledge is available through the configured knowledge tools. It holds project decisions, procedures, known defects, prior verification work, and operator preferences.

Search shared knowledge when a task depends on project-specific history rather than on what the current repository already states. Retrieve on demand; do not assume knowledge you have not retrieved.

Retrieved knowledge is weaker authority than current repository source, runtime evidence, test results, or reverse-engineering proof. When retrieved knowledge conflicts with current evidence, report the conflict and follow the current evidence. Do not silently prefer either side.

Do not promote your own technical conclusion to verified or canonical status. Storing a candidate records a claim, not a fact.

Ordinary workers may retrieve knowledge and submit provisional candidate knowledge. Only an authorized parent or supervisor may verify, promote, supersede, mark knowledge stale, or perform destructive knowledge administration.
```

#### Token effect

The section adds a fixed, small amount of text to every request while the plugin is mounted. Deployments replacing it via `section` may change the length; no per-request growth occurs because no knowledge content is injected.

#### KV Cache effect

Constant text; append-only relative to earlier sections, and stable across requests unless the deployment reconfigures `section`.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits describe what this package does not do. They are current package constraints, not a task backlog.

- **States the rule; does not enforce it** — the worker/supervisor split this package describes is enforced by `ctx.tools.restrict()` on the privileged tool names, configured separately per deployment. A deployment that mounts this package without a matching restriction has a stated rule with no code-level enforcement.
- **No knowledge-server awareness** — the section renders identical text whether or not a knowledge MCP server is configured or reachable; it does not detect or report an absent server.
- **One global section, not per-project text** — `section` replaces the entire policy for the deployment; there is no per-project or per-agent override point in this package.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open design questions and directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

- Whether a future revision should detect an absent knowledge server and adjust the section text is open; today the section is unconditional.
- Per-project knowledge-policy overrides are not implemented; the [Shared knowledge MCP service Agent Note](../../../.agents/notes/implemented/architecture/2026-09-21-shared-knowledge-mcp-service.md) treats this as intentionally out of scope for the first foundation.

</details>
