import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

const SHIM_VARIABLE = 'DSH_FREEBUFF_EXE'
const SHIM_PATTERN = /\.(?:cmd|bat)$/i
const SHELL_METACHARACTERS = /[&|<>^%"]/

export interface FreebuffLaunch {
  readonly argv: string[]
  readonly env: Record<string, string>
}

export function freebuffLaunch(
  executable: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  comSpec: string | undefined = process.env.ComSpec,
): FreebuffLaunch {
  if (platform !== 'win32' || !SHIM_PATTERN.test(executable)) return { argv: [executable, ...args], env: {} }
  const unsafe = args.find(arg => SHELL_METACHARACTERS.test(arg))
  if (unsafe !== undefined) throw new Error('llm-freebuff: the Freebuff launcher cannot pass an argument that contains & | < > ^ % or a double quote')
  return {
    argv: [comSpec ?? 'cmd.exe', '/d', '/c', `%${SHIM_VARIABLE}%`, ...args],
    env: { [SHIM_VARIABLE]: `"${executable}"` },
  }
}

export function freebuffConfigDir(env: Readonly<Record<string, string | undefined>>, home: string = homedir()): string {
  const configured = env.FREEBUFF_CONFIG_DIR
  return configured !== undefined && isAbsolute(configured) ? configured : join(home, '.config', 'manicode')
}

const ANSI = /\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|[@-Z\-_])/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '')
}
