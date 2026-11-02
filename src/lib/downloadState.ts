// Pure state handling for the download indicator: events from the worker -> per-download progress, speed and ETA.
import type { DownloadEvent } from '../types'

export interface Download {
  id: string
  label: string
  loaded: number
  /** size in bytes, 0 when unknown */
  total: number
  startedAt: number
  /** time and byte count of the last speed sample */
  lastAt: number
  lastLoaded: number
  /** smoothed bytes per second (0 until measured) */
  speed: number
  state: 'active' | 'done' | 'error' | 'cancelled'
  error?: string
}

export type Timed = DownloadEvent & { at: number }

const MIN_SAMPLE_MS = 250
const SMOOTHING = 0.3

/** Returns a new map with the event applied (the input is not modified). */
export function reduce(map: ReadonlyMap<string, Download>, ev: Timed): Map<string, Download> {
  const next = new Map(map)
  const cur = next.get(ev.id)
  if (ev.event === 'start') {
    next.set(ev.id, { id: ev.id, label: ev.label, loaded: 0, total: ev.total, startedAt: ev.at, lastAt: ev.at, lastLoaded: 0, speed: 0, state: 'active' })
  } else if (cur && ev.event === 'progress' && cur.state === 'active') {
    const d = { ...cur, loaded: ev.loaded }
    const dt = ev.at - cur.lastAt
    if (dt >= MIN_SAMPLE_MS) {
      const inst = ((ev.loaded - cur.lastLoaded) / dt) * 1000
      d.speed = cur.speed > 0 ? cur.speed * (1 - SMOOTHING) + inst * SMOOTHING : inst
      d.lastAt = ev.at
      d.lastLoaded = ev.loaded
    }
    next.set(ev.id, d)
  } else if (cur && ev.event === 'end') {
    next.set(ev.id, { ...cur, state: ev.status, error: ev.error, loaded: ev.status === 'done' && cur.total ? cur.total : cur.loaded })
  }
  return next
}

/** 0..1, or null while the size is unknown. */
export function fraction(d: Download): number | null {
  if (d.state === 'done') return 1
  return d.total > 0 ? Math.min(1, d.loaded / d.total) : null
}

/** Seconds left, or null when it cannot be estimated yet. */
export function eta(d: Download): number | null {
  if (d.state !== 'active' || d.total <= 0 || d.speed <= 0) return null
  return Math.max(0, (d.total - d.loaded) / d.speed)
}

/** Mean progress of the active downloads (unknown sizes count as 0), or null when nothing is active. */
export function averageFraction(list: readonly Download[]): number | null {
  const active = list.filter((d) => d.state === 'active')
  if (active.length === 0) return null
  return active.reduce((s, d) => s + (fraction(d) ?? 0), 0) / active.length
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1048576) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`
  return `${(n / 1048576).toFixed(n < 10485760 ? 2 : 1)} MB`
}

export function formatEta(seconds: number): string {
  if (seconds < 1) return 'less than 1 s'
  const s = Math.round(seconds)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m} min ${s % 60} s` : `${Math.floor(m / 60)} h ${m % 60} min`
}
