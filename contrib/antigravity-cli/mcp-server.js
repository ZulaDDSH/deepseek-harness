import {createHash, randomBytes, randomUUID, timingSafeEqual} from 'node:crypto'
import http from 'node:http'

function encodeToolName(name) {
  const encoded = [...name].map(ch => (/[A-Za-z0-9_-]/.test(ch) ? ch : `_${ch.codePointAt(0)?.toString(16) ?? '0'}_`)).join('')
  return `dsh__${encoded}`
}

function normalizeSchema(parameters) {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    return {type: 'object', properties: {}}
  }
  const copy = JSON.parse(JSON.stringify(parameters))
  if (!copy.type) copy.type = 'object'
  return copy
}

export function mapTools(tools = []) {
  const dshToMcp = new Map()
  const mcpToDsh = new Map()
  const declaredProps = new Map()
  const definitions = []
  for (const tool of tools) {
    if (!tool?.name || typeof tool.name !== 'string') continue
    let mcpName = encodeToolName(tool.name)
    if (mcpName.length > 56) {
      const digest = createHash('sha256').update(tool.name).digest('hex').slice(0, 10)
      mcpName = `${mcpName.slice(0, 45)}_${digest}`
    }
    if (dshToMcp.has(tool.name) || mcpToDsh.has(mcpName)) continue
    const inputSchema = normalizeSchema(tool.parameters)
    dshToMcp.set(tool.name, mcpName)
    mcpToDsh.set(mcpName, tool.name)
    declaredProps.set(mcpName, new Set(Object.keys(inputSchema.properties || {})))
    definitions.push({
      name: mcpName,
      description: String(tool.description || tool.name),
      inputSchema,
    })
  }
  return {dshToMcp, mcpToDsh, declaredProps, definitions}
}

export function toolsFingerprint(tools = []) {
  const stable = tools.map(t => ({name: t.name, description: t.description, parameters: t.parameters}))
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex')
}

function authorized(headerValue, expectedBytes) {
  if (typeof headerValue !== 'string') return false
  const actual = Buffer.from(headerValue, 'utf8')
  return actual.length === expectedBytes.length && timingSafeEqual(actual, expectedBytes)
}

/**
 * Per-session authenticated loopback Streamable-HTTP MCP server.
 * Parks incoming `tools/call` HTTP requests so DeepSeek Harness executes each tool
 * under its own permission system and feeds the result back into the live ACP turn.
 */
export async function createMcpBridgeServer(tools, onToolCall) {
  const mapped = mapTools(tools)
  const token = randomBytes(24).toString('hex')
  const expectedAuth = Buffer.from(`Bearer ${token}`, 'utf8')
  const parked = new Map()

  const server = http.createServer((req, res) => {
    res.setTimeout(0)
    if (req.method === 'GET' && req.url?.startsWith('/.well-known/')) {
      res.writeHead(404)
      res.end()
      return
    }
    if (!authorized(req.headers.authorization, expectedAuth)) {
      res.writeHead(401, {'content-type': 'application/json'})
      res.end(JSON.stringify({error: 'unauthorized'}))
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    let body = ''
    let overflow = false
    req.setEncoding('utf8')
    req.on('data', chunk => {
      body += chunk
      if (body.length > 8_000_000) {
        overflow = true
        res.writeHead(413)
        res.end()
        req.destroy()
      }
    })
    req.on('end', () => {
      if (overflow) return
      let msg
      try { msg = JSON.parse(body) } catch {
        res.writeHead(400, {'content-type': 'application/json'})
        res.end(JSON.stringify({jsonrpc: '2.0', id: null, error: {code: -32700, message: 'Parse error'}}))
        return
      }
      if (msg.method === 'initialize') {
        res.writeHead(200, {'content-type': 'application/json'})
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: {tools: {}},
            serverInfo: {name: 'deepseek-harness', version: '2.0.0'},
          },
        }))
        return
      }
      if (msg.method === 'notifications/initialized' || msg.method?.startsWith('notifications/')) {
        res.writeHead(202)
        res.end()
        return
      }
      if (msg.method === 'tools/list') {
        res.writeHead(200, {'content-type': 'application/json'})
        res.end(JSON.stringify({jsonrpc: '2.0', id: msg.id, result: {tools: mapped.definitions}}))
        return
      }
      if (msg.method === 'tools/call') {
        const mcpName = msg.params?.name
        const dshName = mapped.mcpToDsh.get(mcpName)
        if (!dshName) {
          res.writeHead(200, {'content-type': 'application/json'})
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: {content: [{type: 'text', text: `Unknown Harness tool: ${mcpName}`}], isError: true},
          }))
          return
        }
        const rawArgs = msg.params?.arguments && typeof msg.params.arguments === 'object' && !Array.isArray(msg.params.arguments)
          ? {...msg.params.arguments}
          : {}
        // Strip Antigravity's synthetic toolSummary field unless the Harness tool explicitly declares it.
        const allowedProps = mapped.declaredProps.get(mcpName)
        if ('toolSummary' in rawArgs && !allowedProps?.has('toolSummary')) {
          delete rawArgs.toolSummary
        }
        const callId = randomUUID()
        const entry = {
          callId,
          mcpId: msg.id,
          dshName,
          mcpName,
          argumentsJson: JSON.stringify(rawArgs),
          res,
          settled: false,
          disconnected: false,
        }
        parked.set(callId, entry)
        res.on('close', () => {
          if (!entry.settled) {
            entry.disconnected = true
            parked.delete(callId)
          }
        })
        onToolCall(entry)
        return
      }
      res.writeHead(200, {'content-type': 'application/json'})
      res.end(JSON.stringify({jsonrpc: '2.0', id: msg.id ?? null, result: {}}))
    })
  })

  server.requestTimeout = 0
  server.headersTimeout = 0
  server.keepAliveTimeout = 0

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })

  const {port} = server.address()
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    headers: [{name: 'Authorization', value: `Bearer ${token}`}],
    mcpConfig: {
      type: 'http',
      name: 'dsh',
      url: `http://127.0.0.1:${port}/mcp`,
      headers: [{name: 'Authorization', value: `Bearer ${token}`}],
    },
    isParked(callId) {
      const entry = parked.get(callId)
      return Boolean(entry && !entry.settled && !entry.disconnected)
    },
    answer(callId, {content, isError = false}) {
      const entry = parked.get(callId)
      if (!entry || entry.settled || entry.disconnected) return false
      entry.settled = true
      parked.delete(callId)
      try {
        entry.res.writeHead(200, {'content-type': 'application/json'})
        entry.res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: entry.mcpId,
          result: {content: content.length ? content : [{type: 'text', text: ''}], isError: Boolean(isError)},
        }))
        return true
      } catch {
        return false
      }
    },
    rejectAll(message) {
      for (const entry of parked.values()) {
        if (entry.settled || entry.disconnected) continue
        entry.settled = true
        try {
          entry.res.writeHead(200, {'content-type': 'application/json'})
          entry.res.end(JSON.stringify({
            jsonrpc: '2.0',
            id: entry.mcpId,
            result: {content: [{type: 'text', text: message}], isError: true},
          }))
        } catch {}
      }
      parked.clear()
    },
    close() {
      this.rejectAll('Session closed.')
      return new Promise(resolve => server.close(() => resolve()))
    },
  }
}
