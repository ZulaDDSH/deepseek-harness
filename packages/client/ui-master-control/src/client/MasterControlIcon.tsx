import type { ReactNode } from 'react'
import { IconAgentPresetOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

export function MasterControlIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <IconAgentPresetOutline16 size={size} />
}
