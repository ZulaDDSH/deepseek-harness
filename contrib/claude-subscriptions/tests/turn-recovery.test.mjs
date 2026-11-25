import assert from 'node:assert/strict'
import {existsSync} from 'node:fs'
import {test} from 'node:test'

const bridge = new URL('../bridge/', import.meta.url)

test('Claude retries overloads and empty tool stops without retrying unknown outcomes', {
  skip: !existsSync(new URL('adapter.js', bridge)),
}, async () => {
  const {ClaudeCodeAdapter} = await import(new URL('adapter.js', bridge))
  const {eventsFromResult} = await import(new URL('sdk-events.js', bridge))
  const {translateTurn} = await import(new URL('stream.js', bridge))
  const policy = new ClaudeCodeAdapter({}).providerRetryPolicy('claude-code-session')
  assert.equal(policy.mode, 'normal')
  assert.equal(policy.maxRetries, 3)
  assert.ok(policy.initialDelayMs > 0)

  const input = {nativeToDsh: new Map(), dshNames: new Set(), allowedNativeTools: new Set()}
  const context = {messageId: 'assistant', stopSent: false}
  const overload = eventsFromResult({
    subtype: 'error_during_execution', is_error: true, api_error_status: 529,
  }, context)
  assert.equal(overload[0].failure.status, 529)
  assert.throws(() => translateTurn(overload, input), {code: 'SERVER'})
  assert.ok(policy.retryableCodes.includes('SERVER'))

  const usage = {type: 'usage', inputTokens: 5, outputTokens: 0}
  const toolStop = {type: 'message-stop', messageId: 'assistant', stopReason: 'tool_use'}
  const noCallCode = 'NATIVE_TOOL_STOP_WITHOUT_CALLS'
  assert.throws(() => translateTurn([usage, toolStop], input), {code: noCallCode})
  assert.ok(policy.retryableCodes.includes(noCallCode))
  assert.throws(() => translateTurn([usage, usage, toolStop], input), {code: 'MALFORMED_RESPONSE'})
  for (const code of ['MALFORMED_RESPONSE', 'NATIVE_OUTCOME_UNKNOWN', 'AUTH', 'ACCOUNT_QUOTA']) {
    assert.ok(!policy.retryableCodes.includes(code), code)
  }
})
