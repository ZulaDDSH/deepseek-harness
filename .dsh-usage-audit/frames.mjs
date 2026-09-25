/**
 * Decode a DSH v3 session log that may contain multiple concatenated zstd
 * frames, then report the event stream: types, model requests, and usage.
 */
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const file = process.argv[2]
const buf = readFileSync(file)

// zstd magic: 28 B5 2F FD. Split the buffer into concatenated frames.
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const offsets = []
for (let i = 0; i + 4 <= buf.length; i++) {
  if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) offsets.push(i)
}
console.log(`file=${buf.length}B  zstd-magic-occurrences=${offsets.length}`)

// Try decoding the whole buffer first.
try {
  const whole = zstdDecompressSync(buf)
  console.log(`whole-buffer decode: ${whole.length}B`)
} catch (error) {
  console.log(`whole-buffer decode failed: ${error.message}`)
}

// Decode frame-by-frame using the streaming decompressor over the raw buffer.
import { createZstdDecompress } from 'node:zlib'
const chunks = []
const dec = createZstdDecompress()
dec.on('data', c => chunks.push(c))
await new Promise((resolve, reject) => {
  dec.on('end', resolve)
  dec.on('error', reject)
  dec.end(buf)
})
const text = Buffer.concat(chunks).toString('utf8')
console.log(`stream decode: ${text.length}B, lines=${text.split('\n').filter(Boolean).length}`)
console.log('first 200:', JSON.stringify(text.slice(0, 200)))
console.log('last 200:', JSON.stringify(text.slice(-200)))
