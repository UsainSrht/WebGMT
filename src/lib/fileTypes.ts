// Decides how a file is opened: GMT script, plain text (editable), image (preview only) or binary (not readable).
import { extname } from './paths'

export type FileKind = 'text' | 'image' | 'binary'

export interface FileInfo {
  kind: FileKind
  /** Monaco language id for text files ("gmt" for scripts) */
  language: string
  /** MIME type for images */
  mime?: string
  /** binary because it is too large to edit, not because of its content */
  tooLarge?: boolean
}

export const MAX_EDIT_BYTES = 5 * 1024 * 1024

const IMAGES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  svg: 'image/svg+xml', ico: 'image/x-icon', avif: 'image/avif', apng: 'image/apng',
}

/** Shell-like extensions are GMT scripts and get GMT syntax highlighting. */
const SCRIPT = new Set(['sh', 'bash', 'zsh', 'ksh'])

const TEXT: Record<string, string> = {
  txt: 'plaintext', dat: 'plaintext', csv: 'plaintext', tsv: 'plaintext', xyz: 'plaintext', cpt: 'plaintext',
  ps: 'plaintext', eps: 'plaintext', log: 'plaintext', conf: 'plaintext', gmt: 'plaintext',
  json: 'json', md: 'markdown', xml: 'xml', html: 'html', css: 'css', js: 'javascript', ts: 'typescript',
  py: 'python', yml: 'yaml', yaml: 'yaml', ini: 'ini', toml: 'ini',
}

/** Formats that are binary no matter what the first bytes look like (no need to sniff them). */
const BINARY = new Set([
  'nc', 'grd', 'cdf', 'h5', 'hdf', 'tif', 'tiff', 'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'tar', 'pdf', 'wasm',
  'bin', 'exe', 'dll', 'so', 'o', 'a', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'mp3', 'mp4', 'wav', 'mov', 'woff',
  'woff2', 'ttf', 'otf', 'sqlite', 'db',
])

export function looksLikeText(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 65536)
  let control = 0
  for (let i = 0; i < Math.min(head.length, 8192); i++) {
    const b = head[i]
    if (b === 0) return false
    if (b < 9 || (b > 13 && b < 32)) control++
  }
  if (control > 8192 * 0.05) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: true }) // stream: a cut multi-byte char at the end is fine
    return true
  } catch {
    return false
  }
}

/** Name-only classification (used for icons and before the content is loaded). */
export function kindFromName(name: string): FileKind | 'unknown' {
  const ext = extname(name)
  if (IMAGES[ext]) return 'image'
  if (BINARY.has(ext)) return 'binary'
  if (SCRIPT.has(ext) || TEXT[ext]) return 'text'
  return 'unknown'
}

export const isScriptName = (name: string) => SCRIPT.has(extname(name))

export function classify(name: string, bytes: Uint8Array): FileInfo {
  const ext = extname(name)
  if (IMAGES[ext]) return { kind: 'image', language: 'plaintext', mime: IMAGES[ext] }
  if (BINARY.has(ext)) return { kind: 'binary', language: 'plaintext' }
  if (bytes.length > MAX_EDIT_BYTES) return { kind: 'binary', language: 'plaintext', tooLarge: true }
  if (!looksLikeText(bytes)) return { kind: 'binary', language: 'plaintext' }
  if (SCRIPT.has(ext)) return { kind: 'text', language: 'gmt' }
  if (TEXT[ext]) return { kind: 'text', language: TEXT[ext] }
  // no known extension: a shell shebang still makes it a script
  const first = new TextDecoder().decode(bytes.subarray(0, 64))
  if (ext === '' && /^#!.*\b(ba|z|k)?sh\b/.test(first)) return { kind: 'text', language: 'gmt' }
  return { kind: 'text', language: 'plaintext' }
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`
  return `${(n / 1073741824).toFixed(2)} GB`
}
