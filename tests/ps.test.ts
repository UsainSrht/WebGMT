// Regression tests for the PostScript -> SVG interpreter, from bugs found by running the GMT tutorial.
import { psToSvg } from '../src/workers/psInterpreter'

let failed = 0, total = 0
const check = (name: string, ok: boolean, detail = '') => { total++; if (!ok) { failed++; console.log(`FAIL ${name} ${detail}`) } }
const render = (ps: string) => { const r = psToSvg(new TextEncoder().encode(`%!PS-Adobe-3.0\n%%BoundingBox: 0 0 200 200\n${ps}`).buffer as ArrayBuffer); return r }

// GMT keeps pens as executable strings: `PSL_path_pen 3 get cvx exec` (contour pens, thick annotated lines)
{
  const r = render('/pens [(4 setlinewidth) (12 setlinewidth)] def\n0 0 moveto 100 0 lineto pens 0 get cvx exec stroke\n0 20 moveto 100 20 lineto pens 1 get cvx exec stroke')
  const widths = [...r.svg.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => +m[1])
  check('cvx exec runs a string (pen widths)', widths.includes(4) && widths.includes(12), JSON.stringify(widths))
  check('cvx exec: no unknown operators', r.warnings.length === 0, r.warnings.join())
}

// the full matrix reaches the text (3-D plots shear their axis labels)
{
  const r = render('/Helvetica findfont 10 scalefont setfont\nV [1 0 0.5 1 50 50] concat 0 0 moveto (Hi) show U')
  const m = /<text[^>]*transform="matrix\(([^)]*)\)"/.exec(r.svg)
  check('sheared text keeps its shear', !!m && m[1].split(' ').map(Number)[2] === -0.5, m?.[1])
  check('text has textLength (fits the metrics)', /textLength="[\d.]+"/.test(r.svg))
}

// ISOLatin1+ accents (0x90-0x9F) are glyphs, not control characters: "M@!a\225noa" uses \225 = macron
{
  const r = render('/Times-Roman findfont 20 scalefont setfont 10 10 moveto (\\225) show')
  check('macron (octal 225) is drawn as a macron', r.svg.includes('¯'), r.svg.slice(-200))
}

// Circles. A full circle under a uniform scale is two SVG arcs (a plot of 83,000 dots was a 156 MB SVG of 12-sided
// polygons); other arcs are straight segments whose number follows their size on the page.
{
  const paths = (svg: string) => [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1])
  const polygon = (d: string) => [...d.matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)].map((m) => [+m[1], +m[2]])

  const c = paths(render('100 100 5 0 360 arc closepath fill').svg)[0]
  const arcs = [...c.matchAll(/A([-\d.]+) ([-\d.]+) ([-\d.]+) ([01]) ([01]) ([-\d.]+) ([-\d.]+)/g)]
  check('full circle is two arcs', arcs.length === 2 && c.length < 90, c)
  check('arc radius is the scaled radius', arcs.every((a) => +a[1] === 5 && +a[2] === 5), c)
  const start = /^M([-\d.]+) ([-\d.]+)/.exec(c), mid = [+arcs[0][6], +arcs[0][7]]
  check('the two arcs end opposite each other (a diameter)', !!start && Math.abs(Math.hypot(mid[0] - +start[1], mid[1] - +start[2]) - 10) < 0.01, c)

  // direction: counter-clockwise (arc) and clockwise (arcn) circles must differ in the sweep flag, and a mirrored page flips it
  const sweep = (ps: string) => /A[-\d.]+ [-\d.]+ [-\d.]+ [01] ([01])/.exec(paths(render(ps).svg)[0])?.[1]
  check('arc and arcn sweep opposite ways', sweep('100 100 5 0 360 arc fill') !== sweep('100 100 5 360 0 arcn fill'))
  check('a mirrored page flips the sweep', sweep('100 100 5 0 360 arc fill') !== sweep('[-1 0 0 1 200 0] concat 100 100 5 0 360 arc fill'))
  check('a rotated, scaled page still gives arcs', /A/.test(paths(render('[0 2 -2 0 100 100] concat 0 0 5 0 360 arc fill').svg)[0]))
  const scaled = paths(render('2 2 scale 50 50 5 0 360 arc fill').svg)[0]
  check('scale is applied to the radius', /A10 10 /.test(scaled), scaled)

  // the picture is cropped to what is painted: the whole circle must be inside it, not just the two end points
  const svg = render('100 100 20 0 360 arc fill').svg
  const w = +(/width="([\d.]+)"/.exec(svg)?.[1] ?? 0)
  check('crop includes the whole circle', w >= 40 + 19, `width ${w}`)

  // not a circle: an ellipse (uneven scale) and a part of a circle are straight segments
  const ell = paths(render('2 1 scale 50 100 20 0 360 arc fill').svg)[0]
  check('ellipse stays a polygon', !/A/.test(ell) && polygon(ell).length > 8, ell)
  const part = polygon(paths(render('100 100 80 0 270 arc stroke').svg)[0])
  check('part of a large circle keeps the 3 degree step', part.length >= 89 && part.length <= 92, String(part.length))
  const tiny = polygon(paths(render('100 100 0.57 0 270 arc stroke').svg)[0])
  check('part of a tiny circle uses few segments', tiny.length >= 4 && tiny.length <= 12, String(tiny.length))
}

// Consecutive paints with the same style are one element where that cannot change the picture.
{
  const count = (svg: string) => (svg.match(/<path d="[^"]*" fill=/g) ?? []).length // painted paths (not a clip's own path)
  const sq = (x: number, rev = false) => (rev ? `${x} 0 moveto ${x} 10 lineto ${x + 10} 10 lineto ${x + 10} 0 lineto closepath` : `${x} 0 moveto ${x + 10} 0 lineto ${x + 10} 10 lineto ${x} 10 lineto closepath`)
  check('same-colour fills in the same direction merge', count(render(`0 setgray ${sq(0)} fill ${sq(20)} fill ${sq(40)} fill`).svg) === 1)
  check('merged fill keeps every subpath', (render(`0 setgray ${sq(0)} fill ${sq(20)} fill`).svg.match(/M/g) ?? []).length >= 2)
  check('fills of opposite direction do not merge (they could cancel)', count(render(`0 setgray ${sq(0)} fill ${sq(5, true)} fill`).svg) === 2)
  check('different colours do not merge', count(render(`0 setgray ${sq(0)} fill 1 0 0 setrgbcolor ${sq(20)} fill`).svg) === 2)
  check('even-odd fills never merge', count(render(`0 setgray ${sq(0)} eofill ${sq(20)} eofill`).svg) === 2)
  check('a path with two subpaths is not merged', count(render(`0 setgray ${sq(0)} ${sq(20)} fill ${sq(40)} fill`).svg) === 2)
  check('strokes with the same pen merge', count(render('0 0 moveto 50 0 lineto stroke 0 10 moveto 50 10 lineto stroke').svg) === 1)
  check('strokes with different widths do not merge', count(render('0 0 moveto 50 0 lineto stroke 3 setlinewidth 0 10 moveto 50 10 lineto stroke').svg) === 2)
  check('a clip between two paints separates them', count(render(`0 setgray ${sq(0)} fill gsave 0 0 50 50 rectclip newpath ${sq(20)} fill grestore`).svg) === 2)
  check('another colour in between keeps the order', (() => {
    const s = render(`0 setgray ${sq(0)} fill 1 0 0 setrgbcolor ${sq(20)} fill 0 setgray ${sq(40)} fill`).svg
    return count(s) === 3 && s.indexOf('rgb(0,0,0)') < s.indexOf('rgb(255,0,0)') && s.lastIndexOf('rgb(0,0,0)') > s.indexOf('rgb(255,0,0)')
  })())
  // GMT draws a filled symbol with an outline as "fill, then stroke the same path": one element paints both, fill first
  const both = render(`0 1 0 setrgbcolor ${sq(0)} gsave fill grestore 0 setgray 2 setlinewidth stroke`).svg
  check('fill and outline of one path are one element', count(both) === 1 && /fill="rgb\(0,255,0\)"[^>]*stroke="rgb\(0,0,0\)"/.test(both), both.slice(-200))
  const two = render(`0 1 0 setrgbcolor ${sq(0)} gsave fill grestore 0 setgray 2 setlinewidth stroke ${sq(20)} gsave 1 0 0 setrgbcolor fill grestore stroke`).svg
  check('outlined symbols are not merged with each other (an outline must stay above its own fill only)', count(two) === 2)
  const other = render(`0 1 0 setrgbcolor ${sq(0)} fill ${sq(30)} 0 setgray stroke`).svg
  check('a stroke of a different path is not combined with the fill', count(other) === 2)
}

if (failed) { console.error(`${failed}/${total} ps tests failed`); process.exit(1) }
console.log(`ps: ${total} checks passed`)
