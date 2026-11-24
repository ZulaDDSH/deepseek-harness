import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, win32 } from 'node:path'
import { accountKey, legacyAccountKey, readOwnership, updateOwnership } from './ownership.js'

const base = new URL('./bridge/index.js', import.meta.url)
const fromBridge = (file) => import(new URL(file + '.js', base))
const { ClaudeCodeAdapter } = await fromBridge('adapter')
const { buildChildEnvironment, defaultSettingsFiles, assertSettingsSafe, ProcessHome } =
  await fromBridge('auth')
const { createProcessAuthRunner } = await fromBridge('auth-process')
const { SessionHeaderWorkspace, SessionForkOrigin } = await fromBridge('context')
const { DEFAULT_DEADLINES } = await fromBridge('deadlines')
const { findClaudeExecutable } = await fromBridge('official-session')
const { SdkNativeRuntime } = await fromBridge('sdk-runtime')
const { SessionManager } = await fromBridge('session-manager')
const { ProductionSpendGate } = await fromBridge('spend-gate')

export const name = 'dsh-claude-account-manager'
export const inject = ['llm', 'sessions', 'connection', 'webServer']
const channel = '/claude-subscription-accounts'
const primary = 'Claude subscription (Claude Code)'
const runner = createProcessAuthRunner()
const home = homedir()
const root = join(process.env.DSH_HOME || join(home, '.dsh'), 'claude-accounts')
const labelPattern = /^[a-z0-9][a-z0-9 -]{0,30}[a-z0-9]$|^[a-z0-9]$/i
const caseInsensitiveFiles = process.platform === 'win32' || process.platform === 'darwin'
const sameDirectory = (a, b) =>
  caseInsensitiveFiles ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b)
export function loginTimeoutMs(value = process.env.DSH_CLAUDE_LOGIN_TIMEOUT_MS) {
  const ms = Number(value)
  if (!Number.isFinite(ms) || ms <= 0) return 300000
  return Math.min(Math.max(Math.floor(ms), 1000), 2 ** 31 - 1)
}
export function windowsSystemPath(env, ...parts) {
  return win32.join(env.SystemRoot || env.SYSTEMROOT || env.windir || 'C:\\Windows', 'System32', ...parts)
}

function environment(account) {
  const env = buildChildEnvironment(process.env, home)
  if (account.dir) env.CLAUDE_CONFIG_DIR = account.dir
  return env
}

function settingsFiles(account, workspace) {
  const normal = defaultSettingsFiles(home, workspace)
  return account.dir
    ? [join(account.dir, 'settings.json'), join(account.dir, '.claude.json'), ...normal.slice(2)]
    : normal
}

async function checkAccount(account, workspace) {
  assertSettingsSafe(settingsFiles(account, workspace))
  const result = await runner.run({
    executable: 'claude',
    args: ['auth', 'status', '--json'],
    env: environment(account),
    cwd: workspace,
  })
  let status
  try {
    status = JSON.parse(result.stdout)
  } catch {
    throw new Error('Claude Code returned an unreadable sign-in status. Update the Claude Code executable and refresh.')
  }
  if (status.loggedIn === false) return { signedIn: false }
  if (
    result.exitCode !== 0 ||
    status.loggedIn !== true ||
    status.authMethod !== 'claude.ai' ||
    status.apiProvider !== 'firstParty' ||
    status.apiKeySource
  )
    throw new Error('Claude Code must be signed in with a Claude subscription for this account.')
  if (
    account.dir &&
    (!status.configDirectory || !sameDirectory(status.configDirectory, account.dir))
  )
    throw new Error('Claude Code did not use the selected account directory.')
  const info = status.email ? status : await readFromCli(account, (session) => session.accountInfo())
  const email = info.email?.trim()
  if (!email) throw new Error('Claude Code could not verify the account email. Complete sign-in again.')
  const key = accountKey(root, email, status.orgId)
  const identity = key
  return {
    signedIn: true,
    accountKey: key,
    legacyKey: legacyAccountKey(email),
    email,
    plan: status.subscriptionType || info.subscriptionType || '',
    identity,
    accepted: { identityBinding: identity, authMethod: status.authMethod, apiProvider: status.apiProvider },
  }
}

async function readFromCli(account, read) {
  const env = environment(account)
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const abort = new AbortController()
  let release
  const done = new Promise((resolve) => {
    release = resolve
  })
  const timer = setTimeout(() => abort.abort(), 15000)
  let session
  try {
    session = query({
      prompt: {
        async *[Symbol.asyncIterator]() {
          await done
        },
      },
      options: {
        abortController: abort,
        cwd: account.dir || home,
        env,
        tools: [],
        strictMcpConfig: true,
        plugins: [],
        skills: [],
        settingSources: [],
        mcpServers: {},
        persistSession: false,
        pathToClaudeCodeExecutable: findClaudeExecutable(env.PATH),
      },
    })
    return await read(session)
  } finally {
    clearTimeout(timer)
    release()
    session?.close()
  }
}

class AccountAdapter extends ClaudeCodeAdapter {
  constructor(ctx, account, identity) {
    const runtime = new SdkNativeRuntime()
    let catalog
    super({
      sessions: new SessionManager(),
      spendGate: new ProductionSpendGate(),
      home: new ProcessHome(),
      parentEnv: () => process.env,
      deadlines: DEFAULT_DEADLINES,
      workspace: new SessionHeaderWorkspace(ctx.sessions),
      sessionOrigin: new SessionForkOrigin(ctx.sessions),
      attachments: () => ctx.get('attachments'),
      discoverModels: () =>
        (catalog ??= readFromCli(account, (session) => session.supportedModels()).catch((err) => {
          catalog = undefined
          throw err
        })),
      auth: {
        async check({ workspace }) {
          const current = await checkAccount(account, workspace)
          if (
            !current.signedIn ||
            current.identity !== identity ||
            readOwnership(root).owners.get(current.accountKey) !== account.id
          )
            throw new Error(
              'The sign-in for this account changed. Open Settings → Claude accounts and refresh.',
            )
          return current.accepted
        },
      },
      runtime: {
        start(config) {
          const launch = config.launch
          return runtime.start({
            ...config,
            launch: { ...launch, env: { ...launch.env, CLAUDE_CONFIG_DIR: account.dir } },
          })
        },
      },
    })
    this.account = account
  }
  assertRoute(provider) {
    if (provider !== this.account.route) throw new Error('Claude subscription route mismatch.')
  }
  providerInfo(provider) {
    this.assertRoute(provider)
    return { id: provider, name: this.account.picker }
  }
}

function slot(label, dir) {
  const id = label.toLowerCase().replace(/ /g, '_')
  return { id, label, dir, route: 'claude-sub-' + id, picker: 'Claude subscription · ' + label }
}

function profiles() {
  const rows = [{ id: 'main', label: 'Main', picker: primary }]
  if (existsSync(root)) {
    for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (!entry.isDirectory() || !labelPattern.test(entry.name)) continue
      const row = slot(entry.name, join(root, entry.name))
      if (!rows.some((other) => other.id === row.id)) rows.push(row)
    }
  }
  return rows
}

function addProfile(input, state) {
  const label = typeof input === 'string' ? input.trim().replace(/ +/g, ' ') : ''
  if (!labelPattern.test(label) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(label))
    throw new Error('Use 1–32 letters, digits, spaces or hyphens for the account name.')
  const account = slot(label, join(root, label))
  const existing = profiles().find((p) => p.id === account.id)
  if (existing && state.rejected.has(existing.id)) return existing
  if (existing) throw new Error('That account name already exists.')
  mkdirSync(root, { recursive: true, mode: 0o700 })
  mkdirSync(account.dir, { mode: 0o700 })
  return account
}

function startLogin(account) {
  const env = environment(account)
  const executable = findClaudeExecutable(env.PATH)
  const cwd = account.dir || home
  if (process.platform !== 'win32') {
    return spawn(executable, ['auth', 'login', '--claudeai'], { cwd, env, stdio: 'ignore' })
  }
  env.DSH_LOGIN_CLI = executable
  const shell = windowsSystemPath(env, 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const command =
    '$ErrorActionPreference="Stop"; $p=Start-Process -FilePath $env:DSH_LOGIN_CLI -ArgumentList @("auth","login","--claudeai") -WorkingDirectory $env:DSH_LOGIN_CWD -PassThru -Wait; exit $p.ExitCode'
  env.DSH_LOGIN_CWD = cwd
  return spawn(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
    cwd: env.DSH_LOGIN_CWD,
    env,
    windowsHide: true,
    stdio: 'ignore',
  })
}

function killTree(child, warn) {
  return new Promise((done) => {
    const kill = () => {
      child.kill()
      done()
    }
    if (process.platform !== 'win32' || !child.pid) return kill()
    execFile(
      windowsSystemPath(process.env, 'taskkill.exe'),
      ['/pid', String(child.pid), '/T', '/F'],
      { windowsHide: true },
      (err) => {
        if (err) warn?.('Could not stop the Claude Code sign-in process tree: ' + err.message)
        kill()
      },
    )
  })
}

export function apply(ctx) {
  const routes = new Map()
  const logins = new Map()
  const loginErrors = new Map()
  const attempts = new Set()
  let notice = ''
  let noticeSeq = Date.now() * 1000 + Math.floor(Math.random() * 1000)
  const say = (text) => {
    if (text === notice) return
    notice = text
    noticeSeq++
  }
  let displacedNotice = ''
  let active = true
  let tail = Promise.resolve()
  function ordered(job) {
    const next = tail.then(job)
    tail = next.catch(() => {})
    return next
  }
  async function observe() {
    return Promise.all(
      profiles().map(async (a) => {
        let status
        try {
          status = await checkAccount(a, a.dir || home)
        } catch (err) {
          status = { signedIn: false, error: err.message }
        }
        return { ...a, status, attempt: attempts.has(a.id), created: a.dir ? statSync(a.dir).birthtimeMs : 0 }
      }),
    )
  }
  async function signOutDuplicate(a, key, accounts) {
    if (!a.dir) throw new Error('Expected a named profile.')
    const target = realpathSync.native(a.dir)
    if (
      accounts.some((other) => {
        const dir = other.dir || join(home, '.claude')
        return other.id !== a.id && existsSync(dir) && sameDirectory(realpathSync.native(dir), target)
      })
    )
      throw new Error('This profile shares its Claude Code directory.')
    const current = await checkAccount(a, a.dir)
    if (current.accountKey !== key || readOwnership(root).owners.get(key) === a.id) return
    const result = await runner.run({
      executable: 'claude',
      args: ['auth', 'logout'],
      env: environment(a),
      cwd: a.dir,
    })
    if (result.exitCode !== 0 || (await checkAccount(a, a.dir)).accountKey === key)
      throw new Error('Claude Code could not clear this sign-in.')
  }
  async function refresh() {
    const { rows: accounts, state } = await updateOwnership(root, observe)
    if (!active) return []
    const displaced = state.displaced.map((id) => accounts.find((a) => a.id === id)?.label || id)
    displacedNotice = displaced.length
      ? 'The default Claude Code sign-in uses the same account as ' +
        displaced.join(', ') +
        ', so that profile was disconnected. Sign it in with a different account to use it again.'
      : ''
    const authorized = accounts.filter(
      (a) => a.status.signedIn && state.owners.get(a.status.accountKey) === a.id,
    )
    for (const [id, old] of routes) {
      if (authorized.some((a) => a.id === id && a.status.identity === old.identity)) continue
      old.release()
      routes.delete(id)
      await old.adapter.closeOwnedSessions()
    }
    for (const a of authorized) {
      if (!active || !a.dir || routes.has(a.id)) continue
      const adapter = new AccountAdapter(ctx, a, a.status.identity)
      const release = ctx.llm.registerAdapter([a.route], adapter)
      routes.set(a.id, { adapter, release, identity: a.status.identity })
    }
    const visible = []
    for (const a of accounts) {
      const { status } = a
      const rejected = state.rejected.get(a.id)
      if (rejected && status.accountKey === rejected.key) {
        const owner = accounts.find((other) => other.id === rejected.owner)?.label || rejected.owner
        if (attempts.has(a.id))
          say(
            'This Claude account is already connected as ' +
            owner +
            '. Choose a different account in your browser and try again.',
          )
        try {
          await signOutDuplicate(a, rejected.key, accounts)
        } catch {
          say('Duplicate sign-in blocked for ' + a.label + '. Refresh to retry clearing its local sign-in.')
        }
        attempts.delete(a.id)
        continue
      }
      const pending = logins.has(a.id) && !status.signedIn
      if (!pending) attempts.delete(a.id)
      if (rejected && !pending && !loginErrors.has(a.id)) continue
      visible.push({
        id: a.id,
        label: a.label,
        picker: a.picker,
        signedIn: status.signedIn,
        email: status.email,
        plan: status.plan,
        pending,
        error: status.error || (!status.signedIn && loginErrors.get(a.id)) || undefined,
      })
    }
    return visible
  }
  ctx.on('session/disposed', (session) =>
    Promise.all([...routes.values()].map((r) => r.adapter.closeSession(String(session.id)))),
  )
  ctx.effect(
    () => () => {
      active = false
      const killed = [...logins.values()].map(({ child, timer }) => {
        clearTimeout(timer)
        return killTree(child, (text) => ctx.logger?.warn?.(text))
      })
      logins.clear()
      return Promise.all([...killed, ...[...routes.values()].map((r) => r.adapter.closeOwnedSessions())])
    },
    'close account sessions',
  )
  ctx.connection.rpc.handle(channel, async (method, args, _signal, peer) => {
    if (peer?.principal?.kind !== 'owner')
      return {
        ok: false,
        error: { code: 'forbidden', message: 'Only the local Harness owner can manage accounts.', details: {} },
      }
    if (args?.ackNotice && args.ackNotice === noticeSeq) say('')
    try {
      const value = await ordered(async () => {
        if (method === 'list') return refresh()
        if (method !== 'add' && method !== 'login') throw new Error('Unknown account action.')
        const a =
          method === 'add'
            ? addProfile(args?.label, readOwnership(root))
            : profiles().find((x) => x.id === args?.id)
        if (!a) throw new Error('Unknown Claude account.')
        const status = await checkAccount(a, a.dir || home)
        if (status.signedIn && readOwnership(root).rejected.has(a.id))
          throw new Error('This Claude account is already connected. Refresh sign-ins and try again.')
        if (!status.signedIn && !logins.has(a.id)) {
          say('')
          loginErrors.delete(a.id)
          const child = startLogin(a)
          attempts.add(a.id)
          const login = { child, timer: undefined }
          logins.set(a.id, login)
          const finish = (message) => {
            clearTimeout(login.timer)
            if (logins.get(a.id) !== login) return
            logins.delete(a.id)
            if (message) loginErrors.set(a.id, message)
            if (active) void ordered(refresh).catch(() => {})
          }
          login.timer = setTimeout(() => {
            void killTree(child, (text) => ctx.logger?.warn?.(text))
            finish('Sign-in timed out. You can try again.')
          }, loginTimeoutMs())
          login.timer.unref?.()
          child.once('error', () => finish('Could not start Claude Code. Try signing in again.'))
          child.once('close', (code) => finish(code === 0 ? '' : 'Sign-in did not finish. You can try again.'))
        }
        return refresh()
      })
      const text = [displacedNotice, notice].filter(Boolean).join(' ')
      const legacy = args?.includeNotice && args.ackNotice === undefined
      const id = noticeSeq
      if (legacy) say('')
      return {
        ok: true,
        value: args?.includeNotice ? { accounts: value, notice: text, noticeId: id } : value,
      }
    } catch (err) {
      return { ok: false, error: { code: 'claude-accounts/error', message: err.message, details: {} } }
    }
  })
  void ordered(refresh).catch((err) => ctx.logger.warn('Could not load Claude accounts: ' + err.message))
}
