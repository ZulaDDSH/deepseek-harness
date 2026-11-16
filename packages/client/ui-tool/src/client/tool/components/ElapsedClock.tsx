import { useEffect, useState } from 'react'
import css from './ElapsedClock.module.css'

const ELAPSED_TICK_MS = 1000

const tickListeners = new Set<(now: number) => void>()
let tickTimer: ReturnType<typeof setInterval> | undefined

function subscribeTick(listener: (now: number) => void): () => void {
  tickListeners.add(listener)
  tickTimer ??= setInterval(() => {
    const now = Date.now()
    for (const notify of tickListeners) notify(now)
  }, ELAPSED_TICK_MS)
  return () => {
    tickListeners.delete(listener)
    if (tickListeners.size > 0) return
    clearInterval(tickTimer)
    tickTimer = undefined
  }
}

function elapsedClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const seconds = String(total % 60).padStart(2, '0')
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes}:${seconds}`
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${seconds}`
}

export function ElapsedClock({ since }: { readonly since: number }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => subscribeTick(setNow), [])
  return <span className={css.elapsed} aria-hidden="true">{elapsedClock(now - since)}</span>
}
