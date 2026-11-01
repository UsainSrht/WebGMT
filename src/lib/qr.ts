import qrcode from 'qrcode-generator'

/** Mimics `qrencode -t EPS`: error correction level L by default, 3 pt per module, 4-module quiet zone.
 *  A white background is drawn so the code stays readable on coloured plots. */
export function qrEps(text: string, level: 'L' | 'M' | 'Q' | 'H' = 'L', scale = 3, margin = 4): string {
  const qr = qrcode(0, level)
  qr.addData(text, 'Byte')
  qr.make()
  const n = qr.getModuleCount()
  const size = (n + 2 * margin) * scale
  const rows: string[] = []
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) rows.push(`${c + margin} ${n - 1 - r + margin} p`)
  }
  return [
    '%!PS-Adobe-2.0 EPSF-1.2',
    `%%BoundingBox: 0 0 ${size} ${size}`,
    '%%Pages: 1 1',
    '%%EndComments',
    '/p { moveto 0 1 rlineto 1 0 rlineto 0 -1 rlineto fill } bind def',
    'gsave',
    '1 setgray 0 0 moveto ' + `${size} 0 rlineto 0 ${size} rlineto -${size} 0 rlineto closepath fill`,
    '0 setgray',
    `${scale} ${scale} scale`,
    ...rows,
    'grestore',
    'showpage',
    '%%EOF',
    '',
  ].join('\n')
}
