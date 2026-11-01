/** Image support for the PostScript renderer: GMT embeds grdimage/colorbar/EPS pictures as
 *  `<< /ImageType 1 ... /DataSource currentfile /ASCII85Decode filter /FlateDecode filter >> image` followed by the
 *  encoded samples in the PostScript stream itself. */
import { unzlibSync, zlibSync } from 'fflate'

/** Pull inline image data out of the source (so the tokenizer never sees it) and leave a marker in its place. */
export function extractImageData(src: string): { src: string; images: string[] } {
  const images: string[] = []
  const out = src.replace(/\/DataSource\s+currentfile([\s\S]{0,200}?)>>\s*image[ \t]*\r?\n([\s\S]*?~>)/g, (_m, filters: string, data: string) => {
    images.push(data)
    return `/DataSource (@@IMG${images.length - 1}@@)${filters}>> image\n`
  })
  return { src: out, images }
}

export function ascii85Decode(text: string): Uint8Array {
  const out: number[] = []
  let group: number[] = []
  const flush = (n: number) => {
    let v = 0
    for (let i = 0; i < 5; i++) v = v * 85 + (group[i] ?? 84)
    for (let i = 0; i < n - 1; i++) out.push((v >>> (24 - 8 * i)) & 255)
  }
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 126) break                         // '~' ends the data ('~>')
    if (c <= 32) continue
    if (c === 122 && group.length === 0) { out.push(0, 0, 0, 0); continue } // 'z' = four zero bytes
    group.push(c - 33)
    if (group.length === 5) { flush(5); group = [] }
  }
  if (group.length > 1) flush(group.length)
  return Uint8Array.from(out)
}

export function asciiHexDecode(text: string): Uint8Array {
  const h = text.replace(/[^0-9a-fA-F]/g, '')
  const out = new Uint8Array(Math.floor(h.length / 2))
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16)
  return out
}

export function runLengthDecode(data: Uint8Array): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < data.length;) {
    const n = data[i++]
    if (n === 128) break
    if (n < 128) { for (let k = 0; k <= n && i < data.length; k++) out.push(data[i++]) }
    else { const b = data[i++]; for (let k = 0; k < 257 - n; k++) out.push(b) }
  }
  return Uint8Array.from(out)
}

export function applyFilters(raw: string, chain: string[]): Uint8Array {
  let data: Uint8Array | null = null
  let text = raw
  for (const f of chain) {
    if (f === 'ASCII85Decode') data = ascii85Decode(text)
    else if (f === 'ASCIIHexDecode') data = asciiHexDecode(text)
    else if (f === 'FlateDecode') data = unzlibSync(data ?? new Uint8Array())
    else if (f === 'RunLengthDecode') data = runLengthDecode(data ?? new Uint8Array())
    else throw new Error(`unsupported image filter ${f}`)
    text = ''
  }
  return data ?? new Uint8Array()
}

let crcTable: Uint32Array | null = null
function crc32(buf: Uint8Array): number {
  if (!crcTable) { crcTable = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0 } }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Encode 8-bit RGB pixels (width*height*3 bytes) as a PNG file. */
export function pngEncode(rgb: Uint8Array, width: number, height: number): Uint8Array {
  const raw = new Uint8Array((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) { raw[y * (width * 3 + 1)] = 0; raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1) }
  const idat = zlibSync(raw, { level: 6 })
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length)
    const dv = new DataView(out.buffer)
    dv.setUint32(0, data.length)
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
    out.set(data, 8)
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
    return out
  }
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, width); dv.setUint32(4, height); ihdr[8] = 8; ihdr[9] = 2
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array())]
  const total = parts.reduce((n, p) => n + p.length, 0)
  const png = new Uint8Array(total)
  let o = 0
  for (const p of parts) { png.set(p, o); o += p.length }
  return png
}

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192) as unknown as number[])
  return btoa(s)
}

export type ColorSpace = { kind: 'gray' } | { kind: 'rgb' } | { kind: 'indexed'; base: 'rgb' | 'gray'; hival: number; lookup: Uint8Array }

/** Convert packed image samples to 8-bit RGB. */
export function samplesToRgb(data: Uint8Array, w: number, h: number, bpc: number, cs: ColorSpace, decode: number[]): Uint8Array {
  const ncomp = cs.kind === 'rgb' ? 3 : 1
  const rowBytes = Math.ceil((w * ncomp * bpc) / 8)
  const maxv = (1 << bpc) - 1
  const out = new Uint8Array(w * h * 3)
  const sample = (row: number, idx: number): number => {
    if (bpc === 8) return data[row * rowBytes + idx] ?? 0
    if (bpc === 16) return data[row * rowBytes + idx * 2] ?? 0
    const bit = idx * bpc
    const byte = data[row * rowBytes + (bit >> 3)] ?? 0
    return (byte >> (8 - bpc - (bit & 7))) & maxv
  }
  const dec = (v: number, c: number) => {
    const lo = decode[c * 2] ?? 0, hi = decode[c * 2 + 1] ?? 1
    return lo + (v * (hi - lo)) / (bpc === 16 ? 255 : maxv)
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0
      if (cs.kind === 'rgb') {
        r = dec(sample(y, x * 3), 0) * 255; g = dec(sample(y, x * 3 + 1), 1) * 255; b = dec(sample(y, x * 3 + 2), 2) * 255
      } else if (cs.kind === 'gray') {
        r = g = b = dec(sample(y, x), 0) * 255
      } else {
        const idx = Math.max(0, Math.min(cs.hival, Math.round(dec(sample(y, x), 0))))
        if (cs.base === 'rgb') { r = cs.lookup[idx * 3] ?? 0; g = cs.lookup[idx * 3 + 1] ?? 0; b = cs.lookup[idx * 3 + 2] ?? 0 }
        else r = g = b = cs.lookup[idx] ?? 0
      }
      const o = (y * w + x) * 3
      out[o] = r; out[o + 1] = g; out[o + 2] = b
    }
  }
  return out
}
