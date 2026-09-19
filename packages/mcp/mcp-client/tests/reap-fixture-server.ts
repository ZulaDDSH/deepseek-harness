/**
 * Fixture server for the stdio disposal regression: a real MCP server that
 * answers `initialize` and `tools/list`, then exits while a detached
 * descendant inherits its stdio.
 *
 * The descendant outlives the child and keeps the inherited pipes open, so the
 * child emits `exit` while the transport's `close` event never arrives. That is
 * the state in which a pid captured before `close` no longer names the child.
 *
 * Run: node --import tsx reap-fixture-server.ts <marker-path>
 */
import { writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'

const markerArg = process.argv[2]
if (markerArg === undefined) throw new Error('reap-fixture-server needs a marker path argument')
const markerPath: string = markerArg

// A URL keeps the dynamic import valid on Windows, where a bare drive path is
// not an accepted ESM specifier.
const fixtureServer = new URL('./fixture-server.ts', import.meta.url).href

// A startup crash must not read as the disposal behavior under test.
process.on('uncaughtException', (error: unknown) => {
  process.stderr.write(`WRAPPER_FAILED: ${String(error)}\n`)
  process.exit(9)
})
process.on('unhandledRejection', (error: unknown) => {
  process.stderr.write(`WRAPPER_FAILED: ${String(error)}\n`)
  process.exit(9)
})

void import(fixtureServer)

/** Exit after handing stdio to a descendant that holds the pipes open. */
function finish(): void {
  process.on('SIGTERM', () => {})
  const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'inherit',
    detached: true,
  })
  grandchild.unref()
  writeFileSync(markerPath, String(grandchild.pid ?? ''))
  process.exit(0)
}

setTimeout(finish, 1_500)
