import { describe, expect, it } from 'vitest'
import { liveToolDetail, normalizeLiveToolDetail } from '../src/index.ts'

describe('liveToolDetail', () => {
  it('takes the earliest recognised key in the shared order and skips empty values', () => {
    expect(liveToolDetail('bash', JSON.stringify({ command: 'ls', description: 'List files' }))).toBe('List files')
    expect(liveToolDetail('grep', '{"path":"src","command":"rg x"}')).toBe('rg x')
    expect(liveToolDetail('bash', '{"command":"  ","path":"a.ts"}')).toBe('a.ts')
  })

  it('flattens whitespace and joins string arrays', () => {
    expect(liveToolDetail('bash', JSON.stringify({ command: 'git  diff\n\t--cached ' }))).toBe('git diff --cached')
    expect(liveToolDetail('web_search', '{"queries":["a  b","c"]}')).toBe('a b, c')
  })

  it('bounds the detail to 160 graphemes, ending in an ellipsis when cut', () => {
    expect(liveToolDetail('read', JSON.stringify({ path: 'a'.repeat(160) }))).toBe('a'.repeat(160))
    expect(liveToolDetail('read', JSON.stringify({ path: 'a'.repeat(161) }))).toBe(`${'a'.repeat(159)}…`)
    expect(liveToolDetail('read', JSON.stringify({ path: '👍'.repeat(161) }))).toBe(`${'👍'.repeat(159)}…`)
    expect(liveToolDetail('read', JSON.stringify({ path: `${'a'.repeat(158)} ${'b'.repeat(50)}` }))).toBe(`${'a'.repeat(158)}…`)
  })

  it('reads questions from the first object that carries a question', () => {
    expect(liveToolDetail('ask_user_question', JSON.stringify({ questions: [null, 3, { question: '  Which  branch? ' }] })))
      .toBe('Which branch?')
    expect(liveToolDetail('ask_user_question', '{"questions":[{"header":"x"}]}')).toBe('ask_user_question')
  })

  it('falls back to the tool name when the arguments have no safe detail', () => {
    expect(liveToolDetail('bash', '{"command":')).toBe('bash')
    expect(liveToolDetail('bash', '"text"')).toBe('bash')
    expect(liveToolDetail('bash', 'null')).toBe('bash')
    expect(liveToolDetail('bash', '{"queries":["a",1]}')).toBe('bash')
    expect(liveToolDetail('todo_write', '{"items":[]}')).toBe('todo_write')
  })
})

describe('normalizeLiveToolDetail', () => {
  it('yields empty text for a value without text', () => {
    expect(normalizeLiveToolDetail(undefined)).toBe('')
  })
})
