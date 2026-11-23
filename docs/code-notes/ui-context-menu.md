# ui-context-menu code notes

`packages/client/ui-context-menu/src/client/registry.ts:isThenable` Provider results are classified by a callable `then`, not `instanceof Promise`, because a promise from another realm (an iframe-backed plugin) fails the same-realm check and would be projected as an action array; the result is adopted through `Promise.resolve` so its rejection and the preparation deadline are attached.

`packages/client/ui-context-menu/src/client/registry.ts:MenuRegistry.resolve` A resolver can withdraw its own provider or dispose the menu before returning a pending promise, so the preparation signal is already aborted when its abort listener is installed and the event is never replayed; the registry settles the preparation immediately in that case, and the deadline callback only reports a timeout while the signal is still live.
