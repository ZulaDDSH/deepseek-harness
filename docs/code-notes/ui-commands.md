# ui-commands code notes

## packages/client/ui-commands/src/client/popup.ts:PopupSelectController.load

Finding 288. `load` called the provider's `options` function and attached `.then` handlers to the returned promise, so a provider that threw synchronously before returning a promise escaped `open`/`retry` after the shell had already published `open` and `pending`, leaving the picker loading with no error or Retry. A synchronous throw is now turned into a rejected promise, so it takes the same binding-checked failed path as an asynchronous rejection (error text, Retry, search retained, late settlements after dismissal or a newer binding dropped).

## packages/client/ui-commands/src/client/service.ts:CommandService.execute

A claimed command submission returns an error outcome for a handler error result whether or not it carries attachments, so the composer keeps the typed draft for correction; the durable command lifecycle display is unchanged and the command is executed once, because the outcome is derived from the single `commands.execute` response.
