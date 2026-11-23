# sandbox-local code notes

## packages/sandbox/sandbox-local/src/index.ts:LocalSandboxProvider.revokeAclGrants

Finding 79: the standing workspace ACE and Low label used to outlive the provider forever. The provider only learns about a confined process through `confine()`, which returns an argv the caller spawns, so it has no per-process exit signal. The sole point where it can say "no capability for this workspace remains" is provider dispose (Host shutdown), where every temp capability of the workspace is disposed. Restore therefore runs there, once per workspace, after that workspace's workspace grant and all of its temp capabilities were disposed without failure. A temp capability whose dispose threw may still be effective, so that workspace keeps its standing grant and a warning is logged. Callers must stop confined children before the provider is disposed; the provider cannot enforce that. An unclean shutdown still leaves the standing grant, and a second Host process on the same workspace caches its own standing grant and does not re-add it, so it loses write access when the first Host restores.

## packages/sandbox/sandbox-local/src/index.ts:AclTempCapability

`workspaceRoot` records which workspace a temp capability belongs to, so the restore guard can count the unfinished capabilities per workspace.

## Refusing partial enforcement on request (finding 146)

- `packages/sandbox/sandbox-local/src/index.ts:LocalSandboxProvider::chainVerdict` - the Windows ACL rung confines writes only; reads, network access and process visibility stay unrestricted, so a deployment that relies on the sandbox for workspace confidentiality was silently running on a boundary that cannot provide it. This is not fixable inside the restricted-token mechanism, so two safe restrictions were added instead. The config field `requireFullEnforcement` (default false) makes the chain verdict `unavailable` whenever the selected rung reports `partial`, so confinement fails closed with `SANDBOX_UNAVAILABLE` instead of running; and selecting a `partial` rung logs one provider-lifetime warning naming the unrestricted reads and network. With the field set, Windows has no usable runner (the Windows rung is always partial) and a Landlock host on an older kernel ABI is refused too. An operator-supplied `runnerCommand` asserts full enforcement and is unaffected. Enforcing reads and network on Windows would need an AppContainer or similar mechanism and is not attempted here.
