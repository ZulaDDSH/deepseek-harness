import { existsSync, readFileSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const MEMORIX_VERSION = '1.3.0'
const MEMORY_ENTRY_ID = 'memory-memorix'

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', 'desktop')
const manifestPath = join(profileDir, 'package.json')
const patchPath = join(profileDir, 'cordis.patch.yml')

if (!existsSync(manifestPath)) {
  fail(`Desktop profile not found at ${profileDir}. Launch DSH Desktop once, then rerun this setup.`)
}

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const install = spawnSync(
  pnpm,
  ['add', '--save-exact', `memorix@${MEMORIX_VERSION}`],
  { cwd: profileDir, stdio: 'inherit', shell: false },
)

if (install.error) fail(`Failed to start pnpm: ${install.error.message}`)
if (install.status !== 0) fail(`pnpm exited with status ${install.status ?? 'unknown'}`)

const cliPath = join(profileDir, 'node_modules', 'memorix', 'dist', 'cli', 'index.js')
if (!existsSync(cliPath)) {
  fail(`Memorix CLI was not installed at ${cliPath}`)
}

const currentPatch = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
if (new RegExp(`(^|\\n)\\s*-?\\s*id:\\s*${MEMORY_ENTRY_ID}(\\s|$)`, 'u').test(currentPatch)) {
  process.stdout.write('Memorix is already enabled in the Desktop profile.\n')
  process.exit(0)
}

const separator = currentPatch.length === 0 || currentPatch.endsWith('\n') ? '' : '\n'
const patch = `${separator}- insert:
    - id: ${MEMORY_ENTRY_ID}
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: memorix
        transport: stdio
        command: !!js process.execPath
        args:
          - ${JSON.stringify(cliPath)}
          - serve
        env:
          ELECTRON_RUN_AS_NODE: "1"
        cwd: !!js process.cwd()
`

appendFileSync(patchPath, patch, 'utf8')
process.stdout.write(`Installed memorix@${MEMORIX_VERSION} and enabled it for the Desktop profile. Restart DSH Desktop to load memory tools.\n`)
