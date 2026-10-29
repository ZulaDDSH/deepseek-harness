import { z } from 'zod'
import { SESSION_RUN_OPTION_EFFORTS } from './types.ts'

/** Delegation roles a Session's subagent setup can configure, in display order. */
export const SUBAGENT_SETUP_ROLES = ['orchestrator', 'coder', 'reviewer', 'researcher'] as const

/** One name from {@link SUBAGENT_SETUP_ROLES}. */
export type SubagentSetupRole = (typeof SUBAGENT_SETUP_ROLES)[number]

/** Upper bound on the review rounds a subagent setup may request. */
export const SUBAGENT_REVIEW_ROUNDS_MAX = 5

/** When the GSD workflow stops to ask the user. */
export const GSD_GATES = ['every-step', 'plan-and-ship', 'auto'] as const

/** Which role writes PLAN.md in the GSD workflow. */
export const GSD_PLAN_AUTHORS = ['orchestrator', 'researcher'] as const

/** Whether the GSD planning directory is committed or kept out of the repository. */
export const GSD_PLANNING_MODES = ['commit', 'local'] as const

/** Upper bound on the GSD check rounds. */
export const GSD_CHECK_ROUNDS_MAX = 5

/** Settings of the GSD workflow, adapted from Get Shit Done (MIT); absent means the workflow is off. */
export interface SubagentGsdSetup {
  readonly enabled: boolean
  readonly gates: (typeof GSD_GATES)[number]
  readonly planAuthor: (typeof GSD_PLAN_AUTHORS)[number]
  readonly planning: (typeof GSD_PLANNING_MODES)[number]
  readonly checkRounds: number
  readonly parallelWaves: boolean
}

/** Whether a stopped agent's last message is reviewed and answered automatically. */
export interface SubagentAutoResponderSetup {
  readonly enabled: boolean
}

/** Where one role runs: a Claude Code CLI model, or an LLM provider model. */
export type SubagentRoleRoute =
  | {
    readonly backend: 'claude-cli'
    readonly model: string
    readonly reasoningEffort?: (typeof SESSION_RUN_OPTION_EFFORTS)[number] | undefined
  }
  | {
    readonly backend: 'llm'
    readonly provider: string
    readonly model: string
    readonly reasoningEffort?: string | undefined
  }

/** A role either defers each run to Jev or is fixed to one route. */
export type SubagentRoleSetting =
  | { readonly mode: 'jev' }
  | { readonly mode: 'fixed'; readonly route: SubagentRoleRoute }

/** Per-Session subagent setup: whether subagent mode is on, its review rounds, and each role's routing. */
export interface SubagentSetup {
  readonly enabled: boolean
  readonly reviewRounds: number
  readonly roles: Readonly<Partial<Record<SubagentSetupRole, SubagentRoleSetting>>>
  readonly gsd?: SubagentGsdSetup | undefined
  readonly autoResponder?: SubagentAutoResponderSetup | undefined
}

const effortSchema = z.enum(SESSION_RUN_OPTION_EFFORTS)
const routeSchema = z.discriminatedUnion('backend', [
  z.object({
    backend: z.literal('claude-cli'),
    model: z.string().regex(/\S/),
    reasoningEffort: effortSchema.optional(),
  }).strict(),
  z.object({
    backend: z.literal('llm'),
    provider: z.string().min(1),
    model: z.string().min(1),
    reasoningEffort: z.string().min(1).optional(),
  }).strict(),
])
const settingSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('jev') }).strict(),
  z.object({ mode: z.literal('fixed'), route: routeSchema }).strict(),
])

const gsdSchema = z.object({
  enabled: z.boolean(),
  gates: z.enum(GSD_GATES).default('every-step'),
  planAuthor: z.enum(GSD_PLAN_AUTHORS).default('orchestrator'),
  planning: z.enum(GSD_PLANNING_MODES).default('commit'),
  checkRounds: z.number().int().min(0).max(GSD_CHECK_ROUNDS_MAX).default(2),
  parallelWaves: z.boolean().default(true),
}).strict()

/** Strict runtime schema of {@link SubagentSetup}, applied to every stored and requested value. */
export const subagentSetupSchema: z.ZodType<SubagentSetup> = z.object({
  enabled: z.boolean(),
  reviewRounds: z.number().int().min(0).max(SUBAGENT_REVIEW_ROUNDS_MAX),
  roles: z.partialRecord(z.enum(SUBAGENT_SETUP_ROLES), settingSchema),
  gsd: gsdSchema.optional(),
  autoResponder: z.object({ enabled: z.boolean() }).strict().optional(),
}).strict()

const DELEGATION_ROLE_PURPOSES = [
  ['coder', 'implementation'],
  ['reviewer', 'independent review'],
  ['researcher', 'research'],
] as const

/**
 * Build the policy text the enabled setup adds to the subagent prompt.
 * @param setup - the setup to describe.
 * @returns the policy text, or an empty string when subagent mode is off.
 */
export function subagentPolicyText(setup: SubagentSetup): string {
  if (!setup.enabled) return ''
  const configured = DELEGATION_ROLE_PURPOSES.filter(([role]) => setup.roles[role] !== undefined)
  if (configured.length === 0) {
    return 'Subagent mode is on for this session. No delegation role is configured, so the subagent tool cannot run a role.'
  }
  const has = (role: string): boolean => configured.some(([candidate]) => candidate === role)
  const parts = ['Subagent mode is on for this session. You are the orchestrator: plan the work, brief each subagent completely, and verify what comes back.']
  if (has('coder')) parts.push('Delegate implementation to a coder and do not make code changes yourself; writing brief and handoff files is fine.')
  if (has('researcher')) parts.push('Delegate research and log reading to a researcher.')
  parts.push('Run independent work in parallel.')
  parts.push(`Every subagent call must pass role as one of: ${configured.map(([role, purpose]) => `${role} (${purpose})`).join(', ')}. A call without one is rejected, and other delegation tools run on your own model, so do not use them for this work.`)
  parts.push('Subagents cannot start subagents, so you start every subagent yourself.')
  if (setup.reviewRounds === 0) parts.push('Do not run review rounds unless the user asks.')
  else if (has('reviewer')) {
    parts.push(`After a coder returns a code change, start a reviewer (role reviewer) on it, send its findings to the coder with send_message (or to a new coder run once the coder has finished), and repeat for at most ${setup.reviewRounds} review round${setup.reviewRounds === 1 ? '' : 's'} before you report.`)
  }
  return parts.join(' ')
}

const GSD_GATE_TEXT: Record<SubagentGsdSetup['gates'], string> = {
  'every-step': 'Gates: every-step. Before each step, ask the user with ask_user_question and offer "continue", "revise" and "run the rest automatically (auto mode)".',
  'plan-and-ship': 'Gates: plan-and-ship. Ask with ask_user_question before executing the plan and before shipping, offering "continue", "revise" and "run the rest automatically (auto mode)". Other steps run without asking.',
  auto: 'Gates: auto. Run each step without asking.',
}

/**
 * Build the GSD workflow policy the enabled setup adds for the top-level orchestrator, stating each chosen setting.
 * @param setup - the setup whose GSD settings name the gates, plan author, planning mode, loop cap and wave mode.
 * @returns the workflow policy, or an empty string when subagent mode or the GSD workflow is off.
 */
export function subagentWorkflowText(setup: SubagentSetup): string {
  const gsd = setup.gsd
  if (!setup.enabled || gsd === undefined || !gsd.enabled) return ''
  const researcherPlans = gsd.planAuthor === 'researcher'
  return [
    'GSD workflow is on for this session, adapted from Get Shit Done (MIT). You are the orchestrator. Run each phase through the loop discuss, plan, execute, verify, ship. Keep project state in .planning/: PROJECT.md (what is built and why), ROADMAP.md (phases and goals), STATE.md (current position, decisions, blockers), and per phase in .planning/phases/<NN>-<slug>/ the files CONTEXT.md, RESEARCH.md, one <NN>-<PP>-PLAN.md per plan (with its <NN>-<PP>-SUMMARY.md), and VERIFICATION.md. Read STATE.md first; if the user is unsure what comes next, suggest /gsd-next. Before each step, load the matching /gsd-* skill for its detailed instructions and mirror that step\'s checklist with todo_write.',
    GSD_GATE_TEXT[gsd.gates],
    'Auto mode, however it starts, still stops to ask on a failure, a blocked verification, and any push, PR or merge.',
    researcherPlans ? 'Plan author: researcher. The researcher writes the plan files, and you check them before execution.' : 'Plan author: orchestrator. You write the plan files yourself.',
    `Roles: the researcher researches${researcherPlans ? ' and writes the plan files' : ''}. A reviewer checks the plan and verifies the result. Coders execute one plan each, with one commit per task.`,
    gsd.parallelWaves
      ? 'Execution: run the plans of one wave in parallel only where they touch disjoint files, and run overlapping plans one after another.'
      : 'Execution: run the plans one at a time, in order.',
    gsd.checkRounds === 0
      ? 'Check rounds: 0. Run each plan check and verification once with no fix rounds; report findings and ask the user.'
      : `Check rounds: ${String(gsd.checkRounds)}. Run each plan check and verification once, then fix and re-check for at most ${String(gsd.checkRounds)} round${gsd.checkRounds === 1 ? '' : 's'}; at the cap, report what remains and ask the user.`,
    gsd.planning === 'commit'
      ? 'Planning files: commit .planning/ to the repo with the work.'
      : 'Planning files: keep .planning/ local. Add it to .git/info/exclude and never commit it.',
    'Ship creates the PR and never merges. Every push, PR creation and merge needs an explicit answer from the user, in every gate mode.',
    'If the setup has no coder or no reviewer, ask the user before doing that work yourself.',
  ].join(' ')
}
