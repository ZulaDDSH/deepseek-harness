import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, posix, resolve } from 'node:path'
import * as yaml from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { preMergeSteps } from './pre-merge-check.ts'

const root = resolve(import.meta.dirname, '..')
const STEP_NAME = 'Run the base branch\'s pre-merge check'
const BASE = 'b'.repeat(40)

function preMergeRunScript(): string {
  const workflow = yaml.load(readFileSync(join(root, '.github/workflows/pr-check-on-head-branch.yml'), 'utf8')) as {
    jobs: Record<string, { steps: { name?: string, run?: string }[] }>
  }
  const step = workflow.jobs['pre-merge']?.steps.find(item => item.name === STEP_NAME)
  if (step?.run === undefined) throw new TypeError(`the pre-merge job must define the step ${STEP_NAME}`)
  return step.run
}

function trustedFiles(script: string): string[] {
  const list = /^\s*trusted=\(([^)]*)\)/mu.exec(script)?.[1]
  if (list === undefined) throw new TypeError('the pre-merge step must list the files it restores from the base commit')
  return list.split(/\s+/u).filter(Boolean)
}

describe('Policy pre-merge job', () => {
  it('restores the check from the base commit before it executes anything', () => {
    const script = preMergeRunScript()
    const restore = script.indexOf('git checkout "$BASE_SHA" -- "${trusted[@]}"')
    const execution = script.indexOf('node scripts/pre-merge-check.ts')
    expect(restore).toBeGreaterThan(0)
    expect(execution).toBeGreaterThan(restore)
    expect(script).not.toContain('-f scripts/pre-merge-check.ts')
  })

  it('restores the driver, every script it runs, and the local modules those scripts import', () => {
    const trusted = trustedFiles(preMergeRunScript())
    expect(trusted).toContain('scripts/pre-merge-check.ts')
    const named = preMergeSteps('/repo', BASE)
      .flatMap(step => step.args)
      .flatMap(arg => /scripts[\\/][\w./-]+\.ts$/u.exec(arg.replaceAll('\\', '/'))?.[0] ?? [])
    expect(named.length).toBeGreaterThan(0)
    for (const path of named) expect(trusted).toContain(path)
    for (const path of trusted) {
      const source = readFileSync(join(root, path), 'utf8')
      for (const [, specifier] of source.matchAll(/^(?:import|export)\b[^'"\n]*from '(\.[^']+)'/gmu)) {
        expect(trusted, `${path} imports ${specifier}`).toContain(posix.join(dirname(path), specifier!))
      }
    }
  })

  it('does not run the upgrade-guide check through the pull request\'s package.json', () => {
    const args = preMergeSteps('/repo', BASE).find(step => step.name === 'upgrade guides')?.args
    expect(args).toEqual(['exec', 'tsx', 'scripts/verify-upgrade-guides.ts', '--base', BASE])
  })
})

describe('Policy pre-merge step against a pull request that replaces the check', () => {
  const directories: string[] = []
  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  function git(cwd: string, ...args: string[]): string {
    return execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { cwd, encoding: 'utf8' }).trim()
  }

  function repository(files: readonly string[]): { dir: string, base: string } {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-policy-'))
    directories.push(dir)
    git(dir, 'init', '-q')
    for (const file of files) {
      mkdirSync(join(dir, dirname(file)), { recursive: true })
      writeFileSync(join(dir, file), file === 'scripts/pre-merge-check.ts' ? 'import { writeFileSync } from "node:fs"\nwriteFileSync("ran-base", "base")\n' : '')
    }
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', 'base')
    return { dir, base: git(dir, 'rev-parse', 'HEAD') }
  }

  function runStep(dir: string, base: string, mode: string): { status: number | null, output: string } {
    const script = join(dir, '..', `${dir.split(/[\\/]/u).pop()}.sh`)
    writeFileSync(script, preMergeRunScript())
    directories.push(script)
    const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', script], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, CHECK_MODE: mode, BASE_SHA: base },
    })
    return { status: result.status, output: result.stdout + result.stderr }
  }

  it('runs the base commit\'s check, not the pull request\'s no-op replacement', () => {
    const trusted = trustedFiles(preMergeRunScript())
    const { dir, base } = repository(trusted)
    writeFileSync(join(dir, 'scripts/pre-merge-check.ts'), 'process.exit(0)\n')
    const result = runStep(dir, base, 'block')
    expect(result.status, result.output).toBe(0)
    expect(readFileSync(join(dir, 'ran-base'), 'utf8')).toBe('base')
    expect(readFileSync(join(dir, 'scripts/pre-merge-check.ts'), 'utf8')).toContain('ran-base')
  })

  it('runs the base commit\'s check when the pull request deleted it', () => {
    const trusted = trustedFiles(preMergeRunScript())
    const { dir, base } = repository(trusted)
    rmSync(join(dir, 'scripts/pre-merge-check.ts'))
    expect(runStep(dir, base, 'block').status).toBe(0)
    expect(readFileSync(join(dir, 'ran-base'), 'utf8')).toBe('base')
  })

  it.each([['block', 1, '::error'], ['report', 0, '::warning']] as const)('reports a base commit without the check in %s mode', (mode, status, annotation) => {
    const trusted = trustedFiles(preMergeRunScript()).filter(file => file !== 'scripts/verify-upgrade-guides.ts')
    const { dir, base } = repository(trusted)
    writeFileSync(join(dir, 'scripts/verify-upgrade-guides.ts'), '')
    const result = runStep(dir, base, mode)
    expect(result.status).toBe(status)
    expect(result.output).toContain(annotation)
    expect(result.output).toContain('scripts/verify-upgrade-guides.ts')
  })
})
