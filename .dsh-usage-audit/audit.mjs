/**
 * Audit token usage across DSH v3 session logs. Each log is a sequence of
 * independently-compressed zstd frames; decode every frame, parse the JSONL
 * events, and aggregate model requests plus reported token usage per session.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const HOME = process.argv[2]
const SESSIONS = join(HOME, 'sessions')
const MAGIC = [0x28, 0xb5, 0x2f, 0xfd]

/** Recursively collect session log files. */
function collect(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collect(full))
    else if (entry.name.endsWith('.jsonl.zstd')) out.push(full)
  }
  return out
}

/** Decode every concatenated zstd frame in a session log to UTF-8 text. */
function decode(file) {
  const buf = readFileSync(file)
  const offsets = []
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf[i] === MAGIC[0] && buf[i + 1] === MAGIC[1] && buf[i + 2] === MAGIC[2] && buf[i + 3] === MAGIC[3]) offsets.push(i)
  }
  const parts = []
  for (let i = 0; i < offsets.length; i++) {
    const start = offsets[i]
    const end = i + 1 < offsets.length ? offsets[i + 1] : buf.length
    try { parts.push(zstdDecompressSync(buf.subarray(start, end))) } catch { /* partial trailing frame */ }
  }
  return Buffer.concat(parts).toString('utf8')
}

const typeCounts = new Map()
const usageShapes = new Map()
let sampleUsage = null
const sessions = []

for (const file of collect(SESSIONS)) {
  const text = decode(file)
  const lines = text.split('\n').filter(Boolean)
  const per = {
    id: file.split(/[\\/]/).slice(-2)[0],
    project: file.split(/[\\/]/).slice(-3)[0],
    bytes: statSync(file).size,
    events: lines.length,
    types: new Map(),
    firstTime: null,
    lastTime: null,
    turns: 0,
    steps: 0,
    usage: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, cost: 0 },
    usageEvents: 0,
    models: new Map(),
  }
  for (const line of lines) {
    let ev
    try { ev = JSON.parse(line) } catch { continue }
    const t = ev.type ?? '(none)'
    per.types.set(t, (per.types.get(t) ?? 0) + 1)
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1)
    if (typeof ev.time === 'number') {
      if (per.firstTime === null || ev.time < per.firstTime) per.firstTime = ev.time
      if (per.lastTime === null || ev.time > per.lastTime) per.lastTime = ev.time
    }
    if (t === 'turn/end') per.turns++
    if (t === 'step/end') per.steps++

    // Walk the event for usage-bearing objects.
    const stack = [ev]
    while (stack.length) {
      const node = stack.pop()
      if (!node || typeof node !== 'object') continue
      if (Array.isArray(node)) { for (const v of node) stack.push(v); continue }
      const keys = Object.keys(node)
      const usageKeys = keys.filter(k => /token|usage|cache|cost/i.test(k))
      if (usageKeys.length >= 2) {
        usageShapes.set(usageKeys.sort().join(','), (usageShapes.get(usageKeys.sort().join(',')) ?? 0) + 1)
        if (!sampleUsage) sampleUsage = { type: t, node: JSON.parse(JSON.stringify(node)) }
        per.usageEvents++
        const num = k => (typeof node[k] === 'number' ? node[k] : 0)
        per.usage.input += num('inputTokens') + num('promptTokens') + num('input_tokens')
        per.usage.cacheRead += num('cacheReadTokens') + num('cacheReadInputTokens') + num('cachedTokens')
        per.usage.cacheWrite += num('cacheWriteTokens') + num('cacheCreationInputTokens')
        per.usage.output += num('outputTokens') + num('completionTokens') + num('output_tokens')
        per.usage.reasoning += num('reasoningTokens')
        per.usage.cost += num('costUsd') + num('cost')
      }
      for (const k of keys) if (node[k] && typeof node[k] === 'object') stack.push(node[k])
    }
  }
  sessions.push(per)
}

console.log('=== event types (all sessions) ===')
for (const [t, n] of [...typeCounts].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`${String(n).padStart(8)}  ${t}`)

console.log('\n=== usage-like key shapes ===')
for (const [s, n] of [...usageShapes].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`${String(n).padStart(8)}  ${s}`)

console.log('\n=== sample usage object ===')
console.log(JSON.stringify(sampleUsage, null, 2)?.slice(0, 1500))

console.log('\n=== per-session ===')
const fmt = n => n.toLocaleString('en-US')
for (const s of sessions.sort((a, b) => b.events - a.events)) {
  const dur = s.firstTime && s.lastTime ? ((s.lastTime - s.firstTime) / 60000).toFixed(0) + 'm' : '?'
  console.log(`${s.id.slice(0, 42).padEnd(44)} ev=${String(s.events).padStart(5)} turns=${String(s.turns).padStart(4)} steps=${String(s.steps).padStart(4)} dur=${dur.padStart(5)} usageEv=${String(s.usageEvents).padStart(5)}`)
}
