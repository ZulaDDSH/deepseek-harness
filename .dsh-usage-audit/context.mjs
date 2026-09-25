/**
 * Characterize per-request context size and cache behaviour across sessions,
 * to explain why cache-read tokens dominate the usage dashboard.
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

console.log('session                                  reqs   avgCtx   maxCtx   cacheHit%  avgOut')
for (const file of collect(SESSIONS)) {
  const id = file.split(/[\\/]/).slice(-2)[0]
  const ctxs = []
  let out = 0
  let cacheRead = 0
  let input = 0
  for (const line of decode(file).split('\n')) {
    if (!line) continue
    let ev
    try { ev = JSON.parse(line) } catch { continue }
    const u = ev?.data?.usage
    if (u && typeof u.inputTokens === 'number') {
      const cr = u.cacheReadTokens ?? 0
      const inp = u.inputTokens ?? 0
      ctxs.push(cr + inp)
      cacheRead += cr
      input += inp
      out += u.outputTokens ?? 0
    }
  }
  if (!ctxs.length) continue
  const avg = ctxs.reduce((a, b) => a + b, 0) / ctxs.length
  const max = Math.max(...ctxs)
  const hit = cacheRead / (cacheRead + input) * 100
  console.log(`${id.slice(0, 40).padEnd(40)} ${String(ctxs.length).padStart(5)}  ${(avg / 1000).toFixed(1).padStart(7)}k ${(max / 1000).toFixed(1).padStart(7)}k  ${hit.toFixed(1).padStart(7)}%  ${(out / ctxs.length).toFixed(0).padStart(6)}`)
}
