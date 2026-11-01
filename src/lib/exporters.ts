/** What can be exported: one figure's SVG, plus GMT's raw PostScript when the Wasm engine produced it. */
export interface Exportable { svg: string; ps?: ArrayBuffer }

export function download(name: string, data: Blob | string | ArrayBuffer | Uint8Array, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function svgSize(svg: string): { w: number; h: number } {
  const m = /<svg[^>]*\swidth="([\d.]+)"[^>]*\sheight="([\d.]+)"/.exec(svg)
  return m ? { w: +m[1], h: +m[2] } : { w: 612, h: 792 }
}

export async function rasterize(svg: string, dpi: number, mime: 'image/png' | 'image/jpeg' = 'image/png'): Promise<Blob> {
  const { w, h } = svgSize(svg)
  const k = dpi / 72
  const img = new Image()
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    await new Promise<void>((res, rej) => {
      img.onload = () => res()
      img.onerror = () => rej(new Error('SVG failed to load'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * k)
    canvas.height = Math.round(h * k)
    const c = canvas.getContext('2d')!
    c.fillStyle = '#fff'
    c.fillRect(0, 0, canvas.width, canvas.height)
    c.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('canvas export failed'))), mime, 0.95))
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Minimal single-page PDF embedding a JPEG render of the map (raster, not vector). */
export async function svgToPdf(svg: string, dpi = 200): Promise<Blob> {
  const { w, h } = svgSize(svg)
  const jpg = new Uint8Array(await (await rasterize(svg, dpi, 'image/jpeg')).arrayBuffer())
  const px = Math.round((w * dpi) / 72), py = Math.round((h * dpi) / 72)
  const enc = new TextEncoder()
  const parts: (Uint8Array | string)[] = []
  const offsets: number[] = []
  let len = 0
  const add = (p: Uint8Array | string) => { const b = typeof p === 'string' ? enc.encode(p) : p; parts.push(b); len += b.length }
  const obj = (n: number, body: string) => { offsets[n] = len; add(`${n} 0 obj\n${body}\nendobj\n`) }
  add('%PDF-1.4\n')
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w.toFixed(2)} ${h.toFixed(2)}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`)
  const content = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} 0 0 cm /Im0 Do Q`
  obj(4, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
  offsets[5] = len
  add(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${px} /Height ${py} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`)
  add(jpg)
  add('\nendstream\nendobj\n')
  const xref = len
  add(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => String(offsets[n]).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`)
  return new Blob(parts as BlobPart[], { type: 'application/pdf' })
}

export type ExportFormat = 'png' | 'svg' | 'pdf' | 'ps' | 'script'

export async function exportAs(fmt: ExportFormat, result: Exportable | null, script: string, baseName: string) {
  const name = baseName.replace(/[^\w.-]+/g, '_') || 'map'
  if (fmt === 'script') return download(`${name}.sh`, script, 'text/x-shellscript')
  if (!result?.svg) throw new Error('Nothing to export yet — run the script first')
  if (fmt === 'svg') return download(`${name}.svg`, result.svg, 'image/svg+xml')
  if (fmt === 'png') return download(`${name}.png`, await rasterize(result.svg, 300))
  if (fmt === 'pdf') return download(`${name}.pdf`, await svgToPdf(result.svg))
  if (fmt === 'ps') {
    if (!result.ps) throw new Error('Raw PostScript is only available with the GMT Wasm engine')
    return download(`${name}.ps`, result.ps, 'application/postscript')
  }
}
