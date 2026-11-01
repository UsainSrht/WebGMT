/** Font metrics for the PostScript renderer. GMT lays text out with stringwidth / charpath+pathbbox, so labels,
 *  annotations and titles are only positioned correctly if these are close to the real font metrics.
 *  Widths are the standard Adobe AFM widths (1000 units/em) for ASCII 32..126 of Helvetica, Helvetica-Bold,
 *  Times-Roman and Courier; other fonts are approximated by one of these. */

// ASCII 32..126
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584]
const HELV_B = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584]
const TIMES = [250,333,408,500,500,833,778,180,333,333,500,564,250,333,250,278,500,500,500,500,500,500,500,500,500,500,278,278,564,564,564,444,921,722,667,667,722,611,556,722,722,333,389,722,611,889,722,722,556,722,667,556,611,722,722,944,722,722,611,333,278,333,469,500,333,444,500,444,500,444,333,500,500,278,278,500,278,778,500,500,500,500,333,389,278,500,500,722,500,500,444,480,200,480,541]

interface Metrics { w: number[]; scale: number; mono?: boolean }

function metricsFor(font: string): Metrics {
  const f = font.toLowerCase()
  if (f.includes('courier')) return { w: HELV, scale: 1, mono: true }
  if (f.includes('chancery')) return { w: TIMES, scale: 0.9 }
  const bold = /bold|demi|black|heavy/.test(f)
  if (f.includes('times') || f.includes('palatino') || f.includes('bookman') || f.includes('newcentury') || f.includes('charter'))
    return { w: TIMES, scale: bold ? 1.05 : /italic|oblique/.test(f) ? 0.98 : 1 }
  return bold ? { w: HELV_B, scale: 1 } : { w: HELV, scale: 1 }
}

/** Advance width of `s` in user units for the given font and size. */
export function stringWidth(font: string, size: number, s: string): number {
  const m = metricsFor(font)
  if (m.mono) return s.length * 0.6 * size
  let t = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    // ISOLatin1+: 0x2D is a minus (as wide as '+'), 0xAD the hyphen
    // 0x90-0x9F are ISOLatin1+ spacing accents (dotlessi 278, the rest 333 in Helvetica and Times)
    t += c === 45 ? m.w[43 - 32] : c === 0xad ? m.w[45 - 32] : c >= 32 && c <= 126 ? m.w[c - 32] : c === 0x90 ? 278 : c > 0x90 && c <= 0x9f ? 333 : 556
  }
  return (t * m.scale * size) / 1000
}

/** Glyph box of `s` relative to the baseline, in user units: [llx, lly, urx, ury] (like charpath + pathbbox). */
export function glyphBox(font: string, size: number, s: string): [number, number, number, number] {
  const w = stringWidth(font, size, s)
  let top = 0, bottom = 0
  for (const ch of s) {
    if (ch === ' ') continue
    let t = 0.523, b = 0                                   // x-height lowercase
    if (/[A-Z0-9]/.test(ch)) t = 0.718
    else if (/[bdfhklt]/.test(ch)) t = 0.718
    else if (/[ij]/.test(ch)) t = 0.718
    else if (/[()\[\]{}|\/\\@$]/.test(ch)) { t = 0.73; b = -0.21 }
    else if (/[!?%&#"'`^*+=<>~_\-.,:;]/.test(ch)) { t = /[.,:;_\-]/.test(ch) ? 0.2 : 0.7; b = /[,;]/.test(ch) ? -0.15 : /_/.test(ch) ? -0.1 : 0 }
    if (/[gjpqy]/.test(ch)) b = -0.21
    if (/[Q]/.test(ch)) b = -0.056
    top = Math.max(top, t); bottom = Math.min(bottom, b)
  }
  return [0, bottom * size, w, top * size]
}

/** Adobe Symbol encoding for the Latin letters GMT uses for Greek (e.g. @~p@~ -> pi). */
const SYMBOL: Record<string, string> = {
  a: 'α', b: 'β', c: 'χ', d: 'δ', e: 'ε', f: 'φ', g: 'γ', h: 'η', i: 'ι', j: 'ϕ', k: 'κ', l: 'λ', m: 'μ', n: 'ν', o: 'ο', p: 'π', q: 'θ', r: 'ρ', s: 'σ', t: 'τ', u: 'υ', v: 'ϖ', w: 'ω', x: 'ξ', y: 'ψ', z: 'ζ',
  A: 'Α', B: 'Β', C: 'Χ', D: 'Δ', E: 'Ε', F: 'Φ', G: 'Γ', H: 'Η', I: 'Ι', J: 'ϑ', K: 'Κ', L: 'Λ', M: 'Μ', N: 'Ν', O: 'Ο', P: 'Π', Q: 'Θ', R: 'Ρ', S: 'Σ', T: 'Τ', U: 'ϒ', V: 'ς', W: 'Ω', X: 'Ξ', Y: 'Ψ', Z: 'Ζ',
}
export const isSymbolFont = (font: string) => /^symbol/i.test(font)
export const symbolText = (s: string) => Array.from(s).map((c) => SYMBOL[c] ?? c).join('')

/** GMT's default ISOLatin1+ encoding differs from plain Latin-1: 0x2D is a true minus sign, 0xAD is the hyphen,
 *  and 0x27 / 0x60 are the typographic right/left single quotes. */
/** ISOLatin1+ 0x90-0x9F hold the spacing accents (plain Latin-1 has control characters there): dotlessi, grave, acute,
 *  circumflex, tilde, macron, breve, dotaccent, dieresis, (none), ring, cedilla, (none), hungarumlaut, ogonek, caron. */
const ACCENTS = ['\u0131', '`', '\u00B4', '\u02C6', '\u02DC', '\u00AF', '\u02D8', '\u02D9', '\u00A8', '', '\u02DA', '\u00B8', '', '\u02DD', '\u02DB', '\u02C7']
export const latinPlus = (s: string) =>
  s.replace(/[-\u00AD'`\u0090-\u009F]/g, (c) => (c === '-' ? '\u2212' : c === '\u00AD' ? '-' : c === "'" ? '\u2019' : c === '`' ? '\u2018' : ACCENTS[c.charCodeAt(0) - 0x90]))
