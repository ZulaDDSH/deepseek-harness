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

const REFERENCE_COMMAND = /\bgh\s+pr\s+(?:view|edit|checkout)\b/
const OWN_URL_LINE = /^(?:url:\s+)?(https?:\/\/[^\s"'<>]+?\/pull\/\d+)\/?$/
const LINE_URL = /^(https?:\/\/[^\s"'<>]+?\/pull\/\d+)\/?$/
const ASSIGNMENT = /^[A-Za-z_][A-Za-z\d_]*=/
const PUSH_COMMAND = /\bgit(?:\s+(?:-[Cc]\s+\S+|--[\w-]+(?:=\S+)?))*\s+push\b/
const CHANGE_REQUEST_URL = /\bhttps?:\/\/[^\s"'<>]+?\/pull\/\d+(?![\w-])/g
const HEREDOC_OPERATOR = /(?<!<)<<-?[ \t]*(['"]?)([A-Za-z_]\w*)\1/g
const EXECUTING_CONSUMER = /(?:^|[\s`(])(?:\S*\/)?(?:bash|sh|zsh|dash|ksh|ssh|pwsh|powershell|python[\d.]*|node|perl|ruby|php|deno|bun|eval|source|xargs|\.)(?=[\s;&|)`]|$)/
const SHELL_KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{', 'time', 'command', 'exec', 'nohup'])
const SHELL_INTERPRETERS = new Set(['bash', 'sh', 'zsh', 'dash'])
const SCRIPT_FLAG = /^-[a-z]*c[a-z]*$/
const PUSH_TARGET_LINE = /^To (\S+)$/
const PUSH_REF_LINE = /^ [ +*=] (\[[^\]]+\]|\S+) +\S+ -> (\S+)(?: \(.*\))?$/

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
  const create = createsChangeRequest(command)
  const references = ghReferences(command)
  const reference = REFERENCE_COMMAND.test(command) || references.length > 0
  const pushes = PUSH_COMMAND.test(command)
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

function createsChangeRequest(command: string): boolean {
  let tokens: parse.ParseEntry[]
  try {
    tokens = parse(command.replace(/\r?\n/g, ';'), () => '')
  } catch {
    return false
  }
  const segments: string[][] = [[]]
  for (const token of tokens) {
    if (typeof token === 'string') segments.at(-1)?.push(token)
    else segments.push([])
  }
  return segments.some((words) => {
    let start = skipAssignments(words, 0)
    while (SHELL_KEYWORDS.has(words[start] ?? '')) start = skipAssignments(words, start + 1)
    if (words[start] === 'env') start = skipAssignments(words, start + 1)
    const [resource, operation, verb] = words.slice(start, start + 3)
    if (resource === 'gh') return operation === 'pr' && (verb === 'create' || verb === 'new')
    if (!SHELL_INTERPRETERS.has(resource ?? '')) return false
    const script = interpreterScript(words, start + 1)
    return script !== undefined && createsChangeRequest(script)
  })
}

function interpreterScript(words: readonly string[], start: number): string | undefined {
  for (let index = start; index < words.length; index++) {
    const word = words[index] ?? ''
    if (SCRIPT_FLAG.test(word)) return words[index + 1]
    if (word === '-o' || word === '+o') index++
    else if (!/^[-+]/.test(word)) return undefined
  }
  return undefined
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
    const ref = PUSH_REF_LINE.exec(line)
    if (remote === undefined || ref === null) continue
    const [, summary = '', destination = ''] = ref
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
