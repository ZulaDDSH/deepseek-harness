# Agent Note: Shared knowledge MCP service

Status: implemented

## Problem

Several DSH machines and agents need one shared knowledge layer holding project decisions, procedures, known defects, and verified findings. Before this decision each agent could only reach knowledge through a per-deployment MCP entry, and no DSH-owned configuration expressed a shared knowledge endpoint, its credentials, or the authority split between an ordinary worker and a supervisor.

Two capabilities were missing from the existing MCP client, and both were proven before this change:

1. `StreamableHttpConfig.headers` was a literal string map (`z.dict(String)`), so a bearer token had to be written into `cordis.yml`. The stdio transport already had an env-merge seam, but the HTTP transport had none, so an authenticated LAN endpoint could not be configured without committing a credential.
2. No prompt section described how shared knowledge should be used or how it ranks against current source and runtime evidence.

Everything else the architecture requires already existed and is reused rather than rebuilt: Streamable HTTP transport, URL configuration, reconnect with a bounded attempt budget, tool discovery and re-sync, and the per-scope tool restriction layer.

## Decision

DSH remains the authority over sessions, agents, providers, tool exposure, permissions, and global agent policy. The knowledge service owns durable shared knowledge, retrieval, source attribution, and knowledge lifecycle, and never becomes the session, task, or provider authority.

The shared knowledge endpoint is one ordinary `dsh-mcp-client` entry with `transport: streamable-http`. No second transport, plugin framework, or knowledge subsystem is introduced. A LAN host, a loopback host, and multiple clients therefore need no distinct DSH code path: they differ only in the configured `url`.

`StreamableHttpConfig` gains `headerEnv`, a map from header name to environment-variable name, resolved through the existing subprocess credential seam (`scrubbedParentEnv`). A configured header name keeps a literal `headers` entry as its override, so an explicit value still wins. Resolution drops a name whose environment variable is unset or empty instead of sending an empty header, and the resolved value never enters the resolved config, a log line, or a diagnostic: only the header name and the variable name are reportable.

The authority split reuses `ctx.tools.restrict()`. A restriction already removes a global tool from a scope's view, and the executor resolves that view before dispatch, so a denied call fails as `unknown tool` before any remote execution. A prompt instructing a worker not to call a privileged tool is not the enforcement point and is not relied on.

The global knowledge policy is one `KNOWLEDGE_POLICY` prompt section, ordered before the tool sections and after `DEPLOYMENT_PERSONA_PREFIX`. It states that shared knowledge is retrieved on demand, that current source, runtime evidence, tests, and reverse-engineering proof outrank retrieved memory, and that only an authorized supervisor may verify, promote, supersede, or mark knowledge stale. No knowledge content is injected into a prompt by this section.

## Alternatives considered

**Add a DSH-owned knowledge service or database.** Rejected: `agent-memory-mcp` already provides SQLite storage, document ingestion with a recorded source path and type, hybrid retrieval, and a knowledge lifecycle. A second implementation would duplicate a maintained dependency and create the competing authoritative memory store the architecture forbids.

**Keep per-agent memory integrations.** Rejected: a per-agent memory system gives each agent a different knowledge view and cannot answer "what did we already establish", which is the purpose of a shared layer.

**Expose the token through `!!js process.env.X` in `cordis.yml`.** Rejected as the product path: it moves credential handling into every deployment's config, cannot be validated or diagnosed by the harness, and gives no way to keep the value out of a resolved-config dump. It remains available for an unusual deployment but is not what the knowledge entry documents.

**A knowledge-specific tool allow/deny list keyed to upstream tool names.** Rejected: `ctx.tools.restrict()` already filters any MCP server's tools by public name, so the capability is generic and reusable for other servers.

## Consequences

An authenticated knowledge service is configurable without a committed credential, and the same entry shape serves a loopback host, a LAN host, and every client pointing at it. A knowledge service that is down leaves DSH running: the entry reports its failure and the reconnect supervisor retries, and the tools are simply absent meanwhile.

The token is read once per connection generation. Rotating it requires reloading the entry or restarting the Host, which matches how every other MCP entry treats configuration changes.

`headerEnv` names a variable, so an operator can still misconfigure which variable holds the token; the harness validates that a named variable exists when the header is not otherwise supplied and fails the entry loudly rather than sending an unauthenticated request.

Tool restrictions are enforced per scope. A worker denied a privileged tool cannot reach it through the tool registry, and a supervisor allowed the same tool reaches it normally.
