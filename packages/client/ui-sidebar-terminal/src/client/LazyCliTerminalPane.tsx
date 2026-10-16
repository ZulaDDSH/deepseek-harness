import { lazy, Suspense, type ReactNode } from 'react'
import type { CliTerminalPaneProps } from './CliTerminalPane.tsx'

const LoadedCliTerminalPane = lazy(async () => ({ default: (await import('./terminal.tsx')).CliTerminalPane }))

/**
 * Suspend while the terminal chunk, which also carries the CLI pane, arrives.
 * @param props - CLI terminal pane props supplied by the conversation slot.
 * @returns the deferred CLI terminal pane.
 */
export function LazyCliTerminalPane(props: CliTerminalPaneProps): ReactNode {
  return <Suspense fallback={null}><LoadedCliTerminalPane {...props} /></Suspense>
}
