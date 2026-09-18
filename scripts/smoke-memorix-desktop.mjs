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

async function probeMemorixMcp(electron, cliPath) {
  await new Promise((resolve, reject) => {
    const child = spawn(electron, [cliPath, 'serve', '--cwd', project, '--mode', 'lite'], {
      cwd: project,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', MEMORIX_DATA_DIR: data, MEMORIX_SQLITE_DRIVER: 'node' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const messages = new Map()
    const waiters = new Map()
    let buffer = ''
    let stderr = ''
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (child.exitCode === null) child.kill()
      if (error) reject(error)
      else resolve()
    }
    const timer = setTimeout(() => {
      finish(new Error('Timed out probing Memorix MCP. stderr:\n' + stderr))
    }, 30000)
    const waitFor = (id) => {
      const key = String(id)
      const existing = messages.get(key)
      if (existing) return Promise.resolve(existing)
      return new Promise((resolveMessage) => { waiters.set(key, resolveMessage) })
    }
    const send = (message) => {
      child.stdin.write(JSON.stringify(message) + '\n')
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      buffer += chunk
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/u, '')
        buffer = buffer.slice(newline + 1)
        if (line.trim()) {
          const message = JSON.parse(line)
          if (message.id !== undefined) {
            const key = String(message.id)
            messages.set(key, message)
            const waiter = waiters.get(key)
            if (waiter) {
              waiters.delete(key)
              waiter(message)
            }
          }
        }
        newline = buffer.indexOf('\n')
      }
    })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', finish)
    child.once('exit', code => {
      if (!settled && code !== 0) finish(new Error('Memorix MCP exited with code ' + String(code) + '. stderr:\n' + stderr))
    })
    void (async () => {
      send({
        jsonrpc: '2.0',
        id: 'initialize',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'dsh-desktop-smoke', version: '1' },
        },
      })
      const initialized = await waitFor('initialize')
      assert.equal(initialized.error, undefined)
      send({ jsonrpc: '2.0', method: 'notifications/initialized' })
      send({ jsonrpc: '2.0', id: 'tools', method: 'tools/list' })
      const listed = await waitFor('tools')
      assert.equal(listed.error, undefined)
      const names = new Set(listed.result.tools.map(tool => tool.name))
      assert.ok(names.has('memorix_project_context'))
      assert.ok(names.has('memorix_session_start'))
      assert.ok(names.has('memorix_store'))
      child.stdin.end()
      const exitTimer = setTimeout(() => finish(new Error('Memorix MCP did not exit after stdin closed. stderr:\n' + stderr)), 5000)
      child.once('exit', code => {
        clearTimeout(exitTimer)
        if (code === 0) finish()
        else finish(new Error('Memorix MCP exited with code ' + String(code) + '. stderr:\n' + stderr))
      })
    })().catch(finish)
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
  assert.match(patch, /- --mode\s*\n\s*- lite/u)
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
  await probeMemorixMcp(electron, cliPath)

  process.stdout.write('Memorix Desktop smoke passed.\n')
} finally {
  rmSync(temp, { recursive: true, force: true })
}
