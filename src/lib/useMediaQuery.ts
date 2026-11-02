import { useSyncExternalStore } from 'react'

/** Live result of a CSS media query (re-renders when it flips, e.g. on rotation or window resize). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(query)
      mq.addEventListener('change', notify)
      return () => mq.removeEventListener('change', notify)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** Below this width the desktop three-column layout has no room for the editor, so the compact layout is used. */
export const COMPACT_QUERY = '(max-width: 1199px)'
/** From this width the compact layout can show the editor and the map side by side. */
export const WIDE_QUERY = '(min-width: 768px)'
/** A phone held sideways: little height, so the navigation moves from the bottom to the left edge. */
export const SHORT_QUERY = '(max-height: 520px) and (orientation: landscape)'
