import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { dump, load } from 'js-yaml'
import { desktopTargetBuildPaths } from './desktop-build-paths.mjs'

export const DEFAULT_FEED_REPOSITORY = 'ZulaDDSH/deepseek-harness'
export const FEED_TAG = 'desktop-feed'
export const FEED_FILES = ['nightly.yml', 'stable.yml']
// Asset names must pass through GitHub unchanged, because the feed links to them by name.
const ASSET_NAME = /^[A-Za-z0-9._-]+$/u

function assetName(reference) {
  let name
  try { name = decodeURIComponent(new URL(reference, 'https://placeholder.invalid/').pathname.split('/').pop() ?? '') }
  catch { name = '' }
  if (!ASSET_NAME.test(name)) throw new Error(`publish github feed: asset name ${JSON.stringify(name)} is not a safe release asset name`)
  return name
}

// Every url and path must become absolute: the generic provider resolves absolute URLs unchanged.
export function rewriteFeedMetadata(yamlText, repository) {
  const document = load(yamlText)
  if (typeof document !== 'object' || document === null || Array.isArray(document)) throw new Error('publish github feed: update metadata must be an object')
  const version = document.version
  if (typeof version !== 'string' || !/^[0-9A-Za-z][0-9A-Za-z.+-]*$/u.test(version)) throw new Error('publish github feed: update metadata needs a version')
  if (!Array.isArray(document.files) || document.files.length === 0) throw new Error('publish github feed: update metadata needs files')
  const tag = `v${version}`
  const base = `https://github.com/${repository}/releases/download/${tag}/`
  const assets = []
  for (const file of document.files) {
    if (typeof file !== 'object' || file === null || typeof file.url !== 'string') throw new Error('publish github feed: every file needs a url')
    const name = assetName(file.url)
    file.url = base + name
    assets.push(name)
  }
  if (document.path !== undefined) {
    if (typeof document.path !== 'string') throw new Error('publish github feed: path must be a string')
    document.path = base + assetName(document.path)
  }
  return { version, tag, assets, yaml: dump(document, { lineWidth: -1 }) }
}

function readMetadata(directory) {
  const names = readdirSync(directory).filter(name => /^(?:nightly|stable)\.yml$/u.test(name))
  if (names.length !== 1) throw new Error(`publish github feed: expected exactly one nightly.yml or stable.yml in ${directory}, found ${names.length}`)
  return { name: names[0], text: readFileSync(join(directory, names[0]), 'utf8') }
}

function releaseExists(gh, repository, tag) {
  try { gh(['release', 'view', tag, '-R', repository]); return true }
  catch (error) {
    if (/release not found/iu.test(`${error.stderr ?? ''}${error.message}`)) return false
    throw error
  }
}

// Ordering: assets must be uploaded before the metadata, so the feed never names a missing asset.
export function publishGithubFeed({ directory, repository = DEFAULT_FEED_REPOSITORY, dryRun = false, gh = args => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), log = console.log }) {
  const { text } = readMetadata(directory)
  const { version, tag, assets, yaml } = rewriteFeedMetadata(text, repository)
  const uploaded = [...new Set(assets)]
  for (const name of [...uploaded]) {
    if (!existsSync(join(directory, name))) throw new Error(`publish github feed: ${name} is not in ${directory}`)
    const blockmap = `${name}.blockmap`
    if (existsSync(join(directory, blockmap))) uploaded.push(blockmap)
    else log(`publish github feed: ${blockmap} is missing; clients will download the full installer`)
  }
  if (existsSync(join(directory, 'SHA256SUMS.txt'))) uploaded.push('SHA256SUMS.txt')
  const create = (name, title, notes) => {
    if (dryRun) log(`gh release view ${name} -R ${repository} || gh release create ${name} -R ${repository} --prerelease --latest=false --title ${JSON.stringify(title)}`)
    else if (!releaseExists(gh, repository, name)) gh(['release', 'create', name, '-R', repository, '--prerelease', '--latest=false', '--title', title, '--notes', notes])
  }
  create(tag, `DeepSeek Harness ${version}`, `Unsigned Windows build ${version}.`)
  const uploadArgs = ['release', 'upload', tag, ...uploaded.map(name => join(directory, name)), '-R', repository, '--clobber']
  if (dryRun) log(`gh ${uploadArgs.join(' ')}`)
  else gh(uploadArgs)
  create(FEED_TAG, 'Desktop update feed', `Rolling update feed: ${FEED_FILES.join(' and ')} point at the installer in the latest versioned release.`)
  if (dryRun) {
    log(`gh release upload ${FEED_TAG} ${FEED_FILES.map(name => `<temporary>/${name}`).join(' ')} -R ${repository} --clobber`)
    log(`--- ${FEED_FILES.join(' = ')} ---\n${yaml}`)
  } else {
    const temporary = mkdtempSync(join(tmpdir(), 'dsh-feed-'))
    try {
      const files = FEED_FILES.map(name => join(temporary, name))
      for (const file of files) writeFileSync(file, yaml)
      gh(['release', 'upload', FEED_TAG, ...files, '-R', repository, '--clobber'])
    } finally { rmSync(temporary, { recursive: true, force: true }) }
  }
  return { tag, feedFiles: FEED_FILES, yaml, uploaded }
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { 'dry-run': { type: 'boolean', default: false }, artifacts: { type: 'string' } },
  })
  if (positionals.length > 1) throw new Error('usage: node publish-github-feed.mjs [owner/repo] [--artifacts <directory>] [--dry-run]')
  const repository = positionals[0] ?? DEFAULT_FEED_REPOSITORY
  if (!/^[\w.-]+\/[\w.-]+$/u.test(repository)) throw new Error(`publish github feed: ${repository} is not owner/repo`)
  const directory = values.artifacts === undefined ? desktopTargetBuildPaths('win-x64').unsignedArtifacts : resolve(values.artifacts)
  const result = publishGithubFeed({ directory, repository, dryRun: values['dry-run'] })
  console.log(`publish github feed: ${values['dry-run'] ? 'would publish' : 'published'} ${result.tag} and ${result.feedFiles.join(' and ')} to ${repository}`)
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) main()
