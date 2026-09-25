/**
 * Decode a DSH v3 session log stored as independently-compressed concatenated
 * zstd frames: locate every frame magic, decode each frame on its own, and
 * concatenate the decoded JSONL text.
 */
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const file = process.argv[2]
const buf = readFileSync(file)

const offsets = []
for (let i = 0; i + 4 <= buf.length; i++) {
  if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) offsets.push(i)
}
console.log(`file=${buf.length}B frames=${offsets.length}`)

const parts = []
let ok = 0
let fail = 0
for (let i = 0; i < offsets.length; i++) {
  const start = offsets[i]
  const end = i + 1 < offsets.length ? offsets[i + 1] : buf.length
  try {
    parts.push(zstdDecompressSync(buf.subarray(start, end)))
    ok++
  } catch {
    fail++
  }
}
console.log(`decoded frames ok=${ok} fail=${fail}`)
const text = Buffer.concat(parts).toString('utf8')
const lines = text.split('\n').filter(Boolean)
console.log(`total text=${text.length}B lines=${lines.length}`)
console.log('first 300:', JSON.stringify(text.slice(0, 300)))
console.log('last 300:', JSON.stringify(text.slice(-300)))
