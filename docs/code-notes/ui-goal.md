# ui-goal code notes

## packages/client/ui-goal/src/client/GoalBar.tsx:GoalBar

Finding 106. The goal bar drew `goal.objective` as plain text, while the `/goal` input bubble
(`GoalCommandInputView`) sends the same text through the `conversation.user.text` factory, which is
where the credential mask plugin hooks in. A recognized token was therefore masked in the bubble and
readable in the persistent bar. `GoalDock` now forwards its `renderFactorySlot` and the bar renders the
objective through the same factory (`interactive: false`, `ellipsis: true`, no command facts), so every
display of the objective is masked by the same rule set. `renderFactorySlot` is optional on `GoalBar`
so a host without the factory still shows plain text. The inline edit field stays raw: it is the
user's own input and holds the value being edited. The masking stays visual only (see ui-secret-mask).
