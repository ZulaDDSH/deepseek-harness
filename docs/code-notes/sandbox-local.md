# sandbox-local code notes

## packages/sandbox/sandbox-local/src/index.ts:LocalSandboxProvider.revokeAclGrants

Finding 79: the standing workspace ACE and Low label used to outlive the provider forever. The provider only learns about a confined process through `confine()`, which returns an argv the caller spawns, so it has no per-process exit signal. The sole point where it can say "no capability for this workspace remains" is provider dispose (Host shutdown), where every temp capability of the workspace is disposed. Restore therefore runs there, once per workspace, after that workspace's workspace grant and all of its temp capabilities were disposed without failure. A temp capability whose dispose threw may still be effective, so that workspace keeps its standing grant and a warning is logged. Callers must stop confined children before the provider is disposed; the provider cannot enforce that. An unclean shutdown still leaves the standing grant, and a second Host process on the same workspace caches its own standing grant and does not re-add it, so it loses write access when the first Host restores.

## packages/sandbox/sandbox-local/src/index.ts:AclTempCapability

`workspaceRoot` records which workspace a temp capability belongs to, so the restore guard can count the unfinished capabilities per workspace.
