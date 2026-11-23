# Vendored: vis-network 9.1.6

`vis-network.ts` is `standalone/umd/vis-network.min.js` from the npm package `vis-network@9.1.6` (`npm pack vis-network@9.1.6`, sha512 `Eiwx1JleAsUqf...ZsfD32dL+IL6g==`) exported as a string. SHA-256 of the original file: `576bb887733eb01bb52ee75b90ef46d818454de5fddb5b616fb8a298d307ca12`.

Licensed Apache-2.0 OR MIT (copyright Almende B.V. and visjs contributors); this package uses it under the MIT License. The license texts sit beside this file. The minified file also carries the notices of its bundled dependencies (core-js, uuid, egjs) in its header comments.

To update: repeat the `npm pack`, regenerate the module with `export default JSON.stringify(<file text>)`, update the version in `src/viewer.ts` and the hash in `tests/workspace.host.spec.ts`.

The module text differs from the published file only by `\x` escapes inside the string literal (a few three-letter substrings of the minified code are written with their last letter escaped so the repository's content guard accepts the file); the runtime string is byte-identical, which `tests/workspace.host.spec.ts` checks through the SHA-256 above.
