/**
 * Cordis profile-patch merging for the shared knowledge entry.
 *
 * The Desktop profile is composed as patches, so enabling a knowledge server
 * means appending one entry without disturbing whatever else the profile
 * already configures.
 */

export const KNOWLEDGE_ENTRY_ID = 'knowledge-shared'

/** Whether the profile patch already enables the shared knowledge entry. */
export function hasKnowledgeEntry(content) {
  return new RegExp(`(^|\\n)\\s*-?\\s*id:\\s*${KNOWLEDGE_ENTRY_ID}(\\s|$)`, 'u').test(content)
}

/** Whether the patch is only the loader's default empty list. */
function onlyDefaultEmptyList(content) {
  const semantic = content
    .split(/\r?\n/u)
    .map(line => line.replace(/#.*$/u, '').trim())
    .filter(Boolean)
  return semantic.length === 1 && semantic[0] === '[]'
}

/**
 * Build the MCP entry for one shared knowledge endpoint.
 * @param url - Streamable HTTP endpoint of the knowledge service.
 * @param tokenVariable - environment variable holding the bearer credential.
 * @returns the Cordis entry as YAML text.
 */
export function knowledgePatch(url, tokenVariable) {
  return `- insert:
    - id: ${KNOWLEDGE_ENTRY_ID}
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: knowledge
        transport: streamable-http
        url: ${JSON.stringify(url)}
        headerEnv:
          Authorization: ${JSON.stringify(tokenVariable)}
`
}

/**
 * Append the knowledge entry to an existing profile patch.
 * @param content - current patch text.
 * @param url - knowledge service endpoint.
 * @param tokenVariable - environment variable holding the credential.
 * @returns the merged patch text.
 */
export function mergeKnowledgePatch(content, url, tokenVariable) {
  if (hasKnowledgeEntry(content)) return content
  const entry = knowledgePatch(url, tokenVariable)
  if (content.trim() === '') return entry
  if (onlyDefaultEmptyList(content)) {
    return content.replace('[]', entry.trimEnd())
  }
  const separator = content.endsWith('\n') ? '' : '\n'
  return `${content}${separator}${entry}`
}
