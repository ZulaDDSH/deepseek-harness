
export const MAX_ERROR_BODY_BYTES = 64 * 1024
export const MAX_FILES_RESPONSE_BYTES = 8 * 1024 * 1024

export interface BoundedText {
  text: string
  truncated: boolean
}

export async function readBoundedText(response: Response, maxBytes: number): Promise<BoundedText> {
  const body = response.body
  if (body === null) return { text: '', truncated: false }
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await body.cancel().catch(() => {})
    return { text: '', truncated: true }
  }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let truncated = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const room = maxBytes - size
      if (value.byteLength > room) {
        chunks.push(value.subarray(0, room))
        truncated = true
        await reader.cancel().catch(() => {})
        break
      }
      chunks.push(value)
      size += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }
  return { text: Buffer.concat(chunks).toString('utf8'), truncated }
}
