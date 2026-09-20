# DeepSeek Harness code notes

- `packages/llm/llm-jev-router/src/index.ts:apply`: Jev is a decision endpoint, not an LLM adapter. The plugin classifies admitted agent-step messages in `agent/pre-step`, caches the result for retries, and applies an allow-listed provider/model in `agent/request`. It is disabled by default and resolves its API credential per request.
- `packages/llm/llm-jev-router/src/index.ts:Config`: `enabled` controls activation; `apiKeyEnv` is a credential reference; `endpoint` and `model` select TypeSafe; `timeoutMs`, `minConfidence`, and `stateMaxChars` bound the decision; `fallback` and `failOpen` define failure behavior; `routes` is the provider/model allowlist.
- `packages/llm/llm-jev-router/src/index.ts:JevRoute`: `id` is the Jev choice; `provider`, `model`, and optional `reasoningEffort` are the DSH destination; `description` is sent as Jev choice criteria.
