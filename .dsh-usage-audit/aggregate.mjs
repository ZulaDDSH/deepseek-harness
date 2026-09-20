/**
 * Aggregate real token usage per session and per hour from DSH v3 session logs,
 * to explain the usage dashboard totals.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
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

const rows = []
const hourly = new Map()
let grand = { input: 0, cacheRead: 0, output: 0, total: 0, requests: 0 }

for (const file of collect(SESSIONS)) {
  const text = decode(file)
  const per = {
    id: file.split(/[\\/]/).slice(-2)[0],
    project: file.split(/[\\/]/).slice(-3)[0].replace(/^--|--$/g, '').replace(/-/g, '/'),
    input: 0, cacheRead: 0, output: 0, total: 0, requests: 0,
    first: null, last: null,
  }
  for (const line of text.split('\n')) {
    if (!line) continue
    let ev
    try { ev = JSON.parse(line) } catch { continue }
    if (typeof ev.time === 'number') {
      if (per.first === null || ev.time < per.first) per.first = ev.time
      if (per.last === null || ev.time > per.last) per.last = ev.time
    }
    // assistant/message carries the usage object at data.usage
    const u = ev?.data?.usage
    if (u && typeof u === 'object' && typeof u.inputTokens === 'number') {
      per.requests++
      per.input += u.inputTokens ?? 0
      per.cacheRead += u.cacheReadTokens ?? 0
      per.output += u.outputTokens ?? 0
      per.total += u.totalTokens ?? 0
      const hour = new Date(ev.time).toISOString().slice(0, 13)
      const h = hourly.get(hour) ?? { requests: 0, input: 0, cacheRead: 0, output: 0 }
      h.requests++
      h.input += u.inputTokens ?? 0
      h.cacheRead += u.cacheReadTokens ?? 0
      h.output += u.outputTokens ?? 0
      hourly.set(hour, h)
    }
  }
  grand.input += per.input
  grand.cacheRead += per.cacheRead
  grand.output += per.output
  grand.total += per.total
  grand.requests += per.requests
  rows.push(per)
}

const M = n => (n / 1e6).toFixed(1) + 'M'
const K = n => (n / 1e3).toFixed(1) + 'k'

console.log('=== per session (by requests) ===')
console.log('requests  input    cacheRead  output   session / project')
for (const r of rows.sort((a, b) => b.requests - a.requests)) {
  if (r.requests === 0) continue
  console.log(`${String(r.requests).padStart(8)}  ${M(r.input).padStart(7)}  ${M(r.cacheRead).padStart(9)}  ${K(r.output).padStart(7)}  ${r.id.slice(0, 40)}  [${r.project}]`)
}

console.log('\n=== GRAND TOTAL (all sessions on disk) ===')
console.log(`requests  : ${grand.requests.toLocaleString()}`)
console.log(`input     : ${grand.input.toLocaleString()} (${M(grand.input)})`)
console.log(`cacheRead : ${grand.cacheRead.toLocaleString()} (${M(grand.cacheRead)})`)
console.log(`output    : ${grand.output.toLocaleString()} (${K(grand.output)})`)
console.log(`total     : ${grand.total.toLocaleString()} (${M(grand.total)})`)

console.log('\n=== by hour (UTC) ===')
console.log('hour              requests   input     cacheRead   output')
for (const [h, v] of [...hourly].sort()) {
  console.log(`${h}  ${String(v.requests).padStart(8)}  ${M(v.input).padStart(8)}  ${M(v.cacheRead).padStart(10)}  ${K(v.output).padStart(8)}`)
}
