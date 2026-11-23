#!/usr/bin/env node
/** Private entry owned by the Python single-file runtime packaging. */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { registerHooks } from 'node:module'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import { isSea } from 'node:sea'
import { fileURLToPath, pathToFileURL } from 'node:url'

const platform = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'win' : process.platform
const resourceDirectory = join(isSea() ? dirname(process.execPath) : dirname(dirname(fileURLToPath(import.meta.url))), `${platform}-${process.arch}`)
let downloads
let cache
if (existsSync(join(resourceDirectory, 'downloads.json'))) {
  downloads = JSON.parse(await readFile(join(resourceDirectory, 'downloads.json'), 'utf8'))
  const root = process.env.DSH_RESOURCE_CACHE ?? join(homedir(), '.cache', 'deepseek-harness', 'resources')
  if (!isAbsolute(root)) throw new Error('DSH_RESOURCE_CACHE must be an absolute directory')
  if (!/^[a-f0-9]{64}$/u.test(downloads.identity)) throw new Error('runtime download manifest has an invalid cache identity')
  cache = join(root, downloads.identity)
}

async function resourceProblem(kind, directory) {
  let marker
  try { marker = await readFile(join(directory, 'complete'), 'utf8') } catch { return 'its completion marker is missing' }
  if (marker !== downloads.identity) return 'its completion marker does not match the runtime manifest identity'
  const win = process.platform === 'win32'
  const missing = async (path, directoryRequired = false) => {
    try { return !(await stat(path))[directoryRequired ? 'isDirectory' : 'isFile']() } catch { return true }
  }
  if (kind === 'office') {
    for (const path of [join(directory, 'node', 'bin', win ? 'node.exe' : 'node'),
      join(directory, 'node_modules', '@deepseek-ai', 'libreoffice-kit', 'lib', 'cli.js')]) {
      if (await missing(path)) return `required file is missing: ${path}`
    }
    return undefined
  }
  const root = join(directory, 'primary-runtime')
  let manifest
  try { manifest = JSON.parse(await readFile(join(root, 'runtime.json'), 'utf8')) } catch { return `runtime manifest is missing or invalid: ${join(root, 'runtime.json')}` }
  if (typeof manifest?.python !== 'string') return undefined
  const python = join(root, 'dependencies', 'python')
  const version = manifest.python.split('.').slice(0, 2).join('.')
  for (const path of [join(python, win ? 'python.exe' : join('bin', 'python3')),
    join(root, 'dependencies', 'node', 'bin', win ? 'node.exe' : 'node')]) {
    if (await missing(path)) return `required file is missing: ${path}`
  }
  const packages = join(python, ...(win ? ['Lib', 'site-packages'] : ['lib', `python${version}`, 'site-packages']))
  return await missing(packages, true) ? `required directory is missing: ${packages}` : undefined
}

async function quarantineResource(kind, destination) {
  const damaged = join(cache, `.${kind}-damaged-${process.pid}-${Date.now()}`)
  try { await rename(destination, damaged) } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  await rm(damaged, { recursive: true, force: true })
}

/** Publish a complete immutable resource directory; overlapping downloads may share the winner. */
async function downloadResource(kind) {
  if (downloads === undefined) throw new Error('runtime download manifest is missing; rebuild or reinstall the runtime wheel')
  const destination = join(cache, kind)
  if (existsSync(join(destination, 'complete')) && await resourceProblem(kind, destination) !== undefined) {
    await quarantineResource(kind, destination)
  }
  if (!existsSync(join(destination, 'complete'))) {
    await mkdir(cache, { recursive: true })
    const staging = await mkdtemp(join(cache, `.${kind}-`))
    let disposeProxy
    try {
      const { installProxyFromEnvironment } = await import('@deepseek-ai/dsh-http-proxy')
      disposeProxy = await installProxyFromEnvironment({ get(name) {
        const value = process.env[name]
        return value === undefined ? undefined : { value }
      } }, message => console.error(message))
      const { downloadNodeRuntime, preparePrimaryRuntime } = await import('./primary-runtime.mjs')
      const archives = join(cache, 'archives')
      if (kind === 'office') {
        const { downloadOfficeSidecar } = await import('./office-sidecar.mjs')
        await downloadNodeRuntime(downloads.target, join(staging, 'node'), archives)
        await downloadOfficeSidecar(downloads.office, staging, archives)
      } else {
        await preparePrimaryRuntime({ target: downloads.target, output: staging, cache: archives,
          version: downloads.version, pnpmArchive: downloads.pnpm })
      }
      await writeFile(join(staging, 'complete'), downloads.identity)
      try { await rename(staging, destination) } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code)
          || await resourceProblem(kind, destination) !== undefined) throw error
      }
    } finally {
      try { await disposeProxy?.() } finally { await rm(staging, { recursive: true, force: true }) }
    }
  }
  const problem = await resourceProblem(kind, destination)
  if (problem !== undefined) throw new Error(`runtime cache is unusable: ${destination}: ${problem}`)
  return kind === 'primary' ? join(destination, 'primary-runtime') : destination
}

let office = process.env.DSH_OFFICE_SIDECAR
if (office === undefined && cache !== undefined && existsSync(join(cache, 'office', 'complete'))) {
  const problem = await resourceProblem('office', join(cache, 'office'))
  if (problem === undefined) office = join(cache, 'office')
  else console.error(`dsh: ignoring the cached Office sidecar at ${join(cache, 'office')}: ${problem}. Run the explicit Office download again to repair it.`)
}
if (office !== undefined) {
  if (!isAbsolute(office)) throw new Error('DSH_OFFICE_SIDECAR must be an absolute directory')
  const parentURL = pathToFileURL(join(office, 'package.json')).href
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const kit = specifier === '@deepseek-ai/libreoffice-kit' || specifier === '@deepseek-ai/libreoffice-kit/package.json'
      return nextResolve(specifier, kit ? { ...context, parentURL } : context)
    },
  })
}

const selectorName = 'DSH_SUBPROCESS_RUNNER'
const selection = process.env[selectorName]
const aclRunner = process.platform === 'win32'
  ? fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-sandbox-windows-acl/runner'))
  : undefined

const resource = process.env.DSH_RUNTIME_DOWNLOAD
if (resource !== undefined) {
  Reflect.deleteProperty(process.env, 'DSH_RUNTIME_DOWNLOAD')
  if (resource !== 'office' && resource !== 'primary') throw new Error('DSH_RUNTIME_DOWNLOAD must select office or primary')
  const path = await downloadResource(resource)
  console.log(JSON.stringify(path))
} else if (aclRunner !== undefined && process.argv[2] === aclRunner) {
  process.argv.splice(1, 1)
  await import('@deepseek-ai/dsh-sandbox-windows-acl/runner')
} else if (process.env.DSH_PTC_RUNTIME_NODE === '1') {
  Reflect.deleteProperty(process.env, 'DSH_PTC_RUNTIME_NODE')
  await import('@deepseek-ai/dsh-ptc-runtime-node/process')
} else if (selection === undefined) {
  // A DSH_PRIMARY_RUNTIME set or inherited from the environment, including the empty opt-out, takes precedence over the
  // downloaded cache.
  if (cache !== undefined && existsSync(join(cache, 'primary', 'complete'))) {
    process.env.DSH_PRIMARY_RUNTIME ??= join(cache, 'primary', 'primary-runtime')
  }
  let packageManager
  const primary = process.env.DSH_PRIMARY_RUNTIME
  if (primary !== undefined && primary !== '') {
    const { resolvePrimaryRuntime } = await import('@deepseek-ai/dsh-tool-workspace-dependencies')
    const { node, pnpm } = await resolvePrimaryRuntime(primary)
    if (node !== undefined && pnpm !== undefined) {
      packageManager = { command: node, args: [pnpm],
        env: { PATH: `${dirname(node)}${delimiter}${process.env.PATH ?? ''}` } }
    }
  }
  const { runCli } = await import('@deepseek-ai/dsh/lib/bin.js')
  await runCli({ packageManager })
} else {
  Reflect.deleteProperty(process.env, selectorName)
  const { runSelectedSubprocessRunner } = await import('@deepseek-ai/dsh-subprocess-local/runner')
  await runSelectedSubprocessRunner(selection)
}
