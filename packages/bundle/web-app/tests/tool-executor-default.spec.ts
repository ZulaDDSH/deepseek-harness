import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { expect, it } from 'vitest'

type Row = ReturnType<typeof composeEntries>[number]

const repo = fileURLToPath(new URL('../../../../', import.meta.url))
const bundles = join(repo, 'packages/bundle')
const examples = join(repo, 'apps/cli/config/examples')

function bundlePatches(name: string): PatchOptions[] {
  const dir = join(bundles, name)
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { dsh: { bundle: { patch: string | string[] } } }
  return [manifest.dsh.bundle.patch].flat().flatMap(file => loadOverlayPatches('executor default', join(dir, file)))
}

function compose(bundle: string, ...overlays: string[]): Row[] {
  return composeEntries([
    bundlePatches('base'),
    ...bundle === 'base' ? [] : [bundlePatches(bundle)],
    ...overlays.map(overlay => loadOverlayPatches('executor default', join(examples, overlay))),
  ])
}

function enabled(rows: readonly Row[], id: string): boolean {
  const row = rows.find(candidate => candidate.id === id)
  return row !== undefined && row.disabled !== true
}

const executors = (rows: readonly Row[]) => ({
  native: enabled(rows, 'tool-executor-native'),
  ptc: enabled(rows, 'tool-executor-ptc'),
  runtime: enabled(rows, 'ptc-runtime'),
})

it.for(['base', 'headless', 'sdk-app', 'web-app'])('%s mounts the PTC executor and its runtime by default', (bundle) => {
  expect(executors(compose(bundle))).toEqual({ native: false, ptc: true, runtime: true })
})

it.for(['base', 'headless', 'sdk-app', 'web-app'])('%s returns to the native executor with the native overlay', (bundle) => {
  expect(executors(compose(bundle, 'native.yml'))).toEqual({ native: true, ptc: false, runtime: true })
})

it('applies the PTC overlay after the native overlay', () => {
  expect(executors(compose('web-app', 'native.yml', 'ptc.yml'))).toMatchObject({ native: false, ptc: true })
})

it('keeps the ACP application on the native executor', () => {
  expect(executors(compose('acp-app'))).toMatchObject({ native: true, ptc: false })
})

it('keeps the standalone minimal SDK on the native executor without a PTC runtime', () => {
  expect(executors(composeEntries([bundlePatches('sdk-minimal')]))).toEqual({ native: true, ptc: false, runtime: false })
})

it.for(['standard', 'cordis', 'lean', 'master', 'minimal'])('the %s preset inherits the deployment executor', (preset) => {
  const [row] = loadOverlayPatches('executor default', join(bundles, `web-app/presets/${preset}.patch.yml`)).flatMap(patch => patch.insert ?? [])
  const plugins = (row!.config as { plugins: { id: string }[] }).plugins.map(plugin => plugin.id)
  expect(plugins).not.toContain('tool-executor-native')
  expect(plugins).not.toContain('tool-executor-ptc')
  expect(plugins).not.toContain('tool-presentation')
})

it('the ptc and economy presets select PTC themselves', () => {
  const rows = (preset: string) => (loadOverlayPatches('executor default', join(bundles, `web-app/presets/${preset}.patch.yml`)).flatMap(patch => patch.insert ?? [])[0]!.config as { plugins: { id: string; config?: { mode?: string } }[] }).plugins
  expect(rows('ptc').map(plugin => plugin.id)).toContain('tool-executor-ptc')
  expect(rows('economy').find(plugin => plugin.id === 'tool-presentation')?.config?.mode).toBe('ptc')
})
