# store code notes

## packages/client/store/src/index.ts:browserStorage

`packages/client/store/src/index.ts:browserStorage`: Finding 175. `typeof localStorage` invokes the window property getter, which throws a SecurityError in opaque-origin or storage-blocked contexts, and it sat outside every try block, so store construction (`attachPersistence`), `clearPersisted` and the other persisted client stores failed instead of falling back to memory. `browserStorage()` is the single guarded accessor: it returns the page's localStorage, or undefined when it is absent or its getter throws. `attachPersistence` and `clearPersisted` use it; ui-conversation, ui-sidebar-right and ui-provider-quota import it for their own reads and writes. Method failures (getItem/setItem/removeItem) stay handled at each call site.
