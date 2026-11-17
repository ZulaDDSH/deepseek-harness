import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { backupExistingDatabase } from '../packages/bundle/web-app/src/memorix.ts'
import { hasMemorixEntry, mergeMemorixPatch } from './setup-memorix-desktop-lib.mjs'

const MEMORIX_VERSION = '1.9.10'

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', 'desktop')
const manifestPath = join(profileDir, 'package.json')
const patchPath = join(profileDir, 'cordis.patch.yml')

if (!existsSync(manifestPath)) {
  fail(`Desktop profile not found at ${profileDir}. Launch DSH Desktop once, stop it, then rerun this setup.`)
}

const cliPath = join(profileDir, 'node_modules', 'memorix', 'dist', 'cli', 'index.js')
const currentPatch = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
let installedVersion
try {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  installedVersion = manifest.dependencies?.memorix
} catch (error) {
  fail(`Could not read Desktop profile manifest: ${error instanceof Error ? error.message : String(error)}`)
}
if (installedVersion === MEMORIX_VERSION && existsSync(cliPath) && hasMemorixEntry(currentPatch)) {
  process.stdout.write(`Memorix ${MEMORIX_VERSION} is installed and already enabled in the Desktop profile.\n`)
  process.exit(0)
}

try {
  const backup = backupExistingDatabase()
  if (backup !== undefined) process.stdout.write(`Backed up the existing Memorix database to ${backup}.\n`)
} catch (error) {
  fail(`Could not back up the existing Memorix database; setup stopped before changing the Desktop profile: ${error instanceof Error ? error.message : String(error)}`)
}

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const install = spawnSync(
  pnpm,
  ['add', '--save-exact', '--ignore-scripts', `memorix@${MEMORIX_VERSION}`],
  { cwd: profileDir, stdio: 'inherit', shell: process.platform === 'win32' },
)

if (install.error) fail(`Failed to start pnpm: ${install.error.message}`)
if (install.status !== 0) fail(`pnpm exited with status ${install.status ?? 'unknown'}`)

if (!existsSync(cliPath)) {
  fail(`Memorix CLI was not installed at ${cliPath}`)
}

const patchAfterInstall = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
if (hasMemorixEntry(patchAfterInstall)) {
  process.stdout.write(`Memorix ${MEMORIX_VERSION} is installed and already enabled in the Desktop profile.\n`)
  process.exit(0)
}

writeFileSync(patchPath, mergeMemorixPatch(patchAfterInstall, cliPath), 'utf8')
process.stdout.write(`Installed memorix@${MEMORIX_VERSION} and enabled it for the Desktop profile. Restart DSH Desktop to load memory tools.\n`)
