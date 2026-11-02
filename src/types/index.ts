/** Legacy (v1 database) record, migrated into NodeRecord on upgrade */
export interface ScriptRecord {
  id?: number
  title: string
  content: string
  createdAt: number
  updatedAt: number
  tags: string[]
}

/** Legacy (v1 database) record, migrated into NodeRecord on upgrade */
export interface FileRecord {
  id?: number
  name: string
  type: string
  size: number
  data: ArrayBuffer
  updatedAt: number
}

/** One entry of the project tree. parentId 0 is the project root. File contents live in the blobs table. */
export interface NodeRecord {
  id?: number
  parentId: number
  name: string
  kind: 'file' | 'folder'
  size: number
  createdAt: number
  updatedAt: number
}

export interface BlobRecord {
  id: number
  data: ArrayBuffer
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
  /** path relative to the project root */
  name: string
  data: ArrayBuffer
}

export type WorkerRequest =
  | {
      type: 'run'
      id: number
      script: string
      /** folder of the script (relative to the project root): the working directory of the run */
      cwd: string
      files: WorkerFile[]
    }
  /** load the engine in the background so the first Run does not have to wait for it */
  | { type: 'warmup' }
  | { type: 'cancel-download'; id: string }

/** Progress of one download, sent by the worker (see lib/downloadState.ts). */
export type DownloadEvent =
  | { event: 'start'; id: string; label: string; total: number }
  | { event: 'progress'; id: string; loaded: number }
  | { event: 'end'; id: string; status: 'done' | 'error' | 'cancelled'; error?: string }

export type WorkerResponse =
  | { type: 'log'; id: number; entry: LogEntry }
  | ({ type: 'download' } & DownloadEvent)
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
