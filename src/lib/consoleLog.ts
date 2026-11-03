import type { LogEntry } from '../types'

export type Severity = 'error' | 'warning' | 'info' | 'plain'

/** GMT prints "module [WARNING]: ..." / "[INFORMATION]: ..." on stderr; only real errors should look like errors. */
export function severity(l: LogEntry): Severity {
  if (l.stream === 'info') return 'info'
  if (l.stream !== 'stderr') return 'plain'
  if (/\[(WARNING|COMPATIBILITY)\]/.test(l.text)) return 'warning'
  if (/\[(INFORMATION|NOTICE|TIMING|DEBUG|LONG_VERBOSE)\]/i.test(l.text)) return 'info'
  return 'error'
}

/** Identical consecutive lines (GMT repeats a warning once per call) are shown once with a count. */
export function fold(logs: LogEntry[]): { l: LogEntry; n: number }[] {
  const out: { l: LogEntry; n: number }[] = []
  for (const l of logs) {
    const last = out[out.length - 1]
    if (last && last.l.stream === l.stream && last.l.text === l.text && last.l.line === l.line && l.stream !== 'stdout') last.n++
    else out.push({ l, n: 1 })
  }
  return out
}
