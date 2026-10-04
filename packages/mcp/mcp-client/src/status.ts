export type McpConnectionState = 'connecting' | 'connected' | 'auth-required' | 'failed'

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
