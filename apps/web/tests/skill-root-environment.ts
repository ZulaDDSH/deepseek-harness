import { join } from 'node:path'

/**
 * Pin the skill, preset and CLI-home environment to the scaffold workspace until the returned restore runs; restore is idempotent.
 * @param harnessHome - the resolved harness home the settings and credential rows read.
 * @param workspaceCwd - the scaffold's isolated workspace root.
 * @returns the restore function, which puts back every key's prior value (deleting keys that were unset).
 */
export function pinSkillRootEnvironment(harnessHome: string, workspaceCwd: string): () => void {
  const pinned = {
    DSH_HOME: harnessHome,
    DSH_AGENTS_HOME: join(workspaceCwd, '.agents-home'),
    DSH_BUNDLED_SKILL_DIR: join(workspaceCwd, '.bundled-skills'),
    CLAUDE_CONFIG_DIR: join(workspaceCwd, '.claude-home'),
    CODEX_HOME: join(workspaceCwd, '.codex-home'),
    GEMINI_CLI_HOME: join(workspaceCwd, '.gemini-cli-home'),
    COPILOT_HOME: join(workspaceCwd, '.copilot-home'),
    XDG_CONFIG_HOME: join(workspaceCwd, '.xdg-config'),
  }
  const original = Object.fromEntries(Object.keys(pinned).map(key => [key, process.env[key]]))
  let restored = false
  Object.assign(process.env, pinned)
  return (): void => {
    if (restored) return
    restored = true
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = value
    }
  }
}
