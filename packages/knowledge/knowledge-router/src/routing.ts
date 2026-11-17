/** @module @deepseek-ai/dsh-knowledge-router/routing */

import type { KnowledgeProviderName } from './types.ts'

/** Cues for a structural question about code relationships or change impact. */
const STRUCTURAL_CUES: readonly string[] = [
  'call chain',
  'call graph',
  'call flow',
  'caller',
  'callers',
  'callee',
  'callees',
  'calls this',
  'who calls',
  'what calls',
  'depends on',
  'dependents',
  'dependency graph',
  'blast radius',
  'what breaks',
  'breaks if',
  'impact of',
  'impact analysis',
  'affected',
  'affects',
  'execution flow',
  'process flow',
  'data flow',
  'control flow',
  'taint',
  'pdg',
  'what changed',
  'detect changes',
  'diff impact',
  'uncommitted',
  'api route',
  'route map',
  'endpoint',
  'handler',
  'tests affected',
  'which tests',
  'other repository',
  'other repo',
  'cross-repo',
]

/** Cues for a question about what was previously learned, corrected, or abandoned. */
const LEARNED_CUES: readonly string[] = [
  'before',
  'previously',
  'prior',
  'earlier',
  'last time',
  'in the past',
  'have we',
  'did we',
  'has this',
  'tried',
  'attempt',
  'attempted',
  'attempts',
  'dead end',
  'dead-end',
  'dead ends',
  'lesson',
  'lessons',
  'learned',
  'learning',
  'corrected',
  'correction',
  'corrections',
  'assumption',
  'assumptions',
  'recurring',
  'recurrence',
  'regression',
  'again',
  'history',
  'historical',
  'stale',
  'outdated',
  'superseded',
]

/** Cues that a task changes code; used only to widen a learned task into a dual query. */
const TECHNICAL_CUES: readonly string[] = [
  'fix',
  'bug',
  'race',
  'deadlock',
  'leak',
  'refactor',
  'implement',
  'migrate',
  'investigate',
  'debug',
  'failure',
  'error',
  'function',
  'method',
  'class',
  'module',
  'symbol',
  'test',
  'build',
  'compile',
]

/** Escape one literal phrase for a regular-expression alternation. */
function escapeRegExp(phrase: string): string {
  return phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Compile a word-boundary alternation over literal cue phrases. */
function cuePattern(phrases: readonly string[]): RegExp {
  return new RegExp(`\\b(?:${phrases.map(escapeRegExp).join('|')})\\b`, 'i')
}

const STRUCTURAL_PATTERN = cuePattern(STRUCTURAL_CUES)
const LEARNED_PATTERN = cuePattern(LEARNED_CUES)
const TECHNICAL_PATTERN = cuePattern(TECHNICAL_CUES)
const INTERROGATIVE_PATTERN = /^\s*(?:did|do|does|have|has|had|was|were|is|are|what|which|who|when|where|why|how)\b/i

/** Whether the task asks a question rather than requesting work. */
function isInterrogative(task: string): boolean {
  return INTERROGATIVE_PATTERN.test(task) || task.trimEnd().endsWith('?')
}

/**
 * Decide which providers a task warrants.
 *
 * A structural question selects code intelligence alone; a question about prior
 * learning selects learned knowledge alone; an imperative task that also
 * carries a historical signal selects both, because fixing a recurring defect
 * needs the code structure and the record of earlier attempts.
 *
 * @param task - the task text to classify.
 * @returns Provider identities to query, in query order; empty when no cue matches.
 */
export function routeTask(task: string): readonly KnowledgeProviderName[] {
  const structural = STRUCTURAL_PATTERN.test(task)
  const learned = LEARNED_PATTERN.test(task)
  if (structural) return learned ? ['gitnexus', 'graphify'] : ['gitnexus']
  if (!learned) return []
  if (isInterrogative(task) || !TECHNICAL_PATTERN.test(task)) return ['graphify']
  return ['gitnexus', 'graphify']
}
