# Client code notes

English | [中文](client-render-notes.zh.md)

Explanation that would otherwise live as a comment beside the line it constrains. Each entry is anchored to a `file:symbol` and states a fact the code cannot show on its own — a renderer invariant, a lifecycle ordering, or a reason a local shape is the only one that works.

These notes are reference material for maintainers reading the owning code; the owning module's JSDoc keeps the contract itself.

## Root-scope slot entries memoize their inject result

`packages/client/ui-renderer/src/client/scoped-slots.tsx:cachedRootInject`

`settings.section` is declared `scope: 'root'` (`packages/client/ui-settings/src/client/contract/slots.ts:SlotMap`), so it renders through `RootEntry`, which resolves its props through `cachedRootInject`. That function memoizes `runInject(entry, …)` in a `WeakMap<StoredEntry, InjectedProps>` keyed by the registration, so the `inject` factory runs once and its returned object is reused for the life of that entry.

The consequence for any plugin registering into a root slot: a value captured in that object is a constant from first render onward. Re-invoking the factory — and reading a fresh field from it — never happens on its own, because nothing invalidates `rootInjectCache`.

A fact that can change after mount must therefore cross the inject face as a live source, not as a plain value. The reserved `hooks` compartment is the mechanism: the renderer strips `hooks` from the plain props, binds each entry through `observableHook`, and exposes it to the component under `use<Name>` (`standardHookPropName` capitalizes the key). Reading that hook subscribes the component, so the change arrives as an ordinary re-render.

`packages/client/ui-settings-models/src/client/index.ts:apply` publishes the credential-record revision this way — a `createSnapshotStore({ revision })` bumped by the `credentials/record-updated` subscription, consumed by `ModelsSection` as `useCredentialsRevision`. A sign-in another browser tab completes commits a credential record rather than a settings reference, so without this channel a card already mounted keeps rendering the pre-login state it read at first render.

## The application mount follows the Session scope owner

`packages/client/web/src/mount.ts:mountClient` depends on both `uiRenderer` and `uiSession`. Replacing the Session owner during client reconciliation first disposes the application mount, so React cannot render `session-maybe` while its scope adapter is absent. The mount is recreated after the replacement installs the adapter.

`packages/client/ui-conversation/src/client/apply.ts:apply` also verifies that each retained view binding is still the active Controller generation before restoring its selected view. This prevents locale or slot notifications during teardown from calling `uiConversation.binding()` for a retired Session.

`packages/extensions/cordis-client-runner/src/client/inspect-registry.ts:ClientCordisInspectRegistry` drops queued manifest syncs when its owning Client entry is replaced, so a retired Remote namespace cannot report expected teardown failures.

## Related

- [Web client architecture](../subsystems/web-client.md) — the render machinery, the three live-data channels, and the store discipline these notes depend on.
- [Slots reference](../subsystems/slots.md) — declaration, scope, and the derived props shares.
