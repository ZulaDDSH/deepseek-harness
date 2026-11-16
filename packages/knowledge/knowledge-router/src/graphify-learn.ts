/** @module @deepseek-ai/dsh-knowledge-router/graphify-learn */

import { runNativeCommand, type NativeCommandRunner } from '@deepseek-ai/dsh-native-command'

/** The outcome a validated finding carries into Graphify's work memory. */
export type LearningOutcome = 'useful' | 'dead_end' | 'corrected'

/** One validated finding offered to Graphify. */
export interface LearningWrite {
  /** The question the finding answers. */
  readonly question: string
  /** The validated answer text. */
  readonly answer: string
  /** How the answer was classified. */
  readonly outcome: LearningOutcome
  /** What superseded the earlier answer; required for a `corrected` outcome. */
  readonly correction?: string
  /**
   * Node labels this finding is about, cited so Graphify can attach the outcome
   * to them. A finding with no cited node is recorded but never becomes a
   * lesson, because Graphify has nothing to attach it to.
   */
  readonly nodes?: readonly string[]
  /** Validator identity appended to the saved answer. */
  readonly validatedBy: string
}

/** Where the Graphify executable lives and which commands to run. */
export interface LearningConfig {
  /** Executable name or path; never a shell string. */
  readonly command: string
  /** Graphify work-memory directory; omitted uses Graphify's own default. */
  readonly memoryDir?: string
  /** Whether to run `reflect` after a successful `save-result`. */
  readonly reflect: boolean
}

/** What one learning write did. */
export interface LearningResult {
  /** The outcome that was written. */
  readonly outcome: LearningOutcome
  /** Whether `reflect` ran and succeeded after the write. */
  readonly reflected: boolean
  /** Captured standard output of the last command that ran. */
  readonly stdout: string
  /** Reflection failure after the finding was saved. */
  readonly reflectionError?: string
}

/** Build the `save-result` argv for one write. */
function saveResultArgs(write: LearningWrite, config: LearningConfig): string[] {
  return [
    'save-result',
    '--question', write.question,
    '--answer', write.answer + '\n\nValidated by: ' + write.validatedBy,
    '--outcome', write.outcome,
    ...write.correction !== undefined ? ['--correction', write.correction] : [],
    ...write.nodes !== undefined && write.nodes.length > 0 ? ['--nodes', ...write.nodes] : [],
    ...config.memoryDir !== undefined ? ['--memory-dir', config.memoryDir] : [],
  ]
}

/** Build the `reflect` argv. */
function reflectArgs(config: LearningConfig): string[] {
  return ['reflect', ...config.memoryDir !== undefined ? ['--memory-dir', config.memoryDir] : []]
}

/**
 * Reject a write Graphify would refuse before spending a process on it.
 * @param write - the finding to check.
 * @throws when a `corrected` outcome carries no correction text.
 */
export function assertWritable(write: LearningWrite): void {
  if (write.outcome === 'corrected' && (write.correction === undefined || write.correction.trim() === '')) {
    throw new Error('a corrected learning outcome requires the correction text that superseded the earlier answer')
  }
}

/**
 * Write one validated finding to Graphify and optionally reflect on it.
 *
 * Save failure rejects; reflection failure returns the completed write with reflectionError.
 *
 * @param write - the validated finding, already checked by {@link assertWritable}.
 * @param config - executable, memory directory, and whether to reflect.
 * @param signal - caller cancellation for both commands.
 * @param runner - the host command boundary; defaults to the real runner.
 * @returns The written outcome, whether reflection ran, and captured stdout.
 */
export async function recordLearning(
  write: LearningWrite,
  config: LearningConfig,
  signal: AbortSignal,
  runner: NativeCommandRunner = runNativeCommand,
): Promise<LearningResult> {
  assertWritable(write)
  const saved = await runner(config.command, saveResultArgs(write, config), signal, 'hidden')
  if (!config.reflect) return { outcome: write.outcome, reflected: false, stdout: saved.stdout }
  try {
    const reflected = await runner(config.command, reflectArgs(config), signal, 'hidden')
    return { outcome: write.outcome, reflected: true, stdout: reflected.stdout }
  } catch (error: unknown) {
    return { outcome: write.outcome, reflected: false, stdout: saved.stdout, reflectionError: String(error) }
  }
}

/** One node's learning state, as Graphify's own `explain` reports it. */
export interface LessonState {
  /** The node label that was explained. */
  readonly node: string
  /** Graphify's lesson status word, when it reported one. */
  readonly status?: string
  /** Whether Graphify marked the lesson as needing reverification. */
  readonly stale: boolean
}

/** The line Graphify prints when a node carries a lesson. */
const LESSON_PREFIX = 'Lesson:'

/** The marker Graphify appends when the underlying source changed since the lesson. */
const STALE_MARKER = 're-verify'

/**
 * Read one node's learning state out of Graphify's `explain` output.
 * @param node - the node label that was explained.
 * @param text - the command's captured standard output.
 * @returns The lesson state, or undefined when Graphify reported no lesson for this node.
 */
export function parseLessonState(node: string, text: string): LessonState | undefined {
  const line = text.split('\n').map(candidate => candidate.trim()).find(candidate => candidate.startsWith(LESSON_PREFIX))
  if (line === undefined) return undefined
  const body = line.slice(LESSON_PREFIX.length).trim()
  const status = body.split(/[\s(]/)[0] as string
  return {
    node,
    ...status === '' ? {} : { status },
    stale: body.includes(STALE_MARKER),
  }
}

/**
 * Read the first node label out of a rendered knowledge-graph result.
 *
 * A rendered result lists nodes as `NODE <label> [src=… …]`; the first one is
 * the seed the query resolved, which is the node worth spending a probe on.
 *
 * @param text - the provider's rendered graph output.
 * @returns The first node label, or undefined when the text lists no node.
 */
export function firstNodeLabel(text: string): string | undefined {
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line.startsWith('NODE ')) continue
    const label = line.slice('NODE '.length).split(' [')[0]?.trim()
    if (label !== undefined && label !== '') return label
  }
  return undefined
}

/**
 * Ask Graphify's own `explain` command for one node's learning state.
 *
 * The MCP query surface does not carry this state: the released server renders
 * queries through a context-filtered copy of the graph that drops the loaded
 * learning overlay, so no lesson annotation reaches a caller. `explain` reads
 * the overlay itself, which is why freshness is probed here instead.
 *
 * @param node - the node label to explain.
 * @param config - the Graphify executable and work-memory settings.
 * @param signal - caller cancellation.
 * @param runner - the host command boundary; defaults to the real runner.
 * @returns The lesson state, or undefined when the node carries no lesson.
 */
export async function explainLesson(
  node: string,
  config: LearningConfig,
  signal: AbortSignal,
  runner: NativeCommandRunner = runNativeCommand,
): Promise<LessonState | undefined> {
  if (config.memoryDir !== undefined) return undefined
  const explained = await runner(config.command, ['explain', node], signal, 'hidden')
  return parseLessonState(node, explained.stdout)
}
