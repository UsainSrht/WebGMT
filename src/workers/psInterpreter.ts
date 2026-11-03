/** A compact PostScript interpreter that converts GMT-produced .ps files to SVG.
 *  Supports the operator subset used by GMT's PSL prolog (paths, painting, clipping, dictionaries, control flow,
 *  arrays/strings, matrix ops, text via `show`). Unknown operators are collected in `warnings` and skipped.
 *  Not tested against real GMT output yet (no Wasm build available during development). */

import { applyFilters, extractImageData, pngEncode, samplesToRgb, toBase64, type ColorSpace } from './psImage'
import { glyphBox, isSymbolFont, latinPlus, stringWidth, symbolText } from './psFonts'

type Mat = [number, number, number, number, number, number]
type Obj = any
interface Proc { proc: Obj[] }
interface Name { name: string; lit: boolean }
interface Seg { op: 'M' | 'L' | 'C' | 'Z'; p: number[] }
interface GState {
  ctm: Mat; path: Seg[]; cur: [number, number] | null; start: [number, number] | null
  fill: string; lw: number; cap: number; join: number; dash: number[]; dashPhase: number
  font: { name: string; size: number }; clipDepth: number
  /** text recorded by charpath; painted as real text when the path is filled/stroked */
  runs: Run[]
  cs: ColorSpace
}
interface Run { text: string; ux: number; uy: number; font: { name: string; size: number }; m: Mat; from: number; to: number }

const mul = (a: Mat, b: Mat): Mat => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
]
// PostScript uses row vectors: p' = p * M. `mul(local, ctm)` applies local first.
const apply = (m: Mat, x: number, y: number): [number, number] => [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]]
const scaleOf = (m: Mat) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))

function tokenize(src: string): Obj[] {
  const out: Obj[] = []
  const stack: Obj[][] = []
  let cur = out
  const push = (o: Obj) => cur.push(o)
  const re = /%[^\n\r]*|\(|<[0-9a-fA-F\s]*>|<<|>>|\[|\]|\{|\}|\/?[^\s()<>[\]{}\/%]+|\/(?=[\s(<[{/%])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const t = m[0]
    if (t[0] === '%') continue
    if (t === '(') {
      let depth = 1, i = re.lastIndex, s = ''
      while (i < src.length && depth > 0) {
        const ch = src[i]
        if (ch === '\\') {
          const n = src[++i]
          if (n === 'n') s += '\n'; else if (n === 'r') s += '\r'; else if (n === 't') s += '\t'
          else if (/[0-7]/.test(n)) { let o = n; while (o.length < 3 && /[0-7]/.test(src[i + 1])) o += src[++i]; s += String.fromCharCode(parseInt(o, 8)) }
          else if (n !== '\n') s += n
        } else if (ch === '(') { depth++; s += ch } else if (ch === ')') { if (--depth > 0) s += ch } else s += ch
        i++
      }
      re.lastIndex = i
      push({ str: s })
    } else if (t === '{') { stack.push(cur); const p: Obj[] = []; cur = p; (p as any).isProc = true }
    else if (t === '}') { const p = cur; cur = stack.pop()!; push({ proc: p } as Proc) }
    else if (t === '[' || t === ']' || t === '<<' || t === '>>') push({ name: t, lit: false } as Name)
    else if (t[0] === '<') { const h = t.slice(1, -1).replace(/\s/g, ''); let s = ''; for (let i = 0; i < h.length; i += 2) s += String.fromCharCode(parseInt(h.substr(i, 2).padEnd(2, '0'), 16)); push({ str: s }) }
    else if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) push(parseFloat(t))
    else if (/^\d+#[0-9a-zA-Z]+$/.test(t)) { const [b, v] = t.split('#'); push(parseInt(v, +b)) }
    else if (t[0] === '/') push({ name: t.slice(1), lit: true } as Name)
    else push({ name: t, lit: false } as Name)
  }
  return out
}

const isProc = (o: Obj): o is Proc => o && typeof o === 'object' && Array.isArray(o.proc)
const isName = (o: Obj): o is Name => o && typeof o === 'object' && typeof o.name === 'string' && 'lit' in o
const isStr = (o: Obj) => o && typeof o === 'object' && typeof o.str === 'string'
class Quit extends Error {}

export function psToSvg(psBytes: ArrayBuffer, opts: { onDef?: (key: string, value: unknown) => void } = {}): { svg: string; warnings: string[] } {
  const src = new TextDecoder('latin1').decode(psBytes)
  const extracted = extractImageData(src)   // inline image data is removed from the stream the tokenizer sees
  const bb = /%%BoundingBox:\s*(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)/.exec(src)
  const [bx0, by0, bx1, by1] = bb ? bb.slice(1).map(Number) : [0, 0, 612, 792]
  const W = Math.max(1, bx1 - bx0), H = Math.max(1, by1 - by0)

  const warnings = new Set<string>()
  const out: string[] = []
  const defs: string[] = []
  let clipId = 0
  const ostack: Obj[] = []
  const systemdict = new Map<string, Obj>()
  const userdict = new Map<string, Obj>()
  const dstack: Map<string, Obj>[] = [systemdict, userdict]
  const gsStack: GState[] = []
  let gs: GState = {
    ctm: [1, 0, 0, 1, 0, 0], path: [], cur: null, start: null, fill: '#000', lw: 1, cap: 0, join: 0,
    dash: [], dashPhase: 0, font: { name: 'Helvetica', size: 10 }, clipDepth: 0, runs: [], cs: { kind: 'rgb' },
  }
  let steps = 0
  const clipStack: number[] = []
  // Tight bounds of everything painted (SVG coordinates). GMT's raw figure PostScript carries a full-page
  // BoundingBox because Ghostscript's bbox pass (psconvert) is not available, so we crop ourselves.
  const bnd = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  const grow = (x: number, y: number, pad = 0) => {
    if (!isFinite(x) || !isFinite(y) || Math.abs(x) > 1e5 || Math.abs(y) > 1e5) return
    bnd.x0 = Math.min(bnd.x0, x - pad); bnd.y0 = Math.min(bnd.y0, y - pad)
    bnd.x1 = Math.max(bnd.x1, x + pad); bnd.y1 = Math.max(bnd.y1, y + pad)
  }
  const MAX_STEPS = 20_000_000

  const num = (): number => { const v = ostack.pop(); return typeof v === 'number' ? v : Number(v?.str ?? 0) }
  const pt = (x: number, y: number) => { const [a, b] = apply(gs.ctm, x, y); return [a - bx0, H - (b - by0)] }
  const lookup = (n: string) => { for (let i = dstack.length - 1; i >= 0; i--) if (dstack[i].has(n)) return dstack[i].get(n) }
  const fmt = (v: number) => +v.toFixed(3)
  const pathD = (segs: Seg[]) => segs.map((s) => (s.op === 'Z' ? 'Z' : `${s.op}${s.p.map(fmt).join(' ')}`)).join('')
  const addSeg = (op: Seg['op'], x: number, y: number, extra: number[] = []) => {
    const p = pt(x, y).map(fmt)
    const e: number[] = []
    for (let i = 0; i < extra.length; i += 2) e.push(...pt(extra[i], extra[i + 1]).map(fmt))
    // In PostScript a moveto directly after a moveto replaces it (it is not a separate subpath)
    const last = gs.path[gs.path.length - 1]
    if (op === 'M' && last && last.op === 'M') gs.path.pop()
    gs.path.push({ op, p: [...e, ...p] })
  }
  // The current point lives in DEVICE space (as in PostScript): rotate/translate/scale must not move it.
  const dev = (x: number, y: number): [number, number] => apply(gs.ctm, x, y)
  const userPos = (): [number, number] => (gs.cur ? apply(inv(gs.ctm), gs.cur[0], gs.cur[1]) : [0, 0])
  const inv = (m: Mat): Mat => { const d = m[0] * m[3] - m[1] * m[2] || 1e-12; return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d] }

  const strokeAttrs = () => {
    const w = Math.max(gs.lw * scaleOf(gs.ctm), 0.25)
    return `stroke-width="${fmt(w)}" stroke-linecap="${['butt', 'round', 'square'][gs.cap] ?? 'butt'}" stroke-linejoin="${['miter', 'round', 'bevel'][gs.join] ?? 'miter'}"${gs.dash.length ? ` stroke-dasharray="${gs.dash.map((d) => fmt(d * scaleOf(gs.ctm))).join(',')}" stroke-dashoffset="${fmt(gs.dashPhase * scaleOf(gs.ctm))}"` : ''}`
  }
  const paint = (mode: 'fill' | 'stroke' | 'eofill') => {
    if (gs.path.length === 0) return
    const runs = gs.runs
    const segs = runs.length ? gs.path.filter((_, i) => !runs.some((r) => i >= r.from && i < r.to)) : gs.path
    const pad = mode === 'stroke' ? Math.max(gs.lw * scaleOf(gs.ctm), 0.05) / 2 : 0
    for (const sg of segs) for (let i = 0; i + 1 < sg.p.length; i += 2) grow(sg.p[i], sg.p[i + 1], pad)
    if (segs.length) {
      const d = pathD(segs)
      if (mode === 'stroke') out.push(`<path d="${d}" fill="none" stroke="${gs.fill}" ${strokeAttrs()}/>`)
      else out.push(`<path d="${d}" fill="${gs.fill}" fill-rule="${mode === 'eofill' ? 'evenodd' : 'nonzero'}" stroke="none"/>`)
    }
    for (const r of runs) {
      // text is drawn in user units (the matrix carries the scale), so the outline width is in user units too
      if (mode === 'stroke') emitText(r.text, r.ux, r.uy, r.font, r.m, `fill="none" stroke="${gs.fill}" stroke-width="${+Math.max(gs.lw, 0.05 / scaleOf(r.m)).toFixed(4)}" stroke-linejoin="round"`)
      else emitText(r.text, r.ux, r.uy, r.font, r.m, `fill="${gs.fill}"`)
    }
    gs.path = []; gs.runs = []
  }
  const clip = (rule: 'nonzero' | 'evenodd') => {
    if (gs.path.length === 0) return
    const id = `k${clipId++}`
    defs.push(`<clipPath id="${id}"><path d="${pathD(gs.path)}" clip-rule="${rule}"/></clipPath>`)
    out.push(`<g clip-path="url(#${id})">`)
    gs.clipDepth++
  }
  const gsave = () => gsStack.push({ ...gs, ctm: [...gs.ctm] as Mat, path: [...gs.path], dash: [...gs.dash], font: { ...gs.font }, clipDepth: gs.clipDepth, runs: [...gs.runs] })
  const grestore = () => {
    const prev = gsStack.pop()
    if (!prev) return
    for (let i = gs.clipDepth; i > prev.clipDepth; i--) out.push('</g>')
    gs = prev
  }
  const emitText = (str: string, ux: number, uy: number, font: { name: string; size: number }, m: Mat, paintAttrs: string) => {
    // position with the matrix of the text itself (a run painted later may follow a CTM change)
    const [ax, ay] = apply(m, ux, uy)
    const x = ax - bx0, y = H - (ay - by0)
    const size = font.size * scaleOf(m)
    const ang = (Math.atan2(m[1], m[0]) * -180) / Math.PI
    const f = font.name
    const family = /Times/i.test(f) ? 'Times New Roman, Times, serif' : /Courier/i.test(f) ? 'Courier New, Courier, monospace' : /AvantGarde/i.test(f) ? 'Century Gothic, Avant Garde, Helvetica, sans-serif' : /Bookman/i.test(f) ? 'Bookman Old Style, Bookman, serif' : /NewCentury/i.test(f) ? 'Century Schoolbook, serif' : /Palatino/i.test(f) ? 'Palatino Linotype, Palatino, serif' : /Chancery/i.test(f) ? 'Zapf Chancery, Apple Chancery, Times New Roman, serif' : isSymbolFont(f) ? 'Symbol, Times New Roman, serif' : 'Helvetica, Arial, sans-serif'
    const bold = /Bold|Demi/i.test(f) ? ' font-weight="bold"' : '', ital = /Oblique|Italic/i.test(f) ? ' font-style="italic"' : ''
    const text = (isSymbolFont(f) ? symbolText(str) : latinPlus(str)).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    // The full matrix (not just rotation) is applied, so 3-D plots, whose axis labels are sheared along the axes, look
    // right. textLength makes the glyphs fill exactly the advance width we use to place what follows, whatever
    // fallback font the browser picks for the PostScript font.
    const adv = stringWidth(f, font.size, str)
    const n6 = (v: number) => +v.toFixed(6)
    out.push(`<text x="0" y="0" transform="matrix(${n6(m[0])} ${n6(-m[1])} ${n6(-m[2])} ${n6(m[3])} ${fmt(x)} ${fmt(y)})" font-family="${family}" font-size="${n6(font.size)}"${bold}${ital} textLength="${n6(adv)}" lengthAdjust="spacingAndGlyphs" ${paintAttrs} xml:space="preserve">${text}</text>`)
    // advance along the text direction for the bounds
    const dx = Math.cos((ang * Math.PI) / -180), dy = Math.sin((ang * Math.PI) / -180)
    for (const t of [0, 1]) grow(x + dx * adv * scaleOf(m) * t, y - dy * adv * scaleOf(m) * t, size * 0.8)
  }
  const show = (str: string) => {
    const [ux, uy] = userPos()
    emitText(str, ux, uy, gs.font, gs.ctm, `fill="${gs.fill}"`)
    gs.cur = dev(ux + stringWidth(gs.font.name, gs.font.size, str), uy)
  }
  const rgb = (r: number, g: number, b: number) => `rgb(${[r, g, b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)).join(',')})`
  const hsb = (h: number, s: number, v: number) => {
    const f = (n: number) => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)) }
    return rgb(f(5), f(3), f(1))
  }

  const arc = (cx: number, cy: number, r: number, a1: number, a2: number, ccw: boolean) => {
    let s = (a1 * Math.PI) / 180, e = (a2 * Math.PI) / 180
    if (ccw) { while (e < s) e += 2 * Math.PI } else { while (e > s) e -= 2 * Math.PI }
    const n = Math.max(4, Math.ceil(Math.abs(e - s) / (Math.PI / 60)))
    for (let i = 0; i <= n; i++) {
      const a = s + ((e - s) * i) / n
      const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a)
      if (i === 0 && !gs.cur) { addSeg('M', x, y); gs.start = dev(x, y) } else addSeg('L', x, y)
      gs.cur = dev(x, y)
    }
  }

  const ops: Record<string, () => void> = {
    pop: () => { ostack.pop() },
    exch: () => { const b = ostack.pop(), a = ostack.pop(); ostack.push(b, a) },
    dup: () => { ostack.push(ostack[ostack.length - 1]) },
    copy: () => { const n = num(); ostack.push(...ostack.slice(ostack.length - n)) },
    index: () => { const n = num(); ostack.push(ostack[ostack.length - 1 - n]) },
    roll: () => {
      const j = num(), n = num()
      if (n <= 0) return
      const part = ostack.splice(ostack.length - n, n)
      const k = ((j % n) + n) % n
      ostack.push(...part.slice(n - k), ...part.slice(0, n - k))
    },
    clear: () => { ostack.length = 0 },
    count: () => { ostack.push(ostack.length) },
    mark: () => { ostack.push({ mark: true }) },
    '[': () => { ostack.push({ mark: true }) },
    cleartomark: () => { while (ostack.length && !ostack.pop()?.mark); },
    counttomark: () => { let i = ostack.length - 1; while (i >= 0 && !ostack[i]?.mark) i--; ostack.push(ostack.length - 1 - i) },
    ']': () => { const a: Obj[] = []; while (ostack.length) { const o = ostack.pop(); if (o?.mark) break; a.unshift(o) } ostack.push({ arr: a }) },
    add: () => { const b = num(), a = num(); ostack.push(a + b) },
    sub: () => { const b = num(), a = num(); ostack.push(a - b) },
    mul: () => { const b = num(), a = num(); ostack.push(a * b) },
    div: () => { const b = num(), a = num(); ostack.push(a / b) },
    idiv: () => { const b = num(), a = num(); ostack.push(Math.trunc(a / b)) },
    mod: () => { const b = num(), a = num(); ostack.push(a % b) },
    neg: () => { ostack.push(-num()) },
    abs: () => { ostack.push(Math.abs(num())) },
    sqrt: () => { ostack.push(Math.sqrt(num())) },
    sin: () => { ostack.push(Math.sin((num() * Math.PI) / 180)) },
    cos: () => { ostack.push(Math.cos((num() * Math.PI) / 180)) },
    atan: () => { const d = num(), n = num(); let a = (Math.atan2(n, d) * 180) / Math.PI; if (a < 0) a += 360; ostack.push(a) },
    exp: () => { const e = num(), b = num(); ostack.push(Math.pow(b, e)) },
    ln: () => { ostack.push(Math.log(num())) },
    log: () => { ostack.push(Math.log10(num())) },
    round: () => { ostack.push(Math.round(num())) },
    floor: () => { ostack.push(Math.floor(num())) },
    ceiling: () => { ostack.push(Math.ceil(num())) },
    truncate: () => { ostack.push(Math.trunc(num())) },
    cvi: () => { const v = ostack.pop(); ostack.push(Math.trunc(typeof v === 'number' ? v : parseFloat(v?.str ?? '0'))) },
    cvr: () => { const v = ostack.pop(); ostack.push(typeof v === 'number' ? v : parseFloat(v?.str ?? '0')) },
    cvs: () => { const s = ostack.pop(); const v = ostack.pop(); ostack.push({ str: String(isStr(v) ? v.str : isName(v) ? v.name : v) }); void s },
    // an executable string (GMT stores pens as strings: `PSL_path_pen 3 get cvx exec`) is tokenized and run by exec
    cvx: () => { const v = ostack.pop(); ostack.push(isName(v) ? { ...v, lit: false } : isStr(v) ? { ...v, xstr: true } : v) },
    cvlit: () => { const v = ostack.pop(); ostack.push(isName(v) ? { ...v, lit: true } : v) },
    eq: () => { const b = ostack.pop(), a = ostack.pop(); ostack.push((a?.str ?? a?.name ?? a) === (b?.str ?? b?.name ?? b)) },
    ne: () => { const b = ostack.pop(), a = ostack.pop(); ostack.push((a?.str ?? a?.name ?? a) !== (b?.str ?? b?.name ?? b)) },
    gt: () => { const b = num(), a = num(); ostack.push(a > b) },
    ge: () => { const b = num(), a = num(); ostack.push(a >= b) },
    lt: () => { const b = num(), a = num(); ostack.push(a < b) },
    le: () => { const b = num(), a = num(); ostack.push(a <= b) },
    and: () => { const b = ostack.pop(), a = ostack.pop(); ostack.push(typeof a === 'boolean' ? a && b : a & b) },
    or: () => { const b = ostack.pop(), a = ostack.pop(); ostack.push(typeof a === 'boolean' ? a || b : a | b) },
    not: () => { const a = ostack.pop(); ostack.push(typeof a === 'boolean' ? !a : ~a) },
    true: () => { ostack.push(true) },
    false: () => { ostack.push(false) },
    bind: () => {},
    def: () => { const v = ostack.pop(), k = ostack.pop(); dstack[dstack.length - 1].set(k.name ?? k.str, v); opts.onDef?.(k.name ?? k.str, v) },
    load: () => { const k = ostack.pop(); ostack.push(lookup(k.name)) },
    store: () => { const v = ostack.pop(), k = ostack.pop(); for (let i = dstack.length - 1; i >= 0; i--) if (dstack[i].has(k.name)) { dstack[i].set(k.name, v); return } dstack[dstack.length - 1].set(k.name, v) },
    known: () => { const k = ostack.pop(), d = ostack.pop(); ostack.push(d?.dict?.has(k.name ?? k.str)) },
    where: () => { const k = ostack.pop(); const f = dstack.some((d) => d.has(k.name)); if (f) ostack.push({ dict: systemdict }); ostack.push(f) },
    dict: () => { ostack.pop(); ostack.push({ dict: new Map() }) },
    begin: () => { const d = ostack.pop(); dstack.push(d.dict) },
    end: () => { if (dstack.length > 2) dstack.pop() },
    countdictstack: () => { ostack.push(dstack.length) },
    cleardictstack: () => { while (dstack.length > 2) dstack.pop() },
    currentdict: () => { ostack.push({ dict: dstack[dstack.length - 1] }) },
    userdict: () => { ostack.push({ dict: userdict }) },
    systemdict: () => { ostack.push({ dict: systemdict }) },
    globaldict: () => { ostack.push({ dict: userdict }) },
    '<<': () => { ostack.push({ mark: true }) },
    '>>': () => { const items: Obj[] = []; while (ostack.length) { const o = ostack.pop(); if (o?.mark) break; items.unshift(o) } const m = new Map(); for (let i = 0; i + 1 < items.length; i += 2) m.set(items[i].name, items[i + 1]); ostack.push({ dict: m }) },
    array: () => { const n = num(); ostack.push({ arr: new Array(n).fill(0) }) },
    length: () => { const o = ostack.pop(); ostack.push(o?.arr?.length ?? o?.str?.length ?? o?.dict?.size ?? o?.proc?.length ?? 0) },
    get: () => { const i = ostack.pop(), o = ostack.pop(); if (o?.dict) ostack.push(o.dict.get(i.name ?? i.str)); else if (o?.arr) ostack.push(o.arr[i]); else if (o?.str !== undefined) ostack.push(o.str.charCodeAt(i)); else ostack.push(0) },
    put: () => { const v = ostack.pop(), i = ostack.pop(), o = ostack.pop(); if (o?.dict) o.dict.set(i.name ?? i.str, v); else if (o?.arr) o.arr[i] = v; else if (o?.str !== undefined) o.str = o.str.slice(0, i) + String.fromCharCode(v) + o.str.slice(i + 1) },
    aload: () => { const a = ostack.pop(); ostack.push(...(a.arr ?? a.proc ?? []), a) },
    astore: () => { const a = ostack.pop(); const n = a.arr.length; a.arr = ostack.splice(ostack.length - n, n); ostack.push(a) },
    string: () => { const n = num(); ostack.push({ str: ' '.repeat(n) }) },
    search: () => { const seek = ostack.pop(), s = ostack.pop(); const i = s.str.indexOf(seek.str); if (i < 0) ostack.push(s, false); else ostack.push({ str: s.str.slice(i + seek.str.length) }, { str: seek.str }, { str: s.str.slice(0, i) }, true) },
    // control
    if: () => { const p = ostack.pop(), c = ostack.pop(); if (c) exec(p) },
    ifelse: () => { const f = ostack.pop(), t = ostack.pop(), c = ostack.pop(); exec(c ? t : f) },
    exec: () => { exec(ostack.pop()) },
    repeat: () => { const p = ostack.pop(), n = num(); try { for (let i = 0; i < n; i++) exec(p) } catch (e) { if (!(e instanceof ExitLoop)) throw e } },
    for: () => { const p = ostack.pop(), lim = num(), inc = num(), ini = num(); try { for (let i = ini; inc > 0 ? i <= lim : i >= lim; i += inc) { ostack.push(i); exec(p) } } catch (e) { if (!(e instanceof ExitLoop)) throw e } },
    loop: () => { const p = ostack.pop(); try { for (;;) exec(p) } catch (e) { if (!(e instanceof ExitLoop)) throw e } },
    forall: () => { const p = ostack.pop(), o = ostack.pop(); try { for (const v of o.arr ?? o.proc ?? []) { ostack.push(v); exec(p) } } catch (e) { if (!(e instanceof ExitLoop)) throw e } },
    exit: () => { throw new ExitLoop() },
    stop: () => { throw new Quit() },
    quit: () => { throw new Quit() },
    showpage: () => {},
    // save/restore snapshot the graphics state (GMT's EPS inclusion relies on restore undoing the EPS's scale/clip)
    save: () => { ostack.push({ saved: { gs: { ...gs, ctm: [...gs.ctm] as Mat, path: [...gs.path], dash: [...gs.dash], font: { ...gs.font }, runs: [...gs.runs] }, depth: gsStack.length } }) },
    restore: () => {
      const o = ostack.pop()
      if (!o?.saved) return
      for (let i = gs.clipDepth; i > o.saved.gs.clipDepth; i--) out.push('</g>')
      gs = o.saved.gs
      gsStack.length = Math.min(gsStack.length, o.saved.depth)
    },
    // graphics state
    gsave, grestore, grestoreall: () => { while (gsStack.length) grestore() },
    initgraphics: () => {},
    newpath: () => { gs.path = []; gs.runs = []; gs.cur = null },
    moveto: () => { const y = num(), x = num(); addSeg('M', x, y); gs.cur = gs.start = dev(x, y) },
    rmoveto: () => { const dy = num(), dx = num(); const [cx, cy] = userPos(); addSeg('M', cx + dx, cy + dy); gs.cur = gs.start = dev(cx + dx, cy + dy) },
    lineto: () => { const y = num(), x = num(); addSeg('L', x, y); gs.cur = dev(x, y) },
    rlineto: () => { const dy = num(), dx = num(); const [cx, cy] = userPos(); addSeg('L', cx + dx, cy + dy); gs.cur = dev(cx + dx, cy + dy) },
    curveto: () => { const y3 = num(), x3 = num(), y2 = num(), x2 = num(), y1 = num(), x1 = num(); addSeg('C', x3, y3, [x1, y1, x2, y2]); gs.cur = dev(x3, y3) },
    rcurveto: () => { const d = [num(), num(), num(), num(), num(), num()].reverse(); const [cx, cy] = userPos(); addSeg('C', cx + d[4], cy + d[5], [cx + d[0], cy + d[1], cx + d[2], cy + d[3]]); gs.cur = dev(cx + d[4], cy + d[5]) },
    arct: () => {
      // x1 y1 x2 y2 r arct: line to the first tangent point, then a circular arc of radius r (rounded corners)
      const r = num(), y2 = num(), x2 = num(), y1 = num(), x1 = num()
      const [x0, y0] = userPos()
      let ax = x0 - x1, ay = y0 - y1, bx = x2 - x1, by = y2 - y1
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by)
      if (la < 1e-9 || lb < 1e-9 || r <= 0) { addSeg('L', x1, y1); gs.cur = dev(x1, y1); return }
      ax /= la; ay /= la; bx /= lb; by /= lb
      const cosT = Math.max(-1, Math.min(1, ax * bx + ay * by))
      const theta = Math.acos(cosT)
      if (Math.abs(Math.sin(theta)) < 1e-6) { addSeg('L', x1, y1); gs.cur = dev(x1, y1); return }
      const dist = r / Math.tan(theta / 2)
      const t1x = x1 + ax * dist, t1y = y1 + ay * dist, t2x = x1 + bx * dist, t2y = y1 + by * dist
      let mx = ax + bx, my = ay + by; const lm = Math.hypot(mx, my); mx /= lm; my /= lm
      const cd = r / Math.sin(theta / 2)
      const cx = x1 + mx * cd, cy = y1 + my * cd
      addSeg(gs.path.length ? 'L' : 'M', t1x, t1y); gs.cur = dev(t1x, t1y)
      const left = (x1 - x0) * (y2 - y1) - (y1 - y0) * (x2 - x1) > 0
      arc(cx, cy, r, (Math.atan2(t1y - cy, t1x - cx) * 180) / Math.PI, (Math.atan2(t2y - cy, t2x - cx) * 180) / Math.PI, left)
    },
    closepath: () => { if (gs.path.length) gs.path.push({ op: 'Z', p: [] }); if (gs.start) gs.cur = gs.start },
    arc: () => { const a2 = num(), a1 = num(), r = num(), y = num(), x = num(); arc(x, y, r, a1, a2, true) },
    arcn: () => { const a2 = num(), a1 = num(), r = num(), y = num(), x = num(); arc(x, y, r, a1, a2, false) },
    currentpoint: () => { ostack.push(...userPos()) },
    stroke: () => paint('stroke'), fill: () => paint('fill'), eofill: () => paint('eofill'),
    clip: () => clip('nonzero'), eoclip: () => clip('evenodd'), clippath: () => { gs.path = []; addSeg('M', -1e5, -1e5); addSeg('L', 1e5, -1e5); addSeg('L', 1e5, 1e5); addSeg('L', -1e5, 1e5); gs.path.push({ op: 'Z', p: [] }) },
    rectfill: () => { const h = num(), w = num(), y = num(), x = num(); gs.path = []; addSeg('M', x, y); addSeg('L', x + w, y); addSeg('L', x + w, y + h); addSeg('L', x, y + h); gs.path.push({ op: 'Z', p: [] }); paint('fill') },
    rectclip: () => { const h = num(), w = num(), y = num(), x = num(); gs.path = []; addSeg('M', x, y); addSeg('L', x + w, y); addSeg('L', x + w, y + h); addSeg('L', x, y + h); gs.path.push({ op: 'Z', p: [] }); clip('nonzero') },
    setrgbcolor: () => { const b = num(), g = num(), r = num(); gs.fill = rgb(r, g, b) },
    setgray: () => { const g = num(); gs.fill = rgb(g, g, g) },
    sethsbcolor: () => { const b = num(), s = num(), h = num(); gs.fill = hsb(h, s, b) },
    setcmykcolor: () => { const k = num(), y = num(), m = num(), c = num(); gs.fill = rgb((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)) },
    setlinewidth: () => { gs.lw = num() },
    setlinecap: () => { gs.cap = num() }, setlinejoin: () => { gs.join = num() }, setmiterlimit: () => { num() }, setflat: () => { num() },
    setdash: () => { const ph = num(), a = ostack.pop(); gs.dash = (a.arr ?? []).filter((x: Obj) => typeof x === 'number'); gs.dashPhase = ph; if (gs.dash.every((d) => d === 0)) gs.dash = [] },
    // matrices
    translate: () => { const ty = num(), tx = num(); gs.ctm = mul([1, 0, 0, 1, tx, ty], gs.ctm) },
    scale: () => { const sy = num(), sx = num(); gs.ctm = mul([sx, 0, 0, sy, 0, 0], gs.ctm) },
    rotate: () => { const a = (num() * Math.PI) / 180; const c = Math.cos(a), s = Math.sin(a); gs.ctm = mul([c, s, -s, c, 0, 0], gs.ctm) },
    concat: () => { const a = ostack.pop().arr as number[]; gs.ctm = mul(a as Mat, gs.ctm) },
    matrix: () => { ostack.push({ arr: [1, 0, 0, 1, 0, 0] }) },
    currentmatrix: () => { const m = ostack.pop(); m.arr = [...gs.ctm]; ostack.push(m) },
    setmatrix: () => { gs.ctm = [...ostack.pop().arr] as Mat },
    defaultmatrix: () => { const m = ostack.pop(); m.arr = [1, 0, 0, 1, 0, 0]; ostack.push(m) },
    transform: () => { const y = num(), x = num(); ostack.push(...apply(gs.ctm, x, y)) },
    itransform: () => { const y = num(), x = num(); ostack.push(...apply(inv(gs.ctm), x, y)) },
    dtransform: () => { const dy = num(), dx = num(); ostack.push(dx * gs.ctm[0] + dy * gs.ctm[2], dx * gs.ctm[1] + dy * gs.ctm[3]) },
    idtransform: () => { const dy = num(), dx = num(); const i = inv(gs.ctm); ostack.push(dx * i[0] + dy * i[2], dx * i[1] + dy * i[3]) },
    // text
    currentfile: () => { ostack.push({ str: '' }) },
    filter: () => {
      const name = ostack.pop(), srcObj = ostack.pop()
      const m = /^@@IMG(\d+)@@$/.exec(srcObj?.str ?? '')
      ostack.push({ filt: { key: m ? +m[1] : srcObj?.filt?.key ?? -1, chain: [...(srcObj?.filt?.chain ?? []), name?.name ?? name?.str ?? ''] } })
    },
    setcolorspace: () => {
      const o = ostack.pop()
      const nm = (x: Obj) => (x?.name ?? x?.str ?? '') as string
      if (o?.arr) {
        const [kind, base, hival, lookup] = o.arr
        if (nm(kind) === 'Indexed') {
          const bytes = Uint8Array.from(Array.from((lookup?.str ?? '') as string, (c) => c.charCodeAt(0) & 255))
          gs.cs = { kind: 'indexed', base: nm(base) === 'DeviceGray' ? 'gray' : 'rgb', hival: Number(hival) || 0, lookup: bytes }
          return
        }
      }
      gs.cs = nm(o?.arr?.[0] ?? o) === 'DeviceGray' ? { kind: 'gray' } : { kind: 'rgb' }
    },
    image: () => {
      const d = ostack.pop()?.dict as Map<string, Obj> | undefined
      if (!d) { warnings.add('image: unsupported operand form'); return }
      const w = Number(d.get('Width')), h = Number(d.get('Height')), bpc = Number(d.get('BitsPerComponent') ?? 8)
      const ds = d.get('DataSource')
      if (!ds?.filt || ds.filt.key < 0 || !w || !h) { warnings.add('image: unsupported data source'); return }
      let rgb: Uint8Array
      try {
        const data = applyFilters(extracted.images[ds.filt.key] ?? '', ds.filt.chain)
        const dec = ((d.get('Decode')?.arr as Obj[] | undefined) ?? []).map(Number)
        rgb = samplesToRgb(data, w, h, bpc, gs.cs, dec.length ? dec : gs.cs.kind === 'indexed' ? [0, (1 << bpc) - 1] : [0, 1, 0, 1, 0, 1])
      } catch (e) { warnings.add(`image: ${(e as Error).message}`); return }
      const im = ((d.get('ImageMatrix')?.arr as Obj[] | undefined) ?? [w, 0, 0, -h, 0, h]).map(Number) as Mat
      const toDevice = mul(mul(inv(im), gs.ctm), [1, 0, 0, -1, -bx0, H + by0])
      const png = toBase64(pngEncode(rgb, w, h))
      // Hard pixels only when the image is shown at about its own size; scaled up or down it is interpolated, so a
      // coarse grid (a 1 degree map over 9 inches) does not turn into big squares and a dense one does not alias.
      const sx = Math.hypot(toDevice[0], toDevice[1]), sy = Math.hypot(toDevice[2], toDevice[3])
      const native = sx > 0.85 && sx < 1.15 && sy > 0.85 && sy < 1.15
      out.push(`<image width="${w}" height="${h}" preserveAspectRatio="none"${native ? ' image-rendering="pixelated"' : ''} transform="matrix(${toDevice.map((v) => +v.toFixed(6)).join(' ')})" href="data:image/png;base64,${png}"/>`)
      for (const [cx, cy] of [[0, 0], [w, 0], [0, h], [w, h]]) { const [gx, gy] = apply(toDevice, cx, cy); grow(gx, gy) }
    },
    findfont: () => { const n = ostack.pop(); ostack.push({ font: n.name ?? n.str, size: 1 }) },
    scalefont: () => { const s = num(); const f = ostack.pop(); ostack.push({ ...f, size: f.size * s }) },
    makefont: () => { const m = ostack.pop().arr as number[]; const f = ostack.pop(); ostack.push({ ...f, size: f.size * Math.hypot(m[0], m[1]) }) },
    setfont: () => { const f = ostack.pop(); if (f?.font) gs.font = { name: f.font, size: f.size } },
    selectfont: () => { const s = num(); const n = ostack.pop(); gs.font = { name: n.name ?? n.str, size: s } },
    definefont: () => { const f = ostack.pop(); ostack.pop(); ostack.push(f) },
    currentfont: () => { ostack.push({ font: gs.font.name, size: gs.font.size }) },
    show: () => show(ostack.pop().str),
    stringwidth: () => { const s = ostack.pop().str; ostack.push(stringWidth(gs.font.name, gs.font.size, s), 0) },
    pathbbox: () => {
      // bounding box of the current path in the current user space
      const i = inv(gs.ctm)
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const sg of gs.path) for (let k = 0; k + 1 < sg.p.length; k += 2) {
        const [ux, uy] = apply(i, sg.p[k] + bx0, H - sg.p[k + 1] + by0)
        x0 = Math.min(x0, ux); y0 = Math.min(y0, uy); x1 = Math.max(x1, ux); y1 = Math.max(y1, uy)
      }
      if (!isFinite(x0)) { ostack.push(0, 0, 0, 0); return }
      ostack.push(x0, y0, x1, y1)
    },
    clipsave: () => { clipStack.push(gs.clipDepth) },
    cliprestore: () => { const d = clipStack.pop(); if (d !== undefined) { for (let i = gs.clipDepth; i > d; i--) out.push('</g>'); gs.clipDepth = d } },
    charpath: () => {
      // approximated by the glyph box: enough for GMT's text-size measurements (sw/sh/sd macros)
      ostack.pop()
      const str = ostack.pop()?.str ?? ''
      const [cx, cy] = userPos()
      const [llx, lly, urx, ury] = glyphBox(gs.font.name, gs.font.size, str)
      const from = gs.path.length
      addSeg('M', cx + llx, cy + lly); addSeg('L', cx + urx, cy + lly); addSeg('L', cx + urx, cy + ury); addSeg('L', cx + llx, cy + ury)
      gs.path.push({ op: 'Z', p: [] })
      gs.runs.push({ text: str, ux: cx, uy: cy, font: { ...gs.font }, m: [...gs.ctm] as Mat, from, to: gs.path.length })
      // like show, charpath leaves the current point after the glyphs, so the next charpath continues the line
      gs.cur = dev(cx + stringWidth(gs.font.name, gs.font.size, str), cy)
    },
    flattenpath: () => {}, setstrokeadjust: () => { ostack.pop() }, setoverprint: () => { ostack.pop() },
    currentflat: () => { ostack.push(1) },
    pagesize: () => {}, setpagedevice: () => { ostack.pop() },
    usertime: () => { ostack.push(0) }, realtime: () => { ostack.push(0) }, srand: () => { ostack.pop() }, rand: () => { ostack.push(0) },
    languagelevel: () => { ostack.push(2) },
    version: () => { ostack.push({ str: '3010' }) },
  }
  class ExitLoop extends Error {}
  for (const k of Object.keys(ops)) systemdict.set(k, { op: k })
  systemdict.set('null', null)

  function exec(o: Obj) {
    if (isProc(o)) { runTokens(o.proc); return }
    if (isName(o) && !o.lit) { execName(o.name); return }
    if (isStr(o) && o.xstr) { runTokens(tokenize(o.str)); return }
    ostack.push(o)
  }
  function execName(name: string) {
    if (++steps > MAX_STEPS) throw new Quit()
    const v = lookup(name)
    if (v === undefined) { warnings.add(`unknown operator: ${name}`); return }
    if (v && v.op) { ops[v.op](); return }
    if (isProc(v)) { runTokens(v.proc); return }
    if (isName(v) && !v.lit) { execName(v.name); return }
    ostack.push(v)
  }
  function runTokens(toks: Obj[]) {
    for (const t of toks) {
      if (isName(t) && !t.lit) execName(t.name)
      else ostack.push(t)
    }
  }

  // Top-level: drop %%BeginSetup-style comments (tokenizer strips all comments); GMT output has a flat structure.
  try {
    runTokens(tokenize(extracted.src))
  } catch (e) {
    if (!(e instanceof Quit) && !(e instanceof ExitLoop)) warnings.add(`interpreter error: ${(e as Error).message}`)
  }
  while (gs.clipDepth-- > 0) out.push('</g>')
  const M = 10
  const cropped = isFinite(bnd.x0) && bnd.x1 > bnd.x0 && bnd.y1 > bnd.y0
  // Crop to what was painted. Not clamped to the page: figures (e.g. stacked panels via -Y) can be larger than one page.
  const vx = cropped ? bnd.x0 - M : 0
  const vy = cropped ? bnd.y0 - M : 0
  const vw = cropped ? bnd.x1 + M - vx : W
  const vh = cropped ? bnd.y1 + M - vy : H
  // GMT plots wider than the page in landscape; psconvert -P rotates those back to portrait, so do the same.
  const landscape = /%%Orientation:\s*Landscape/.test(src)
  const body = `<rect x="${fmt(vx)}" y="${fmt(vy)}" width="${fmt(vw)}" height="${fmt(vh)}" fill="white"/><defs>${defs.join('')}</defs>${out.join('')}`
  const svg = landscape
    ? `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(vh)}" height="${fmt(vw)}" viewBox="0 0 ${fmt(vh)} ${fmt(vw)}"><g transform="translate(${fmt(vh)} 0) rotate(90) translate(${fmt(-vx)} ${fmt(-vy)})">${body}</g></svg>`
    : `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(vw)}" height="${fmt(vh)}" viewBox="${fmt(vx)} ${fmt(vy)} ${fmt(vw)} ${fmt(vh)}">${body}</svg>`
  return { svg, warnings: [...warnings] }
}
