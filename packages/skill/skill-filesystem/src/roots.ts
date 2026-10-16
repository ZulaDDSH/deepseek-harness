import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { SkillSource } from '@deepseek-ai/dsh-skill'

/** Config roots of every agent whose skill directories the provider scans. */
export interface AgentHomes {
  dshHome: string
  agentsHome: string
  claudeHome: string
  codexHome: string
  opencodeHome: string
  geminiHome: string
  cursorHome: string
  copilotHome: string
}

/** A directory scanned for skills, with the rank that orders its skills. */
export interface SkillRoot {
  path: string
  source: SkillSource
  rank: number
  skipSystem?: boolean
  projectRoot?: string
  trustedHost?: boolean
}

interface AgentRootRow {
  agent: string
  projectDir: string
  projectRank: number
  user?: { home: keyof AgentHomes; rank: number; skipSystem?: boolean }
}

const AGENT_ROOTS: readonly AgentRootRow[] = [
  { agent: 'dsh', projectDir: '.dsh/skills', projectRank: 100, user: { home: 'dshHome', rank: 400, skipSystem: true } },
  { agent: 'agents', projectDir: '.agents/skills', projectRank: 200, user: { home: 'agentsHome', rank: 500 } },
  { agent: 'claude', projectDir: '.claude/skills', projectRank: 230, user: { home: 'claudeHome', rank: 550 } },
  { agent: 'codex', projectDir: '.codex/skills', projectRank: 232, user: { home: 'codexHome', rank: 560, skipSystem: true } },
  { agent: 'opencode', projectDir: '.opencode/skills', projectRank: 234, user: { home: 'opencodeHome', rank: 565 } },
  { agent: 'gemini', projectDir: '.gemini/skills', projectRank: 236, user: { home: 'geminiHome', rank: 570 } },
  { agent: 'cursor', projectDir: '.cursor/skills', projectRank: 238, user: { home: 'cursorHome', rank: 575 } },
  { agent: 'copilot', projectDir: '.github/skills', projectRank: 240, user: { home: 'copilotHome', rank: 580 } },
  { agent: 'goose', projectDir: '.goose/skills', projectRank: 242 },
]

/**
 * Resolve each agent home from its explicit config, then its environment variable, then the default.
 * @param config - explicit home overrides; unset keys fall back to the environment and defaults.
 * @returns the resolved home of every agent.
 */
export function resolveAgentHomes(config: Partial<AgentHomes>): AgentHomes {
  return {
    dshHome: resolveDshHome(config.dshHome),
    agentsHome: resolve(config.agentsHome ?? process.env.DSH_AGENTS_HOME ?? join(homedir(), '.agents')),
    claudeHome: resolve(config.claudeHome ?? nonEmptyEnv('CLAUDE_CONFIG_DIR') ?? join(homedir(), '.claude')),
    codexHome: resolve(config.codexHome ?? nonEmptyEnv('CODEX_HOME') ?? join(homedir(), '.codex')),
    opencodeHome: resolve(config.opencodeHome ?? join(nonEmptyEnv('XDG_CONFIG_HOME') ?? join(homedir(), '.config'), 'opencode')),
    geminiHome: resolve(config.geminiHome ?? join(nonEmptyEnv('GEMINI_CLI_HOME') ?? homedir(), '.gemini')),
    cursorHome: resolve(config.cursorHome ?? join(homedir(), '.cursor')),
    copilotHome: resolve(config.copilotHome ?? nonEmptyEnv('COPILOT_HOME') ?? join(homedir(), '.copilot')),
  }
}

/**
 * Project skill roots for every agent, ordered by project rank.
 * @param projectRoot - the project directory that holds each agent's skill directory.
 * @returns one root per agent.
 */
export function projectSkillRoots(projectRoot: string): SkillRoot[] {
  return AGENT_ROOTS.map(row => ({
    path: join(projectRoot, row.projectDir),
    source: `project-${row.agent}`,
    rank: row.projectRank,
    projectRoot,
  }))
}

/**
 * User skill roots for every agent that has one, ordered by user rank.
 * @param homes - the resolved home of every agent.
 * @returns one root per agent with a user directory.
 */
export function userSkillRoots(homes: AgentHomes): SkillRoot[] {
  return AGENT_ROOTS.flatMap(({ agent, user }) => user === undefined ? [] : [{
    path: join(homes[user.home], 'skills'),
    source: `user-${agent}`,
    rank: user.rank,
    ...user.skipSystem ? { skipSystem: true } : {},
  }])
}

/**
 * The nearest ancestor of `cwd` containing `.git`, or `cwd` when there is none.
 * @param cwd - the directory to start the search from.
 * @param fs - the filesystem service that probes for `.git`, or `undefined` to probe the host.
 * @returns the project root directory.
 */
export async function findProjectRoot(cwd: string, fs: FileSystem | undefined): Promise<string> {
  let current = cwd
  while (true) {
    if (await pathExists(join(current, '.git'), fs)) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) return cwd
    current = parent
  }
}

function nonEmptyEnv(name: string): string | undefined {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : value
}

async function pathExists(path: string, fs: FileSystem | undefined): Promise<boolean> {
  if (fs !== undefined) {
    return await pathExistsInFileSystem(path, fs)
  }
  return await pathExistsInNode(path)
}

async function pathExistsInFileSystem(path: string, fs: FileSystem): Promise<boolean> {
  let target
  try {
    target = await fs.resolve(path)
  } catch {
    // A backend may reject or hide this candidate; continue walking upward.
    return false
  }
  try {
    return await fs.stat(target) !== undefined
  } catch {
    // Transient stat failures make only this git-root candidate unusable.
    return false
  }
}

async function pathExistsInNode(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    // Missing host paths are expected while walking toward the filesystem root.
    return false
  }
}
