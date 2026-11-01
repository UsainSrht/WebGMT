/** A small bash-like interpreter for GMT scripts.
 *
 *  Supported: comments, VAR=value / export, $VAR / ${VAR}, single/double quotes, backslash escapes, line continuations,
 *  `cmd` and $(cmd) substitution, pipelines (|), redirects (> >> < 2>/dev/null), heredocs (<<EOF), ';' / '&&' / '||',
 *  and the commands: gmt, echo, printf, cat, awk, grep, date, ip (no-op), qrencode, rm, mkdir, cd, true, false, sleep, exit.
 *  Not supported: if/for/while/functions, globbing, arithmetic expansion $(( )), arrays. Such lines are reported, not run. */

import { runAwk, sprintf } from './awk'
import { qrEps } from './qr'

export interface Vfs {
  read(name: string): Uint8Array | undefined
  write(name: string, data: Uint8Array, append?: boolean): void
  remove(name: string): void
}

export interface ShellRuntime {
  vfs: Vfs
  /** Run one GMT module. stdin is null when the command has no piped/redirected input. */
  gmt(module: string, args: string[], stdin: Uint8Array | null, line: number): Promise<{ status: number; stdout: Uint8Array }>
  log(stream: 'stdout' | 'stderr' | 'info', text: string, line?: number): void
  now?: () => Date
}

// ----------------------------------------------------------------------------------------------- lexing
type Part = { k: 'lit'; v: string; q: boolean } | { k: 'var'; name: string; q: boolean } | { k: 'sub'; src: string; q: boolean }
type Word = Part[]
type Tok = { t: 'word'; w: Word } | { t: 'op'; v: string }

const enc = new TextEncoder()
const dec = new TextDecoder()

function findClose(s: string, i: number, open: string, close: string): number {
  // i points just after the opener; returns index of the matching closer
  let depth = 1
  for (; i < s.length; i++) {
    const c = s[i]
    if (c === "'" ) { const j = s.indexOf("'", i + 1); if (j < 0) return -1; i = j; continue }
    if (c === '"') { i++; while (i < s.length && s[i] !== '"') { if (s[i] === '\\') i++; i++ } continue }
    if (c === '\\') { i++; continue }
    if (c === open) depth++
    else if (c === close && --depth === 0) return i
  }
  return -1
}

function lexLine(src: string): Tok[] {
  const toks: Tok[] = []
  let parts: Part[] = []
  let has = false
  let lit = ''
  const flushLit = (q: boolean) => { if (lit) { parts.push({ k: 'lit', v: lit, q }); lit = '' } }
  const endWord = () => { flushLit(false); if (has) toks.push({ t: 'word', w: parts }); parts = []; has = false }
  const dollar = (i: number, q: boolean): number => {
    // handle a '$' at src[i]; returns new index (pointing at the last consumed char)
    const n = src[i + 1]
    if (n === '(' && src[i + 2] !== '(') {
      const j = findClose(src, i + 2, '(', ')')
      if (j < 0) { lit += '$'; return i }
      flushLit(q); parts.push({ k: 'sub', src: src.slice(i + 2, j), q }); return j
    }
    const m = /^\$(?:\{(\w+)\}|(\w+)|(\?))/.exec(src.slice(i))
    if (!m) { lit += '$'; return i }
    flushLit(q); parts.push({ k: 'var', name: m[1] ?? m[2] ?? '?', q }); return i + m[0].length - 1
  }
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === "'") {
      has = true; flushLit(false)
      const j = src.indexOf("'", i + 1); const end = j < 0 ? src.length : j
      parts.push({ k: 'lit', v: src.slice(i + 1, end), q: true }); i = end
    } else if (c === '"') {
      has = true; flushLit(false)
      let ql = ''
      const flushQ = () => { if (ql) { parts.push({ k: 'lit', v: ql, q: true }); ql = '' } }
      i++
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < src.length && '"$`\\'.includes(src[i + 1])) { ql += src[++i] }
        else if (src[i] === '$') { flushQ(); const saved = lit; lit = ''; i = dollar(i, true); flushLit(true); lit = saved }
        else if (src[i] === '`') {
          const j = src.indexOf('`', i + 1); const end = j < 0 ? src.length : j
          flushQ(); parts.push({ k: 'sub', src: src.slice(i + 1, end), q: true }); i = end
        } else ql += src[i]
        i++
      }
      flushQ()
    } else if (c === '\\' && i + 1 < src.length) { has = true; lit += src[++i] }
    else if (c === '$') { has = true; i = dollar(i, false) }
    else if (c === '`') {
      has = true; flushLit(false)
      const j = src.indexOf('`', i + 1); const end = j < 0 ? src.length : j
      parts.push({ k: 'sub', src: src.slice(i + 1, end), q: false }); i = end
    } else if (c === '#' && !has) break
    else if (/\s/.test(c)) endWord()
    else if (c === '|' || c === ';' || c === '&' && src[i + 1] === '&') {
      endWord()
      if (c === '|' && src[i + 1] === '|') { toks.push({ t: 'op', v: '||' }); i++ }
      else if (c === '&') { toks.push({ t: 'op', v: '&&' }); i++ }
      else toks.push({ t: 'op', v: c })
    } else if (c === '>' || c === '<') {
      // fd redirects: "2>" / "2>&1" / "&>"
      const fdOnly = lit === '2' && parts.length === 0 && has
      if (fdOnly) { lit = ''; has = false }
      else endWord()
      let op = c
      if (src[i + 1] === c) { op += c; i++ }
      if (fdOnly && src[i + 1] === '&') { op += '&'; i++; while (/\d/.test(src[i + 1] ?? '')) op += src[++i] }
      toks.push({ t: 'op', v: fdOnly ? '2' + op : op })
    } else { has = true; lit += c }
  }
  endWord()
  return toks
}

// ----------------------------------------------------------------------------------------------- parsing
interface Stage { words: Word[]; out?: { file: Word; append: boolean }; in?: Word; heredoc?: { body: string; expand: boolean }; assigns: { name: string; value: Word }[] }
interface Cmd { stages: Stage[]; cond: 'always' | 'and' | 'or'; line: number }
interface Note { note: string; line: number }

const wordText = (w: Word) => w.map((p) => (p.k === 'lit' ? p.v : '')).join('')

function parseTokens(toks: Tok[], line: number, heredocs: { delim: string; quoted: boolean }[]): Cmd[] {
  const cmds: Cmd[] = []
  let stages: Stage[] = []
  let st: Stage = { words: [], assigns: [] }
  let cond: Cmd['cond'] = 'always'
  const endCmd = (next: Cmd['cond']) => { stages.push(st); st = { words: [], assigns: [] }; if (stages[0].words.length || stages[0].assigns.length || stages.length > 1) cmds.push({ stages, cond, line }); stages = []; cond = next }
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t.t === 'op') {
      if (t.v === '|') { stages.push(st); st = { words: [], assigns: [] } }
      else if (t.v === ';') endCmd('always')
      else if (t.v === '&&') endCmd('and')
      else if (t.v === '||') endCmd('or')
      else if (t.v === '>' || t.v === '>>') { const n = toks[++i]; if (n?.t === 'word') st.out = { file: n.w, append: t.v === '>>' } }
      else if (t.v === '<') { const n = toks[++i]; if (n?.t === 'word') st.in = n.w }
      else if (t.v === '<<') {
        const n = toks[++i]
        if (n?.t === 'word') {
          const quoted = n.w.some((p) => p.q)
          const delim = wordText(n.w)
          heredocs.push({ delim, quoted })
          st.heredoc = { body: '', expand: !quoted }
        }
      }
      else if (t.v.startsWith('2>')) { if (!t.v.includes('&')) i++ /* skip target (e.g. /dev/null) */ }
      continue
    }
    // assignment words are only recognised before the command word
    if (st.words.length === 0) {
      const first = t.w[0]
      const m = first && first.k === 'lit' && !first.q ? /^([A-Za-z_]\w*)=(.*)$/s.exec(first.v) : null
      if (m) { st.assigns.push({ name: m[1], value: [{ k: 'lit', v: m[2], q: false }, ...t.w.slice(1)] }); continue }
    }
    st.words.push(t.w)
  }
  endCmd('always')
  return cmds
}

// ----------------------------------------------------------------------------------------------- execution
interface Out { status: number; stdout: Uint8Array }

export async function runShell(src: string, rt: ShellRuntime): Promise<{ ok: boolean }> {
  const vars = new Map<string, string>()
  let lastStatus = 0
  let allOk = true
  let exited = false

  const rawLines = src.replace(/\r\n?/g, '\n').split('\n')

  async function expandWord(w: Word, line: number): Promise<string[]> {
    const out: string[] = []
    let cur = ''
    let any = false
    for (const p of w) {
      if (p.k === 'lit') { cur += p.v; any = true; continue }
      let val: string
      if (p.k === 'var') val = p.name === '?' ? String(lastStatus) : vars.get(p.name) ?? ''
      else val = (await evalSub(p.src, line)).replace(/\n+$/, '')
      any = true
      if (p.q) cur += val
      else {
        const pieces = val.split(/\s+/)
        pieces.forEach((s, idx) => { if (idx === 0) cur += s; else { out.push(cur); cur = s } })
        if (val === '') { /* empty unquoted expansion contributes nothing */ }
      }
    }
    if (any && (cur !== '' || w.some((p) => p.k === 'lit' && p.q))) out.push(cur)
    return out
  }
  const expandOne = async (w: Word, line: number) => (await expandWord(w, line)).join(' ')

  async function evalSub(code: string, line: number): Promise<string> {
    const lines = code.split('\n')
    let captured = ''
    await execLines(lines, line, (b) => { captured += dec.decode(b) }, true)
    return captured
  }

  async function runStage(st: Stage, stdin: Uint8Array | null, line: number): Promise<Out> {
    for (const a of st.assigns) vars.set(a.name, await expandOne(a.value, line))
    const argv: string[] = []
    for (const w of st.words) argv.push(...(await expandWord(w, line)))
    if (argv.length === 0) return { status: 0, stdout: new Uint8Array() }

    let input = stdin
    if (st.in) { const f = await expandOne(st.in, line); const d = rt.vfs.read(f); if (!d) { rt.log('stderr', `${f}: No such file or directory`, line); return { status: 1, stdout: new Uint8Array() } } input = d }
    if (st.heredoc) {
      let body = st.heredoc.body
      if (st.heredoc.expand) body = await expandHeredoc(body, line)
      input = enc.encode(body)
    }
    return runCommand(argv, input, line)
  }

  async function expandHeredoc(body: string, line: number): Promise<string> {
    // only $VAR / ${VAR} / $(..) are expanded inside heredocs
    let out = ''
    for (let i = 0; i < body.length; i++) {
      if (body[i] === '$') {
        const m = /^\$(?:\{(\w+)\}|(\w+))/.exec(body.slice(i))
        if (m) { out += vars.get(m[1] ?? m[2]) ?? ''; i += m[0].length - 1; continue }
        if (body[i + 1] === '(') { const j = findClose(body, i + 2, '(', ')'); if (j > 0) { out += (await evalSub(body.slice(i + 2, j), line)).replace(/\n+$/, ''); i = j; continue } }
      }
      out += body[i]
    }
    return out
  }

  async function runCommand(argv: string[], input: Uint8Array | null, line: number): Promise<Out> {
    const [cmd, ...args] = argv
    const text = () => (input ? dec.decode(input) : '')
    const ok = (s: string, status = 0): Out => ({ status, stdout: enc.encode(s) })
    const fileText = (f: string) => { const d = rt.vfs.read(f); return d ? dec.decode(d) : undefined }
    switch (cmd) {
      case 'gmt': {
        if (args.length === 0) return ok('', 0)
        if (args[0] === '--version') return ok('6.6.0\n')
        const r = await rt.gmt(args[0], args.slice(1), input, line)
        if (r.status !== 0) allOk = false   // only GMT failures (not e.g. grep's "no match") fail the script
        return r
      }
      case 'echo': {
        let nl = true, esc = false
        const a = [...args]
        while (a[0] && /^-[neE]+$/.test(a[0])) { const f = a.shift()!; if (f.includes('n')) nl = false; if (f.includes('e')) esc = true }
        let s = a.join(' ')
        if (esc) s = s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\')
        return ok(s + (nl ? '\n' : ''))
      }
      case 'printf': {
        if (!args.length) return ok('')
        const fmt = args[0].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\')
        return ok(sprintf(fmt, args.slice(1)))
      }
      case 'cat': {
        if (args.length === 0) return { status: 0, stdout: input ?? new Uint8Array() }
        const chunks: string[] = []
        for (const f of args) { const t = fileText(f); if (t === undefined) { rt.log('stderr', `cat: ${f}: No such file or directory`, line); return ok(chunks.join(''), 1) } chunks.push(t) }
        return ok(chunks.join(''))
      }
      case 'awk': {
        let fs: string | undefined
        const v: Record<string, string> = {}
        const rest: string[] = []
        for (let i = 0; i < args.length; i++) {
          const a = args[i]
          if (a === '-F') fs = args[++i]
          else if (a.startsWith('-F') && rest.length === 0) fs = a.slice(2)
          else if (a === '-v') { const [k, ...val] = (args[++i] ?? '').split('='); v[k] = val.join('=') }
          else rest.push(a)
        }
        if (fs === 't') fs = '\t'
        const prog = rest.shift()
        if (prog === undefined) { rt.log('stderr', 'awk: no program given', line); return ok('', 2) }
        let data = ''
        if (rest.length) { for (const f of rest) { const t = fileText(f); if (t === undefined) { rt.log('stderr', `awk: cannot open ${f}`, line); return ok('', 2) } data += t } } else data = text()
        try { return ok(runAwk(prog, data, { fs, vars: v })) } catch (e) { rt.log('stderr', (e as Error).message, line); allOk = false; return ok('', 2) }
      }
      case 'grep': {
        const flags = args.filter((a) => /^-[a-zA-Z]+$/.test(a)).join('')
        const rest = args.filter((a) => !/^-[a-zA-Z]+$/.test(a))
        const pat = rest.shift() ?? ''
        const data = rest.length ? rest.map((f) => fileText(f) ?? '').join('') : text()
        let re: RegExp
        try { re = new RegExp(flags.includes('F') ? pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pat, flags.includes('i') ? 'i' : '') } catch { return ok('', 2) }
        const inv = flags.includes('v')
        const hit = data.split('\n').filter((l, i, arr) => !(i === arr.length - 1 && l === '') && re.test(l) !== inv)
        return ok(flags.includes('c') ? hit.length + '\n' : hit.map((l) => l + '\n').join(''), hit.length ? 0 : 1)
      }
      case 'date': {
        const d = (rt.now ?? (() => new Date()))()
        const p2 = (n: number) => String(n).padStart(2, '0')
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        const f = args.find((a) => a.startsWith('+'))
        const fmt = f ? f.slice(1) : '%a %b %e %H:%M:%S UTC %Y'
        const map: Record<string, string> = {
          a: days[d.getUTCDay()], b: mons[d.getUTCMonth()], d: p2(d.getUTCDate()), e: String(d.getUTCDate()).padStart(2, ' '), H: p2(d.getUTCHours()), M: p2(d.getUTCMinutes()), S: p2(d.getUTCSeconds()),
          Y: String(d.getUTCFullYear()), y: p2(d.getUTCFullYear() % 100), m: p2(d.getUTCMonth() + 1), Z: 'UTC', s: String(Math.floor(d.getTime() / 1000)),
          F: `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`, T: `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`, '%': '%',
        }
        return ok(fmt.replace(/%(.)/g, (_m, c: string) => map[c] ?? '%' + c) + '\n')
      }
      case 'ip': return ok('')   // network interfaces are not visible from a browser
      case 'qrencode': {
        let outFile = '', level: 'L' | 'M' | 'Q' | 'H' = 'L', scale = 3, margin = 4
        const words: string[] = []
        for (let i = 0; i < args.length; i++) {
          const a = args[i]
          if (a === '-o') outFile = args[++i]
          else if (a === '-t') i++            // output type: EPS is the only one we emit
          else if (a === '-l') level = (args[++i] ?? 'L').toUpperCase() as typeof level
          else if (a === '-s') scale = +args[++i] || 3
          else if (a === '-m') margin = +args[++i] || 4
          else words.push(a)
        }
        const data = words.join(' ') || text().replace(/\n$/, '')
        if (!outFile) { rt.log('stderr', 'qrencode: only "-o file" output is supported', line); return ok('', 1) }
        try { rt.vfs.write(outFile, enc.encode(qrEps(data, level, scale, margin))) } catch (e) { rt.log('stderr', `qrencode: ${(e as Error).message}`, line); return ok('', 1) }
        return ok('')
      }
      case 'seq': {
        const n = args.map(Number)
        const [first, inc, last] = n.length === 1 ? [1, 1, n[0]] : n.length === 2 ? [n[0], 1, n[1]] : [n[0], n[1], n[2]]
        if (n.some((v) => Number.isNaN(v)) || !inc) { rt.log('stderr', 'seq: invalid argument', line); allOk = false; return ok('', 1) }
        const out: number[] = []
        for (let v = first; inc > 0 ? v <= last + 1e-9 : v >= last - 1e-9; v += inc) { out.push(+v.toFixed(10)); if (out.length > 1e6) break }
        return ok(out.map((v) => v + '\n').join(''))
      }
      case 'rm': for (const f of args.filter((a) => !a.startsWith('-'))) rt.vfs.remove(f); return ok('')
      case 'mkdir': case 'cd': case 'sleep': case 'true': case ':': case 'unset': case 'set': case 'chmod': return ok('')
      case 'false': return ok('', 1)
      case 'exit': exited = true; return ok('', +args[0] || 0)
      case 'export': for (const a of args) { const m = /^(\w+)=(.*)$/s.exec(a); if (m) vars.set(m[1], m[2]) } return ok('')
      default:
        rt.log('stderr', `${cmd}: command not found`, line)
        allOk = false
        return ok('', 127)
    }
  }

  async function runCmd(cmd: Cmd, capture: ((b: Uint8Array) => void) | null): Promise<void> {
    let data: Uint8Array | null = null
    let res: Out = { status: 0, stdout: new Uint8Array() }
    for (let i = 0; i < cmd.stages.length; i++) {
      const st = cmd.stages[i]
      res = await runStage(st, data, cmd.line)
      data = res.stdout
      if (exited) break
    }
    lastStatus = res.status
    const last = cmd.stages[cmd.stages.length - 1]
    if (last.out) {
      const file = await expandOne(last.out.file, cmd.line)
      if (file !== '/dev/null') rt.vfs.write(file, res.stdout, last.out.append)
    } else if (capture) capture(res.stdout)
    else if (res.stdout.length) for (const l of dec.decode(res.stdout).replace(/\n$/, '').split('\n')) rt.log('stdout', l, cmd.line)
  }

  async function execLines(lines: string[], baseLine: number, capture: ((b: Uint8Array) => void) | null, quiet: boolean): Promise<void> {
    for (let i = 0; i < lines.length && !exited; i++) {
      const startLine = baseLine + i
      let text = lines[i]
      while (/\\\s*$/.test(text) && i + 1 < lines.length) text = text.replace(/\\\s*$/, ' ') + lines[++i]
      const trimmed = text.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const forHead = /^for\s+(\w+)\s+in\s+(.*)$/.exec(trimmed)
      if (forHead) {
        let listSrc = forHead[2]
        let rest = ''
        const dm = /^(.*?)\s*;\s*do\b(.*)$/.exec(listSrc) ?? /^(.*?)\s+do\b(.*)$/.exec(listSrc)
        if (dm) { listSrc = dm[1]; rest = dm[2] }
        else {
          let j = i + 1
          while (j < lines.length && !lines[j].trim()) j++
          if (j < lines.length && /^do\b/.test(lines[j].trim())) { rest = lines[j].trim().slice(2); i = j }
          else { rt.log('stderr', '[WARNING]: malformed for loop; skipped', startLine); allOk = false; continue }
        }
        let body: string[]
        const one = /^(.*?)\s*;?\s*done\s*$/.exec(rest)
        if (one) body = [one[1].replace(/;\s*$/, '')]
        else {
          body = rest.trim() ? [rest] : []
          let depth = 1
          for (i++; i < lines.length; i++) {
            const t = lines[i].trim()
            if (/^(for|while|until)\b/.test(t) && !/\bdone\s*$/.test(t)) depth++   // a one-line loop closes itself
            if (/^done\b/.test(t) && --depth === 0) break
            body.push(lines[i])
          }
        }
        const items: string[] = []
        for (const t of lexLine(listSrc)) if (t.t === 'word') items.push(...(await expandWord(t.w, startLine)))
        let guard = 0
        for (const item of items) {
          if (++guard > 5000 || exited) break
          vars.set(forHead[1], item)
          await execLines(body, startLine, capture, quiet)
        }
        continue
      }
      if (/^(if|for|while|until|case|function)\b/.test(trimmed) || /^\w+\s*\(\)\s*\{/.test(trimmed)) {
        if (!quiet) rt.log('stderr', `[WARNING]: shell control flow ("${trimmed.split(/\s/)[0]}") is not supported; line skipped`, startLine)
        allOk = false
        continue
      }
      if (/\$\(\(/.test(trimmed)) { rt.log('stderr', '[WARNING]: arithmetic expansion $(( )) is not supported; line skipped', startLine); allOk = false; continue }
      const toks = lexLine(text)
      const heredocs: { delim: string; quoted: boolean }[] = []
      const cmds = parseTokens(toks, startLine, heredocs)
      // collect heredoc bodies from the following lines
      const bodies: string[] = []
      for (const h of heredocs) {
        const body: string[] = []
        i++
        while (i < lines.length && lines[i].trim() !== h.delim) body.push(lines[i++])
        bodies.push(body.join('\n') + (body.length ? '\n' : ''))
      }
      let bi = 0
      for (const c of cmds) for (const st of c.stages) if (st.heredoc) st.heredoc.body = bodies[bi++] ?? ''
      let prevOk = true
      for (const c of cmds) {
        if (c.cond === 'and' && !prevOk) continue
        if (c.cond === 'or' && prevOk) continue
        await runCmd(c, capture)
        prevOk = lastStatus === 0
        if (exited) break
      }
    }
  }

  await execLines(rawLines, 1, null, false)
  return { ok: allOk }
}
