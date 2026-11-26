import assert from 'node:assert/strict'
import test from 'node:test'
import {contextWindowFor, parseModelsOutput, projectListModels, projectResolvedModel, recordContextWindow, resolveWireModel} from './catalog.js'
import {createMcpBridgeServer, mapTools, toolsFingerprint} from './mcp-server.js'
import {buildPromptBlocks, buildSystemAppend, extractSystemPrompt, messageFingerprint, prependSystemPrompt, toMcpToolResult} from './prompt.js'

const SAMPLE_MODELS = [
  'Fetching available models...',
  'gemini-4-neon-high\tGemini 4 Neon (High)',
  'gemini-4-neon-xhigh\tGemini 4 Neon (XHigh)',
  'gemini-4-neon-medium\tGemini 4 Neon (Medium)',
  'gemini-4-neon-low\tGemini 4 Neon (Low)',
  'claude-opus-5-5-low\tClaude Opus 5.5 (Low)',
  'claude-opus-5-5-high\tClaude Opus 5.5 (High)',
  'gemini-pro-orchestrator-neon\tOrchestrator (Neon)',
  'gpt-oss-120b-medium\tGPT-OSS 120B (Medium)',
].join('\n')

test('catalog groups multi-effort models cleanly and preserves legacy IDs', () => {
  const catalog = parseModelsOutput(SAMPLE_MODELS)
  const listed = projectListModels('antigravity-cli', catalog)
  assert.deepEqual(listed.map(m => m.id), [
    'gemini-4-neon',
    'claude-opus-5-5',
    'gemini-pro-orchestrator-neon',
    'gpt-oss-120b-medium',
  ])
  assert.ok(listed.every(m => m.inputModalities.includes('image')))

  const resolvedNeon = projectResolvedModel('antigravity-cli', 'gemini-4-neon', catalog)
  assert.equal(resolvedNeon.name, 'Gemini 4 Neon')
  assert.deepEqual(resolvedNeon.reasoning.efforts.map(e => e.id), ['low', 'medium', 'high', 'xhigh'])
  assert.equal(resolvedNeon.reasoning.defaultEffort, 'high')
  assert.equal(resolvedNeon.context.contextWindow, 1_048_576)

  // Legacy suffixed ID still resolves and honors effort override
  const resolvedLegacy = projectResolvedModel('antigravity-cli', 'gemini-4-neon-low', catalog)
  assert.equal(resolvedLegacy.reasoning.defaultEffort, 'low')
  assert.equal(resolveWireModel('gemini-4-neon', 'xhigh', catalog), 'gemini-4-neon-xhigh')
  assert.equal(resolveWireModel('gemini-4-neon', undefined, catalog), 'gemini-4-neon-high')
  assert.equal(resolveWireModel('gemini-4-neon-low', undefined, catalog), 'gemini-4-neon-low')
  assert.equal(resolveWireModel('gemini-4-neon-low', 'high', catalog), 'gemini-4-neon-high')

  recordContextWindow('claude-opus-5-5-high', 200_000)
  assert.equal(contextWindowFor('claude-opus-5-5'), 200_000)
})

test('mcp-server enforces bearer auth, strips synthetic toolSummary, and parks/answers tool calls', async () => {
  let received
  const srv = await createMcpBridgeServer(
    [{name: 'read_file', description: 'Read a file.', parameters: {type: 'object', properties: {path: {type: 'string'}}, required: ['path']}}],
    entry => { received = entry },
  )
  try {
    // Unauthorized request rejected with 401
    const unauth = await fetch(srv.url, {method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'})
    assert.equal(unauth.status, 401)

    const authHeaders = {'content-type': 'application/json', Authorization: srv.headers[0].value}
    const listRes = await (await fetch(srv.url, {
      method: 'POST', headers: authHeaders, body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/list'}),
    })).json()
    assert.equal(listRes.result.tools.length, 1)
    assert.equal(listRes.result.tools[0].name, 'dsh__read_file')

    // Start parked tools/call with synthetic toolSummary field
    const callPromise = fetch(srv.url, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {name: 'dsh__read_file', arguments: {path: 'README.md', toolSummary: 'Read README'}},
      }),
    }).then(r => r.json())

    // Wait briefly for handler to park
    for (let i = 0; i < 40 && !received; i++) await new Promise(r => setTimeout(r, 10))
    assert.ok(received)
    assert.equal(received.dshName, 'read_file')
    assert.deepEqual(JSON.parse(received.argumentsJson), {path: 'README.md'})
    assert.equal(srv.isParked(received.callId), true)

    assert.equal(srv.answer(received.callId, {content: [{type: 'text', text: 'hello'}], isError: false}), true)
    const callJson = await callPromise
    assert.deepEqual(callJson.result, {content: [{type: 'text', text: 'hello'}], isError: false})
  } finally {
    await srv.close()
  }
})

test('prompt helpers preserve system prompt, images, and tool results', async () => {
  const sys = extractSystemPrompt({
    system: 'Top system',
    messages: [{role: 'system', content: [{type: 'text', text: 'Loop system'}]}],
  })
  assert.equal(sys, 'Top system\n\nLoop system')
  assert.ok(buildSystemAppend(true).includes('mcp_dsh_'))
  assert.ok(buildSystemAppend(true).length < 500)
  const withSys = prependSystemPrompt([{type: 'text', text: 'Hi'}], sys)
  assert.equal(withSys.length, 2)
  assert.ok(withSys[0].text.includes('Top system\n\nLoop system'))

  const fakeAttachments = {
    async readImage() { return {data: Buffer.from([1, 2, 3])} },
  }
  const blocks = await buildPromptBlocks(
    [{role: 'user', content: [{type: 'text', text: 'Look'}, {type: 'image', attachment: {attachmentId: 'a1', mediaType: 'image/png', name: 'x.png'}}]}],
    {attachments: fakeAttachments},
  )
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].type, 'text')
  assert.deepEqual(blocks[1], {type: 'image', data: Buffer.from([1, 2, 3]).toString('base64'), mimeType: 'image/png'})

  const toolRes = await toMcpToolResult(
    {role: 'tool', isError: true, content: [{type: 'text', text: 'failed'}, {type: 'image', attachment: {attachmentId: 'a2', mediaType: 'image/jpeg'}}]},
    fakeAttachments,
  )
  assert.equal(toolRes.isError, true)
  assert.equal(toolRes.content[1].mimeType, 'image/jpeg')

  assert.notEqual(
    messageFingerprint({role: 'user', content: [{type: 'text', text: 'a'}]}),
    messageFingerprint({role: 'user', content: [{type: 'text', text: 'b'}]}),
  )
  assert.equal(mapTools([{name: 'a.b', description: 'd', parameters: {type: 'object'}}]).definitions[0].name, 'dsh__a_2e_b')
  assert.notEqual(toolsFingerprint([{name: 'a'}]), toolsFingerprint([{name: 'b'}]))
})
