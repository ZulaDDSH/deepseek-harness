import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-skill'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'

async function writeSkill(root: string, name: string): Promise<void> {
  const bundle = join(root, name)
  await mkdir(bundle, { recursive: true })
  await writeFile(join(bundle, 'SKILL.md'), `---
name: ${name}
description: Must not enter the Web replay scaffold
---

Ambient host state.
`)
}

it('isolates replay skill discovery from every ambient host root', async () => {
  const ambient = await mkdtemp(join(tmpdir(), 'dsh-web-ambient-skills-'))
  const dshHome = join(ambient, 'dsh-home')
  const agentsHome = join(ambient, 'agents-home')
  const claudeConfig = join(ambient, 'claude-config')
  const codexHome = join(ambient, 'codex-home')
  const bundled = join(ambient, 'bundled')
  const geminiCli = join(ambient, 'gemini-cli')
  const copilotHome = join(ambient, 'copilot-home')
  const xdgConfig = join(ambient, 'xdg')
  await Promise.all([
    writeSkill(join(dshHome, 'skills'), 'ambient-dsh'),
    writeSkill(join(agentsHome, 'skills'), 'ambient-agents'),
    writeSkill(join(claudeConfig, 'skills'), 'ambient-claude'),
    writeSkill(join(codexHome, 'skills'), 'ambient-codex'),
    writeSkill(join(geminiCli, '.gemini', 'skills'), 'ambient-gemini'),
    writeSkill(join(copilotHome, 'skills'), 'ambient-copilot'),
    writeSkill(join(xdgConfig, 'opencode', 'skills'), 'ambient-opencode'),
    writeSkill(bundled, 'ambient-bundled'),
  ])

  const originalDshHome = process.env.DSH_HOME
  const originalAgentsHome = process.env.DSH_AGENTS_HOME
  const originalClaudeConfig = process.env.CLAUDE_CONFIG_DIR
  const originalCodexHome = process.env.CODEX_HOME
  const originalGeminiCli = process.env.GEMINI_CLI_HOME
  const originalCopilotHome = process.env.COPILOT_HOME
  const originalXdgConfig = process.env.XDG_CONFIG_HOME
  const originalBundled = process.env.DSH_BUNDLED_SKILL_DIR
  process.env.DSH_HOME = dshHome
  process.env.DSH_AGENTS_HOME = agentsHome
  process.env.CLAUDE_CONFIG_DIR = claudeConfig
  process.env.CODEX_HOME = codexHome
  process.env.GEMINI_CLI_HOME = geminiCli
  process.env.COPILOT_HOME = copilotHome
  process.env.XDG_CONFIG_HOME = xdgConfig
  process.env.DSH_BUNDLED_SKILL_DIR = bundled
  let scaffold: WebScaffold | undefined
  try {
    scaffold = await launchWebScaffold()
    const ctx = scaffold.ctx
    // Local skill discovery belongs to the agent's preset LAYER of the host
    // registry, so the roots under test are only reachable through a composed
    // agent's view — the same scope the `skills/list` Remote resolves for a
    // browser request about a session.
    const handle = await ctx.agents.create({
      sessionId: SessionId('hermetic-skills'),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx).then(() => undefined),
    })
    try {
      const skills = ctx.get('skills')
      if (skills === undefined) throw new Error('the composition mounts no skill registry')
      const names = (await skills.list({ cwd: scaffold.workspaceCwd, scope: handle.agent })).map(skill => skill.name)
      expect(names).not.toContain('ambient-dsh')
      expect(names).not.toContain('ambient-agents')
      expect(names).not.toContain('ambient-claude')
      expect(names).not.toContain('ambient-codex')
      expect(names).not.toContain('ambient-gemini')
      expect(names).not.toContain('ambient-copilot')
      expect(names).not.toContain('ambient-opencode')
      expect(names).not.toContain('ambient-bundled')
    } finally {
      await handle.dispose()
    }
  } finally {
    try {
      await scaffold?.close()
    } finally {
      if (originalDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = originalDshHome
      if (originalAgentsHome === undefined) delete process.env.DSH_AGENTS_HOME
      else process.env.DSH_AGENTS_HOME = originalAgentsHome
      if (originalClaudeConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = originalClaudeConfig
      if (originalCodexHome === undefined) delete process.env.CODEX_HOME
      else process.env.CODEX_HOME = originalCodexHome
      if (originalGeminiCli === undefined) delete process.env.GEMINI_CLI_HOME
      else process.env.GEMINI_CLI_HOME = originalGeminiCli
      if (originalCopilotHome === undefined) delete process.env.COPILOT_HOME
      else process.env.COPILOT_HOME = originalCopilotHome
      if (originalXdgConfig === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = originalXdgConfig
      if (originalBundled === undefined) delete process.env.DSH_BUNDLED_SKILL_DIR
      else process.env.DSH_BUNDLED_SKILL_DIR = originalBundled
      await rm(ambient, { recursive: true, force: true })
    }
  }
})
