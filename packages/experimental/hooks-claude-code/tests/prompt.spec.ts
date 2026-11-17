import { describe, expect, it } from 'vitest'
import { parseVerdict, promptRequestText, verdictOutput, type PromptVerdict } from '@deepseek-ai/dsh-hooks-claude-code/src/prompt.ts'

describe('promptRequestText', () => {
  it('appends the hook input JSON after a prompt that has no $ARGUMENTS token', () => {
    expect(promptRequestText('Is this safe?', { tool_name: 'Write' })).toBe('Is this safe?\n\n{"tool_name":"Write"}')
  })

  it('replaces every $ARGUMENTS token with the hook input JSON', () => {
    expect(promptRequestText('a $ARGUMENTS b $ARGUMENTS', { n: 1 })).toBe('a {"n":1} b {"n":1}')
  })
})

describe('parseVerdict', () => {
  it('reads an allow reply', () => {
    expect(parseVerdict('{"ok": true}')).toEqual({ ok: true })
  })

  it('reads a block reply, keeping its reason and defaulting impossible to false', () => {
    expect(parseVerdict('{"ok": false, "reason": "no rm -rf"}')).toEqual({ ok: false, reason: 'no rm -rf', impossible: false })
    expect(parseVerdict('{"ok": false}')).toEqual({ ok: false, impossible: false })
  })

  it('treats impossible as set only when it is literally true', () => {
    expect(parseVerdict('{"ok": false, "impossible": true}')).toEqual({ ok: false, impossible: true })
    expect(parseVerdict('{"ok": false, "impossible": "yes"}')).toEqual({ ok: false, impossible: false })
  })

  it('drops a reason that is not a string', () => {
    expect(parseVerdict('{"ok": false, "reason": 5}')).toEqual({ ok: false, impossible: false })
  })

  it('reads the first JSON object in prose, ignoring braces and escaped quotes inside strings', () => {
    expect(parseVerdict('Sure. {"ok": false, "reason": "uses {braces} and \\"quotes\\""} Thanks {x}'))
      .toEqual({ ok: false, reason: 'uses {braces} and "quotes"', impossible: false })
  })

  it('reads past nested objects to the matching close brace', () => {
    expect(parseVerdict('{"ok": true, "meta": {"a": {"b": 1}}}')).toEqual({ ok: true })
  })

  it('throws on a reply with no JSON object, an unterminated one, or a non-boolean ok', () => {
    expect(() => parseVerdict('no json here')).toThrow('prompt hook reply has no JSON object')
    expect(() => parseVerdict('{"ok": true')).toThrow('prompt hook reply has an unterminated JSON object')
    expect(() => parseVerdict('{"ok": "yes"}')).toThrow('prompt hook reply has no boolean "ok"')
  })
})

describe('verdictOutput', () => {
  const block: PromptVerdict = { ok: false, reason: 'no', impossible: false }
  const denied = { exitCode: undefined, stderr: 'no', stdout: '', decision: 'deny', reason: 'no' }

  it('passes an allow through as an empty output', () => {
    expect(verdictOutput('PreToolUse', { prompt: 'p' }, { ok: true })).toEqual({ exitCode: undefined, stderr: '', stdout: '' })
  })

  it('ends the turn for a block on UserPromptSubmit, PreToolUse, and PostToolUse by default', () => {
    for (const point of ['UserPromptSubmit', 'PreToolUse', 'PostToolUse']) {
      expect(verdictOutput(point, { prompt: 'p' }, block)).toEqual({ ...denied, continue: false, stopReason: 'no' })
    }
  })

  it('keeps a PreToolUse or PostToolUse block to a deny when continueOnBlock is set', () => {
    for (const point of ['PreToolUse', 'PostToolUse']) {
      expect(verdictOutput(point, { prompt: 'p', continueOnBlock: true }, block)).toEqual(denied)
    }
  })

  it('ends the turn for a Stop block only when the verdict is impossible', () => {
    expect(verdictOutput('Stop', { prompt: 'p' }, { ok: false, reason: 'no', impossible: true }))
      .toEqual({ ...denied, continue: false, stopReason: 'no' })
    expect(verdictOutput('Stop', { prompt: 'p' }, block)).toEqual(denied)
  })

  it('never ends the turn for subagent events', () => {
    expect(verdictOutput('SubagentStop', { prompt: 'p' }, { ok: false, reason: 'no', impossible: true })).toEqual(denied)
    expect(verdictOutput('SubagentStart', { prompt: 'p' }, block)).toEqual(denied)
  })

  it('names the event in the reason when the model gives none', () => {
    expect(verdictOutput('PostToolUse', { prompt: 'p', continueOnBlock: true }, { ok: false, impossible: false })).toEqual({
      exitCode: undefined,
      stderr: 'blocked by PostToolUse prompt hook',
      stdout: '',
      decision: 'deny',
      reason: 'blocked by PostToolUse prompt hook',
    })
  })
})
