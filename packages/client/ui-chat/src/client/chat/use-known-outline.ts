import { useEffect, useMemo, useRef, useState } from 'react'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { absorbOutline, oldestKnownSeq, type KnownOutline, type OutlineEntry } from './turn-rail-items.ts'
import type { OutlinePage } from '../contract/outline.ts'

interface Paging {
  readonly sessionId: string
  readonly known: KnownOutline
  cursor: number | undefined
  done: boolean
  inflight: boolean
  failedAt: number | null | undefined
}

export function useKnownOutline(
  sessionId: string,
  outline: unknown,
  firstSeq: number | null,
  hasMore: boolean,
  loadOutline: (beforeSeq: SessionSeq) => Promise<OutlinePage | null>,
): readonly OutlineEntry[] {
  const holder = useRef<Paging | null>(null)
  if (holder.current?.sessionId !== sessionId) {
    holder.current = { sessionId, known: new Map(), cursor: undefined, done: false, inflight: false, failedAt: undefined }
  }
  const paging = holder.current
  const [version, setVersion] = useState(0)
  const entries = useMemo(() => {
    absorbOutline(paging.known, outline)
    return [...paging.known.values()]
  }, [paging, outline, version])
  useEffect(() => {
    const target = paging.cursor ?? oldestKnownSeq(paging.known)
    if (paging.done || paging.inflight || !hasMore || target === undefined || firstSeq === null || firstSeq > target
      || paging.failedAt === firstSeq) return
    paging.inflight = true
    void loadOutline(SessionSeq(target)).then((page) => {
      paging.inflight = false
      if (holder.current !== paging) return
      if (page === null) {
        paging.failedAt = firstSeq
        return
      }
      absorbOutline(paging.known, page.entries)
      paging.done = !page.hasMore || page.before >= target
      paging.cursor = page.before
      setVersion(value => value + 1)
    })
  }, [paging, entries, firstSeq, hasMore, loadOutline])
  return entries
}
