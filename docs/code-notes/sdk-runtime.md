# sdk-runtime code notes

## python/sdk-runtime/runtime-bootstrap.mjs:resourceProblem (issues 127, 128)

The packaged bootstrap used the bare existence of `<cache>/<identity>/<kind>/complete` as proof of a usable cache. Python's `office_launch_args` compares the marker content with the manifest identity and checks the sidecar files, so a restored or damaged cache was rejected by Python and accepted by the Node Host, and `downloadResource` returned a damaged completed directory on every retry.

`resourceProblem(kind, directory)` returns a reason string or `undefined`. It requires the marker content to equal `downloads.identity`. For `office` it requires `node/bin/node[.exe]` and `node_modules/@deepseek-ai/libreoffice-kit/lib/cli.js`, the same files `_resources.py:office_launch_args` checks. For `primary` it requires a parseable `primary-runtime/runtime.json` and, when that manifest names a Python version (a real payload), the interpreter, `site-packages` and Node paths that `_resources.py:validate_resources` checks; the layout is duplicated here, so a change to either side must change both.

Automatic Office discovery (127): an invalid cache is ignored with a stderr warning and no import hook is installed. An explicit `DSH_OFFICE_SIDECAR` keeps its own trust model. The automatic primary selection is unchanged: a damaged selected payload still fails startup in `resolvePrimaryRuntime` rather than silently selecting system pnpm.

Explicit download (128): `downloadResource` treats a present but invalid completed directory as damaged and moves it to a unique `.<kind>-damaged-*` sibling with `rename` (atomic, so two repairing processes cannot both move it; the loser sees ENOENT and proceeds), then downloads from the verified archives and removes the damaged copy. Validity is re-checked immediately before the move so a copy another process just repaired is not moved. Ceiling: a repair by process B that lands between process A's recheck and A's move can still make A move B's fresh copy; A then republishes, so the end state is valid, but B's returned path can be momentarily absent. A cross-process lock is the upgrade if this is observed.

Python consumers are unchanged and unverified here (no Python on the review machine); they already compare the marker and files.
