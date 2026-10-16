/**
 * Bundled GSD workflow skill provider: one user-invocable skill per `/gsd-*` command.
 *
 * @module @deepseek-ai/dsh-skill-gsd
 */

import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import {
  BUNDLED_SKILL_RANK,
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'

const PROVIDER_NAME = 'dsh-gsd'
const ASSET_ROOT = fileURLToPath(new URL('../assets/', import.meta.url))
const RESOURCE_BASE = { kind: 'directory', path: ASSET_ROOT } as const
const INVOCATION = { modelInvocable: true, userInvocable: true } as const

/** Skill directory names under `assets/`; each name is also the user-facing `/` command. */
export const SKILL_NAMES = [
  'gsd-discuss-phase', 'gsd-plan-phase', 'gsd-execute-phase', 'gsd-verify-work', 'gsd-ship',
  'gsd-next', 'gsd-progress', 'gsd-pause-work', 'gsd-resume-work', 'gsd-autonomous',
  'gsd-quick', 'gsd-fast', 'gsd-new-project', 'gsd-map-codebase',
  'gsd-code-review', 'gsd-debug', 'gsd-secure-phase', 'gsd-ui-review', 'gsd-audit-milestone',
  'gsd-help',
] as const

function parseSkill(raw: string, name: string, path: string): { description: string; content: string } {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw)
  if (frontmatter?.[1] === undefined) throw new Error(`skill-gsd: ${path} has no YAML frontmatter`)
  const fields = frontmatter[1]
  if (/^name: (.+)$/mu.exec(fields)?.[1]?.trim() !== name) throw new Error(`skill-gsd: ${path} must declare name ${name}`)
  const description = /^description: (.+)$/mu.exec(fields)?.[1]?.trim()
  if (description === undefined || description.length === 0) throw new Error(`skill-gsd: ${path} has no description`)
  return { description, content: raw.slice(frontmatter[0].length).trim() }
}

/** Cordis plugin name. */
export const name = 'skill-gsd'
/** Registry used by the bundled provider. */
export const inject = ['skills']

/**
 * Register the GSD skills on `ctx.skills`; each body resolves its templates and briefs under the packaged `assets/` directory.
 * @param ctx - Context carrying the skill registry.
 */
export function apply(ctx: Context): void {
  const candidates: SkillCandidate[] = SKILL_NAMES.map((skillName) => {
    const path = join(ASSET_ROOT, skillName, 'SKILL.md')
    const { description } = parseSkill(readFileSync(path, 'utf8'), skillName, path)
    return {
      name: skillName, description, invocation: INVOCATION,
      provider: PROVIDER_NAME, source: 'bundled', resourceBase: RESOURCE_BASE,
      rank: BUNDLED_SKILL_RANK, locator: path,
    }
  })
  const provider: SkillProvider = {
    name: PROVIDER_NAME,
    list: () => Promise.resolve(candidates),
    async get(candidate): Promise<SkillDefinition | undefined> {
      const path = candidate.locator as string
      const { content } = parseSkill(await readFile(path, 'utf8'), candidate.name, path)
      return {
        name: candidate.name, description: candidate.description, invocation: candidate.invocation,
        provider: candidate.provider, source: candidate.source, resourceBase: RESOURCE_BASE, content,
      }
    },
  }
  ctx.skills.registerProvider(() => provider)
}
