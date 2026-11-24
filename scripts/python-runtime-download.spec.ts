/** Explicit resource acquisition through the Python carrier's private dispatcher. */
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { expect, it } from 'vitest'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-resource-download-'))
  const bootstrap = join(root, 'node', 'runtime-bootstrap.mjs')
  const platform = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'win' : process.platform
  const resources = join(root, `${platform}-${process.arch}`)
  const cache = join(root, 'cache')
  async function file(path: string, content: string) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
  }
  await file(join(resources, 'downloads.json'), JSON.stringify({ identity: 'a'.repeat(64), office: [], pnpm: {} }))
  await mkdir(dirname(bootstrap), { recursive: true })
  await copyFile(new URL('../python/sdk-runtime/runtime-bootstrap.mjs', import.meta.url), bootstrap)
  await file(join(root, 'node/node_modules/@deepseek-ai/dsh-http-proxy/package.json'), '{"type":"module","exports":"./index.mjs"}')
  await file(join(root, 'node/node_modules/@deepseek-ai/dsh-http-proxy/index.mjs'), 'export async function installProxyFromEnvironment(env) { if (typeof env.get !== "function") throw new Error("missing environment lookup"); return async () => {} }')
  await file(join(root, 'node/node_modules/@deepseek-ai/dsh-sandbox-windows-acl/package.json'), '{"type":"module","exports":{"./runner":"./runner.mjs"}}')
  await file(join(root, 'node/node_modules/@deepseek-ai/dsh-sandbox-windows-acl/runner.mjs'), '')
  await file(join(root, 'node/node_modules/@deepseek-ai/dsh/package.json'), '{"type":"module"}')
  await file(join(root, 'node/node_modules/@deepseek-ai/dsh/lib/bin.js'), `
    export async function runCli(options = {}) {
      const result = process.argv[2] ? { argv: process.argv.slice(2) }
        : { primary: process.env.DSH_PRIMARY_RUNTIME };
      const office = Object.keys(process.env).filter(name => /^DSH_BUNDLED_OFFICE_(?:CLI|NODE)$/.test(name));
      if (office.length > 0) result.office = office;
      if (options.packageManager) Object.assign(result, { packageManager: options.packageManager, hostPath: process.env.PATH });
      console.log(JSON.stringify(result));
    }
  `)
  await file(join(root, 'node/node_modules/@deepseek-ai/dsh-tool-workspace-dependencies/package.json'), '{"type":"module","exports":"./index.mjs"}')
  await file(join(root, 'node/node_modules/@deepseek-ai/dsh-tool-workspace-dependencies/index.mjs'), `
    import { readFile } from 'node:fs/promises';
    import { join } from 'node:path';
    export async function resolvePrimaryRuntime(root) {
      const manifest = JSON.parse(await readFile(join(root, 'runtime.json'), 'utf8'));
      return {
        node: manifest.node ? join(root, 'dependencies/node/bin', process.platform === 'win32' ? 'node.exe' : 'node') : undefined,
        pnpm: manifest.pnpm ? join(root, 'dependencies/pnpm/bin/pnpm.mjs') : undefined,
      };
    }
  `)
  await file(join(root, 'node/primary-runtime.mjs'), `
    import { mkdir, writeFile } from 'node:fs/promises';
    import { join } from 'node:path';
    export async function downloadNodeRuntime(target, destination) {
      if (process.env.DSH_RUNTIME_DOWNLOAD !== undefined) throw new Error("private selector leaked");
      await mkdir(join(destination, 'bin'), { recursive: true });
      await writeFile(join(destination, 'bin', process.platform === 'win32' ? 'node.exe' : 'node'), 'node');
    }
    export async function preparePrimaryRuntime({ output }) {
      if (process.env.DSH_RUNTIME_DOWNLOAD !== undefined) throw new Error("private selector leaked");
      await mkdir(join(output, 'primary-runtime'), { recursive: true });
      await writeFile(join(output, 'primary-runtime/runtime.json'), '{}');
    }
  `)
  await file(join(root, 'node/office-sidecar.mjs'), `
    import { mkdir, writeFile } from 'node:fs/promises';
    import { join } from 'node:path';
    export async function downloadOfficeSidecar(packages, destination) {
      const directory = join(destination, 'node_modules/@deepseek-ai/libreoffice-kit/lib');
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'cli.js'), 'cli');
      if (process.env.DSH_FIXTURE_FAIL) throw new Error('fixture download failed');
      if (process.env.DSH_FIXTURE_BARRIER) {
        process.stderr.write('ready\\n');
        await new Promise(resolve => process.stdin.once('data', resolve));
        process.stdin.pause();
      }
    }
  `)
  function run(resource?: string, extra: NodeJS.ProcessEnv = {}, args: string[] = []) {
    const child = spawn(process.execPath, [bootstrap, ...args], {
      env: { ...process.env, DSH_RESOURCE_CACHE: cache, DSH_RUNTIME_DOWNLOAD: resource,
        DSH_PRIMARY_RUNTIME: undefined, DSH_OFFICE_SIDECAR: undefined, ...extra },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = '', stderr = ''
    child.stdout.on('data', (data) => { stdout += String(data) })
    let reportReady: (() => void) | undefined
    let failReady: ((error: Error) => void) | undefined
    const ready = extra.DSH_FIXTURE_BARRIER === undefined ? Promise.resolve()
      : new Promise<void>((resolve, reject) => { reportReady = resolve; failReady = reject })
    child.stderr.on('data', (data) => { stderr += String(data); if (stderr.includes('ready\n')) reportReady?.() })
    const done = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code) => { failReady?.(new Error(`download exited before readiness: ${stderr}`)); resolve({ code, stdout, stderr }) })
    })
    return { child, ready, done }
  }
  return { root, cache, run, file }
}

it('supplies downloaded Node and pnpm to profile and CLI package operations without changing the host PATH', async () => {
  const { root, cache, run, file } = await fixture()
  try {
    await run('primary').done
    const primary = join(cache, 'a'.repeat(64), 'primary', 'primary-runtime')
    await file(join(primary, 'runtime.json'), JSON.stringify({ node: '24.9.0', pnpm: '11.0.0' }))
    const node = join(primary, 'dependencies/node/bin', process.platform === 'win32' ? 'node.exe' : 'node')
    for (const args of [[], ['plugin', '--profile', 'sdk', 'add', 'local-bundle']]) {
      const result = await run(undefined, { PATH: '' }, args).done
      expect(result.code, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({
        packageManager: { command: node, args: [join(primary, 'dependencies/pnpm/bin/pnpm.mjs')],
          env: { PATH: `${dirname(node)}${delimiter}` } }, hostPath: '',
      })
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('uses an explicit primary runtime instead of the cache and honors its empty disable value', async () => {
  const { root, run, file } = await fixture()
  try {
    await run('primary').done
    const primary = join(root, 'replacement')
    await file(join(primary, 'runtime.json'), JSON.stringify({ node: '24.9.0', pnpm: '11.0.0' }))
    const replaced = await run(undefined, { DSH_PRIMARY_RUNTIME: primary }).done
    expect(replaced.code, replaced.stderr).toBe(0)
    expect(JSON.parse(replaced.stdout)).toMatchObject({ packageManager: {
      command: join(primary, 'dependencies/node/bin', process.platform === 'win32' ? 'node.exe' : 'node'),
    } })
    const disabled = await run(undefined, { DSH_PRIMARY_RUNTIME: '' }).done
    expect(disabled.code, disabled.stderr).toBe(0)
    expect(JSON.parse(disabled.stdout)).not.toHaveProperty('packageManager')
    const missing = await run(undefined, { DSH_PRIMARY_RUNTIME: join(root, 'missing') }).done
    expect(missing.code).toBe(1)
    expect(missing.stderr).toContain('ENOENT')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('starts without downloading, independently downloads either resource, and reuses completed caches', async () => {
  const { root, cache, run } = await fixture()
  try {
    expect(await run().done).toMatchObject({ code: 0, stdout: '{}\n' })
    await expect(readdir(cache)).rejects.toMatchObject({ code: 'ENOENT' })
    const primary = await run('primary').done
    expect(primary.code, primary.stderr).toBe(0)
    expect(JSON.parse(primary.stdout)).toBe(join(cache, 'a'.repeat(64), 'primary', 'primary-runtime'))
    await expect(readdir(join(cache, 'a'.repeat(64), 'office'))).rejects.toMatchObject({ code: 'ENOENT' })
    const office = await run('office').done
    expect(office.code, office.stderr).toBe(0)
    const location = JSON.parse(office.stdout) as string
    expect(await readFile(join(location, 'node_modules/@deepseek-ai/libreoffice-kit/lib/cli.js'), 'utf8')).toBe('cli')
    expect(await run('office', { DSH_FIXTURE_FAIL: '1' }).done).toMatchObject({ code: 0, stdout: office.stdout })
    // A cached sidecar only redirects Kit resolution; the CLI process receives no Office executable paths.
    const started = await run().done
    expect(started.code, started.stderr).toBe(0)
    expect(JSON.parse(started.stdout)).toEqual({ primary: join(cache, 'a'.repeat(64), 'primary', 'primary-runtime') })
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('cleans failed staging and allows an explicit retry', async () => {
  const { root, cache, run } = await fixture()
  try {
    const failed = await run('office', { DSH_FIXTURE_FAIL: '1' }).done
    expect(failed.code).toBe(1)
    expect(failed.stderr).toContain('fixture download failed')
    expect(await readdir(join(cache, 'a'.repeat(64)))).toEqual([])
    expect((await run('office').done).code).toBe(0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('publishes one complete cache when two processes download concurrently', async () => {
  const { root, cache, run } = await fixture()
  const jobs = [run('office', { DSH_FIXTURE_BARRIER: '1' }), run('office', { DSH_FIXTURE_BARRIER: '1' })]
  try {
    await Promise.all(jobs.map(job => job.ready))
    for (const job of jobs) job.child.stdin.end('continue')
    const results = await Promise.all(jobs.map(job => job.done))
    for (const result of results) expect(result.code, result.stderr).toBe(0)
    expect(results[0]!.stdout).toBe(results[1]!.stdout)
    expect(await readdir(join(cache, 'a'.repeat(64)))).toEqual(['office'])
  } finally {
    for (const job of jobs) if (job.child.exitCode === null && job.child.signalCode === null) job.child.kill()
    await Promise.allSettled(jobs.map(job => job.done))
    await rm(root, { recursive: true, force: true })
  }
})


it('leaves ordinary CLI arguments to the CLI and rejects an invalid private download selector', async () => {
  const { root, cache, run } = await fixture()
  try {
    expect(await run(undefined, {}, ['--download-office']).done).toMatchObject({
      code: 0, stdout: JSON.stringify({ argv: ['--download-office'] }) + '\n',
    })
    const rejected = await run('invalid').done
    expect(rejected.code).toBe(1)
    expect(rejected.stderr).toContain('DSH_RUNTIME_DOWNLOAD must select office or primary')
    await expect(readdir(cache)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

const identity = 'a'.repeat(64)
const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'

it.each([
  ['a missing sidecar file', (office: string) => rm(join(office, 'node_modules/@deepseek-ai/libreoffice-kit/lib/cli.js'))],
  ['a missing Node interpreter', (office: string) => rm(join(office, 'node', 'bin', nodeName))],
  ['a marker for another identity', (office: string) => writeFile(join(office, 'complete'), 'b'.repeat(64))],
])('repairs a completed Office cache with %s on the next explicit download', async (_name, damage) => {
  const { root, cache, run } = await fixture()
  try {
    const first = await run('office').done
    expect(first.code, first.stderr).toBe(0)
    const office = JSON.parse(first.stdout) as string
    await damage(office)
    const repaired = await run('office').done
    expect(repaired.code, repaired.stderr).toBe(0)
    expect(await readFile(join(office, 'node_modules/@deepseek-ai/libreoffice-kit/lib/cli.js'), 'utf8')).toBe('cli')
    expect(await readFile(join(office, 'node', 'bin', nodeName), 'utf8')).toBe('node')
    expect(await readFile(join(office, 'complete'), 'utf8')).toBe(identity)
    expect(await readdir(join(cache, identity))).toEqual(['office'])
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('repairs a damaged primary cache whose manifest is gone', async () => {
  const { root, cache, run } = await fixture()
  try {
    expect((await run('primary').done).code).toBe(0)
    await rm(join(cache, identity, 'primary', 'primary-runtime', 'runtime.json'))
    const repaired = await run('primary').done
    expect(repaired.code, repaired.stderr).toBe(0)
    expect(await readFile(join(cache, identity, 'primary', 'primary-runtime', 'runtime.json'), 'utf8')).toBe('{}')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('lets two processes repair one damaged cache without losing it', async () => {
  const { root, cache, run } = await fixture()
  try {
    const first = await run('office').done
    const office = JSON.parse(first.stdout) as string
    await rm(join(office, 'node_modules/@deepseek-ai/libreoffice-kit/lib/cli.js'))
    const jobs = [run('office', { DSH_FIXTURE_BARRIER: '1' }), run('office', { DSH_FIXTURE_BARRIER: '1' })]
    try {
      await Promise.all(jobs.map(job => job.ready))
      for (const job of jobs) job.child.stdin.end('continue')
      const results = await Promise.all(jobs.map(job => job.done))
      for (const result of results) expect(result.code, result.stderr).toBe(0)
      expect(await readFile(join(office, 'node_modules/@deepseek-ai/libreoffice-kit/lib/cli.js'), 'utf8')).toBe('cli')
      expect(await readdir(join(cache, identity))).toEqual(['office'])
    } finally {
      for (const job of jobs) if (job.child.exitCode === null && job.child.signalCode === null) job.child.kill()
      await Promise.allSettled(jobs.map(job => job.done))
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('ignores an automatically discovered Office cache whose marker or files do not verify', async () => {
  const { root, run } = await fixture()
  try {
    const office = JSON.parse((await run('office').done).stdout) as string
    const valid = await run().done
    expect(valid.code, valid.stderr).toBe(0)
    expect(valid.stderr).not.toContain('ignoring the cached Office sidecar')
    await writeFile(join(office, 'complete'), 'b'.repeat(64))
    const mismatched = await run().done
    expect(mismatched.code, mismatched.stderr).toBe(0)
    expect(mismatched.stderr).toContain('ignoring the cached Office sidecar')
    expect(mismatched.stderr).toContain('does not match the runtime manifest identity')
    await writeFile(join(office, 'complete'), identity)
    await rm(join(office, 'node_modules/@deepseek-ai/libreoffice-kit/lib/cli.js'))
    const missing = await run().done
    expect(missing.stderr).toContain('required file is missing')
    expect((await run(undefined, { DSH_OFFICE_SIDECAR: office }).done).stderr).not.toContain('ignoring')
  } finally { await rm(root, { recursive: true, force: true }) }
})
