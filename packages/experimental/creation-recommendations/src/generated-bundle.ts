/** Admit only a newly named bundle whose patch adds its own rows. */
import { lstat, opendir, readFile, readlink, realpath } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, resolve, sep } from 'node:path'
import { z } from 'zod'
import { parseDocument } from 'yaml'
import { resolve as resolvePackageEntry } from 'resolve.exports'

const RUNTIME_EXTENSIONS = ['.js', '.mjs', '.cjs']

export interface BundleLimits {
  readonly entries: number
  readonly depth: number
  readonly bytes: number
  readonly fileBytes: number
  readonly metadataBytes: number
}

export const BUNDLE_LIMITS: BundleLimits = { entries: 20_000, depth: 32, bytes: 256 * 2 ** 20, fileBytes: 64 * 2 ** 20, metadataBytes: 2 ** 20 }

/** Validate model-written files before profile installation.
 * @param directory - Host-reserved output directory.
 * @param name - Host-reserved package name.
 * @returns after package identity, insert-only rows, built entries, the built `./client` entry of a package declaring
 * `dsh.client`, and portable links have been checked; does not execute code.
 */
export async function validateGeneratedBundle(directory: string, name: string, limits: BundleLimits = BUNDLE_LIMITS): Promise<void> {
  const manifestPath = await containedFile(directory, 'package.json')
  const manifest = z.looseObject({
    name: z.literal(name), version: z.string().min(1),
    main: z.string().optional(), exports: z.unknown().optional(),
    dsh: z.object({ bundle: z.object({ patch: z.literal('./cordis.patch.yml') }), client: z.looseObject({}).optional() }),
  }).parse(JSON.parse(await readBounded(manifestPath, limits.metadataBytes)))
  const patchPath = await containedFile(directory, manifest.dsh.bundle.patch)
  const document = parseDocument(await readBounded(patchPath, limits.metadataBytes), { schema: 'core', customTags: [] })
  if (document.errors.length || document.warnings.length) throw new Error('Generated patches must use plain YAML without custom tags or includes.')
  const patch = z.array(z.object({
    insert: z.array(z.looseObject({ id: z.string().min(1), name: z.string().min(1), group: z.literal(false).optional() })).min(1),
  }).strict()).min(1).parse(document.toJS({ maxAliasCount: 0 }))
  const ids = new Set<string>()
  for (const operation of patch) for (const row of operation.insert) {
    if (!row.id.startsWith(name + ':') || ids.has(row.id)
      || row.name !== name && !row.name.startsWith(name + '/')) {
      throw new Error('Generated bundles must add uniquely named rows from their own package.')
    }
    ids.add(row.id)
    const target = manifest.exports === undefined
      ? row.name === name ? manifest.main ?? './index.js' : './' + row.name.slice(name.length + 1)
      : exportedEntry(manifest, row.name)
    if (target === undefined || !RUNTIME_EXTENSIONS.includes(extname(target))) {
      throw new Error(`Build and export the runtime entry for ${row.name} before installation.`)
    }
    const entry = await containedFile(directory, target)
    if (!(await lstat(entry)).isFile()) throw new Error(`The runtime entry for ${row.name} must be a built file.`)
  }
  // The client module system loads `exports["./client"]` for every package declaring `dsh.client`.
  if (manifest.dsh.client !== undefined && !(await isBuiltFile(directory, exportedEntry(manifest, name + '/client')))) {
    throw new Error('Build and export the "./client" entry before installation.')
  }
  await validateTree(await realpath(directory), directory, limits, { entries: 0, bytes: 0 }, 0)
}

/** Whether a relative entry path names an existing JavaScript file inside the bundle. */
async function isBuiltFile(directory: string, target: string | undefined): Promise<boolean> {
  if (target === undefined || !RUNTIME_EXTENSIONS.includes(extname(target))) return false
  let entry: string
  try {
    entry = await containedFile(directory, target)
  } catch {
    // realpath rejects a missing file and containedFile a path outside the bundle; neither is a built entry.
    return false
  }
  return (await lstat(entry)).isFile()
}

/** The first file `exports` maps a package specifier to, or undefined when nothing matches. */
function exportedEntry(manifest: { readonly name: string; readonly exports?: unknown }, specifier: string): string | undefined {
  try {
    return resolvePackageEntry(manifest, specifier)?.[0]
  } catch {
    // resolve.exports throws when `exports` has no matching subpath or condition.
    return undefined
  }
}

async function readBounded(path: string, limit: number): Promise<string> {
  if ((await lstat(path)).size > limit) throw new Error('Generated bundle metadata is too large.')
  return readFile(path, 'utf8')
}

/** Relative links must continue to work when the bundle is copied out of the workspace. */
async function validateTree(
  root: string, directory: string, limits: BundleLimits, tally: { entries: number; bytes: number }, depth: number,
): Promise<void> {
  if (depth > limits.depth) throw new Error('Generated bundle is nested too deeply.')
  for await (const entry of await opendir(directory)) {
    if (++tally.entries > limits.entries) throw new Error('Generated bundle contains too many files.')
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      const link = await readlink(path)
      if (isAbsolute(link)) throw new Error('Generated bundle links must be relative and stay inside the bundle.')
      await containedFile(root, resolve(dirname(path), link))
    } else if (entry.isDirectory()) await validateTree(root, path, limits, tally, depth + 1)
    else {
      const { size } = await lstat(path)
      tally.bytes += size
      if (size > limits.fileBytes || tally.bytes > limits.bytes) throw new Error('Generated bundle is too large.')
    }
  }
}

async function containedFile(directory: string, file: string): Promise<string> {
  const root = await realpath(directory)
  const path = await realpath(resolve(directory, file))
  if (!path.startsWith(root + sep)) throw new Error('Generated bundle files must remain inside their reserved directory.')
  return path
}
