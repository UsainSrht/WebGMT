export interface ScriptRecord {
  id?: number
  title: string
  content: string
  createdAt: number
  updatedAt: number
  tags: string[]
}

export interface FileRecord {
  id?: number
  name: string
  type: string
  size: number
  data: ArrayBuffer
  updatedAt: number
}

export interface HistoryRecord {
  id?: number
  scriptId: number
  executedAt: number
  status: 'ok' | 'error'
  executionTimeMs: number
}

export interface LogEntry {
  stream: 'stdout' | 'stderr' | 'info'
  text: string
  /** 1-based script line the message belongs to, when known */
  line?: number
}

export interface WorkerFile {
  name: string
  data: ArrayBuffer
}

export type WorkerRequest = { type: 'run'; id: number; script: string; files: WorkerFile[] }

export type WorkerResponse =
  | { type: 'log'; id: number; entry: LogEntry }
  | {
      type: 'result'
      id: number
      ok: boolean
      engine: 'wasm' | 'mock'
      figures: { name: string; ps?: ArrayBuffer; svg?: string }[]
      durationMs: number
    }

/** One finished figure (a gmt begin ... gmt end block) rendered to SVG; ps is the raw GMT PostScript if available. */
export interface Figure {
  name: string
  svg: string
  ps?: ArrayBuffer
}

export interface RenderResult {
  figures: Figure[]
  engine: 'wasm' | 'mock'
  durationMs: number
  ok: boolean
}

export interface EditorMarker {
  line: number
  message: string
  severity: 'error' | 'warning'
}
