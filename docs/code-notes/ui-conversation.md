# ui-conversation code notes

## packages/client/ui-conversation/src/client/stores.ts:readConversationDraft

Finding 175. Both readers called `typeof localStorage` outside their try blocks, so a throwing
property getter escaped. They now resolve storage through `browserStorage()` from
`@deepseek-ai/dsh-client-store`, which swallows the getter failure, and return the empty draft or null
preference as for any unavailable storage.
