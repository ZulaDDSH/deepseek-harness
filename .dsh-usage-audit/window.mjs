/**
 * Find the sliding window that best matches the dashboard figures
 * (997 requests, 1.7M input, 271.9M cache read, 317.8k output) and report
 * per-session concurrency, to identify what drove the reported usage.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const HOME = process.argv[2]
const SESSIONS = join(HOME, 'sessions')
const MAGIC = [0x28, 0xb5, 0x2f, 0xfd]

function collect(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collect(full))
    else if (entry.name.endsWith('.jsonl.zstd')) out.push(full)
  }
  return out
}

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
    try { parts.push(zstdDecompressSync(buf.subarray(start, end))) } catch { /* partial frame */ }
  }
  return Buffer.concat(parts).toString('utf8')
}

// Collect every request with its timestamp, session, and tokens.
const requests = []
for (const file of collect(SESSIONS)) {
  const id = file.split(/[\\/]/).slice(-2)[0]
  const project = file.split(/[\\/]/).slice(-3)[0].replace(/^--|--$/g, '')
  for (const line of decode(file).split('\n')) {
    if (!line) continue
    let ev
    try { ev = JSON.parse(line) } catch { continue }
    const u = ev?.data?.usage
    if (u && typeof u.inputTokens === 'number' && typeof ev.time === 'number') {
      requests.push({
        time: ev.time, id, project,
        input: u.inputTokens ?? 0,
        cacheRead: u.cacheReadTokens ?? 0,
        output: u.outputTokens ?? 0,
      })
    }
  }
}
requests.sort((a, b) => a.time - b.time)
console.log(`total requests parsed: ${requests.length}`)
console.log(`range: ${new Date(requests[0].time).toISOString()} .. ${new Date(requests.at(-1).time).toISOString()}`)

// Slide a 60-minute window and find the best match to the dashboard figures.
const TARGET = { requests: 997, input: 1.7e6, cacheRead: 271.9e6, output: 317.8e3 }
let best = null
for (let i = 0; i < requests.length; i++) {
  const start = requests[i].time
  const end = start + 3600_000
  let j = i
  const acc = { requests: 0, input: 0, cacheRead: 0, output: 0 }
  const byId = new Map()
  while (j < requests.length && requests[j].time < end) {
    const r = requests[j]
    acc.requests++
    acc.input += r.input
    acc.cacheRead += r.cacheRead
    acc.output += r.output
    byId.set(r.id, (byId.get(r.id) ?? 0) + 1)
    j++
  }
  const score = Math.abs(acc.requests - TARGET.requests) / TARGET.requests
    + Math.abs(acc.cacheRead - TARGET.cacheRead) / TARGET.cacheRead
  if (!best || score < best.score) best = { start, acc, byId, score }
}

const M = n => (n / 1e6).toFixed(1) + 'M'
const K = n => (n / 1e3).toFixed(1) + 'k'
console.log(`\n=== best-matching 60-minute window ===`)
console.log(`window: ${new Date(best.start).toISOString()} .. ${new Date(best.start + 3600_000).toISOString()}`)
console.log(`requests  : ${best.acc.requests}   (dashboard 997)`)
console.log(`input     : ${M(best.acc.input)}   (dashboard 1.7M)`)
console.log(`cacheRead : ${M(best.acc.cacheRead)}   (dashboard 271.9M)`)
console.log(`output    : ${K(best.acc.output)}   (dashboard 317.8k)`)
console.log(`\nsessions active in that window:`)
for (const [id, n] of [...best.byId].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)} requests  ${id}`)

// Concurrency: how many distinct sessions had a request in each 5-minute bucket.
console.log(`\n=== distinct sessions active per 5-minute bucket (peak hours) ===`)
const buckets = new Map()
for (const r of requests) {
  const b = Math.floor(r.time / 300_000) * 300_000
  if (!buckets.has(b)) buckets.set(b, new Set())
  buckets.get(b).add(r.id)
}
const busy = [...buckets].map(([b, s]) => ({ b, n: s.size })).sort((a, b) => b.n - a.n).slice(0, 12)
for (const { b, n } of busy) console.log(`  ${new Date(b).toISOString()}  ${n} concurrent sessions`)
