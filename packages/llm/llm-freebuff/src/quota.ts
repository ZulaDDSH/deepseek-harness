import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { win32 } from 'node:path'
import type { QuotaSource } from '@deepseek-ai/dsh-api-quota-controller'
import type { QuotaResult, QuotaWindow } from '@deepseek-ai/dsh-api-quota-controller/types'
import { PROVIDER } from './auth.ts'

export const SESSION_URL = 'https://www.codebuff.com/api/v1/freebuff/session'
export const QUOTA_TTL_MS = 300_000
const CREDENTIAL_SERVICE = 'freebuff-cli'
const REQUEST_TIMEOUT_MS = 15_000
const NAME = 'Freebuff'
const UNSUPPORTED = 'Freebuff usage is only read on Windows for now'
const FREEBUCKS_PER_HOUR = 5
const READ_FAILED = 'Could not read the Freebuff sign-in from Credential Manager'

export type TokenReader = () => Promise<string | undefined>

export interface FreebuffQuotaOptions {
  readonly readToken: TokenReader
  readonly unconfigured?: string
  readonly now?: () => number
  readonly timeZone?: () => string
}

interface OpenHour {
  readonly amount: number
  readonly endsAt: number
}

interface Usage {
  readonly dailyRemaining: number
  readonly dailyLimit: number
  readonly resetAt: number | null
  readonly openHours: readonly OpenHour[]
  readonly monthly: { readonly remaining: number; readonly limit: number } | undefined
}

const READ_CREDENTIAL = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FbCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct CREDENTIAL { public int Flags; public int Type; public string TargetName; public string Comment;
    public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredReadW(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr cred);
  public static byte[] Read(string target) {
    IntPtr p;
    if (!CredReadW(target, 1, 0, out p)) return null;
    try {
      var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      var b = new byte[c.CredentialBlobSize];
      Marshal.Copy(c.CredentialBlob, b, 0, b.Length);
      return b;
    } finally { CredFree(p); }
  }
}
'@
$blob = [FbCred]::Read($env:FB_CREDENTIAL_TARGET)
if ($blob) { [Console]::Out.Write([Convert]::ToBase64String($blob)) }
`

export function hours(freebucks: number): number {
  return Math.floor(Math.max(0, freebucks) / FREEBUCKS_PER_HOUR + 1e-9)
}

export function hoursMinutes(freebucks: number): string {
  const minutes = Math.floor(Math.max(0, freebucks) / FREEBUCKS_PER_HOUR * 60)
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

export function decodeToken(blob: Buffer): string | undefined {
  const utf8 = blob.toString('utf8')
  const text = utf8.includes('\0') ? blob.toString('utf16le') : utf8
  const token = text.trim()
  return token === '' ? undefined : token
}

export function credentialTarget(home: string): string {
  return `${CREDENTIAL_SERVICE}/${win32.join(home, '.config', 'manicode', 'credentials.json')}`
}

export type RunPowerShell = (script: string, env: Readonly<Record<string, string>>) => Promise<string>

function runPowerShell(script: string, env: Readonly<Record<string, string>>): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      env: { ...process.env, ...env },
      timeout: 15_000,
      windowsHide: true,
      maxBuffer: 1 << 20,
    }, (error, stdout) => {
      if (error !== null) reject(new Error(READ_FAILED))
      else resolve(stdout)
    })
  })
}

export function windowsTokenReader(home: string = homedir(), run: RunPowerShell = runPowerShell): TokenReader {
  return async () => {
    const encoded = (await run(READ_CREDENTIAL, { FB_CREDENTIAL_TARGET: credentialTarget(home) })).trim()
    return encoded === '' ? undefined : decodeToken(Buffer.from(encoded, 'base64'))
  }
}

export function defaultQuotaOptions(platform: NodeJS.Platform = process.platform): FreebuffQuotaOptions {
  return platform === 'win32'
    ? { readToken: windowsTokenReader() }
    : { readToken: () => Promise.resolve(undefined), unconfigured: UNSUPPORTED }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function instant(value: unknown): number | undefined {
  const at = typeof value === 'string' ? Date.parse(value) : Number.NaN
  return Number.isFinite(at) ? at : undefined
}

export function parseUsage(body: unknown): Usage | undefined {
  const freebucks = record(record(body)?.freebucks)
  const daily = record(freebucks?.daily)
  const remaining = finite(daily?.remaining)
  const limit = finite(daily?.limit)
  if (daily === undefined || remaining === undefined || limit === undefined) return undefined
  const openHours = Array.isArray(daily.openHours)
    ? daily.openHours.flatMap((entry: unknown): OpenHour[] => {
      const amount = finite(record(entry)?.amount)
      const endsAt = instant(record(entry)?.endsAt)
      return amount === undefined || endsAt === undefined ? [] : [{ amount, endsAt }]
    })
    : []
  const usage = record(record(freebucks?.wallet)?.monthlyUsage)
  const monthlyRemaining = finite(usage?.remaining)
  const monthlyLimit = finite(usage?.limit)
  return {
    dailyRemaining: remaining,
    dailyLimit: limit,
    resetAt: instant(daily.resetAt) ?? null,
    openHours,
    monthly: monthlyRemaining === undefined || monthlyLimit === undefined ? undefined : { remaining: monthlyRemaining, limit: monthlyLimit },
  }
}

function usedPercent(left: number, limit: number): number | null {
  return limit > 0 ? Math.min(100, Math.max(0, (1 - left / limit) * 100)) : null
}

export function quotaWindows(usage: Usage, now: number): Partial<Record<'credits' | 'monthly', QuotaWindow>> {
  let unused = 0
  let running: number | undefined
  for (const hour of usage.openHours) {
    const minutes = Math.max(0, (hour.endsAt - now) / 60_000)
    unused += hour.amount * minutes / 60
    if (minutes > 0 && (running === undefined || hour.endsAt > running)) running = hour.endsAt
  }
  const left = usage.dailyRemaining + unused
  const runningLabel = running === undefined ? '' : `, running hour ends in ${Math.floor((running - now) / 60_000)} min`
  const windows: Partial<Record<'credits' | 'monthly', QuotaWindow>> = {
    credits: {
      usedPercent: usedPercent(left, usage.dailyLimit),
      resetAt: usage.resetAt,
      valueLabel: `Today ${hoursMinutes(left)} left of ${hours(usage.dailyLimit)} h${runningLabel}`,
    },
  }
  if (usage.monthly !== undefined) {
    windows.monthly = {
      usedPercent: usedPercent(usage.monthly.remaining, usage.monthly.limit),
      resetAt: null,
      valueLabel: `${hours(usage.monthly.remaining)} of ${hours(usage.monthly.limit)} h left`,
    }
  }
  return windows
}

export function createFreebuffQuotaSource(options: FreebuffQuotaOptions): QuotaSource {
  const now = options.now ?? Date.now
  const timeZone = options.timeZone ?? (() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  const identity = { providerId: PROVIDER, providerName: NAME }
  let cached: { readonly at: number; readonly usage: Usage } | undefined

  const read = async (fetchImpl: typeof fetch): Promise<QuotaResult> => {
    const token = await options.readToken()
    if (token === undefined) {
      cached = undefined
      return { ...identity, configured: false, ok: false, error: options.unconfigured ?? 'Not configured' }
    }
    let usage = cached !== undefined && now() - cached.at < QUOTA_TTL_MS ? cached.usage : undefined
    if (usage === undefined) {
      const response = await fetchImpl(SESSION_URL, {
        headers: { Authorization: `Bearer ${token}`, 'x-fb-timezone': timeZone() },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!response.ok) {
        const rejected = response.status === 401 || response.status === 403 ? '; sign in to Freebuff again' : ''
        return { ...identity, configured: true, ok: false, error: `Freebuff usage API returned HTTP ${response.status}${rejected}` }
      }
      usage = parseUsage(await response.json())
      if (usage === undefined) return { ...identity, configured: true, ok: false, error: 'Freebuff usage response had no daily hours' }
      cached = { at: now(), usage }
    }
    return { ...identity, configured: true, ok: true, windows: quotaWindows(usage, now()), asOf: cached?.at ?? now() }
  }

  return {
    id: PROVIDER,
    name: NAME,
    configured: async () => {
      try { return (await options.readToken()) !== undefined } catch { return false }
    },
    fetch: async (fetchImpl) => {
      try {
        return await read(fetchImpl)
      } catch (error) {
        const message = error instanceof Error && error.message === READ_FAILED ? READ_FAILED : 'Freebuff usage request failed'
        return { ...identity, configured: true, ok: false, error: message }
      }
    },
  }
}
