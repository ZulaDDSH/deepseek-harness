/**
 * Audit DSH session logs in the desktop development home for token usage.
 * Reads zstd-compressed v3 JSONL session logs, counts model requests, and
 * aggregates usage fields found on request/response events.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const HOME = process.argv[2]
const SESSIONS = join(HOME, 'sessions')

/** Recursively collect session log files. */
function collect(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collect(full))
    else if (entry.name.endsWith('.jsonl.zstd') || entry.name.endsWith('.jsonl')) out.push(full)
  }
  return out
}

/** Decode a possibly-zstd-compressed log to UTF-8 text. */
function decode(file) {
  const buf = readFileSync(file)
  if (file.endsWith('.zstd')) return zstdDecompressSync(buf).toString('utf8')
  return buf.toString('utf8')
}

const files = collect(SESSIONS)
console.log(`decoded ${files.length} session logs\n`)

// Discover the set of event types and any usage-bearing keys.
const typeCounts = new Map()
const usageKeyShapes = new Map()
let sampleUsageEvent = null

const sessions = []

for (const file of files) {
  let text
  try {
    text = decode(file)
  } catch (error) {
    console.log(`DECODE FAIL ${file}: ${error.message}`)
    continue
  }
  const lines = text.split('\n').filter(Boolean)
  const per = {
    file,
    bytes: statSync(file).size,
    lines: lines.length,
    types: new Map(),
    requests: 0,
    tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 },
    firstTs: null,
    lastTs: null,
    sessionId: null,
    model: null,
  }
  for (const line of lines) {
    let ev
    try {
      ev = JSON.parse(line)
    } catch {
      continue
    }
    const t = ev.type ?? '(none)'
    per.types.set(t, (per.types.get(t) ?? 0) + 1)
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1)
    if (ev.timestamp) {
      const ts = typeof ev.timestamp === 'number' ? ev.timestamp : Date.parse(ev.timestamp)
      if (Number.isFinite(ts)) {
        if (per.firstTs === null || ts < per.firstTs) per.firstTs = ts
        if (per.lastTs === null || ts > per.lastTs) per.lastTs = ts
      }
    }
    if (t === 'session' && ev.id) per.sessionId = ev.id

    // Locate usage objects anywhere in the event.
    const stack = [ev]
    while (stack.length) {
      const node = stack.pop()
      if (!node || typeof node !== 'object') continue
      if (Array.isArray(node)) { for (const v of node) stack.push(v); continue }
      const keys = Object.keys(node)
      const usageLike = keys.filter(k => /token|usage|cache|cost/i.test(k))
      if (usageLike.length >= 2) {
        const shape = usageLike.sort().join(',')
        usageKeyShapes.set(shape, (usageKeyShapes.get(shape) ?? 0) + 1)
        if (!sampleUsageEvent) sampleUsageEvent = JSON.parse(JSON.stringify(node))
      }
      for (const k of keys) {
        if (node[k] && typeof node[k] === 'object') stack.push(node[k])
      }
    }
  }
  sessions.push(per)
}

console.log('=== event types (all sessions) ===')
for (const [t, n] of [...typeCounts].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(8)}  ${t}`)

console.log('\n=== usage-like key shapes ===')
for (const [s, n] of [...usageKeyShapes].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`${String(n).padStart(8)}  ${s}`)

console.log('\n=== sample usage object ===')
console.log(JSON.stringify(sampleUsageEvent, null, 2)?.slice(0, 2000))

console.log('\n=== per-session ===')
for (const s of sessions.sort((a, b) => b.lines - a.lines)) {
  console.log(`${String(s.lines).padStart(7)} lines  ${String(s.bytes).padStart(9)}B  ${s.sessionId ?? s.file.split(/[\\/]/).slice(-2)[0]}`)
}
