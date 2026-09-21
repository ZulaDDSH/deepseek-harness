/**
 * Transport factory: creates the appropriate MCP transport based on the
 * plugin's resolved config. Stdio spawns a child process (with credential
 * scrubbing); Streamable HTTP connects to a URL.
 *
 * @module
 */

import type { Transport } from '@modelcontextprotocol/client'
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
function buildChildEnv(extra: Record<string, string>): Record<string, string> {
  return { ...scrubbedParentEnv(), ...extra }
}

/** Header values for a Streamable HTTP connection, literal or environment-sourced. */
export interface HttpHeaderConfig {
  /** Explicit header values; an entry here overrides the same name in `headerEnv`. */
  headers?: Record<string, string>
  /** Header name to environment variable name; the variable supplies the header value. */
  headerEnv?: Record<string, string>
}

/**
 * Resolve the request headers for a Streamable HTTP connection.
 *
 * `headerEnv` reads a credential from the process environment so a committed
 * `cordis.yml` names the variable instead of holding the value. A literal
 * `headers` entry for the same name wins, keeping an explicit deployment
 * override possible. A name whose variable is unset or empty is omitted rather
 * than sent as an empty credential.
 *
 * @param config - literal headers and the header-to-variable map.
 * @param options - `required` fails loudly when a named variable has no value.
 * @returns the resolved header map; callers must not log or serialize it.
 */
export function resolveHttpHeaders(
  config: HttpHeaderConfig,
  options: { required?: boolean } = {},
): Record<string, string> {
  const resolved: Record<string, string> = { ...config.headers }
  for (const [header, variable] of Object.entries(config.headerEnv ?? {})) {
    if (config.headers?.[header] !== undefined) continue
    const value = process.env[variable]
    if (value === undefined || value === '') {
      if (options.required === true) {
        throw new Error(`streamable-http header "${header}" reads environment variable "${variable}", which is unset or empty`)
      }
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
 * @returns A connected-ready MCP Transport (stdio or Streamable HTTP).
 */
export function createTransport(config: Config): Transport {
  switch (config.transport) {
    case 'stdio':
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: buildChildEnv(config.env),
        cwd: config.cwd,
      })
    case 'streamable-http':
      return new StreamableHTTPClientTransport(
        new URL(config.url),
        { requestInit: { headers: resolveHttpHeaders(config, { required: true }) } },
      )
  }
}
