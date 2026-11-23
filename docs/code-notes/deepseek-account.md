# deepseek-account code notes

## Remote logout outcome is reported (finding 59)

- `packages/credentials/deepseek-account/src/logout.ts:revokeAccount` - returns `revoked` after one accepted request, `failed` when every bounded attempt failed, and `unconfirmed` when the provider lifetime ended first (shutdown, aborted request or delay). It still never touches local account state and never restores the grant.
- `packages/credentials/deepseek-account/src/index.ts:DeepSeekAccount::revoke` - records the outcome as `revocationStatus` (`none`, `pending`, then the outcome), emits `deepseek-account/revocation` with it, and logs a warning for `failed` and `unconfirmed` so an operator can revoke the token issuer-side. The token is deliberately not retained for a later retry: persisting or holding a revoked-from-local credential would reverse the sign-out guarantee; the issuer-side recovery path is the documented retry.
- `packages/credentials/deepseek-account/src/index.ts:DeepSeekAccount::getRevocationStatus` - Host-only (not a Remote) read of the latest outcome. Status is process memory only; a restart forgets it, like the pending revocation itself.
