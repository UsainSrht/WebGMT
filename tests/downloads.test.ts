// Tests for the download progress state (speed, ETA, averages, formatting).
import { averageFraction, eta, formatBytes, formatEta, fraction, reduce, type Download } from '../src/lib/downloadState'

let failed = 0, total = 0
const eq = (name: string, got: unknown, want: unknown) => {
  total++
  if (JSON.stringify(got) !== JSON.stringify(want)) { failed++; console.log(`FAIL ${name}\n  got : ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`) }
}
const near = (name: string, got: number | null, want: number, tol: number) => {
  total++
  if (got === null || Math.abs(got - want) > tol) { failed++; console.log(`FAIL ${name}: got ${got}, want ${want} +-${tol}`) }
}

let m = new Map<string, Download>()
m = reduce(m, { event: 'start', id: 'a', label: 'A', total: 1000, at: 0 })
eq('start: active at 0', [m.get('a')!.state, m.get('a')!.loaded, fraction(m.get('a')!)], ['active', 0, 0])
eq('no ETA before a speed sample', eta(m.get('a')!), null)

m = reduce(m, { event: 'progress', id: 'a', loaded: 100, at: 100 })
eq('too-soon sample is ignored for speed but loaded updates', [m.get('a')!.loaded, m.get('a')!.speed], [100, 0])
m = reduce(m, { event: 'progress', id: 'a', loaded: 300, at: 1000 })
near('speed = bytes per second (300 B in 1 s)', m.get('a')!.speed, 300, 1)
near('ETA = remaining / speed', eta(m.get('a')!), 700 / 300, 0.01)
eq('fraction', fraction(m.get('a')!), 0.3)

// speed is smoothed, not replaced
m = reduce(m, { event: 'progress', id: 'a', loaded: 1300, at: 2000 })        // 1000 B/s instantaneous
near('smoothed speed', m.get('a')!.speed, 300 * 0.7 + 1000 * 0.3, 1)

// unknown size
m = reduce(m, { event: 'start', id: 'u', label: 'U', total: 0, at: 0 })
m = reduce(m, { event: 'progress', id: 'u', loaded: 500, at: 1000 })
eq('unknown size: no fraction, no ETA', [fraction(m.get('u')!), eta(m.get('u')!)], [null, null])

// average of the active downloads only
m = reduce(m, { event: 'start', id: 'b', label: 'B', total: 1000, at: 0 })
m = reduce(m, { event: 'progress', id: 'b', loaded: 500, at: 100 })
const list = [...m.values()]
near('average over active downloads (a=1.0? no: a=1.3->capped, u=unknown=0, b=0.5)', averageFraction(list), (1 + 0 + 0.5) / 3, 0.001)
m = reduce(m, { event: 'end', id: 'a', status: 'done', at: 3000 })
eq('done counts as 100% and leaves the average', [fraction(m.get('a')!), averageFraction([...m.values()]) !== null], [1, true])
m = reduce(m, { event: 'end', id: 'u', status: 'cancelled', at: 3000 })
m = reduce(m, { event: 'end', id: 'b', status: 'error', error: 'boom', at: 3000 })
eq('nothing active -> null', averageFraction([...m.values()]), null)
eq('error keeps its message', m.get('b')!.error, 'boom')
eq('events for an unknown id are ignored', reduce(new Map(), { event: 'progress', id: 'x', loaded: 5, at: 5 }).size, 0)

// the input map is never mutated
const before = new Map<string, Download>()
reduce(before, { event: 'start', id: 'z', label: 'Z', total: 1, at: 0 })
eq('reduce is immutable', before.size, 0)

eq('formatBytes', [formatBytes(512), formatBytes(2048), formatBytes(5 * 1048576), formatBytes(40 * 1048576)], ['512 B', '2.0 KB', '5.00 MB', '40.0 MB'])
eq('formatEta', [formatEta(0.4), formatEta(12), formatEta(65), formatEta(3700)], ['less than 1 s', '12 s', '1 min 5 s', '1 h 1 min'])

if (failed) { console.error(`${failed}/${total} download tests failed`); process.exit(1) }
console.log(`downloads: ${total} checks passed`)
