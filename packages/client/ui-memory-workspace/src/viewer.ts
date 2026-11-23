const POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:"
const LIBRARY = /<script\b[^>]*\bsrc\s*=\s*["']https:\/\/unpkg\.com\/vis-network@9\.1\.6\/[^"']*["'][^>]*>\s*<\/script>/gi

export async function offlineViewer(html: string): Promise<string> {
  const { default: library } = await import('./vendor/vis-network.ts')
  const inlined = html.replace(LIBRARY, () => `<script>${library}</script>`)
  const unmatched = /https?:\/\/unpkg\.com\/vis-network@[^"'\s>]*/i.exec(inlined.replaceAll(library, ''))
  if (unmatched !== null) {
    throw new Error(`Graphify's viewer loads ${unmatched[0]}, but this Host bundles only vis-network 9.1.6; update ui-memory-workspace to the Graphify release in use`)
  }
  const meta = `<meta http-equiv="Content-Security-Policy" content="${POLICY}">`
  const head = /<head\b[^>]*>/i.exec(inlined)
  return head === null ? meta + inlined : inlined.slice(0, head.index + head[0].length) + meta + inlined.slice(head.index + head[0].length)
}
