/**
 * The browsing region's search state machine: the controlled query, the
 * wide-only expansion, the rail hand-off that lands focus in the input, and
 * the debounced Host content-search request.
 */
import { useEffect, useRef, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import type { RemoteSearchState } from './SearchResults.tsx'
import { sanitizeSearchQuery } from './search-query.ts'

/**
 * Column slide length (--ds-transition-duration-slow): rail-search focus waits it out —
 * focus() forces a synchronous layout and would jank the slide.
 */
const EXPAND_SLIDE_MS = 300
/** Pause between the latest keystroke and a Host content-search request. */
const SEARCH_DEBOUNCE_MS = 250

/** Search inputs shared with the region: the expansion flag and its Host request. */
export interface WorkspaceSearchOptions {
  /** The shell is wide, so the input is mounted and can take focus. */
  wide: boolean
  /** Ask the shell to expand the rail before this gesture can focus the input. */
  expandSidebar: () => void
  /** Host content search for the current query. */
  searchSessions: WorkspaceBrowserProps['searchSessions']
}

/** The browsing region's search state and the gestures that drive it. */
export interface WorkspaceSearch {
  /** The raw controlled input value. */
  query: string
  /** The trimmed, wire-bounded query the region renders against. */
  normalizedQuery: string
  /** The search input is open. */
  searchExpanded: boolean
  /** The current Host request paired with the query that produced it. */
  remote: RemoteSearchState
  /** The search cluster, for outside-click containment. */
  root: React.RefObject<HTMLDivElement | null>
  /** The text input, for rail-hand-off focus. */
  input: React.RefObject<HTMLInputElement | null>
  /** Replace the controlled input value. */
  setQuery: (value: string) => void
  /** Open the search box without a rail hand-off. */
  expand: () => void
  /** Open the search box and ask the shell to expand the rail first. */
  expandFromRail: () => void
  /** Clear the query and close the box. */
  close: () => void
}

/**
 * Own the browsing region's search state.
 * @param options - the shell's wide state, the rail expansion request, and the Host search call.
 * @returns the query, expansion state, Host request, and the element refs they read.
 */
export function useWorkspaceSearch(options: WorkspaceSearchOptions): WorkspaceSearch {
  const { wide, expandSidebar, searchSessions } = options
  const [query, setQuery] = useState('')
  const [searchExpanded, setSearchExpanded] = useState(false)
  const [remote, setRemote] = useState<RemoteSearchState>({
    query: '',
    status: 'idle',
    items: [],
    hasMore: false,
  })
  const normalizedQuery = sanitizeSearchQuery(query).trim()
  const root = useRef<HTMLDivElement | null>(null)
  const input = useRef<HTMLInputElement | null>(null)
  // Rail search = expand + land in the search box: the flag arms before the
  // expand request; once the shell flips wide the input mounts and takes focus.
  const [onExpand, setOnExpand] = useState(false)

  useEffect(() => {
    if (wide && onExpand) {
      const timer = window.setTimeout(() => {
        input.current?.focus({ preventScroll: true })
        setOnExpand(false)
      }, EXPAND_SLIDE_MS)
      return () => { window.clearTimeout(timer) }
    }
  }, [wide, onExpand])

  useEffect(() => {
    if (!wide || !searchExpanded || onExpand) return
    input.current?.focus({ preventScroll: true })
  }, [wide, searchExpanded, onExpand])

  // Outside-click dismissal stays off while the rail gesture is in flight
  // (onExpand): the rail click flips the shell wide and mounts this listener
  // during its own dispatch, then keeps bubbling to document with the
  // now-unmounted rail button as its target — outside root, so the listener
  // would dismiss the search that click just opened.
  useEffect(() => {
    if (!wide || !searchExpanded || onExpand) return
    const onClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Node) || root.current?.contains(event.target) === true) return
      input.current?.blur()
      if (normalizedQuery !== '') return
      setSearchExpanded(false)
    }
    document.addEventListener('click', onClick)
    return () => { document.removeEventListener('click', onClick) }
  }, [normalizedQuery, wide, searchExpanded, onExpand])

  useEffect(() => {
    if (normalizedQuery === '') {
      setRemote({ query: '', status: 'idle', items: [], hasMore: false })
      return
    }
    const controller = new AbortController()
    setRemote({ query: normalizedQuery, status: 'loading', items: [], hasMore: false })
    const timer = window.setTimeout(() => {
      searchSessions(normalizedQuery, controller.signal).then((result) => {
        if (controller.signal.aborted) return
        setRemote({
          query: normalizedQuery,
          status: 'ready',
          items: result.items,
          hasMore: result.hasMore,
        })
      }).catch(() => {
        if (controller.signal.aborted) return
        setRemote({ query: normalizedQuery, status: 'error', items: [], hasMore: false })
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [normalizedQuery, searchSessions])

  return {
    query,
    normalizedQuery,
    searchExpanded,
    remote,
    root,
    input,
    setQuery: (value) => { setQuery(sanitizeSearchQuery(value)) },
    expand: () => { setSearchExpanded(true) },
    expandFromRail: () => {
      setSearchExpanded(true)
      setOnExpand(true)
      expandSidebar()
    },
    close: () => {
      setQuery('')
      setSearchExpanded(false)
    },
  }
}

/** The reveal hand-off: a chosen search result is scrolled into view once. */
export interface SessionReveal {
  /** The Session the region must expose and scroll into view, if any. */
  id: SessionId | undefined
  /** Request a reveal and open the Session. */
  open: (sessionId: SessionId) => void
  /** Acknowledge the reveal once the row has shown it. */
  acknowledge: (sessionId: SessionId) => void
  /** Drop a pending reveal because the query moved on. */
  clear: () => void
}

/**
 * Own the pending scroll-into-view hand-off from a search result to its row.
 * @returns the pending Session id and the three transitions that move it.
 */
export function useSessionReveal(): SessionReveal {
  const [id, setId] = useState<SessionId | undefined>(undefined)
  return {
    id,
    open: (sessionId) => { setId(sessionId) },
    acknowledge: (sessionId) => { setId(current => current === sessionId ? undefined : current) },
    clear: () => { setId(undefined) },
  }
}
