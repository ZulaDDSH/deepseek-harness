/**
 * Transport factory: creates the appropriate MCP transport based on the
 * plugin's resolved config. Stdio spawns a child process (with credential
 * scrubbing); Streamable HTTP connects to a URL.
 *
 * @module
 */

import type { AuthProvider, Transport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type { Config } from './index.ts'

/**
 * The subprocess seam's scrubbed parent env (credential-shaped and stale
 * `DSH_*` names dropped), plus the spec's explicit env. The MCP SDK owns the
 * actual spawn, so this transport shares the scrub definition rather than the
 * spawn path.
 */
export function buildChildEnv(extra: Record<string, string>): Record<string, string> {
  return { ...scrubbedParentEnv(), ...extra }
}

export interface HttpHeaderConfig {
  headers?: Record<string, string>
  headerEnv?: Record<string, string>
}

export function resolveHttpHeaders(config: HttpHeaderConfig, required = false): Record<string, string> {
  const resolved = { ...config.headers }
  for (const [header, variable] of Object.entries(config.headerEnv ?? {})) {
    if (config.headers?.[header] !== undefined) continue
    const value = process.env[variable]
    if (value === undefined || value === '') {
      if (required) throw new Error(`streamable-http header "${header}" reads environment variable "${variable}", which is unset or empty`)
      continue
    }
    resolved[header] = value
  }
  return resolved
}

/**
 * Create an MCP transport from the resolved plugin config.
 *
 * @param config - Resolved plugin config discriminated on `transport`.
 * @returns an unstarted MCP transport (stdio or Streamable HTTP).
 */
export function createTransport(config: Config, authProvider?: AuthProvider, environment?: Record<string, string>): Transport {
  switch (config.transport) {
    case 'stdio':
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: environment ?? buildChildEnv(config.env),
        cwd: config.cwd,
      })
    case 'streamable-http':
      return new StreamableHTTPClientTransport(
        new URL(config.url),
        {
          requestInit: { headers: resolveHttpHeaders(config, true) },
          ...authProvider === undefined ? {} : { authProvider },
        },
      )
  }
}
