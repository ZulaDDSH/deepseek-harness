/**
 * What the `workspace-changes` tab type IS: the right-Sidebar review of one
 * Workspace's whole Git working tree, showing every changed file and the
 * selected file's comparison.
 *
 * A page type: it views the Workspace's current state rather than one
 * addressable resource, so it is opened by kind and its guide entry is the
 * single way in.
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { NS } from './locales.ts'

/** The tab kind this package owns. */
export const WORKSPACE_CHANGES_KIND = 'workspace-changes'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const WORKSPACE_CHANGES_ID = '@deepseek-ai/dsh-client-ui-deliverables/workspace-changes'

/**
 * The workspace-review type's registry definition.
 * @param t - namespace-bound translate, read fresh on every title call.
 * @returns the definition to register.
 */
export function workspaceChangesDefinition(t: TranslateNS<typeof NS>): SidebarRightTabDefinition {
  return {
    id: WORKSPACE_CHANGES_ID,
    kind: WORKSPACE_CHANGES_KIND,
    priority: 'builtin',
    title: () => t('source.title'),
    guide: [{
      id: WORKSPACE_CHANGES_KIND,
      order: 10,
      title: () => t('source.title'),
      description: () => t('source.subtitle'),
    }],
  }
}
