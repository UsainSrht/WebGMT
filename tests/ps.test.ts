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

if (failed) { console.error(`${failed}/${total} ps tests failed`); process.exit(1) }
console.log(`ps: ${total} checks passed`)
