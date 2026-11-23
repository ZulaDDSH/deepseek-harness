# ui-provider-quota code notes

## packages/client/ui-provider-quota/src/client/usage-prompt.ts:localUsagePromptStore

Finding 175 (getter) and 199 (methods). The default storage argument evaluated `typeof localStorage`
at call time and threw when the getter is blocked; it now uses `browserStorage()` from
`@deepseek-ai/dsh-client-store`. The store's `getItem`/`setItem`/`removeItem` calls were unguarded, so
a quota or policy error rejected controller construction, dismissal, and a provider switch after the
remote setting had already changed. Every storage call is now wrapped: a read failure reads as no
saved value, a write or remove failure is ignored, and the in-memory prompt state keeps working for
the page.
