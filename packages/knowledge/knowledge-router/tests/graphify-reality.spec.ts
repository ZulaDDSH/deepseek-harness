/**
 * Real-Graphify tier: drives an installed Graphify CLI end to end over a
 * throwaway project, proving the freshness probe reads the provider's own
 * lesson state and reports reverification once the source it was fingerprinted
 * against changes.
 *
 * Self-skips when no `graphify` executable is available; set
 * `DSH_GRAPHIFY_COMMAND` to point at a specific install.
 */

import { execFile, spawnSync } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import { explainLesson, recordLearning } from '../src/graphify-learn.ts'

const command = process.env.DSH_GRAPHIFY_COMMAND ?? 'graphify'
// `graphify --help` exits non-zero on this CLI, so a non-null status — not a
// zero one — is what proves the executable ran.
const available = spawnSync(command, ['--help'], { encoding: 'utf8', windowsHide: true }).status !== null

const SOURCE = [
  'export function closeSession(id: string): void {',
  '  teardown(id)',
  '}',
  '',
  'export function teardown(id: string): void {',
  '  void id',
  '}',
  '',
  'export function openSession(id: string): void {',
  '  closeSession(id)',
  '}',
  '',
].join('\n')

const CHANGED = `${SOURCE}\nexport function extra(id: string): void {\n  void id\n}\n`

const QUESTION = 'what calls closeSession'

/** A runner that executes inside the throwaway project Graphify was pointed at. */
function runnerIn(cwd: string): NativeCommandRunner {
  return (executable, args, signal) => new Promise((resolve, reject) => {
    execFile(executable, [...args], { encoding: 'utf8', cwd, signal, windowsHide: true }, (error, stdout, stderr) => {
      if (error !== null) reject(Object.assign(new Error(error.message, { cause: error }), { stdout, stderr }))
      else resolve({ stdout, stderr })
    })
  })
}

describe.skipIf(!available)('Graphify CLI end to end', () => {
  it('reports a lesson as needing reverification once the source it was fingerprinted against changes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-graphify-'))
    const runner = runnerIn(directory)
    const signal = new AbortController().signal
    const config = { command, reflect: true }
    const source = join(directory, 'session.ts')

    await writeFile(source, SOURCE)
    await runner(command, ['update', directory], signal, 'hidden')

    // Two citations of the same node reach Graphify's corroboration threshold.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await recordLearning(
        {
          question: QUESTION,
          answer: 'openSession calls closeSession',
          outcome: 'useful',
          nodes: ['closeSession()'],
          validatedBy: 'reviewer',
        },
        config,
        signal,
        runner,
      )
    }

    const current = await explainLesson('closeSession()', config, signal, runner)
    expect(current?.status).toBeDefined()
    expect(current?.stale).toBe(false)

    await writeFile(source, CHANGED)

    const afterChange = await explainLesson('closeSession()', config, signal, runner)
    expect(afterChange?.stale).toBe(true)
  }, 120_000)
})
