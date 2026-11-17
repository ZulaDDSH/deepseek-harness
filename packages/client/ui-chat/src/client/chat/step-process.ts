/** Localized titles for projected step-process activity. */
import type { ChatViewSlotProps } from '../contract/slots.ts'
import type { ProcessActivitySummary } from '../contract/process-groups.ts'

type ProcessCount = ProcessActivitySummary['counts'][number]

function singleFileLabel(kind: ProcessCount['kind'], name: string, t: ChatViewSlotProps['t']): string | undefined {
  switch (kind) {
    case 'read': return t('message.stepProcess.file.read', { name })
    case 'readImage': return t('message.stepProcess.file.readImage', { name })
    case 'write': return t('message.stepProcess.file.write', { name })
    case 'edit': return t('message.stepProcess.file.edit', { name })
    default: return undefined
  }
}

function countLabel({ kind, count, targets }: ProcessCount, t: ChatViewSlotProps['t']): string {
  const [target] = targets
  if (targets.length === 1 && target !== undefined) {
    const single = singleFileLabel(kind, target, t)
    if (single !== undefined) return single
  }
  const shown = targets.length > 1 ? targets.length : count
  return shown === 1
    ? t(`message.stepProcess.done.${kind}`)
    : t(`message.stepProcess.many.${kind}`, { count: shown })
}

/**
 * Compose a closed group's localized title from its top three categories, naming a lone file and counting the rest.
 * @param summary - ranked work and phase evidence for this range.
 * @param t - Chat namespace translator.
 * @returns the secondary disclosure title.
 */
export function processTitle(
  summary: ProcessActivitySummary,
  t: ChatViewSlotProps['t'],
): string {
  const labels = summary.counts.slice(0, 3).map(entry => countLabel(entry, t))
  const first = labels[0]
  if (first === undefined) return t('message.stepProcess.done.thinking')
  const continuation = (label: string): string => label.charAt(0).toLowerCase() + label.slice(1)
  const second = labels[1]
  if (second === undefined) return first
  if (labels.length === 2) {
    const prefix = t('message.stepProcess.sharedPrefix')
    const shared = prefix !== '' && first.startsWith(prefix) && second.startsWith(prefix)
    return t('message.stepProcess.joinTwo', { first, second: continuation(shared ? second.slice(prefix.length) : second) })
  }
  const title = [first, ...labels.slice(1).map(continuation)].join(t('message.stepProcess.comma'))
  return summary.counts.length > 3 ? t('message.stepProcess.more', { title }) : title
}
