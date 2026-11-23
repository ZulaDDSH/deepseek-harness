import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const name = 'dsh-plugin-claude-code'
const version = '0.2.5'
const archive = `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`
const digest = 'RXFa0WKsiYoC+VbjPSWdgGNK0btoh+RyHsMZwFlvZHnSNsYST86AdyrrxFQnlqQH2mxkEli+iiYjqT0DJizMZw=='
if (process.env.DSH_CLAUDE_BRIDGE_SKIP === '1') {
  if (!existsSync(new URL('./bridge/index.js', import.meta.url))) {
    console.log('DSH_CLAUDE_BRIDGE_SKIP is set but bridge/ is missing; bridge tests will be skipped.')
  }
  process.exit(0)
}
const directory = await mkdtemp(join(tmpdir(), 'dsh-build-claude-'))
try {
  let bytes
  if (process.env.DSH_CLAUDE_BRIDGE_TARBALL) bytes = await readFile(process.env.DSH_CLAUDE_BRIDGE_TARBALL)
  else {
    const response = await fetch(archive, { signal: AbortSignal.timeout(60000) })
    if (!response.ok) throw new Error(`Fetching the Claude Code adapter failed (HTTP ${response.status})`)
    bytes = Buffer.from(await response.arrayBuffer())
  }
  if (createHash('sha512').update(bytes).digest('base64') !== digest)
    throw new Error('Unexpected adapter archive digest')
  await writeFile(join(directory, 'input.tgz'), bytes)
  execFileSync('tar', ['-xzf', 'input.tgz'], { cwd: directory })
  const patch = fileURLToPath(new URL('./bridge.patch', import.meta.url))
  execFileSync('git', ['apply', '--no-index', '--unidiff-zero', patch], { cwd: directory })
  const source = join(directory, 'package')
  const dest = new URL('./bridge/', import.meta.url)
  await cp(join(source, 'dist'), dest, { recursive: true, filter: (path) => !path.endsWith('.d.ts') })
  await cp(join(source, 'LICENSE'), new URL('LICENSE', dest))
  const metadata = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
  await writeFile(
    new URL('package.json', dest),
    JSON.stringify({ name: metadata.name, version: metadata.version, type: 'module' }) + '\n',
  )
} finally {
  await rm(directory, { recursive: true, force: true })
}
