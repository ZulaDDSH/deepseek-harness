import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { userParentEnv } from '@deepseek-ai/dsh-subprocess'
import type { SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'

const SCRIPT = 'process.stdout.write("RESULT:" + JSON.stringify([process.env.PROBE_API_KEY, process.env.DSH_PROBE, process.env.TERM]) + ":END")'

async function probe(extra: Partial<SubprocessTerminalSpawnSpec>): Promise<unknown> {
  const ctx = new Context()
  const fiber = await ctx.plugin(LocalSubprocessRuntime)
  try {
    const handle = await ctx.subprocess.spawnTerminal({
      argv: [process.execPath, '-e', SCRIPT], cwd: process.cwd(), rows: 24, cols: 200, terminalType: 'xterm-256color', graceMs: 200, ...extra,
    })
    let text = ''
    handle.output.on('data', (chunk: Buffer | string) => { text += String(chunk) })
    await handle.done
    await new Promise(resolve => setTimeout(resolve, 50))
    const match = /RESULT:(.*?):END/su.exec(text.replaceAll(/\r|\n/gu, ''))
    return match === null ? text : JSON.parse(match[1] ?? 'null')
  } finally {
    await fiber.dispose()
  }
}

describe('terminal user environment', () => {
  it('keeps credential-shaped names and drops only DSH_ names when inheritEnvironment is set', async () => {
    process.env.PROBE_API_KEY = 'user-owned'
    process.env.DSH_PROBE = 'internal'
    try {
      expect(userParentEnv()).toMatchObject({ PROBE_API_KEY: 'user-owned' })
      expect(userParentEnv()).not.toHaveProperty('DSH_PROBE')
      expect(await probe({ inheritEnvironment: true })).toEqual(['user-owned', null, 'xterm-256color'])
    } finally {
      delete process.env.PROBE_API_KEY
      delete process.env.DSH_PROBE
    }
  })

  it('keeps the credential scrub for an ordinary terminal', async () => {
    process.env.PROBE_API_KEY = 'user-owned'
    try {
      expect(await probe({})).toEqual([null, null, 'xterm-256color'])
    } finally {
      delete process.env.PROBE_API_KEY
    }
  })

  it('only the local provider declares that it honors the inherited environment', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    expect(ctx.subprocess.inheritsUserEnvironment).toBe(true)
    await fiber.dispose()
  })
})
