import type * as Monaco from 'monaco-editor'
import type { EditorMarker, LogEntry } from '../types'

const ERR = /\[(ERROR|WARNING)\]:?\s*(.*)$/i
const LINE = /\bline\s+(\d+)\b/i

/** Turns stderr log entries into editor markers. The worker tags each message with the script line of the
 *  command that produced it; an explicit "on line N" in the message text takes precedence. */
export function parseErrors(logs: LogEntry[], lineCount: number): EditorMarker[] {
  const out: EditorMarker[] = []
  for (const l of logs) {
    if (l.stream !== 'stderr') continue
    const m = ERR.exec(l.text)
    const isMock = /^mock engine:/.test(l.text)
    if (!m && !isMock) continue
    const explicit = LINE.exec(l.text)
    const line = explicit ? +explicit[1] : l.line
    if (!line || line < 1 || line > lineCount) continue
    out.push({
      line,
      message: (m ? m[2] : l.text).trim() || l.text,
      severity: m && m[1].toUpperCase() === 'ERROR' ? 'error' : 'warning',
    })
  }
  return out
}

export function applyMarkers(monaco: typeof Monaco, model: Monaco.editor.ITextModel, markers: EditorMarker[]) {
  monaco.editor.setModelMarkers(
    model,
    'gmt',
    markers.map((m) => ({
      startLineNumber: m.line,
      endLineNumber: m.line,
      startColumn: 1,
      endColumn: model.getLineMaxColumn(m.line),
      message: m.message,
      severity: m.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
    })),
  )
}
