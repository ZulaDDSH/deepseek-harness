export const MEMORY_ENTRY_ID = 'memory-memorix'

export function hasMemorixEntry(content) {
  return new RegExp(`(^|\\n)\\s*-?\\s*id:\\s*${MEMORY_ENTRY_ID}(\\s|$)`, 'u').test(content)
}

function onlyDefaultEmptyList(content) {
  const semantic = content
    .split(/\r?\n/u)
    .map(line => line.replace(/#.*$/u, '').trim())
    .filter(Boolean)
  return semantic.length === 1 && semantic[0] === '[]'
}

export function memorixPatch(cliPath) {
  return `- insert:
    - id: ${MEMORY_ENTRY_ID}
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: memorix
        transport: stdio
        command: !!js process.execPath
        args:
          - ${JSON.stringify(cliPath)}
          - serve
          - --mode
          - lite
        env:
          ELECTRON_RUN_AS_NODE: "1"
          MEMORIX_SQLITE_DRIVER: "node"
        cwd: !!js process.cwd()
`
}

export function mergeMemorixPatch(content, cliPath) {
  if (hasMemorixEntry(content)) return content
  const entry = memorixPatch(cliPath)
  if (content.trim() === '') return entry
  if (onlyDefaultEmptyList(content)) {
    return content.replace('[]', entry.trimEnd())
  }
  const separator = content.endsWith('\n') ? '' : '\n'
  return `${content}${separator}${entry}`
}
