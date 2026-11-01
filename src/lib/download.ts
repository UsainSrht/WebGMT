// Saves bytes to the user's computer through a temporary link.
import { zipSync } from 'fflate'

export function saveBytes(name: string, data: ArrayBuffer | Uint8Array, mime = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Zips `entries` (path inside the zip -> bytes; a path ending in "/" is an empty folder) and saves it. */
export function saveZip(name: string, entries: Record<string, Uint8Array>) {
  saveBytes(name, zipSync(entries), 'application/zip')
}
