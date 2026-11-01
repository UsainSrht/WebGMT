/** Fallback engine used when public/gmt/gmt.wasm is not present. It understands a small, commonly used
 *  subset of GMT (basemap, coast, plot, text, makecpt, colorbar, contour) and draws SVG directly.
 *  Coastlines are crude hand-made outlines, NOT GSHHG data. */
export interface CmdItem { line: number; module: string; args: string[] }

type Emit = (stream: 'stdout' | 'stderr' | 'info', text: string, line?: number) => void
const CM = 72 / 2.54

const LAND: number[][][] = [
  [[-168,66],[-157,71],[-140,70],[-125,70],[-95,72],[-82,68],[-80,63],[-93,59],[-88,56],[-79,52],[-78,62],[-70,60],[-62,57],[-56,52],[-65,47],[-70,43],[-76,38],[-81,31],[-80,26],[-83,29],[-90,30],[-97,27],[-97,21],[-91,19],[-88,21],[-87,16],[-83,10],[-79,9],[-77,8],[-83,8],[-86,12],[-92,15],[-97,16],[-105,20],[-110,24],[-115,29],[-117,32],[-121,35],[-124,40],[-124,47],[-130,54],[-137,58],[-148,60],[-153,58],[-162,55],[-165,62]],
  [[-77,8],[-72,12],[-62,10],[-52,5],[-50,0],[-45,-3],[-35,-6],[-39,-14],[-41,-22],[-48,-26],[-53,-34],[-58,-38],[-65,-41],[-66,-47],[-69,-52],[-68,-55],[-74,-52],[-74,-42],[-72,-30],[-70,-18],[-76,-14],[-81,-5],[-80,0],[-78,3]],
  [[-17,21],[-10,30],[-6,36],[10,37],[20,32],[32,31],[35,28],[43,12],[51,12],[41,-2],[40,-15],[35,-24],[33,-29],[26,-34],[18,-34],[12,-18],[13,-9],[9,-1],[9,4],[-8,4],[-13,8],[-17,14]],
  [[-9,37],[-9,43],[-1,46],[-4,48],[2,51],[8,54],[10,57],[12,55],[20,55],[24,60],[30,60],[22,65],[15,69],[5,62],[5,58],[8,63],[15,69],[30,71],[45,68],[60,69],[80,73],[105,78],[130,72],[160,70],[180,69],[180,65],[170,60],[163,58],[156,51],[143,59],[135,55],[141,52],[140,46],[131,42],[129,35],[126,38],[122,40],[121,31],[120,25],[110,20],[108,16],[109,12],[105,9],[100,13],[100,5],[103,1],[98,8],[94,17],[90,22],[80,15],[77,8],[73,17],[67,24],[58,23],[52,17],[43,13],[39,21],[35,28],[34,31],[36,36],[30,36],[27,37],[26,40],[23,40],[22,37],[19,41],[14,45],[12,44],[16,40],[15,38],[8,44],[3,43],[-1,37],[-6,36]],
  [[114,-22],[122,-18],[130,-12],[137,-12],[142,-11],[146,-19],[153,-26],[150,-37],[141,-38],[135,-34],[129,-32],[115,-34]],
  [[-73,78],[-60,82],[-30,83],[-20,75],[-22,70],[-40,65],[-44,60],[-52,64],[-55,70]],
  [[-180,-70],[-120,-74],[-60,-64],[-60,-75],[0,-70],[60,-67],[120,-66],[180,-70],[180,-90],[-180,-90]],
  [[-5,50],[1,51],[0,54],[-3,58],[-6,57]],
  [[130,31],[135,34],[140,36],[142,40],[141,45],[140,41],[136,36]],
]

const NAMED: Record<string, string> = { tan: '#d2b48c', lightblue: '#add8e6', lightcyan: '#e0ffff', gray: '#808080', grey: '#808080' }
function color(s: string | undefined, fallback = 'black'): string {
  if (!s) return fallback
  if (/^\d+\/\d+\/\d+$/.test(s)) return `rgb(${s.split('/').join(',')})`
  if (/^\d+$/.test(s)) return `rgb(${s},${s},${s})`
  if (/^#[0-9a-f]{3,8}$/i.test(s)) return s
  const m = /^(gr[ae]y)(\d+)$/i.exec(s)
  if (m) { const v = Math.round(2.55 * +m[2]); return `rgb(${v},${v},${v})` }
  return NAMED[s.toLowerCase()] ?? s
}
function toPt(v: string): number {
  const m = /^([\d.]+)([cip]?)$/.exec(v)
  if (!m) return NaN
  return +m[1] * (m[2] === 'i' ? 72 : m[2] === 'p' ? 1 : CM)
}
function pen(s: string | undefined, def = '0.25p,black') {
  const [w, c, dash] = (s ?? def).split(',')
  const width = /^[\d.]+/.test(w) ? parseFloat(w) * (w.endsWith('c') ? CM : w.endsWith('i') ? 72 : 1) : 0.25
  return { width, color: color(c ?? (/^[\d.]+/.test(w) ? 'black' : w)), dash: dash ? '4,3' : '' }
}

const CPTS: Record<string, string[]> = {
  viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
  hot: ['#000000', '#e60000', '#ffa500', '#ffff66', '#ffffff'],
  jet: ['#00007f', '#0000ff', '#00ffff', '#ffff00', '#ff0000', '#7f0000'],
  rainbow: ['#7f00ff', '#0000ff', '#00ff00', '#ffff00', '#ff0000'],
  cool: ['#00ffff', '#ff00ff'],
  gray: ['#000000', '#ffffff'],
  polar: ['#0000ff', '#ffffff', '#ff0000'],
  topo: ['#264d99', '#3399cc', '#99cc66', '#e6d98c', '#a67c52', '#ffffff'],
}
function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
interface Cpt { stops: string[]; z0: number; z1: number }
function cptColor(c: Cpt, z: number) {
  const t = Math.min(1, Math.max(0, (z - c.z0) / (c.z1 - c.z0 || 1))) * (c.stops.length - 1)
  const i = Math.min(c.stops.length - 2, Math.floor(t))
  const a = hex(c.stops[i]), b = hex(c.stops[i + 1]), f = t - i
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')})`
}

function niceStep(range: number) {
  const raw = range / 6
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / p
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p
}
const fmt = (v: number) => (Math.abs(v) < 1e-9 ? '0' : String(+v.toFixed(6)))
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

interface View {
  w: number; e: number; s: number; n: number
  proj: string
  W: number; H: number
  fx(lon: number): number
  fy(lat: number, lon: number): number
}

function makeView(R: number[], jArg: string): View | string {
  const [w, e, s, n] = R
  const proj = jArg[0]?.toUpperCase() ?? 'X'
  const parts = jArg.slice(1).split('/')
  const dims = parts.map(toPt).filter((v) => !isNaN(v))
  if (dims.length === 0) return `-J${jArg}: could not find a plot width`
  const width = dims[0 + (proj === 'X' ? 0 : dims.length - 1)]
  if (proj === 'X') {
    const height = dims[1] ?? 10 * CM
    return { w, e, s, n, proj, W: width, H: height, fx: (x) => ((x - w) / (e - w)) * width, fy: (y) => ((y - s) / (n - s)) * height }
  }
  if (proj === 'M') {
    const m = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * Math.PI) / 360))
    const k = width / (((e - w) * Math.PI) / 180)
    const y0 = m(s)
    const H = (m(n) - y0) * k
    return { w, e, s, n, proj, W: width, H, fx: (x) => ((x - w) / (e - w)) * width, fy: (y) => (m(y) - y0) * k }
  }
  if (proj === 'W') {
    const lon0 = (w + e) / 2
    const moll = (lon: number, lat: number) => {
      const phi = (lat * Math.PI) / 180
      let th = phi
      for (let i = 0; i < 12 && Math.abs(Math.abs(phi) - Math.PI / 2) > 1e-6; i++) th -= (2 * th + Math.sin(2 * th) - Math.PI * Math.sin(phi)) / (2 + 2 * Math.cos(2 * th))
      return [(2 * Math.SQRT2 / Math.PI) * ((lon - lon0) * Math.PI / 180) * Math.cos(th), Math.SQRT2 * Math.sin(th)]
    }
    const k = width / (4 * Math.SQRT2)
    return { w, e, s, n, proj, W: width, H: width / 2, fx: (x, ) => width / 2 + moll(x, 0)[0] * k, fy: (y, x) => width / 4 + moll(x, y)[1] * k }
  }
  // all other projections: plate carrée fallback
  const k = width / (e - w)
  return { w, e, s, n, proj, W: width, H: (n - s) * k, fx: (x) => (x - w) * k, fy: (y) => (y - s) * k }
}

function parseRegion(a: string): number[] | null {
  if (a === 'g') return [0, 360, -90, 90]
  if (a === 'd') return [-180, 180, -90, 90]
  const v = a.split('/').map(Number)
  return v.length >= 4 && v.slice(0, 4).every((x) => !isNaN(x)) ? v : null
}

function readTable(data: Uint8Array | undefined): number[][] {
  if (!data) return []
  return new TextDecoder().decode(data).split(/\r?\n/).filter((l) => l.trim() && !/^[#>]/.test(l.trim()))
    .map((l) => l.trim().split(/[\s,;]+/).map(Number)).filter((r) => r.length >= 2 && !isNaN(r[0]) && !isNaN(r[1]))
}

/** Stateful mock: call exec() once per GMT command (returns an SVG when a figure is finished by `end`),
 *  and finish() at the end of the script to flush a figure that was never closed. */
export function createMock(files: Map<string, Uint8Array>, emit: Emit) {
  let R = null as number[] | null
  let view = null as View | null
  let jArg = ''
  let cpt = null as Cpt | null
  let defs = ''
  let body = ''
  let clipN = 0
  let colorbar = ''
  let title = ''
  let drewAnything = false

  const setup = (args: string[], line: number): boolean => {
    for (const a of args) {
      if (a.startsWith('-R')) { const r = parseRegion(a.slice(2)); if (r) R = r; else emit('stderr', `mock engine: -R${a.slice(2)} not understood`, line) }
      if (a.startsWith('-J')) jArg = a.slice(2)
    }
    if (!R || !jArg) return !!view
    const v = makeView(R, jArg)
    if (typeof v === 'string') { emit('stderr', `gmt [ERROR]: ${v}`, line); return false }
    if (!view || view.W !== v.W || view.proj !== v.proj) view = v
    return true
  }
  const px = (x: number, y: number) => `${view!.fx(x).toFixed(2)},${(view!.H - view!.fy(y, x)).toFixed(2)}`
  const frameClip = () => {
    const id = `c${clipN++}`
    const shape = view!.proj === 'W'
      ? `<ellipse cx="${view!.W / 2}" cy="${view!.H / 2}" rx="${view!.W / 2}" ry="${view!.H / 2}"/>`
      : `<rect width="${view!.W}" height="${view!.H}"/>`
    defs += `<clipPath id="${id}">${shape}</clipPath>`
    return id
  }

  const finish = () => {
    if (!view || !drewAnything) return undefined
    const M = 48, top = title ? 54 : 30, bottom = colorbar ? 100 : 44
    const W = view.W + M + 24, H = view.H + top + bottom
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(1)}" height="${H.toFixed(1)}" viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}" font-family="Helvetica, Arial, sans-serif"><rect width="100%" height="100%" fill="white"/><defs>${defs}</defs><g transform="translate(${M},${top})">${body}${title ? `<text x="${view.W / 2}" y="-18" text-anchor="middle" font-size="16">${esc(title)}</text>` : ''}${colorbar}</g></svg>`
  }

  const exec = (c: CmdItem, stdin?: string): string | undefined => {
    const args = c.args
    const opt = (p: string) => args.find((a) => a.startsWith(p))?.slice(p.length)
    const pos = args.filter((a) => !a.startsWith('-'))
    switch (c.module) {
      case 'begin': case 'figure': case 'end': case 'clear': case 'set': case 'gmtset': case 'inset': case 'subplot':
        if (c.module === 'end') {
          const svg = finish()
          if (svg) return svg
        }
        break
      case 'basemap': {
        if (!setup(args, c.line) || !view) { emit('stderr', 'gmt [ERROR]: basemap needs -R and -J', c.line); break }
        drewAnything = true
        const bTitle = args.filter((a) => a.startsWith('-B')).map((a) => /\+t(.+)$/.exec(a)?.[1]).find(Boolean)
        if (bTitle) title = bTitle
        const bargs = args.filter((a) => a.startsWith('-B')).map((a) => a.slice(2).replace(/\+.*$/, '').replace(/^[xy]/, ''))
        const grid = bargs.some((b) => b.includes('g'))
        const num = (b: string) => parseFloat(/a(\d+\.?\d*)/.exec(b)?.[1] ?? '')
        const stepX = bargs.map(num).find((v) => !isNaN(v)) ?? niceStep(view.e - view.w)
        const stepY = bargs.map(num).find((v) => !isNaN(v)) ?? niceStep(view.n - view.s)
        const sx = args.find((a) => a.startsWith('-Bx')), sy = args.find((a) => a.startsWith('-By'))
        const stX = sx ? num(sx) || stepX : stepX, stY = sy ? num(sy) || stepY : stepY
        let g = ''
        const gridCol = '#cfcfcf'
        for (let x = Math.ceil(view.w / stX) * stX; x <= view.e + 1e-9; x += stX) {
          const p = view.fx(x)
          if (grid) g += `<line x1="${p}" y1="0" x2="${p}" y2="${view.H}" stroke="${gridCol}" stroke-width="0.4"/>`
          g += `<line x1="${p}" y1="${view.H}" x2="${p}" y2="${view.H + 4}" stroke="black"/><text x="${p}" y="${view.H + 16}" font-size="10" text-anchor="middle">${fmt(x)}</text>`
        }
        for (let y = Math.ceil(view.s / stY) * stY; y <= view.n + 1e-9; y += stY) {
          const p = view.H - view.fy(y, view.w)
          if (grid) g += `<line x1="0" y1="${p}" x2="${view.W}" y2="${p}" stroke="${gridCol}" stroke-width="0.4"/>`
          g += `<line x1="-4" y1="${p}" x2="0" y2="${p}" stroke="black"/><text x="-8" y="${p + 3.5}" font-size="10" text-anchor="end">${fmt(y)}</text>`
        }
        body += view.proj === 'W'
          ? `<ellipse cx="${view.W / 2}" cy="${view.H / 2}" rx="${view.W / 2}" ry="${view.H / 2}" fill="none" stroke="black" stroke-width="1.2"/>`
          : `<rect width="${view.W}" height="${view.H}" fill="none" stroke="black" stroke-width="1.2"/>` + g
        break
      }
      case 'coast': {
        if (!setup(args, c.line) || !view) { emit('stderr', 'gmt [ERROR]: coast needs -R and -J', c.line); break }
        drewAnything = true
        const land = opt('-G'), sea = opt('-S'), w = opt('-W')
        const id = frameClip()
        let s = ''
        if (sea) s += `<rect width="${view.W}" height="${view.H}" fill="${color(sea)}"/>`
        const p = w !== undefined ? pen(w || undefined) : null
        for (const poly of LAND) {
          for (const shift of [-360, 0, 360]) {
            if (view.w > 180 + 1 && shift === -360) continue
            const d = poly.map(([x, y], i) => `${i ? 'L' : 'M'}${px(x + shift, y)}`).join('') + 'Z'
            s += `<path d="${d}" fill="${land ? color(land) : 'none'}" ${p ? `stroke="${p.color}" stroke-width="${p.width}"` : ''}/>`
          }
        }
        body = body.replace(/^/, `<g clip-path="url(#${id})">${s}</g>`)
        emit('info', 'mock engine: coast uses a crude built-in outline, not GSHHG', c.line)
        break
      }
      case 'makecpt': case 'grd2cpt': {
        const name = (opt('-C') ?? 'viridis').replace(/^@?/, '')
        let stops = CPTS[name.replace(/^-/, '')] ?? CPTS.viridis
        if (!CPTS[name.replace(/^-/, '')]) emit('stderr', `mock engine: palette "${name}" unknown, using viridis`, c.line)
        if (args.includes('-G') || opt('-C')?.startsWith('-') || args.includes('-I')) stops = [...stops].reverse()
        const t = (opt('-T') ?? '0/1/1').split('/').map(Number)
        cpt = { stops, z0: t[0], z1: isNaN(t[1]) ? t[0] + 1 : t[1] }
        break
      }
      case 'plot': case 'psxy': case 'text': case 'pstext': case 'contour': case 'pscontour': {
        if (!view && !setup(args, c.line)) { emit('stderr', `gmt [ERROR]: ${c.module} needs a region/projection (-R, -J)`, c.line); break }
        if (args.some((a) => a.startsWith('-R') || a.startsWith('-J'))) setup(args, c.line)
        if (!view) break
        drewAnything = true
        const id = frameClip()
        const file = pos[0]
        const data = file ? files.get(file) : stdin !== undefined ? new TextEncoder().encode(stdin) : undefined
        if (file && !data) { emit('stderr', `gmt [ERROR]: Cannot find file ${file}`, c.line); break }
        let s = ''
        const w = opt('-W'), g = opt('-G'), S = opt('-S')
        if (c.module === 'text' || c.module === 'pstext') {
          const size = parseFloat(/\+f(\d+\.?\d*)/.exec(opt('-F') ?? '')?.[1] ?? '10')
          for (const l of new TextDecoder().decode(data).split(/\r?\n/)) {
            const m = /^\s*(\S+)\s+(\S+)\s+(.*)$/.exec(l)
            if (m && !isNaN(+m[1]) && !isNaN(+m[2])) s += `<text x="${view.fx(+m[1])}" y="${view.H - view.fy(+m[2], +m[1])}" font-size="${size}" text-anchor="middle">${esc(m[3])}</text>`
          }
        } else if (c.module === 'contour' || c.module === 'pscontour') {
          const pts = readTable(data).filter((r) => r.length >= 3)
          if (pts.length < 3) { emit('stderr', 'gmt [ERROR]: contour needs x y z data', c.line); break }
          const interval = parseFloat(opt('-C') ?? '') || 1
          const N = 70, grid: number[][] = []
          for (let j = 0; j <= N; j++) {
            grid.push([])
            for (let i = 0; i <= N; i++) {
              const x = view.w + ((view.e - view.w) * i) / N, y = view.s + ((view.n - view.s) * j) / N
              let sw = 0, sz = 0
              for (const p of pts) {
                const d2 = ((p[0] - x) / (view.e - view.w)) ** 2 + ((p[1] - y) / (view.n - view.s)) ** 2 + 1e-9
                const wt = 1 / (d2 * d2); sw += wt; sz += wt * p[2]
              }
              grid[j].push(sz / sw)
            }
          }
          const zs = pts.map((p) => p[2])
          const p = pen(w ?? '0.5p,black')
          const gx = (i: number) => view!.w + ((view!.e - view!.w) * i) / N, gy = (j: number) => view!.s + ((view!.n - view!.s) * j) / N
          for (let lv = Math.ceil(Math.min(...zs) / interval) * interval; lv <= Math.max(...zs); lv += interval) {
            let d = ''
            const cross = (a: number, b: number) => (lv - a) / (b - a)
            for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
              const v = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]
              const P: [number, number][] = [] // edge crossings
              const edges: [number, number, [number, number], [number, number]][] = [
                [0, 1, [gx(i), gy(j)], [gx(i + 1), gy(j)]], [1, 2, [gx(i + 1), gy(j)], [gx(i + 1), gy(j + 1)]],
                [2, 3, [gx(i + 1), gy(j + 1)], [gx(i), gy(j + 1)]], [3, 0, [gx(i), gy(j + 1)], [gx(i), gy(j)]],
              ]
              for (const [a, b, p0, p1] of edges) if ((v[a] - lv) * (v[b] - lv) < 0) { const t = cross(v[a], v[b]); P.push([p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t]) }
              if (P.length >= 2) d += `M${px(P[0][0], P[0][1])}L${px(P[1][0], P[1][1])}`
              if (P.length === 4) d += `M${px(P[2][0], P[2][1])}L${px(P[3][0], P[3][1])}`
            }
            if (d) s += `<path d="${d}" fill="none" stroke="${p.color}" stroke-width="${p.width}"/>`
          }
          emit('info', 'mock engine: contours from inverse-distance interpolation (not GMT surface/contour)', c.line)
        } else {
          const rows = readTable(data)
          if (rows.length === 0) emit('stderr', `gmt [ERROR]: no numeric x y records found in ${file ?? 'input'}`, c.line)
          if (S !== undefined && S !== null) {
            const kind = S[0] || 'c'
            const size = (toPt(S.slice(1)) || 0.25 * CM) / 2
            const p = w !== undefined ? pen(w || undefined) : null
            const useCpt = args.includes('-C') || opt('-C') !== undefined
            for (const r of rows) {
              const fill = useCpt && cpt && r.length > 2 ? cptColor(cpt, r[2]) : g ? color(g) : 'gray'
              const x = view.fx(r[0]), y = view.H - view.fy(r[1], r[0])
              const st = `fill="${fill}" ${p ? `stroke="${p.color}" stroke-width="${p.width}"` : ''}`
              if (kind === 's') s += `<rect x="${x - size}" y="${y - size}" width="${2 * size}" height="${2 * size}" ${st}/>`
              else if (kind === 't') s += `<path d="M${x},${y - size}L${x + size},${y + size}L${x - size},${y + size}Z" ${st}/>`
              else if (kind === 'd') s += `<path d="M${x},${y - size}L${x + size},${y}L${x},${y + size}L${x - size},${y}Z" ${st}/>`
              else if (kind === 'a') {
                let d = ''
                for (let k = 0; k < 10; k++) { const rr = k % 2 ? size * 0.4 : size, a = (k * Math.PI) / 5 - Math.PI / 2; d += `${k ? 'L' : 'M'}${x + rr * Math.cos(a)},${y + rr * Math.sin(a)}` }
                s += `<path d="${d}Z" ${st}/>`
              } else s += `<circle cx="${x}" cy="${y}" r="${size}" ${st}/>`
            }
          } else {
            const p = pen(w ?? '0.25p,black')
            s += `<polyline points="${rows.map((r) => px(r[0], r[1])).join(' ')}" fill="${g ? color(g) : 'none'}" stroke="${p.color}" stroke-width="${p.width}" ${p.dash ? `stroke-dasharray="${p.dash}"` : ''}/>`
          }
        }
        body += `<g clip-path="url(#${id})">${s}</g>`
        break
      }
      case 'colorbar': {
        if (!view || !cpt) { emit('stderr', 'gmt [ERROR]: colorbar needs a prior makecpt and plot', c.line); break }
        const label = /\+l(.+)$/.exec(args.find((a) => a.startsWith('-Bx') || a.startsWith('-B')) ?? '')?.[1]
        const gid = `g${clipN++}`
        defs += `<linearGradient id="${gid}">${cpt.stops.map((c2, i) => `<stop offset="${(i / (cpt!.stops.length - 1)) * 100}%" stop-color="${c2}"/>`).join('')}</linearGradient>`
        const bw = view.W * 0.6, bx = (view.W - bw) / 2, by = view.H + 34
        colorbar = `<rect x="${bx}" y="${by}" width="${bw}" height="12" fill="url(#${gid})" stroke="black"/>` +
          [0, 0.25, 0.5, 0.75, 1].map((t) => `<text x="${bx + bw * t}" y="${by + 25}" font-size="10" text-anchor="middle">${fmt(cpt!.z0 + (cpt!.z1 - cpt!.z0) * t)}</text>`).join('') +
          (label ? `<text x="${view.W / 2}" y="${by + 40}" font-size="11" text-anchor="middle">${esc(label)}</text>` : '')
        break
      }
      default:
        emit('stderr', `mock engine: module "${c.module}" is not supported without the GMT Wasm build (skipped)`, c.line)
    }
    return undefined
  }
  return { exec, finish }
}
