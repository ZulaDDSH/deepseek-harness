/**
 * Deterministic MCP knowledge server over stdio for the knowledge-router
 * real-composition test.
 *
 * It stands in for the two external providers the router dispatches through:
 * `query` answers like a code-intelligence provider and `query_graph` answers
 * like a learned-knowledge provider, including the per-node lesson annotation
 * the router reads for freshness. Both echo their bound arguments so the test
 * can prove the router applied its configured limits.
 *
 * Run: node knowledge-server.ts
 */

import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'

serveStdio(() => {
  const server = new McpServer({ name: 'knowledge-fixture', version: '1.0.0' })

  server.registerTool('query', {
    title: 'Code intelligence query',
    description: 'Answers a structural question about the indexed code.',
    inputSchema: z.object({
      search_query: z.string(),
      limit: z.number().optional(),
      max_symbols: z.number().optional(),
    }),
  }, async args => ({
    content: [{
      type: 'text',
      text: `CODE for "${args.search_query}" limit=${String(args.limit)} symbols=${String(args.max_symbols)}`,
    }],
  }))

  server.registerTool('query_graph', {
    title: 'Learned knowledge query',
    description: 'Answers a question from persisted learned knowledge.',
    inputSchema: z.object({
      question: z.string(),
      depth: z.number().optional(),
      token_budget: z.number().optional(),
    }),
  }, async args => ({
    content: [{
      type: 'text',
      text: 'NODE close learning=preferred\n'
        + 'NODE teardown learning=contested:stale\n'
        + `LESSON for "${args.question}" depth=${String(args.depth)} budget=${String(args.token_budget)}`,
    }],
  }))

  return server
})
