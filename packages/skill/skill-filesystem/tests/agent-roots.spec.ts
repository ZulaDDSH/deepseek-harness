import { describe, expect, it, vi } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '../src/index.ts'
import { setupLocal, tempDir, writeFlatSkill, writeSkill, writeSkillWithSidecar } from './helpers.ts'

describe('FileSystemSkillProvider agent roots', () => {
  it('discovers Codex, OpenCode, Gemini CLI, Cursor, Copilot, and goose skill roots in rank order', async () => {
    const home = await tempDir('skill-agents-priority')
    const project = await tempDir('skill-agents-priority-project')
    await mkdir(join(project, '.git'), { recursive: true })
    await writeSkill(join(project, '.codex/skills'), 'project-codex-only', 'project codex')
    await writeSkill(join(project, '.opencode/skills'), 'project-opencode-only', 'project opencode')
    await writeSkill(join(project, '.gemini/skills'), 'project-gemini-only', 'project gemini')
    await writeSkill(join(project, '.cursor/skills'), 'project-cursor-only', 'project cursor')
    await writeSkill(join(project, '.github/skills'), 'project-copilot-only', 'project copilot')
    await writeSkill(join(project, '.goose/skills'), 'project-goose-only', 'project goose')
    await writeSkill(join(project, '.claude/skills'), 'shared', 'claude wins over codex')
    await writeSkill(join(project, '.codex/skills'), 'shared', 'codex loses to claude')
    await writeSkill(join(project, '.codex/skills'), 'shared-agents', 'codex loses to agents')
    await writeSkill(join(project, '.agents/skills'), 'shared-agents', 'agents wins over codex')
    await writeSkill(join(project, '.cursor/skills'), 'cursor-vs-gemini', 'cursor loses')
    await writeSkill(join(project, '.gemini/skills'), 'cursor-vs-gemini', 'gemini wins')
    await writeSkill(join(home, '.codex/skills'), 'user-codex-only', 'user codex')
    await writeSkill(join(home, '.config/opencode/skills'), 'user-opencode-only', 'user opencode')
    await writeSkill(join(home, '.gemini/skills'), 'user-gemini-only', 'user gemini')
    await writeSkill(join(home, '.cursor/skills'), 'user-cursor-only', 'user cursor')
    await writeSkill(join(home, '.copilot/skills'), 'user-copilot-only', 'user copilot')
    await writeSkill(join(home, '.claude/skills'), 'user-shared', 'user claude wins')
    await writeSkill(join(home, '.codex/skills'), 'user-shared', 'user codex loses')
    await writeSkill(join(home, '.codex/skills/.system'), 'system-skill', 'codex system skills stay hidden')
    const ctx = await setupLocal(home)

    expect((await ctx.skills.list({ cwd: project })).map(skill => [skill.name, skill.source])).toEqual([
      ['cursor-vs-gemini', 'project-gemini'],
      ['project-codex-only', 'project-codex'],
      ['project-copilot-only', 'project-copilot'],
      ['project-cursor-only', 'project-cursor'],
      ['project-gemini-only', 'project-gemini'],
      ['project-goose-only', 'project-goose'],
      ['project-opencode-only', 'project-opencode'],
      ['shared', 'project-claude'],
      ['shared-agents', 'project-agents'],
      ['user-codex-only', 'user-codex'],
      ['user-copilot-only', 'user-copilot'],
      ['user-cursor-only', 'user-cursor'],
      ['user-gemini-only', 'user-gemini'],
      ['user-opencode-only', 'user-opencode'],
      ['user-shared', 'user-claude'],
    ])
  })

  it('honors Codex agents/openai.yaml and OpenCode metadata invocation policy below an explicit frontmatter key', async () => {
    const home = await tempDir('skill-agents-invocation')
    const root = join(home, '.codex/skills')
    await writeSkillWithSidecar(root, 'codex-explicit-only', 'interface:\n  display_name: Explicit\npolicy:\n  allow_implicit_invocation: false\n')
    await writeSkillWithSidecar(root, 'codex-implicit', 'policy:\n  allow_implicit_invocation: true\n')
    await mkdir(join(root, 'frontmatter-wins/agents'), { recursive: true })
    await writeFile(join(root, 'frontmatter-wins/SKILL.md'), '---\nname: frontmatter-wins\ndescription: Frontmatter wins\ndisable-model-invocation: false\n---\n\nBody.\n')
    await writeFile(join(root, 'frontmatter-wins/agents/openai.yaml'), 'policy:\n  allow_implicit_invocation: false\n')
    await mkdir(join(root, 'opencode-manual'), { recursive: true })
    await writeFile(join(root, 'opencode-manual/SKILL.md'), '---\nname: opencode-manual\ndescription: OpenCode manual\nmetadata:\n  opencode/autoinvoke: "false"\n---\n\nBody.\n')
    await writeFlatSkill(root, 'flat-codex', 'Flat skills carry no sidecar')
    const ctx = await setupLocal(home)

    const invocation = async (name: string) => (await ctx.skills.get(name))?.invocation
    expect(await invocation('codex-explicit-only')).toEqual({ modelInvocable: false, userInvocable: true })
    expect(await invocation('codex-implicit')).toEqual({ modelInvocable: true, userInvocable: true })
    expect(await invocation('frontmatter-wins')).toEqual({ modelInvocable: true, userInvocable: true })
    expect(await invocation('flat-codex')).toEqual({ modelInvocable: true, userInvocable: true })
    expect(await invocation('opencode-manual')).toEqual({ modelInvocable: false, userInvocable: true })
    expect((await ctx.skills.list()).find(skill => skill.name === 'codex-explicit-only')?.invocation.modelInvocable).toBe(false)
  })

  it('drops a skill whose agents/openai.yaml policy is not a boolean instead of silently permitting model invocation', async () => {
    const home = await tempDir('skill-agents-invalid-policy')
    await writeSkillWithSidecar(join(home, '.codex/skills'), 'bad-policy', 'policy:\n  allow_implicit_invocation: maybe\n')
    const ctx = await setupLocal(home)
    const warn = vi.spyOn(ctx.logger, 'warn')

    expect(await ctx.skills.list()).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('allow_implicit_invocation'))
  })

  it('treats empty agent home environment variables as unset', async () => {
    const previous = ['CODEX_HOME', 'XDG_CONFIG_HOME', 'GEMINI_CLI_HOME', 'COPILOT_HOME', 'CLAUDE_CONFIG_DIR', 'HOME', 'USERPROFILE'] as const
    const previousValues = previous.map(key => [key, process.env[key]] as const)
    const envHome = await tempDir('skill-empty-env-home')
    try {
      process.env.CODEX_HOME = ''
      process.env.XDG_CONFIG_HOME = ''
      process.env.GEMINI_CLI_HOME = ''
      process.env.COPILOT_HOME = ''
      process.env.CLAUDE_CONFIG_DIR = ''
      process.env.HOME = envHome
      process.env.USERPROFILE = envHome
      await writeSkill(join(envHome, '.codex/skills'), 'empty-env-codex', 'Empty env Codex skill')
      await writeSkill(join(envHome, '.copilot/skills'), 'empty-env-copilot', 'Empty env Copilot skill')
      await writeSkill(join(envHome, '.claude/skills'), 'empty-env-claude', 'Empty env Claude skill')
      const ctx = new Context()
      await ctx.plugin(SkillRegistry)
      SkillFileSystem.apply(ctx, { dshHome: join(envHome, '.dsh'), agentsHome: join(envHome, '.agents'), watch: false })
      expect((await ctx.skills.get('empty-env-codex'))?.source).toBe('user-codex')
      expect((await ctx.skills.get('empty-env-copilot'))?.source).toBe('user-copilot')
      expect((await ctx.skills.get('empty-env-claude'))?.source).toBe('user-claude')
    } finally {
      for (const [key, value] of previousValues) {
        if (value === undefined) Reflect.deleteProperty(process.env, key)
        else process.env[key] = value
      }
    }
  })

  it('uses default home root resolution without exposing builtin skills', async () => {
    const previousDshHome = process.env.DSH_HOME
    const previousAgentsHome = process.env.DSH_AGENTS_HOME
    const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
    const previousBundledSkillDir = process.env.DSH_BUNDLED_SKILL_DIR
    const agentEnv = ['CODEX_HOME', 'XDG_CONFIG_HOME', 'OPENCODE_CONFIG_DIR', 'GEMINI_CLI_HOME', 'COPILOT_HOME', 'HOME', 'USERPROFILE'] as const
    const previousAgentEnv = agentEnv.map(key => [key, process.env[key]] as const)
    const envHome = await tempDir('skill-env-home')
    try {
      process.env.CODEX_HOME = join(envHome, '.codex')
      process.env.XDG_CONFIG_HOME = join(envHome, '.config')
      process.env.OPENCODE_CONFIG_DIR = join(envHome, 'opencode-override')
      process.env.GEMINI_CLI_HOME = envHome
      process.env.COPILOT_HOME = join(envHome, '.copilot')
      process.env.HOME = envHome
      process.env.USERPROFILE = envHome
      await writeSkill(join(envHome, '.codex/skills'), 'env-codex-skill', 'Env Codex skill')
      await writeSkill(join(envHome, '.gemini/skills'), 'env-gemini-skill', 'Env Gemini skill')
      await writeSkill(join(envHome, '.cursor/skills'), 'env-cursor-skill', 'Env Cursor skill')
      await writeSkill(join(envHome, '.config/opencode/skills'), 'env-opencode-skill', 'Env OpenCode skill')
      await writeSkill(join(envHome, '.copilot/skills'), 'env-copilot-skill', 'Env Copilot skill')
      process.env.DSH_HOME = join(envHome, '.dsh')
      process.env.DSH_AGENTS_HOME = join(envHome, '.agents')
      process.env.CLAUDE_CONFIG_DIR = join(envHome, '.claude')
      const bundled = join(envHome, 'bundled-skills')
      process.env.DSH_BUNDLED_SKILL_DIR = bundled
      await writeSkill(join(envHome, '.dsh/skills'), 'env-skill', 'Env skill')
      await writeSkill(join(envHome, '.claude/skills'), 'env-claude-skill', 'Env Claude skill')
      await writeSkill(bundled, 'env-bundled-skill', 'Env bundled skill')
      const ctx = new Context()
      await ctx.plugin(SkillRegistry)
      await ctx.plugin(SkillFileSystem, { watch: false })
      expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['env-bundled-skill', 'env-claude-skill', 'env-codex-skill', 'env-copilot-skill', 'env-cursor-skill', 'env-gemini-skill', 'env-opencode-skill', 'env-skill'])
      expect((await ctx.skills.get('env-claude-skill'))?.source).toBe('user-claude')
      expect((await ctx.skills.get('env-codex-skill'))?.source).toBe('user-codex')
      expect((await ctx.skills.get('env-gemini-skill'))?.source).toBe('user-gemini')
      expect((await ctx.skills.get('env-cursor-skill'))?.source).toBe('user-cursor')
      expect((await ctx.skills.get('env-opencode-skill'))?.source).toBe('user-opencode')
      expect((await ctx.skills.get('env-copilot-skill'))?.source).toBe('user-copilot')

      // Isolated providers see only their explicit roots: the environment
      // bundled root is a default root, so includeDefaultRoots: false must
      // drop it — isolated providers never re-claim the app's builtins.
      const isolated = new Context()
      await isolated.plugin(SkillRegistry)
      const customOnly = join(envHome, 'custom-only')
      await writeSkill(customOnly, 'custom-isolated-skill', 'Custom isolated skill')
      await isolated.plugin(SkillFileSystem, {
        providerName: 'isolated',
        includeDefaultRoots: false,
        customSkillDirs: [customOnly],
        watch: false,
      })
      expect((await isolated.skills.list()).map(skill => skill.name)).toEqual(['custom-isolated-skill'])
      await isolated.fiber.dispose()

      process.env.DSH_HOME = join(envHome, 'empty-dsh')
      delete process.env.DSH_BUNDLED_SKILL_DIR
      process.env.DSH_AGENTS_HOME = join(envHome, 'empty-agents')
      process.env.CLAUDE_CONFIG_DIR = join(envHome, 'empty-claude')
      process.env.CODEX_HOME = join(envHome, 'empty-codex')
      process.env.GEMINI_CLI_HOME = join(envHome, 'empty-gemini')
      process.env.XDG_CONFIG_HOME = join(envHome, 'empty-xdg')
      process.env.COPILOT_HOME = join(envHome, 'empty-copilot')
      process.env.HOME = join(envHome, 'empty-home')
      process.env.USERPROFILE = join(envHome, 'empty-home')
      const empty = new Context()
      await empty.plugin(SkillRegistry)
      SkillFileSystem.apply(empty, { watch: false })
      expect(await empty.skills.list()).toEqual([])

      delete process.env.DSH_AGENTS_HOME
      expect(new SkillFileSystem.FileSystemSkillProvider(empty, {
        signal: new AbortController().signal,
        invalidate() {},
      }, { dshHome: join(envHome, 'empty-dsh') }).name).toBe('filesystem')
    } finally {
      for (const [key, value] of previousAgentEnv) {
        if (value === undefined) Reflect.deleteProperty(process.env, key)
        else process.env[key] = value
      }
      if (previousDshHome === undefined) {
        delete process.env.DSH_HOME
      } else {
        process.env.DSH_HOME = previousDshHome
      }
      if (previousAgentsHome === undefined) {
        delete process.env.DSH_AGENTS_HOME
      } else {
        process.env.DSH_AGENTS_HOME = previousAgentsHome
      }
      if (previousClaudeConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR
      } else {
        process.env.CLAUDE_CONFIG_DIR = previousClaudeConfigDir
      }
      if (previousBundledSkillDir === undefined) {
        delete process.env.DSH_BUNDLED_SKILL_DIR
      } else {
        process.env.DSH_BUNDLED_SKILL_DIR = previousBundledSkillDir
      }
    }
  })
})
