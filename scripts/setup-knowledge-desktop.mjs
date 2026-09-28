/**
 * Enable the shared GARDEN knowledge endpoint for the Desktop profile.
 *
 * The profile is composed as patches, so this appends one MCP entry pointing at
 * the configured knowledge service. The credential is named by environment
 * variable, never written into the patch.
 *
 * Usage: node scripts/setup-knowledge-desktop.mjs [--url <endpoint>] [--token-env <name>]
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { hasKnowledgeEntry, mergeKnowledgePatch } from './setup-knowledge-desktop-lib.mjs'

const DEFAULT_URL = 'http://127.0.0.1:18080/mcp'
const DEFAULT_TOKEN_ENV = 'GARDEN_KNOWLEDGE_TOKEN'

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

/** Read one `--flag value` option. */
function option(flag, fallback) {
  const index = process.argv.indexOf(flag)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  if (value === undefined || value.startsWith('--')) fail(`${flag} requires a value`)
  return value
}

const url = option('--url', DEFAULT_URL)
const tokenEnv = option('--token-env', DEFAULT_TOKEN_ENV)

try {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    fail(`--url must be an http or https endpoint, received ${parsed.protocol}`)
  }
} catch {
  fail(`--url is not a valid URL: ${url}`)
}

const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', 'desktop')
const patchPath = join(profileDir, 'cordis.patch.yml')

if (!existsSync(profileDir)) {
  fail(`Desktop profile not found at ${profileDir}. Launch DSH Desktop once, stop it, then rerun this setup.`)
}

const currentPatch = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
if (hasKnowledgeEntry(currentPatch)) {
  process.stdout.write(`The shared knowledge entry is already enabled in ${patchPath}.\n`)
  process.exit(0)
}

writeFileSync(patchPath, mergeKnowledgePatch(currentPatch, url, tokenEnv), 'utf8')

const credentialState = process.env[tokenEnv] === undefined || process.env[tokenEnv] === ''
  ? 'is not set in this shell — export it before launching Desktop, or the knowledge entry will refuse to connect'
  : 'is set'

process.stdout.write(`Enabled the shared knowledge endpoint ${url} in ${patchPath}.\n`)
process.stdout.write(`Credential variable ${tokenEnv} ${credentialState}.\n`)
process.stdout.write('Restart DSH Desktop to load the knowledge tools.\n')
