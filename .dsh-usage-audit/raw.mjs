/**
 * Inspect the decoded structure of a DSH v3 session log: header bytes, framing,
 * and the JSON member names of the first record.
 */
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const file = process.argv[2]
const buf = readFileSync(file)
const raw = file.endsWith('.zstd') ? zstdDecompressSync(buf) : buf
console.log(`compressed=${buf.length} decompressed=${raw.length}`)
console.log('first 64 bytes hex:', raw.subarray(0, 64).toString('hex'))
console.log('first 300 chars:', JSON.stringify(raw.subarray(0, 300).toString('utf8')))
console.log('newline count:', raw.toString('utf8').split('\n').length - 1)
console.log('last 200 chars:', JSON.stringify(raw.subarray(-200).toString('utf8')))
