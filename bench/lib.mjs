// Small helpers shared by the benchmark drivers (not part of the website).
import os from 'node:os'

export function args(argv = process.argv.slice(2)) {
  const o = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue
    const k = argv[i].slice(2)
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true
    o[k] = v
  }
  return o
}

export const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN }
export const percentile = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] : NaN }

export function machine() {
  const c = os.cpus()
  return { os: `${os.type()} ${os.release()}`, cpu: c[0]?.model.trim(), logicalCpus: c.length, memoryGB: +(os.totalmem() / 2 ** 30).toFixed(1), node: process.version }
}
