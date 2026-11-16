import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillGsd from '@deepseek-ai/dsh-skill-gsd'
import { describe, expect, it } from 'vitest'

const assets = fileURLToPath(new URL('../assets/', import.meta.url))
const readme = fileURLToPath(new URL('../README.md', import.meta.url))
const FOOTER = 'Adapted from GSD (MIT), see NOTICE-GSD.md'
const FORBIDDEN_TOKENS = ['gsd_run', 'AskUserQuestion', 'subagent_type', 'worktree']
const GATE_BEARING = [
  'gsd-discuss-phase', 'gsd-plan-phase', 'gsd-execute-phase', 'gsd-verify-work',
  'gsd-ship', 'gsd-new-project', 'gsd-autonomous',
]
const HARDCODED_GATE = /\bgates\s*(?:[:=]|is\b)\s*[`'"]?(?:every-step|plan-and-ship|auto)\b/u
const BARE_PANEL = /(?<!Orchestrator & )Subagent Setup/u
const RESOURCE = /\b(?:templates|briefs|shared)\/[\w-]+\.md\b/gu

async function assetFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(entries.map(entry => (
    entry.isDirectory() ? assetFiles(join(dir, entry.name)) : Promise.resolve([join(dir, entry.name)])
  )))
  return nested.flat()
}

async function skillText(name: string): Promise<string> {
  return readFile(join(assets, name, 'SKILL.md'), 'utf8')
}

describe('dsh-skill-gsd', () => {
  it('registers one user-invocable skill per command and disposes them', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SkillRegistry)
      const fiber = await ctx.plugin(SkillGsd)
      const catalog = await ctx.skills.list()
      expect(catalog.map(skill => skill.name).sort()).toEqual([...SkillGsd.SKILL_NAMES].sort())
      expect(catalog).toHaveLength(20)
      for (const skill of catalog) {
        expect(skill).toMatchObject({
          source: 'bundled',
          provider: 'dsh-gsd',
          invocation: { modelInvocable: true, userInvocable: true },
          resourceBase: { kind: 'directory', path: assets },
        })
      }
      await fiber.dispose()
      expect(await ctx.skills.list()).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('loads every body without frontmatter and ends with the attribution footer', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SkillRegistry)
      await ctx.plugin(SkillGsd)
      for (const name of SkillGsd.SKILL_NAMES) {
        const loaded = await ctx.skills.get(name)
        expect(loaded?.content.startsWith('---'), name).toBe(false)
        expect(loaded?.content.endsWith(FOOTER), name).toBe(true)
      }
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('gives every skill a frontmatter name equal to its directory and a short plain description', async () => {
    for (const name of SkillGsd.SKILL_NAMES) {
      const fields = /^---\n([\s\S]*?)\n---/u.exec(await skillText(name))?.[1] ?? ''
      expect(/^name: (.+)$/mu.exec(fields)?.[1], name).toBe(name)
      expect(name).toMatch(/^gsd-[a-z0-9]+(?:-[a-z0-9]+)*$/u)
      const description = /^description: (.+)$/mu.exec(fields)?.[1] ?? ''
      expect(description.length, name).toBeGreaterThan(0)
      expect(description.length, name).toBeLessThanOrEqual(500)
      expect(description, name).not.toContain(': ')
    }
  })

  it('resolves every template, brief and shared file a skill or resource names', async () => {
    const missing: string[] = []
    for (const file of await assetFiles(assets)) {
      if (!file.endsWith('.md')) continue
      for (const reference of new Set((await readFile(file, 'utf8')).match(RESOURCE) ?? [])) {
        if (!existsSync(join(assets, reference))) missing.push(`${relative(assets, file)} -> ${reference}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('keeps the /gsd-* command names unique and matched to skill directories', async () => {
    const names = [...SkillGsd.SKILL_NAMES]
    expect(new Set(names).size).toBe(names.length)
    expect(names.every(name => name.startsWith('gsd-'))).toBe(true)
    const directories = (await readdir(assets, { withFileTypes: true }))
      .filter(entry => entry.isDirectory() && entry.name.startsWith('gsd-'))
      .map(entry => entry.name)
    expect(directories.sort()).toEqual([...names].sort())
  })

  it('keeps upstream-only tokens out of every skill and resource', async () => {
    const hits: string[] = []
    for (const file of await assetFiles(assets)) {
      const text = (await readFile(file, 'utf8')).toLowerCase()
      for (const token of FORBIDDEN_TOKENS) {
        if (text.includes(token.toLowerCase())) hits.push(`${relative(assets, file)}: ${token}`)
      }
    }
    expect(hits).toEqual([])
  })

  it('ties every gate-bearing skill to the GSD settings and hard-codes no gate mode', async () => {
    for (const name of SkillGsd.SKILL_NAMES) {
      expect(HARDCODED_GATE.test(await skillText(name)), name).toBe(false)
    }
    for (const name of GATE_BEARING) {
      const text = await skillText(name)
      expect(text, name).toContain('`gates`')
      expect(text, name).toContain('shared/settings.md')
    }
  })

  it('names the settings panel Orchestrator & Subagent Setup everywhere', async () => {
    const texts = [await readFile(readme, 'utf8')]
    for (const file of await assetFiles(assets)) texts.push(await readFile(file, 'utf8'))
    expect(texts.filter(text => BARE_PANEL.test(text))).toEqual([])
  })

  it('lets only gsd-ship push, and only after a question that no gates value skips', async () => {
    const pushers: string[] = []
    for (const file of await assetFiles(assets)) {
      if (/git push|gh pr create/u.test(await readFile(file, 'utf8'))) pushers.push(relative(assets, file).split(sep).join('/'))
    }
    expect(pushers).toEqual(['gsd-ship/SKILL.md'])
    const ship = await skillText('gsd-ship')
    expect(ship).toContain('Ask before pushing. Use `ask_user_question`')
    expect(ship).not.toMatch(/Under `auto`, do not ask/u)
    expect(ship).toContain('Never run `gh pr merge`, `git merge`')
  })

  it('tells every committing role to use the user identity with no trailers, and children never to push or merge', async () => {
    const conventions = await readFile(join(assets, 'shared', 'conventions.md'), 'utf8')
    expect(conventions).toContain("Commit with the user's configured git identity. Add no trailers")
    expect(conventions).toContain('no `--author`')
    const executor = await readFile(join(assets, 'briefs', 'executor.md'), 'utf8')
    expect(executor).toContain("Use the user's git identity. Add no trailers and no `--author`")
    expect(executor).toContain('Do not push, open a pull request or merge.')
    expect(await skillText('gsd-ship')).toContain('no "Generated with" line')
  })

  it('treats checkRounds 0 as one check with no fix round in the settings file and the plan step', async () => {
    const settings = await readFile(join(assets, 'shared', 'settings.md'), 'utf8')
    expect(settings).toContain('`0` still runs each check once but allows no fix round')
    expect(settings).not.toContain('skips the reviewer check')
    const plan = await skillText('gsd-plan-phase')
    expect(plan).toContain('whatever `checkRounds` is')
    expect(plan).not.toContain('skip the check')
  })


  it('names the per-plan files the Host section names', async () => {
    const conventions = await readFile(join(assets, 'shared', 'conventions.md'), 'utf8')
    expect(conventions).toContain('<NN>-<PP>-PLAN.md')
    expect(conventions).toContain('<NN>-<PP>-SUMMARY.md')
    expect(conventions).toContain('info/exclude')
  })

  it('keeps every skill within 200 lines', async () => {
    for (const name of SkillGsd.SKILL_NAMES) {
      expect((await skillText(name)).split('\n').length, name).toBeLessThanOrEqual(200)
    }
  })
})
