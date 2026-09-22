/** Sidebar entry icon for the global Source Control panel. */
import { IconCodeOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** Render the Source Control panel icon at the rail's requested size. */
export function SourceChangesPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>) {
  return <IconCodeOutline16 size={size} />
}
