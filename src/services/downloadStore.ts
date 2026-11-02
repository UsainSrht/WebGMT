// Page-side store of the downloads the GMT worker reports. Components read it with useDownloads().
import { useSyncExternalStore } from 'react'
import { reduce, type Download } from '../lib/downloadState'
import type { DownloadEvent } from '../types'

let state: ReadonlyMap<string, Download> = new Map()
let snapshot: Download[] = []
const listeners = new Set<() => void>()
const timers = new Map<string, number>()

/** how long a finished download stays visible (so "100%" and errors can be seen) */
const LINGER_MS = { done: 1500, cancelled: 800, error: 6000 }

function publish(next: ReadonlyMap<string, Download>) {
  state = next
  snapshot = [...next.values()].sort((a, b) => a.startedAt - b.startedAt)
  listeners.forEach((l) => l())
}

export function applyDownloadEvent(ev: DownloadEvent) {
  const at = performance.now()
  window.clearTimeout(timers.get(ev.id))
  publish(reduce(state, { ...ev, at }))
  if (ev.event === 'end') {
    timers.set(ev.id, window.setTimeout(() => {
      const next = new Map(state)
      next.delete(ev.id)
      publish(next)
    }, LINGER_MS[ev.status]))
  }
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const useDownloads = () => useSyncExternalStore(subscribe, () => snapshot)
