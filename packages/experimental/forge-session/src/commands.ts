/** Recognition of shell commands and output that bind change requests to a Session. */

import parse from 'shell-quote/parse.js'
import type { CommandEvidence } from './types.ts'
import { ghReferences } from './references.ts'

/** One branch a `git push` output reported as updated. */
export interface PushedRef {
  /** Remote as `git push` printed it after `To`. */
  readonly remote: string
  /** Branch name on the remote. */
  readonly branch: string
}

const OWN_URL_LINE = /^(?:url:\s+)?(https?:\/\/[^\s"'<>]+?\/pull\/\d+)\/?$/
const LINE_URL = /^(https?:\/\/[^\s"'<>]+?\/pull\/\d+)\/?$/
const ASSIGNMENT = /^[A-Za-z_][A-Za-z\d_]*=/
const CHANGE_REQUEST_URL = /\bhttps?:\/\/[^\s"'<>]+?\/pull\/\d+(?![\w-])/g
const HEREDOC_OPERATOR = /(?<!<)<<-?[ \t]*(['"]?)([A-Za-z_]\w*)\1/g
const EXECUTING_PROGRAMS = 'bash|sh|zsh|dash|ksh|ssh|pwsh|powershell|python[\\d.]*|node|perl|ruby|php|deno|bun|eval|source|xargs|\\.'
const EXECUTING_CONSUMER = new RegExp(`(?:^|[\\s\`(])(?:\\S*/)?(?:${EXECUTING_PROGRAMS})(?=[\\s;&|)\`]|$)`)
const SHELL_KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{', 'time', 'command', 'exec', 'nohup'])
const SHELL_INTERPRETERS = new Set(['bash', 'sh', 'zsh', 'dash'])
const SHELL_LETTERS = new Set('ilrscDOoabefhkmnptuvxBCEHPT')
const SHELL_ARGUMENT_LETTERS = new Set('oO')
const SHELL_LONG_OPTIONS = new Set(['--debug', '--debugger', '--login', '--noediting', '--noprofile', '--norc', '--posix', '--protected', '--restricted', '--verbose'])
const SHELL_LONG_ARGUMENT_OPTIONS = new Set(['--rcfile', '--init-file'])
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--super-prefix', '--attr-source'])
const GIT_INFO_OPTIONS = new Set(['-h', '--help', '-v', '--version', '--html-path', '--man-path', '--info-path'])
const GH_VALUE_LONG_OPTIONS = new Set([
  '--assignee', '--base', '--body', '--body-file', '--head', '--label', '--milestone', '--project', '--recover', '--reviewer', '--template',
  '--title', '--repo',
])
const GH_VALUE_SHORT_OPTIONS = new Set('aBbFHlmprTtR')
const MAX_NESTING = 32
const PUSH_TARGET_LINE = /^To (\S+)$/
const PUSH_REF_LINE = /^ [ +*=] (?<summary>\[[^\]]+\]|\S+) +\S+ -> (?<destination>\S+)(?: \(.*\))?$/
const PORCELAIN_REF_LINE = /^[ +*=]\t[^:\t]*:(?<destination>\S+)\t(?<summary>.*)$/

/**
 * Read the command string of a `bash` or `pwsh` tool call.
 * @param argumentsJson - raw tool-call arguments as the model produced them.
 * @returns the command, or undefined when the arguments are not JSON or carry no string `command`.
 */
export function commandOf(argumentsJson: string): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(argumentsJson)
  } catch (error) {
    void error // Malformed arguments never ran a command.
    return undefined
  }
  return commandIn(parsed)
}

/**
 * Read the command string of parsed `bash` or `pwsh` arguments, such as the
 * arguments a program dispatch logs.
 * @param args - parsed tool arguments.
 * @returns the command, or undefined when the arguments carry no string `command`.
 */
export function commandIn(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null || !('command' in args)) return undefined
  return typeof args.command === 'string' ? args.command : undefined
}

/**
 * Classify the binding evidence a command and its output can carry.
 * `gh pr create` (or its alias `gh pr new`) as a simple command prints the
 * change request URL; `gh pr view`, `gh pr edit`, and `gh pr checkout` act on
 * one change request, which a URL or a number with an explicit repository and
 * host can name; their output can also print its URL. `git push`,
 * with or without leading `-C`, `-c`, and long options, prints the updated
 * refs. When a command does both, the URLs a result prints bind as created.
 * Create detection reads shell words, so quoted or echoed mentions do not
 * classify; the other forms still match text.
 * @param source - shell command text.
 * @returns the evidence, or undefined when the command has none of these forms.
 */
export function commandEvidence(source: string): CommandEvidence | undefined {
  const command = stripHeredocBodies(source)
  const forms = commandForms(command)
  const create = forms.create
  const references = ghReferences(command)
  const reference = forms.reference || references.length > 0
  const pushes = forms.push
  if (!create && !reference && !pushes) return undefined
  const named = [...new Set(references.flatMap(reference => reference.url === null ? [] : [reference.url]))]
  return { urls: create ? 'created' : reference ? 'referenced' : null, pushes, named }
}

/**
 * Find GitHub pull request URLs in command output.
 * @param text - rendered shell result.
 * @returns distinct URLs in order of first appearance.
 */
export function changeRequestUrls(text: string): string[] {
  return [...new Set(text.match(CHANGE_REQUEST_URL))]
}

/**
 * Find the URLs that `gh pr view`, `gh pr edit`, or `gh pr checkout` output
 * prints for the change request it acts on: gh's `url:` field or a URL alone
 * on a line before the `--` line that starts a description. Links in a
 * description or in other fields name other pages.
 * @param text - rendered shell result.
 * @returns distinct URLs in order of first appearance.
 */
export function ownChangeRequestUrls(text: string): string[] {
  const json = topLevelUrl(text)
  if (json !== undefined) return json
  const urls: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (line === '--') break
    const [, own] = OWN_URL_LINE.exec(line.trim()) ?? []
    if (own !== undefined) urls.push(own)
  }
  return [...new Set(urls)]
}

export function createdChangeRequestUrls(text: string): string[] {
  const urls: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const [, url] = LINE_URL.exec(line.trim()) ?? []
    if (url !== undefined) urls.push(url)
  }
  return [...new Set(urls)]
}

function topLevelUrl(text: string): string[] | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null || !('url' in value) || typeof value.url !== 'string') return []
  const [, url] = OWN_URL_LINE.exec(value.url) ?? []
  return url === undefined ? [] : [url]
}

function stripHeredocBodies(source: string): string {
  const lines = source.split('\n')
  const kept: string[] = []
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? ''
    const operators = [...line.matchAll(HEREDOC_OPERATOR)]
    const first = operators[0]
    const last = operators.at(-1)
    let next = index + 1
    const terminated = first !== undefined && operators.every((operator) => {
      const terminator = new RegExp(`^[ \\t]*${operator[2]}[ \\t]*\\r?$`)
      const found = lines.findIndex((candidate, at) => at >= next && terminator.test(candidate))
      if (found < 0) return false
      next = found + 1
      return true
    })
    if (!terminated || first === undefined || last === undefined) {
      kept.push(line)
      continue
    }
    const before = line.slice(0, first.index).split(/[;&|(]/).at(-1) ?? ''
    const after = line.slice(last.index + last[0].length).split(/;|&&|\|\|/)[0] ?? ''
    if (EXECUTING_CONSUMER.test(`${before} ${after}`)) {
      kept.push(line)
    } else {
      kept.push(line.replace(HEREDOC_OPERATOR, '<<$2'))
      index = next - 1
    }
  }
  return kept.join('\n')
}

interface CommandForms {
  create: boolean
  reference: boolean
  push: boolean
}

function commandForms(command: string): CommandForms {
  const forms: CommandForms = { create: false, reference: false, push: false }
  const visit = (text: string, depth: number): void => {
    if (depth > MAX_NESTING) return
    const bodies = substitutionBodies(text)
    if (bodies === undefined) return
    for (const body of bodies) visit(body, depth + 1)
    for (const [program = '', ...args] of simpleCommands(text)) {
      if (SHELL_INTERPRETERS.has(program)) {
        const script = shellScript(args)
        if (script !== undefined) visit(script, depth + 1)
      } else if (program === 'gh') {
        const [resource, operation, ...flags] = args
        if (resource !== 'pr') continue
        if (operation === 'view' || operation === 'edit' || operation === 'checkout') forms.reference = true
        else if ((operation === 'create' || operation === 'new') && !printsNoPullRequest(flags)) forms.create = true
      } else if (program === 'git' && gitSubcommand(args) === 'push') {
        forms.push = true
      }
    }
  }
  visit(command, 0)
  return forms
}

function simpleCommands(source: string): string[][] {
  let tokens: parse.ParseEntry[]
  try {
    tokens = parse(source.replace(/\r?\n/g, ';'), () => '')
  } catch {
    return []
  }
  const segments: string[][] = [[]]
  for (const token of tokens) {
    if (typeof token === 'string') segments.at(-1)?.push(token)
    else if ('pattern' in token) segments.at(-1)?.push(token.pattern)
    else segments.push([])
  }
  return segments.flatMap((words) => {
    let start = skipAssignments(words, 0)
    while (SHELL_KEYWORDS.has(words[start] ?? '')) start = skipAssignments(words, start + 1)
    if (executableName(words[start] ?? '') === 'env') start = skipAssignments(words, start + 1)
    const program = words[start]
    return program === undefined ? [] : [[executableName(program), ...words.slice(start + 1)]]
  })
}

function executableName(word: string): string {
  return word.slice(Math.max(word.lastIndexOf('/'), word.lastIndexOf('\\')) + 1).replace(/\.exe$/i, '')
}

function shellScript(words: readonly string[]): string | undefined {
  let command = false
  let index = 0
  for (; index < words.length; index++) {
    const word = words[index] ?? ''
    if (word === '--' || word === '-') {
      index++
      break
    }
    if (word.startsWith('--')) {
      if (SHELL_LONG_ARGUMENT_OPTIONS.has(word)) index++
      else if (!SHELL_LONG_OPTIONS.has(word)) return undefined
      continue
    }
    if (word.length < 2 || (word[0] !== '-' && word[0] !== '+')) break
    for (const letter of word.slice(1)) {
      if (!SHELL_LETTERS.has(letter)) return undefined
      if (letter === 'c' && word[0] === '-') command = true
      if (SHELL_ARGUMENT_LETTERS.has(letter)) index++
    }
  }
  return command ? words[index] : undefined
}

function gitSubcommand(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index++) {
    const word = args[index] ?? ''
    if (GIT_INFO_OPTIONS.has(word)) return undefined
    if (!word.startsWith('-')) return word
    if (GIT_VALUE_OPTIONS.has(word)) index++
  }
  return undefined
}

function printsNoPullRequest(flags: readonly string[]): boolean {
  for (let index = 0; index < flags.length; index++) {
    const word = flags[index] ?? ''
    if (word === '--') return false
    if (word.startsWith('--')) {
      if (word === '--help' || word === '--dry-run') return true
      if (GH_VALUE_LONG_OPTIONS.has(word)) index++
      continue
    }
    if (word.length < 2 || word[0] !== '-') continue
    for (let at = 1; at < word.length; at++) {
      const letter = word[at] ?? ''
      if (GH_VALUE_SHORT_OPTIONS.has(letter)) {
        if (at === word.length - 1) index++
        break
      }
      if (letter === 'h') return true
    }
  }
  return false
}

interface SubstitutionFrame {
  start: number
  tick: boolean
  depth: number
  quote: string | undefined
}

function substitutionBodies(source: string): string[] | undefined {
  const bodies: string[] = []
  const root: SubstitutionFrame = { start: 0, tick: false, depth: 0, quote: undefined }
  const frames: SubstitutionFrame[] = [root]
  for (let index = 0; index < source.length; index++) {
    const frame = frames.at(-1) ?? root
    const char = source[index]
    if (frame.quote === "'") {
      if (char === "'") frame.quote = undefined
    } else if (char === '\\') {
      index++
    } else if (char === "'" && frame.quote === undefined) {
      frame.quote = "'"
    } else if (char === '"') {
      frame.quote = frame.quote === '"' ? undefined : '"'
    } else if (char === '`') {
      if (frame.tick) {
        bodies.push(source.slice(frame.start, index))
        frames.pop()
      } else if (frames.length <= MAX_NESTING) {
        frames.push({ start: index + 1, tick: true, depth: 0, quote: undefined })
      }
    } else if (char === '$' && source[index + 1] === '(' && source[index + 2] !== '(' && frames.length <= MAX_NESTING) {
      frames.push({ start: index + 2, tick: false, depth: 0, quote: undefined })
      index++
    } else if (frame !== root && !frame.tick && frame.quote === undefined && char === '(') {
      frame.depth++
    } else if (frame !== root && !frame.tick && frame.quote === undefined && char === ')') {
      if (frame.depth > 0) {
        frame.depth--
      } else {
        bodies.push(source.slice(frame.start, index))
        frames.pop()
      }
    }
  }
  return frames.length === 1 ? bodies : undefined
}

function skipAssignments(words: readonly string[], start: number): number {
  let index = start
  while (index < words.length && ASSIGNMENT.test(words[index] ?? '')) index++
  return index
}

/**
 * Find branches that `git push` output reports as created, updated, forced,
 * or already up to date. Each ref line belongs to the nearest preceding
 * `To <remote>` line. Rejected and deleted refs, new tags, and explicit refs
 * outside `refs/heads/` are excluded. Unqualified tag updates cannot be
 * distinguished from branch updates and are included.
 * @param text - rendered shell result, stdout and stderr.
 * @returns distinct pushed branches in order of first appearance.
 */
export function pushedBranches(text: string): PushedRef[] {
  const pushed: PushedRef[] = []
  let remote: string | undefined
  for (const line of text.split(/\r?\n/)) {
    const target = PUSH_TARGET_LINE.exec(line)
    if (target !== null) {
      [, remote = ''] = target
      continue
    }
    const ref = PUSH_REF_LINE.exec(line) ?? PORCELAIN_REF_LINE.exec(line)
    if (remote === undefined || ref?.groups === undefined) continue
    const { summary = '', destination = '' } = ref.groups
    if (summary === '[new tag]') continue
    const branch = destination.startsWith('refs/heads/') ? destination.slice('refs/heads/'.length) : destination
    if (branch.startsWith('refs/')) continue
    if (!pushed.some(entry => entry.remote === remote && entry.branch === branch)) pushed.push({ remote, branch })
  }
  return pushed
}

/**
 * Compare two change request URLs ignoring scheme, letter case, query,
 * fragment, and trailing slashes.
 * @param left - one URL.
 * @param right - the other URL.
 * @returns whether both name the same web page.
 */
export function sameChangeRequestUrl(left: string, right: string): boolean {
  return urlIdentity(left) === urlIdentity(right)
}

function urlIdentity(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/[?#].*$/s, '').replace(/\/+$/, '').toLowerCase()
}
