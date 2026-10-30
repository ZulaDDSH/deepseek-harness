import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SqliteSessionQueryEngine from '@deepseek-ai/dsh-session-query-sqlite'
import GoalService from '@deepseek-ai/dsh-goal'
import LocalBashExecutor from '@deepseek-ai/dsh-bash-local'
import * as BashEnvPlugin from '@deepseek-ai/dsh-shell-env'
import { PwshLocalExecutor } from '@deepseek-ai/dsh-pwsh-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import LocalSandboxProvider from '@deepseek-ai/dsh-sandbox-local'
import NodePtcRuntime from '@deepseek-ai/dsh-ptc-runtime-node'
import { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentLimits, ImageAttachmentRef, SaveImageAttachment, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import PlanModeController from '@deepseek-ai/dsh-plan-mode'
import ActionCards from '@deepseek-ai/dsh-action-cards'
import RemoteAccess from '@deepseek-ai/dsh-api-remote-access'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as WebSearchExa from '@deepseek-ai/dsh-web-search-exa'
import * as WebFetchLocal from '@deepseek-ai/dsh-web-fetch-http'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentProvider } from '@deepseek-ai/dsh-subagent'
import * as ToolSubagentControl from '@deepseek-ai/dsh-tool-subagent-control'
import * as ToolSubagentOar from '@deepseek-ai/dsh-experimental-tool-subagent-oar'
import * as ToolMasterControl from '@deepseek-ai/dsh-tool-master-control'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import * as ToolAskUser from '@deepseek-ai/dsh-tool-ask-user'
import * as ToolBash from '@deepseek-ai/dsh-tool-bash'
import * as ToolPwsh from '@deepseek-ai/dsh-tool-pwsh'
import * as ToolBashPersistent from '@deepseek-ai/dsh-tool-bash-persistent'
import * as ToolPwshPersistent from '@deepseek-ai/dsh-tool-pwsh-persistent'
import CordisHostRunner from '@deepseek-ai/dsh-cordis-host-runner'
import * as ToolCordis from '@deepseek-ai/dsh-tool-cordis'
import * as ToolPresent from '@deepseek-ai/dsh-tool-present'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import * as ToolFsSearch from '@deepseek-ai/dsh-tool-fs-search'
import * as ToolStrReplaceEditor from '@deepseek-ai/dsh-tool-str-replace-editor'
import TerminalSessionService from '@deepseek-ai/dsh-terminal'
import * as ToolPty from '@deepseek-ai/dsh-tool-terminal'
import * as ToolGoal from '@deepseek-ai/dsh-tool-goal'
import ScheduleService from '@deepseek-ai/dsh-schedule'
import * as ToolSchedule from '@deepseek-ai/dsh-tool-schedule'
import Lsp from '@deepseek-ai/dsh-lsp'
import * as ToolLsp from '@deepseek-ai/dsh-tool-lsp'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import * as ToolSessionQuery from '@deepseek-ai/dsh-tool-session-query'
import * as ToolJobs from '@deepseek-ai/dsh-tool-jobs'
import BrowserUseRegistry from '@deepseek-ai/dsh-browser-use'
import * as StagehandBrowserTools from '@deepseek-ai/dsh-experimental-browser-use-stagehand-native'
import * as ToolTeam from '@deepseek-ai/dsh-experimental-tool-agent-team'
import * as ToolTodo from '@deepseek-ai/dsh-tool-todo'
import type PluginManager from '@deepseek-ai/dsh-plugin-manager'
import * as PluginManagerTools from '@deepseek-ai/dsh-plugin-manager/tools'
import type PluginMarket from '@deepseek-ai/dsh-plugin-market'
import * as PluginMarketTools from '@deepseek-ai/dsh-plugin-market/tools'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import McpResources from '@deepseek-ai/dsh-mcp-resources'
import KnowledgeRouter from '@deepseek-ai/dsh-knowledge-router'
import * as ToolSubagent from '@deepseek-ai/dsh-tool-subagent'
import * as ToolWeb from '@deepseek-ai/dsh-tool-web'
import * as ToolWatch from '@deepseek-ai/dsh-tool-watch'
import WorkflowEngine from '@deepseek-ai/dsh-workflow'
import type { WorkflowRun, WorkflowStartRequest } from '@deepseek-ai/dsh-workflow'
import * as ToolRalph from '@deepseek-ai/dsh-tool-ralph'
import * as ToolWorkflow from '@deepseek-ai/dsh-tool-workflow'
import * as ToolWorkspaceDependencies from '@deepseek-ai/dsh-tool-workspace-dependencies'
import * as ToolWorkingDirectory from '@deepseek-ai/dsh-tool-working-directory'
import * as ToolWorktree from '@deepseek-ai/dsh-experimental-tool-worktree'

const root = resolve(import.meta.dirname, '..')

/** Attachment seam marker that makes the attachments-conditional `read_image` schema harvestable. */
class CatalogAttachmentStore extends AttachmentStore {
  readonly imageLimits: ImageAttachmentLimits = Object.freeze({
    maxImageBytes: 1,
    maxImagesPerMessage: 1,
    maxMessageImageBytes: 1,
    maxImagePixels: 1,
    maxImageDimension: 1,
    mediaTypes: Object.freeze(['image/png'] as const),
  })

  override validateImage(_input: SaveImageAttachment): Promise<void> {
    return Promise.reject(new Error('gen-tool-catalog: attachment validation is unreachable during schema harvest'))
  }

  override saveImage(_input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    return Promise.reject(new Error('gen-tool-catalog: attachment writes are unreachable during schema harvest'))
  }

  override readImage(_ref: ImageAttachmentRef): Promise<StoredImageAttachment> {
    return Promise.reject(new Error('gen-tool-catalog: attachment reads are unreachable during schema harvest'))
  }
}

/** Workflow tools expose their schemas without executing a program. */
class CatalogWorkflowEngine extends WorkflowEngine {
  start(_request: WorkflowStartRequest): WorkflowRun {
    throw new Error('gen-tool-catalog: workflow execution is unavailable during schema harvest')
  }
}

/**
 * Register the descriptor needed to mount schema-producing consumers. Declares
 * the full capability set of the shipped in-process providers so consumers
 * mount under their shipped defaults (tool-subagent's default numeric maxDepth
 * requires `depthLimit`).
 */
function registerCatalogSubagentProvider(ctx: Context, name: string): void {
  const provider: SubagentProvider = {
    name,
    capabilities: { agentOptions: true, agentPreset: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    inheritsParentContext: false,
    start: () => Promise.reject(new Error('tool-catalog provider cannot start a child')),
    prepareContinuable: () => Promise.reject(new Error('tool-catalog provider cannot prepare a child')),
  }
  ctx.subagents.registerProvider(provider)
}

/** Minted child-scope keys for packages whose tools are never global. */
const catalogChildScopes = new WeakMap<Context, Agent>()

/**
 * Tool package plus its hand-maintained boot recipe. The caller mounts the
 * prompt and registry; each recipe supplies only package-specific seams and
 * config, while `dir` participates in the completeness check.
 */
export interface ToolPackage {
  /** The npm package name, used as the catalog section heading. */
  pkg: string
  /** The `packages/<group>/<dir>` leaf name — matched by the completeness guard. */
  dir: string
  /**
   * Repo-relative implementation source linked per harvested tool. Packages
   * whose tools share one plugin may use a string; split plugins map each tool
   * name to its own source.
   */
  source: string | Readonly<Record<string, string>>
  /** Services or owning runtimes the package requires at execution time. */
  requires: string[]
  /** Session events or other visible state the tools write or affect. */
  writes: string[]
  /** Additional model-visible names shipped by example/app config. */
  shippedNames?: string[]
  /** Plug the injected seams + the tool plugin onto a context that already
   * carries `systemPrompt` + `tools`. */
  mount: (ctx: Context) => Promise<void>
  /** Agent-like scope key whose tool view is catalogued instead of the global view. */
  scope?: (ctx: Context) => Agent
  /** Select the program transport when harvesting the PTC package. */
  executor?: 'ptc'
  /**
   * A deployment note rendered after the package's tools, for a fact that
   * booting the package alone cannot show. The registered tool NAME can be a
   * load-time config (`tool-subagent`'s `toolName`), so one package may appear
   * under several names across deployments — the boot yields the package
   * DEFAULT, and this note records the shipped alternatives the model sees.
   */
  note?: string
}

/**
 * The boot manifest: every shipped tool package (a `tool-*` leaf under
 * `packages/`). Ordered by package name (the render order); the completeness
 * guard proves it is exhaustive against the on-disk glob.
 */
export const TOOL_PACKAGES: ToolPackage[] = [
  {
    pkg: '@deepseek-ai/dsh-knowledge-router',
    dir: 'knowledge-router',
    source: {
      knowledge_query: 'packages/knowledge/knowledge-router/src/tool.ts',
      knowledge_delegate: 'packages/knowledge/knowledge-router/src/tool-delegate.ts',
      knowledge_record: 'packages/knowledge/knowledge-router/src/tool-learn.ts',
    },
    requires: ['ctx.tools', 'ctx.subagents (assisted mode)', 'ctx.commands (optional)'],
    writes: ['tool/call', 'tool/result', 'child sessions', 'configured Graphify memory (explicit learning)'],
    async mount(ctx) {
      await ctx.plugin(SubagentRuntime)
      await ctx.plugin(KnowledgeRouter, { mode: 'assisted', learning: { enabled: true } })
    },
  },
  {
    pkg: '@deepseek-ai/dsh-plugin-manager',
    dir: 'plugin-manager',
    source: 'packages/boot/plugin-manager/src/tools.ts',
    requires: ['ctx.tools', 'ctx.pluginManager', 'ctx.sandboxPolicy'],
    writes: ['tool/call', 'tool/result', 'user/message'],
    async mount(ctx) {
      ctx.provide('pluginManager', {} as PluginManager)
      await ctx.plugin(SandboxPolicy)
      await ctx.plugin(PluginManagerTools)
    },
  },
  {
    pkg: '@deepseek-ai/dsh-plugin-market',
    dir: 'plugin-market',
    source: 'packages/boot/plugin-market/src/tools.ts',
    requires: ['ctx.tools', 'ctx.pluginMarket'],
    writes: ['tool/call', 'tool/result'],
    async mount(ctx) {
      ctx.provide('pluginMarket', {} as PluginMarket)
      await ctx.plugin(PluginMarketTools)
    },
  },
  {
    pkg: '@deepseek-ai/dsh-mcp-resources',
    dir: 'mcp-resources',
    source: 'packages/mcp/mcp-resources/src/tools.ts',
    requires: ['ctx.tools', 'ctx.mcpResources'],
    writes: ['tool/call', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(McpResources)
      ctx.mcpResources.register('catalog', {
        request: () => Promise.reject(new Error('gen-tool-catalog: MCP requests are unreachable during schema harvest')),
      })
    },
  },
  {
    pkg: '@deepseek-ai/dsh-experimental-browser-use-stagehand-native',
    dir: 'browser-use-stagehand-native',
    source: 'packages/experimental/browser-use-stagehand-native/src/index.ts',
    requires: ['ctx.browserUse', 'ctx.agents', 'ctx.tools', 'ctx.systemPrompt'],
    writes: ['tool/call', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(BrowserUseRegistry)
      await ctx.plugin(AgentRegistry)
      await ctx.plugin(StagehandBrowserTools, {
        mode: 'launch', model: { modelName: 'openai/gpt-5.4-mini', apiKey: 'placeholder' },
      })
    },
  },
  {
    pkg: '@deepseek-ai/dsh-action-cards',
    dir: 'action-cards',
    source: 'packages/experimental/action-cards/src/index.ts',
    requires: ['ctx.tools', 'ctx.agents', 'ctx.sessionProjections', 'ctx.remoteAccess'],
    writes: ['tool/call', 'tool/result', 'plugin:action-cards/decision', 'user/message'],
    async mount(ctx) {
      await ctx.plugin(AgentRegistry)
      await ctx.plugin(RemoteAccess)
      await ctx.plugin(ActionCards)
    },
    note: 'Declared only to an Agent that loaded the skill of a registered card kind; the kind packages register their actions, and the Personalized recommendations bundle supplies the shipped kinds.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-ask-user',
    dir: 'tool-ask-user',
    source: 'packages/interaction/tool-ask-user/src/index.ts',
    requires: ['ctx.tools', 'ctx.userQuestions'],
    writes: ['tool/call', 'tool/result after an answer or timeout', 'late user/message'],
    async mount(ctx) {
      await ctx.plugin(UserQuestionService)
      await ctx.plugin(ToolAskUser)
    },
    note:
      'ask_user_question keeps the original blocking behavior by default; set `mode: timed` to opt into a foreground timeout and pending result while the question remains answerable. In timed mode, `timeout: -1` keeps that call blocking indefinitely.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-executor-ptc',
    dir: 'tool-executor-ptc',
    source: 'packages/core/tool-executor-ptc/src/ptc.ts',
    requires: ['ctx.workingDirectory (Agent executions)', 'ctx.tools', 'ctx.ptcRuntime', 'ctx.systemPrompt'],
    writes: ['tool/call', 'one tool/ptc-dispatch-start + tool/ptc-dispatch pair per bridged sub-call', 'tool/result'],
    executor: 'ptc',
    async mount(ctx) {
      await ctx.plugin(LocalSubprocessRuntime)
      await ctx.plugin(LocalSandboxProvider)
      await ctx.plugin(SandboxPolicy)
      await ctx.plugin(NodePtcRuntime)
    },
    note:
      'The PTC executor exposes only run_code to the model and declares other visible capabilities in a generated SDK in the runtime’s language. Program bindings enter the shared guarded tool pipeline in submission order; concurrency-safe bodies overlap up to maxParallelSubCalls, and nested results remain linked to the outer program.',
  },
  {
    pkg: '@deepseek-ai/dsh-plan-mode',
    dir: 'plan-mode',
    source: 'packages/plan/plan-mode/src/index.ts',
    requires: ['ctx.tools', 'ctx.systemPrompt', 'ctx.agents', 'ctx.userQuestions (execution time, opportunistic)'],
    writes: ['tool/call', 'plan/mode inactive on an approved review', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(AgentRegistry)
      await ctx.plugin(PlanModeController, { section: 'Tool catalog schema harvest.' })
    },
    note:
      'exit_plan_mode stays in the model-facing schema while planning is inactive so transitions add no tool-catalog churn on top of the plan-policy change. Its execute path rejects calls outside plan mode; in plan mode it presents the plan over the user-questions seam (approve / keep planning with feedback), and approval logs plan mode inactive at the step boundary.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-bash',
    dir: 'tool-bash',
    source: 'packages/shell/tool-bash/src/index.ts',
    requires: ['ctx.workingDirectory', 'ctx.tools', 'ctx.shell', 'ctx.systemPrompt', 'ctx.shellEnv', 'ctx.jobs for run_in_background and the job-backed foreground path'],
    writes: ['tool/call', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(LocalSubprocessRuntime)
      await ctx.plugin(BashEnvPlugin)
      await ctx.plugin(LocalBashExecutor)
      await ctx.plugin(LocalJobRegistry)
      await ctx.plugin(ToolBash)
    },
    note:
      'The bash tool is the model-facing consumer of the bash executor seam. With a job registry composed every call registers with the generic `ctx.jobs` runtime as it starts, collected/stopped through the `job_*` tools from `@deepseek-ai/dsh-tool-jobs`; without one, or with `enableRunInBackground: false`, the tool registers a foreground-only schema without the `run_in_background` parameter.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-present',
    dir: 'tool-present',
    source: 'packages/deliverables/tool-present/src/index.ts',
    requires: ['ctx.workingDirectory', 'ctx.tools', 'ctx.fs', 'ctx.agents'],
    writes: ['tool/call', 'deliverables/presented after a successful final result', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(AgentRegistry)
      await ctx.plugin(ToolPresent)
    },
    note: 'Deliveries belong to the calling Session; Web ui-deliverables supplies source-file opening and cards.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-pwsh',
    dir: 'tool-pwsh',
    source: 'packages/shell/tool-pwsh/src/index.ts',
    requires: ['ctx.workingDirectory', 'ctx.tools', 'ctx.shell', 'ctx.systemPrompt', 'ctx.shellEnv', 'ctx.jobs for run_in_background and the job-backed foreground path'],
    writes: ['tool/call', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(LocalSubprocessRuntime)
      await ctx.plugin(BashEnvPlugin)
      await ctx.plugin(PwshLocalExecutor)
      await ctx.plugin(LocalJobRegistry)
      await ctx.plugin(ToolPwsh)
    },
    note:
      'The pwsh tool is the PowerShell-dialect consumer of the bash executor seam for Windows compositions (a PowerShell executor such as `@deepseek-ai/dsh-pwsh-local` backs `ctx.shell`); it mirrors the bash tool call-for-call minus sandbox controls — `run_in_background` runs register with the generic `ctx.jobs` runtime and are collected/stopped through the `job_*` tools, and the managed `DSH_*` environment comes from `@deepseek-ai/dsh-shell-env`. Each call runs in a fresh process (no persistent PTY session), with native `C:\\...` paths and `$env:NAME` variables.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-cordis',
    dir: 'tool-cordis',
    source: 'packages/extensions/tool-cordis/src/index.ts',
    requires: ['ctx.tools', 'ctx.cordisInspect'],
    writes: ['tool/call', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(CordisHostRunner)
      await ctx.plugin(ToolCordis)
    },
    note:
      'Creator mode provides two read-only runtime inspection tools. The Cordis host runner supplies the inspection registry; Client queries require a connected page. Author persistent changes as bundles and install them with plugin_manager.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-bash-persistent',
    dir: 'tool-bash-persistent',
    source: 'packages/shell/tool-bash-persistent/src/index.ts',
    requires: ['ctx.workingDirectory', 'ctx.tools', 'ctx.terminals', 'an owning Agent at execution time'],
    writes: ['tool/call', 'PTY shell state', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(TerminalSessionService)
      await ctx.plugin(ToolBashPersistent)
    },
    note:
      'One owner-isolated persistent bash tool; deployment composition supplies the PTY backend and may override the model-facing environment description.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-pwsh-persistent',
    dir: 'tool-pwsh-persistent',
    source: 'packages/shell/tool-pwsh-persistent/src/index.ts',
    requires: ['ctx.workingDirectory', 'ctx.tools', 'ctx.terminals', 'an owning Agent at execution time'],
    writes: ['tool/call', 'PTY shell state', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(TerminalSessionService)
      await ctx.plugin(ToolPwshPersistent)
    },
    note:
      'One owner-isolated persistent pwsh tool, the Windows counterpart of the persistent bash tool; deployment composition supplies a pwsh-dialect PTY backend and may override the model-facing environment description.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-str-replace-editor',
    dir: 'tool-str-replace-editor',
    source: 'packages/fs/tool-str-replace-editor/src/index.ts',
    requires: ['ctx.tools', 'ctx.fs'],
    writes: ['tool/call', 'fs/observed after view presence/absence, edit absence, or successful mutation', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(ToolStrReplaceEditor)
    },
    note:
      'Standalone view/create/unique literal replace/line insert tool over the filesystem seam; it composes with any shell or terminal API.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-fs',
    dir: 'tool-fs',
    source: 'packages/fs/tool-fs/src/index.ts',
    requires: ['ctx.workingDirectory', 'ctx.tools', 'ctx.fs', 'ctx.systemPrompt', 'ctx.attachments (image-tool registration)', 'ctx.llm + an image-capable route (image-tool execution)'],
    writes: ['tool/call', 'fs/write-intent, fs/edit-intent, or fs/delete-intent for mutations', 'fs/observed after read presence/absence or successful file operation', 'durable attachment (read_image)', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(CatalogAttachmentStore)
      await ctx.plugin(ToolFs, { applyPatch: true })
    },
    note:
      'The read-before-write/edit policy is added by `@deepseek-ai/dsh-fs-observation-policy` (an `fs/*` event-gate plugin, no schema change); a deployment that loads these tools is expected to also load it. The image tool is not registered without `ctx.attachments`; its schema is route-independent, and execution refuses unless the exact routed model declares image input. `apply_patch` registers only with `applyPatch: true`; the catalog sets it so the schema is documented, while shipped compositions keep the switch off on their `tool-fs` rows.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-fs-search',
    dir: 'tool-fs-search',
    source: 'packages/fs/tool-fs-search/src/index.ts',
    requires: ['ctx.workingDirectory', 'ctx.tools', 'ctx.subprocess', 'ctx.systemPrompt'],
    writes: ['tool/call', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(LocalSubprocessRuntime)
      await ctx.plugin(ToolFsSearch, { sampleOverCapGlobResults: true })
    },
    note:
      'glob and grep are unconditional discovery tools that spawn the packaged ripgrep binary (`@vscode/ripgrep`) through ctx.subprocess as ordinary foreground calls (never background jobs) — no host `rg` install and no shell layer. The catalog uses `sampleOverCapGlobResults: true`; deployments must choose that behavior explicitly. Capped results save the complete formatted list through the optional ctx.spillStore backend; returned locators are follow-up-readable/searchable when the backend exposes local paths in co-located deployments.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-terminal',
    dir: 'tool-terminal',
    source: 'packages/experimental/tool-terminal/src/index.ts',
    requires: ['ctx.workingDirectory', 'ctx.tools', 'ctx.terminals', 'ctx.systemPrompt', 'ctx.jobs at call time for run_in_background'],
    writes: ['tool/call', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(TerminalSessionService)
      await ctx.plugin(ToolPty)
    },
    note:
      'The six terminal tools are opt-in and complement one-shot shell/filesystem tools. `terminal_send(run_in_background: true)` registers with `ctx.jobs`; TUI, named key sequences, BEL, resize, auto-start, and cross-agent sharing are absent from the schema.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-goal',
    dir: 'tool-goal',
    source: 'packages/goal/tool-goal/src/index.ts',
    requires: ['ctx.tools', 'ctx.agents', 'ctx.goals', 'ctx.systemPrompt', 'a calling Agent in an authorized open turn'],
    writes: ['tool/call', 'goal/change for mutations', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(AgentRegistry)
      await ctx.plugin(GoalService)
      await ctx.plugin(ToolGoal)
    },
    note:
      'create, edit, pause, and resume require direct-human root authority; complete and blocked also accept the exact current goal round. The default blocked lower bound is three admitted rounds.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-schedule',
    dir: 'tool-schedule',
    source: 'packages/schedule/tool-schedule/src/index.ts',
    requires: ['ctx.tools', 'ctx.schedule', 'ctx.systemPrompt'],
    writes: ['tool/call', 'Schedule storage domain create, update, or delete', 'tool/result'],
    async mount(ctx) {
      ctx.provide('schedule', {
        deliveryLimits: () => ({ newSessionIntervalSeconds: ScheduleService.Config({}).newSessionIntervalSeconds }),
      } as ScheduleService)
      await ctx.plugin(ToolSchedule)
    },
    note:
      'A preset or Agent scope mounts this package and decides which agents receive its tools. '
      + 'Management reads and writes Host tasks by id across Sessions. '
      + 'Tasks store an RFC 5545 recurrence and an existing, first-created-and-reused, or per-run-new Session target. '
      + 'Delegated subagents cannot call these tools.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-lsp',
    dir: 'tool-lsp',
    source: 'packages/lsp/tool-lsp/src/index.ts',
    requires: ['ctx.workingDirectory', 'ctx.tools', 'ctx.lsp', 'ctx.systemPrompt'],
    writes: ['tool/call', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(Lsp)
      await ctx.plugin(ToolLsp)
    },
    note:
      'The lsp tool keeps provider selection and language-server subprocesses behind ctx.lsp, so its model-visible schema stays stable across providers. Requires a registered provider (e.g. `@deepseek-ai/dsh-lsp-stdio`) at runtime; without one, a query returns the structured `LSP_UNAVAILABLE` error rather than changing the schema.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-ralph',
    dir: 'tool-ralph',
    source: 'packages/experimental/tool-ralph/src/index.ts',
    requires: ['ctx.tools', 'ctx.workflowEngine', 'ctx.subagents', 'ctx.systemPrompt', 'a calling Agent (exec.agent parents every fresh round)'],
    writes: ['tool/call', 'tool/result', 'workflow and child session events during execution'],
    async mount(ctx) {
      await ctx.plugin(SubagentRuntime)
      registerCatalogSubagentProvider(ctx, 'mock')
      await ctx.plugin(CatalogWorkflowEngine)
      await ctx.plugin(ToolRalph, { subagentProvider: 'mock' })
    },
    note:
      'A fixed foreground workflow starts one fresh structured child per round; the model selects only the immutable objective and an optional round cap.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-skill',
    dir: 'tool-skill',
    source: 'packages/skill/tool-skill/src/index.ts',
    requires: ['ctx.workingDirectory', 'ctx.tools', 'ctx.agents', 'ctx.skills'],
    writes: ['tool/call', 'tool/result', 'user/message replacement catalogs via agent.inject()'],
    async mount(ctx) {
      await ctx.plugin(AgentRegistry)
      await ctx.plugin(SkillRegistry)
      await ctx.plugin(SkillFileSystem, { dshHome: resolve(root, '.tmp/tool-catalog', '.dsh'), agentsHome: resolve(root, '.tmp/tool-catalog', '.agents'), claudeHome: resolve(root, '.tmp/tool-catalog', '.claude'), codexHome: resolve(root, '.tmp/tool-catalog', '.codex'), opencodeHome: resolve(root, '.tmp/tool-catalog', '.opencode'), geminiHome: resolve(root, '.tmp/tool-catalog', '.gemini'), cursorHome: resolve(root, '.tmp/tool-catalog', '.cursor'), copilotHome: resolve(root, '.tmp/tool-catalog', '.copilot') })
      await ctx.plugin(ToolSkill)
    },
  },
  {
    pkg: '@deepseek-ai/dsh-tool-session-query',
    dir: 'tool-session-query',
    source: 'packages/experimental/tool-session-query/src/index.ts',
    requires: ['ctx.tools', 'ctx.systemPrompt', 'ctx.sessionQuery', 'ctx.agents', 'a calling Agent for workspace authority'],
    writes: ['tool/call', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(SessionStore)
      await ctx.plugin(AgentRegistry)
      await ctx.plugin(SqliteSessionQueryEngine, { path: ':memory:' })
      await ctx.plugin(ToolSessionQuery)
    },
    note:
      'The five read-only tools hide provider cursors and authorize every result from the immutable calling agent session. The package is opt-in; compositions that need enforced deadlines or bounded inline output also mount the generic timeout or spill policies.',
  },
  {
    pkg: '@deepseek-ai/dsh-experimental-tool-subagent-oar',
    dir: 'tool-subagent-oar',
    source: 'packages/experimental/tool-subagent-oar/src/index.ts',
    requires: ['ctx.tools', 'ctx.subagents'],
    writes: ['tool/call', 'tool/result', 'parent subagent catalog and completion notices'],
    async mount(ctx) {
      await ctx.plugin(SubagentRuntime)
      await ctx.plugin(ToolSubagentOar, {
        providers: { codex: 'oar-codex', claude: 'oar-claude' },
      })
    },
    note: 'The subagent_oar tool selects among configured aliases for external providers. This catalog shows Codex and Claude Code aliases; each deployment chooses its providers. Native model and permission settings belong to the selected provider configuration.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-subagent',
    dir: 'tool-subagent',
    source: {
      list_subagent_models: 'packages/subagent/tool-subagent/src/list-models.ts',
      subagent: 'packages/subagent/tool-subagent/src/index.ts',
    },
    requires: ['ctx.tools', 'ctx.subagents', 'ctx.systemPrompt', 'ctx.sessionProjections', 'ctx.llm for model discovery and selected-route validation'],
    writes: ['tool/call', 'tool/result', 'child session events through the chosen provider'],
    shippedNames: ['subagent', 'subagent_fork'],
    async mount(ctx) {
      await ctx.plugin(SubagentRuntime)
      await ctx.plugin(LlmRuntime)
      registerCatalogSubagentProvider(ctx, 'mock')
      await ctx.plugin(ToolSubagent, { provider: 'mock', modelDiscovery: true })
    },
    note:
      'The load-time `toolName` selects the delegation name (default `subagent`); `modelSelection` adds optional route fields. `modelDiscovery` defaults off and registers shared discovery on one instance per scope. Web and Desktop presets enable spawn discovery and route fields and leave `subagent_fork` route fields disabled. The Host settings service records authorization for each new top-level Session; child Sessions inherit it. Without a recorded policy, discovery and explicit selection permit only the current parent route. Every delegation returns a child id promptly; local children accept follow-ups, while external backends report their single execution automatically.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-subagent-control',
    dir: 'tool-subagent-control',
    source: {
      interrupt_agent: 'packages/subagent/tool-subagent-control/src/index.ts',
      list_agents: 'packages/subagent/tool-subagent-control/src/list-agents.ts',
      send_message: 'packages/subagent/tool-subagent-control/src/index.ts',
    },
    requires: ['ctx.tools', 'ctx.subagents', 'ctx.agents'],
    writes: ['tool/call', 'tool/result', 'child session events through ctx.subagents'],
    async mount(ctx) {
      await ctx.plugin(SubagentRuntime)
      await ctx.plugin(LocalJobRegistry)
      await ctx.plugin(AgentRegistry)
      await ctx.plugin(SessionStore)
      await ctx.plugin(ToolSubagentControl)
    },
    note:
      'The globally named discovery, interruption, and local-message tools over managed subagents: provider-bound `tool-subagent` instances register distinct delegation tools, while one instance of this package registers `send_message`, `interrupt_agent`, and `list_agents`.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-master-control',
    dir: 'tool-master-control',
    source: {
      mc_interrupt: 'packages/subagent/tool-master-control/src/index.ts',
      mc_list_sessions: 'packages/subagent/tool-master-control/src/index.ts',
      mc_send: 'packages/subagent/tool-master-control/src/index.ts',
    },
    requires: ['ctx.tools', 'ctx.agents', 'ctx.sessionQuery'],
    writes: ['tool/call', 'tool/result', 'steer or interrupt message delivery into target agent turns'],
    async mount(ctx) {
      await ctx.plugin(SessionStore)
      await ctx.plugin(AgentRegistry)
      await ctx.plugin(SqliteSessionQueryEngine, { path: ':memory:' })
      await ctx.plugin(ToolMasterControl, { managedAll: true, managed: [] })
    },
    note:
      'Session control and messaging tools for peer agents: mc_list_sessions, mc_send, and mc_interrupt. Targets must be loaded in ctx.agents and enrolled via managed or managedAll.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-jobs',
    dir: 'tool-jobs',
    source: 'packages/jobs/tool-jobs/src/index.ts',
    requires: ['ctx.tools', 'ctx.jobs', 'ctx.systemPrompt'],
    writes: ['tool/call', 'tool/result', 'user/message via agent.inject() for background completion notices'],
    async mount(ctx) {
      await ctx.plugin(LocalJobRegistry)
      await ctx.plugin(ToolJobs)
    },
    note:
      'The kind-agnostic background-job controller: background bash commands and PTY sends are read, listed, and killed through the same three tools. Loading the plugin attaches the controller that arms producers\' `ctx.jobs.start()`.',
  },
  {
    pkg: '@deepseek-ai/dsh-experimental-tool-agent-team',
    dir: 'tool-agent-team',
    source: 'packages/experimental/tool-agent-team/src/index.ts',
    requires: ['ctx.tools', 'ctx.systemPrompt', 'ctx.agentTeams', 'ctx.subagents', 'an exact live Team member Agent'],
    writes: ['tool/call', 'team/member', 'team/message/queued', 'team/message/delivered', 'team/task', 'agent/inbox/spliced', 'user/message on inbox claim', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(AgentRegistry)
      await ctx.plugin(SessionStore)
      await ctx.plugin(SubagentRuntime)
      const session = ctx.sessions.create(SessionId('tool-catalog-team-lead'))
      let agent!: Agent
      const membership = {
        get root() { return agent },
        id: session.id,
        role: 'lead' as const,
        name: 'lead',
      }
      ctx.provide('agentTeams', {
        tryMembership: (candidate: Agent) => candidate === agent ? membership : undefined,
        membership: () => membership,
      } as never)
      await ctx.plugin(Object.assign(async (inner: Context) => {
        agent = {
          id: session.id,
          session,
          options: {},
          status: 'idle',
        } as Agent
        Object.assign(agent, { ctx: createScope(inner, agent).ctx })
        await inner.agents.register(agent)
      }, { inject: ['tools', 'systemPrompt', 'agents', 'agentTeams'] }))
      await ctx.plugin(ToolTeam)
      catalogChildScopes.set(ctx, agent)
    },
    scope: ctx => catalogChildScopes.get(ctx) as Agent,
    note:
      'All nine tools are scoped to implicit Team Leads and durable teammates. send_message, interrupt_agent, and list_agents also reach the direct subagents the caller started. The shipped dsh-base bundle keeps the package disabled; the documented Agent Teams profile patch enables it while disabling the legacy continuable-child control names.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-todo',
    dir: 'tool-todo',
    source: 'packages/todo/tool-todo/src/index.ts',
    requires: ['ctx.tools', 'owning Agent session'],
    writes: ['tool/call', 'todo/write', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(ToolTodo, { allowParallelInProgress: true })
    },
    note:
      'todo_write is session-owned state; UIs render the latest todo/write event as a checklist. `allowParallelInProgress` is required with no default, so the catalog states its choice: `true`, whose description invites several `in_progress` items. A deployment choosing `false` receives the same tool with a description asking for exactly one active task.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-working-directory',
    dir: 'tool-working-directory',
    source: 'packages/session/tool-working-directory/src/index.ts',
    requires: ['ctx.tools', 'ctx.workingDirectory'],
    writes: ['tool/call', 'working-directory/change', 'user context for directory changes', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(ToolWorkingDirectory)
    },
    note: 'Reads or changes the calling Session directory. Existing shells and processes retain their own directories; origin metadata and permission roots stay fixed.',
  },
  {
    pkg: '@deepseek-ai/dsh-experimental-tool-worktree',
    dir: 'tool-worktree',
    source: 'packages/experimental/tool-worktree/src/index.ts',
    requires: ['ctx.tools', 'ctx.worktrees', 'a calling Agent'],
    writes: ['tool/call', 'Git branch and checkout', 'working-directory/change', 'tool/result'],
    async mount(ctx) {
      ctx.provide('worktrees', {
        create: () => Promise.reject(new Error('gen-tool-catalog: worktree creation is unavailable during schema harvest')),
      })
      await ctx.plugin(ToolWorktree)
    },
    note: 'Explicit experimental composition only. Creates a new branch and checkout from a pinned local commit under existing write permissions, then changes the Session directory. Leaving retains the branch and checkout.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-workflow',
    dir: 'tool-workflow',
    source: 'packages/workflow/tool-workflow/src/index.ts',
    requires: ['ctx.tools', 'ctx.workflowEngine', 'ctx.systemPrompt', 'a calling Agent (exec.agent parents the script children)'],
    writes: ['tool/call', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(SubagentRuntime)
      registerCatalogSubagentProvider(ctx, 'mock')
      await ctx.plugin(CatalogWorkflowEngine)
      await ctx.plugin(ToolWorkflow)
    },
  },
  {
    pkg: '@deepseek-ai/dsh-tool-workspace-dependencies',
    dir: 'tool-workspace-dependencies',
    source: 'packages/skill/tool-workspace-dependencies/src/index.ts',
    requires: ['ctx.tools'],
    writes: ['tool/call', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(ToolWorkspaceDependencies, { source: resolve(root, '.tmp/tool-catalog/primary-runtime') })
    },
  },
  {
    pkg: '@deepseek-ai/dsh-tool-watch',
    dir: 'tool-watch',
    source: 'packages/jobs/tool-watch/src/index.ts',
    requires: ['ctx.tools', 'ctx.shell', 'ctx.shellEnv', 'ctx.jobs', 'ctx.systemPrompt'],
    writes: ['tool/call', 'tool/result', 'user/message via agent.followup() or agent.inject() when the watch settles'],
    async mount(ctx) {
      await ctx.plugin(LocalSubprocessRuntime)
      await ctx.plugin(BashEnvPlugin)
      await ctx.plugin(LocalBashExecutor)
      await ctx.plugin(LocalJobRegistry)
      await ctx.plugin(ToolWatch)
    },
    note:
      'Waits for an external condition. A host-side poll re-runs one shell command under the session sandbox policy with no model call between checks, then wakes the owner through the job completion path. Inspect and stop a watch with the job tools from `@deepseek-ai/dsh-tool-jobs`.',
  },
  {
    pkg: '@deepseek-ai/dsh-tool-web',
    dir: 'tool-web',
    source: 'packages/web/tool-web/src/index.ts',
    requires: ['ctx.tools', 'ctx.web', 'ctx.systemPrompt'],
    writes: ['tool/call', 'tool/result'],
    async mount(ctx) {
      await ctx.plugin(WebRuntime)
      await ctx.plugin(WebSearchExa)
      await ctx.plugin(WebFetchLocal)
      await ctx.plugin(ToolWeb)
    },
    note:
      'web_search and web_fetch keep provider selection behind ctx.web so model-visible schemas stay stable across backend swaps.',
  },
]
