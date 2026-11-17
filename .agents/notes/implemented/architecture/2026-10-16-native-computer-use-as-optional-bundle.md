# Agent Note: Ship native computer use as an optional bundle

Status: implemented

## Problem

The desktop app had no computer-use tools. The native Cua Driver provider worked on Windows from a repository checkout, but no installation carried it and no bundle mounted it, so a desktop user could not enable it without hand-writing a profile patch and installing packages by name. Agents without tools fell back to unrelated third-party computer-use skills.

## Decision

`@deepseek-ai/dsh-experimental-computer-use-cua-driver-native` is an optional bundle, listed in `packages/boot/app-boot/src/profile.ts:OPTIONAL_BUNDLES` and offered switched off on the Plugins page. Its `cordis.patch.yml` inserts the `@deepseek-ai/dsh-computer-use` service row and the provider row. Both packages are runtime dependencies of `apps/cli`, which `plugin-manager` `listBundles` requires before it lists a bundle.

This supersedes the computer-use part of `2026-09-21-experimental-capabilities-as-optional-bundles.md`, which kept the native provider out because its runtime binaries enlarge every install. That cost is accepted: the native closure adds about 26 MB per install (mostly the win32 `cua_driver_sdk.dll`), about 8% of the Windows installer. The Cua Driver MCP provider and the browser-use providers stay explicit compositions as that note describes.

## Alternatives considered

**Desktop-host dependency only.** Ships to the desktop and not the CLI, but the Plugins page lists only installation dependencies, so there would be no switch.

## Consequences

Every `dsh` installation carries the native Cua Driver closure whether or not the bundle is enabled. Native binaries are unpacked from the asar by the existing `**/*.{node,dylib,dll,so,exe}` rule.
