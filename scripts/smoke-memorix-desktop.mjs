import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { spawn, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const temp = mkdtempSync(join(tmpdir(), 'dsh-memorix-smoke-'))
const home = join(temp, 'home')
const profile = join(home, 'profiles', 'desktop')
const project = join(temp, 'project')
const data = join(temp, 'memorix-data')
const token = 'garden-memorix-' + Date.now() + '-' + process.pid

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    shell: false,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error([
      'Command failed: ' + command + ' ' + args.join(' '),
      result.stdout ?? '',
      result.stderr ?? '',
    ].filter(Boolean).join('\n'))
  }
  return result
}

async function waitForMemorixStart(electron, cliPath) {
  await new Promise((resolve, reject) => {
    const child = spawn(electron, [cliPath, 'serve', '--cwd', project, '--mode', 'micro'], {
      cwd: project,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', MEMORIX_DATA_DIR: data, MEMORIX_SQLITE_DRIVER: 'node' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stderr = ''
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.stdin.end()
      child.kill()
      if (error) reject(error)
      else resolve()
    }
    const timer = setTimeout(() => {
      finish(new Error('Timed out waiting for Memorix MCP startup. stderr:\n' + stderr))
    }, 20000)
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => {
      stderr += chunk
      if (stderr.includes('MCP Server running on stdio')) finish()
    })
    child.once('error', finish)
    child.once('exit', code => {
      if (!settled) finish(new Error('Memorix MCP exited before readiness with code ' + String(code) + '. stderr:\n' + stderr))
    })
  })
}

try {
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-profile-desktop',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  }, null, 2) + '\n')
  writeFileSync(join(profile, 'cordis.patch.yml'), '# test profile patch\n[]\n')
  writeFileSync(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')

  run(process.execPath, ['scripts/setup-memorix-desktop.mjs'], { env: { DSH_HOME: home } })

  const memorixManifest = JSON.parse(readFileSync(join(profile, 'node_modules', 'memorix', 'package.json'), 'utf8'))
  assert.equal(memorixManifest.version, '1.3.0')

  const patch = readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /id:\s*memory-memorix/u)
  assert.match(patch, /- --mode\s*\n\s*- micro/u)
  assert.doesNotMatch(patch, /^\[\]$/mu)

  mkdirSync(project)
  run('git', ['init'], { cwd: project })
  run('git', ['config', 'user.email', 'ci@example.invalid'], { cwd: project })
  run('git', ['config', 'user.name', 'CI'], { cwd: project })
  writeFileSync(join(project, 'README.md'), '# Memorix smoke\n')
  run('git', ['add', 'README.md'], { cwd: project })
  run('git', ['commit', '-m', 'smoke fixture'], { cwd: project })

  const cliPath = join(profile, 'node_modules', 'memorix', 'dist', 'cli', 'index.js')
  const env = { MEMORIX_DATA_DIR: data, MEMORIX_SQLITE_DRIVER: 'node' }
  run(process.execPath, [cliPath, 'memory', 'store', '--type', 'decision', '--entity', 'dsh-desktop-smoke', '--title', 'Desktop smoke memory', token], { cwd: project, env })
  const search = run(process.execPath, [cliPath, 'memory', 'search', token], { cwd: project, env })
  assert.ok((search.stdout + '\n' + search.stderr).includes(token))

  const desktopRequire = createRequire(pathToFileURL(join(root, 'apps', 'desktop', 'package.json')))
  const electron = desktopRequire('electron')
  assert.equal(typeof electron, 'string')
  await waitForMemorixStart(electron, cliPath)

  process.stdout.write('Memorix Desktop smoke passed.\n')
} finally {
  rmSync(temp, { recursive: true, force: true })
}
