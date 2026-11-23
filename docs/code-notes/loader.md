# loader code notes

## packages/typert/loader/src/index.ts:apply (issue 156)

`apply` cached the resolved artifact location (`artifactPath`) and the imported manifest promise (`manifests`) for the loader's whole lifetime, so a plugin that Plugin Manager removed and remounted at a new version with the same package name got the old descriptors, and a manifest whose import or validation rejected stayed rejected for every later remount.

Fix: when an entry stops qualifying (the unmount reconciliation in `processOne`), its artifact verdict and the manifest cached for that artifact's package are dropped, and `loadManifest` drops its own cache entry when the import or validation rejects. The next mount resolves `package.json` again and imports the artifact again. A rejected import therefore recovers on the next remount instead of needing a Host restart.

Limit: Node's ES module cache is keyed by URL. HMR evicts the reloaded package's modules from that cache (`packages/boot/hmr/src/index.ts:evict`), so a re-import after an HMR update evaluates the new files; a remount outside HMR that rewrites an artifact in place at the same URL still receives the cached module until restart. A negative verdict for a package without a `./typert` export is also dropped at unmount, so an update that adds the export is picked up at the next mount.
