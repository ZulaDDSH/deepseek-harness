/** Connection state of one MCP server as shown to the user. */
export type McpConnectionState = 'connecting' | 'connected' | 'auth-required' | 'failed'

/** One server's answer to the `mcp-client/inventory` event. */
export interface McpConnectionReport {
  readonly serverName: string
  readonly state: McpConnectionState
  readonly toolCount: number
  readonly error?: string
  readonly authKey?: string
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A listener is asking for the connection state of the configured MCP servers; each server appends its report.
     * @mode emit
     * @param reports Collected reports, one per configured server.
     */
    'mcp-client/inventory'(reports: McpConnectionReport[]): void
  }
}
