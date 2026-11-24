import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolvePrimaryRuntime, workspaceDependencyPaths, type PrimaryRuntimeManifest } from '../src/index.ts'

const originalPlatform = process.platform
const originalArch = process.arch
const roots: string[] = []

function host(platform: string, arch: string): void {
  Reflect.defineProperty(process, 'platform', { configurable: true, enumerable: true, value: platform })
  Reflect.defineProperty(process, 'arch', { configurable: true, enumerable: true, value: arch })
}

beforeEach(() => { host('win32', 'arm64') })
afterEach(async () => {
  host(originalPlatform, originalArch)
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function payload(arch: string, runnable: boolean): Promise<string> {
  const source = await mkdtemp(join(tmpdir(), 'dsh-arm64-payload-'))
  roots.push(source)
  const manifest: PrimaryRuntimeManifest = { desktopVersion: '1', platform: 'win32', arch, python: '3.12.14', pythonPackages: {} }
  const paths = workspaceDependencyPaths(source, manifest)
  await mkdir(dirname(paths.python), { recursive: true })
  if (runnable) await copyFile(process.execPath, paths.python)
  else await writeFile(paths.python, 'not an executable')
  await mkdir(paths.pythonPackages, { recursive: true })
  await writeFile(join(source, 'runtime.json'), JSON.stringify(manifest))
  return source
}

describe('x64 payload on a Windows ARM64 host', () => {
  it('accepts it once its interpreter launches', async () => {
    const source = await payload('x64', true)
    await expect(resolvePrimaryRuntime(source)).resolves.toMatchObject({ python: join(source, 'dependencies', 'python', 'python.exe') })
  })

  it('rejects it with the launch failure as cause when the interpreter cannot run', async () => {
    const source = await payload('x64', false)
    await expect(resolvePrimaryRuntime(source)).rejects.toMatchObject({ code: 'WORKSPACE_DEPENDENCY_UNSUPPORTED_PLATFORM', cause: expect.any(Error) })
  })

  it('still rejects an ARM64 payload on an x64 host', async () => {
    host('win32', 'x64')
    const source = await payload('arm64', true)
    await expect(resolvePrimaryRuntime(source)).rejects.toMatchObject({ code: 'WORKSPACE_DEPENDENCY_UNSUPPORTED_PLATFORM', message: 'primary runtime: incompatible platform or architecture' })
  })
})
