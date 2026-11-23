# ui-sidebar-right code notes

## packages/client/ui-sidebar-right/src/client/persistence.ts:readSidebarLayout

Finding 175. `readSidebarLayout`, `writeSidebarLayout` and `clearSidebarLayout` tested
`typeof localStorage` outside their try blocks, so a throwing storage getter broke sidebar creation.
They now use `browserStorage()` from `@deepseek-ai/dsh-client-store` and treat an undefined result as
no persistence.
