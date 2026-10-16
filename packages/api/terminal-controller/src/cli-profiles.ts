import type { CliTerminalProfileId } from '@deepseek-ai/dsh-session/types'

export type { CliTerminalProfileId } from '@deepseek-ai/dsh-session/types'

/** One CLI the user installs and signs into themselves. */
export interface CliTerminalProfile {
  readonly id: CliTerminalProfileId
  readonly command: string
  readonly installUrl: string
}

/** Every CLI terminal profile; each one also needs its picker copy in the Client locales. */
export const CLI_TERMINAL_PROFILES: readonly CliTerminalProfile[] = [
  { id: 'gemini-cli', command: 'gemini', installUrl: 'https://geminicli.com' },
  { id: 'grok-cli', command: 'grok', installUrl: 'https://x.ai/cli' },
  { id: 'cursor-cli', command: 'cursor-agent', installUrl: 'https://cursor.com/cli' },
]

const POSIX_SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'ash'])

/**
 * Resolve one profile by its persisted identity.
 * @param id - profile identity from a create request or Session event.
 * @returns the matching entry of {@link CLI_TERMINAL_PROFILES}.
 * @throws when the identity names no profile.
 */
export function cliTerminalProfile(id: string): CliTerminalProfile {
  const profile = CLI_TERMINAL_PROFILES.find(candidate => candidate.id === id)
  if (profile === undefined) throw new Error(`Unknown CLI terminal profile "${id}"`)
  return profile
}

/**
 * Build the shell argv that runs a profile command, then keeps the shell open.
 * @param shellPath - resolved executable of the user's default shell.
 * @param profile - profile whose command runs at startup.
 * @returns argv beginning with the shell path.
 */
export function cliStartupArgv(shellPath: string, profile: CliTerminalProfile): string[] {
  const name = shellPath.slice(Math.max(shellPath.lastIndexOf('/'), shellPath.lastIndexOf('\\')) + 1).toLowerCase().replace(/\.exe$/u, '')
  if (name === 'pwsh' || name === 'powershell') return [shellPath, '-NoLogo', '-NoExit', '-Command', profile.command]
  if (name === 'cmd') return [shellPath, '/k', profile.command]
  if (POSIX_SHELLS.has(name)) return [shellPath, '-i', '-c', `${profile.command}; exec "$0" -i`, shellPath]
  return [shellPath, '-i', '-c', profile.command]
}
