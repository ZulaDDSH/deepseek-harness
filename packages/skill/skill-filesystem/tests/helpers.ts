import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '../src/index.ts'

/** Pin every other-agent config root under the fixture home so tests never read the developer's real agent directories. */
export function otherAgentHomes(home: string): Record<'codexHome' | 'opencodeHome' | 'geminiHome' | 'cursorHome' | 'copilotHome', string> {
  return {
    codexHome: join(home, '.codex'),
    opencodeHome: join(home, '.config/opencode'),
    geminiHome: join(home, '.gemini'),
    cursorHome: join(home, '.cursor'),
    copilotHome: join(home, '.copilot'),
  }
}

/** Every config root pinned under the fixture home, with the host watcher off. */
export function allHomes(home: string) {
  return {
    dshHome: join(home, '.dsh'),
    agentsHome: join(home, '.agents'),
    claudeHome: join(home, '.claude'),
    ...otherAgentHomes(home),
    watch: false,
  }
}

/** A temp dir removed when the calling test finishes. */
export async function tempDir(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `dsh-${name}-`))
  onTestFinished(async () => { await rm(dir, { recursive: true, force: true }) })
  return await realpath(dir)
}

export async function writeSkill(root: string, name: string, description: string, body = 'Use the skill.'): Promise<void> {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`)
}

export async function writeSkillWithSidecar(root: string, name: string, openaiYaml: string): Promise<void> {
  await writeSkill(root, name, `${name} skill`)
  await mkdir(join(root, name, 'agents'), { recursive: true })
  await writeFile(join(root, name, 'agents/openai.yaml'), openaiYaml)
}

export async function writeFlatSkill(root: string, name: string, description: string, body = 'Flat body.'): Promise<void> {
  await mkdir(root, { recursive: true })
  await writeFile(join(root, `${name}.md`), `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`)
}

export async function setupLocal(home: string, config: Partial<SkillFileSystem.Config> = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillFileSystem, { ...allHomes(home), ...config })
  return ctx
}
