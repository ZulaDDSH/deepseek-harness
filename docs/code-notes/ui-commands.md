# ui-commands code notes

## packages/client/ui-commands/src/client/popup.ts:PopupSelectController.load

Finding 288. `load` called the provider's `options` function and attached `.then` handlers to the returned promise, so a provider that threw synchronously before returning a promise escaped `open`/`retry` after the shell had already published `open` and `pending`, leaving the picker loading with no error or Retry. A synchronous throw is now turned into a rejected promise, so it takes the same binding-checked failed path as an asynchronous rejection (error text, Retry, search retained, late settlements after dismissal or a newer binding dropped).
