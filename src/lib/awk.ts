/** A compact AWK interpreter covering what GMT scripts typically use: BEGIN/END, patterns, field access and
 *  assignment, arithmetic, string concatenation, comparisons, printf/sprintf, if/else, a few built-ins,
 *  simple arrays, -F and -v. Not supported: user functions, getline, while/for loops, regex dynamic features
 *  beyond JS RegExp, output redirection from print. */

type Val = number | string | { s: string; n: number }   // {s,n} = "strnum" (a field that looks numeric)

const NUM_RE = /^\s*[-+]?(\d+\.?\d*([eE][-+]?\d+)?|\.\d+([eE][-+]?\d+)?|inf|nan)\s*$/i

const isStrnum = (v: Val): v is { s: string; n: number } => typeof v === 'object'
function toNum(v: Val): number {
  if (typeof v === 'number') return v
  if (isStrnum(v)) return v.n
  const m = /^\s*[-+]?(\d+\.?\d*([eE][-+]?\d+)?|\.\d+([eE][-+]?\d+)?)/.exec(v)
  return m ? parseFloat(m[0]) : 0
}
function numToStr(n: number, fmt = '%.6g'): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e16) return String(n)
  return sprintf(fmt, [n])
}
function toStr(v: Val): string { return typeof v === 'number' ? numToStr(v) : isStrnum(v) ? v.s : v }
function toBool(v: Val): boolean { return typeof v === 'number' ? v !== 0 : isStrnum(v) ? v.n !== 0 : v !== '' }
const mkField = (s: string): Val => (NUM_RE.test(s) ? { s, n: parseFloat(s) } : s)

export function sprintf(fmt: string, args: Val[]): string {
  let ai = 0
  return fmt.replace(/%([-+ 0#]*)(\*|\d+)?(?:\.(\*|\d+))?([diouxXeEfgGcs%])/g, (_m, flags: string, w: string, p: string, conv: string) => {
    if (conv === '%') return '%'
    const next = (): Val => args[ai++] ?? ''
    const width = w === '*' ? toNum(next()) : w ? +w : 0
    const prec = p === '*' ? toNum(next()) : p !== undefined ? +p : undefined
    let s: string
    const v = next()
    switch (conv) {
      case 'd': case 'i': { const n = Math.trunc(toNum(v)); s = String(Math.abs(n)); if (prec !== undefined) s = s.padStart(prec, '0'); s = (n < 0 ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '') + s; break }
      case 'o': s = (Math.trunc(toNum(v)) >>> 0).toString(8); break
      case 'u': s = String(Math.trunc(toNum(v)) >>> 0); break
      case 'x': s = (Math.trunc(toNum(v)) >>> 0).toString(16); break
      case 'X': s = (Math.trunc(toNum(v)) >>> 0).toString(16).toUpperCase(); break
      case 'e': case 'E': { const n = toNum(v); s = n.toExponential(prec ?? 6).replace(/e([+-])(\d)$/, 'e$10$2'); if (conv === 'E') s = s.toUpperCase(); if (n >= 0 && flags.includes('+')) s = '+' + s; break }
      case 'f': { const n = toNum(v); s = n.toFixed(prec ?? 6); if (n >= 0 && flags.includes('+')) s = '+' + s; break }
      case 'g': case 'G': {
        const n = toNum(v); const P = prec === 0 ? 1 : prec ?? 6
        if (n === 0) s = '0'
        else {
          const exp = Math.floor(Math.log10(Math.abs(n)))
          if (exp < -4 || exp >= P) s = n.toExponential(P - 1).replace(/\.?0+e/, 'e').replace(/e([+-])(\d)$/, 'e$10$2')
          else s = String(+n.toFixed(Math.max(0, P - 1 - exp)))
        }
        if (conv === 'G') s = s.toUpperCase()
        if (n >= 0 && flags.includes('+')) s = '+' + s
        break
      }
      case 'c': s = typeof v === 'number' ? String.fromCharCode(v) : toStr(v).charAt(0); break
      default: s = toStr(v); if (prec !== undefined) s = s.slice(0, prec)
    }
    if (s.length < width) {
      if (flags.includes('-')) s = s.padEnd(width)
      else if (flags.includes('0') && conv !== 's' && conv !== 'c') { const sign = /^[-+ ]/.test(s) ? s[0] : ''; s = sign + s.slice(sign.length).padStart(width - sign.length, '0') }
      else s = s.padStart(width)
    }
    return s
  })
}

// ---------------------------------------------------------------- lexer
interface Tok { t: 'num' | 'str' | 're' | 'id' | 'op' | 'nl' | 'eof'; v: string; n?: number }

function lex(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  let prevSignificant: Tok | null = null
  const push = (t: Tok) => { out.push(t); if (t.t !== 'nl') prevSignificant = t }
  const regexAllowed = () => !prevSignificant || prevSignificant.t === 'op' && !/^[)\]$]$/.test(prevSignificant.v) || prevSignificant.t === 'id' && /^(print|printf|if|else|return)$/.test(prevSignificant.v)
  while (i < src.length) {
    const c = src[i]
    if (c === '\n') { push({ t: 'nl', v: '\n' }); i++; continue }
    if (/[ \t\r]/.test(c)) { i++; continue }
    if (c === '\\' && src[i + 1] === '\n') { i += 2; continue }
    if (c === '#') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1] ?? ''))) {
      const m = /^(\d+\.?\d*([eE][-+]?\d+)?|\.\d+([eE][-+]?\d+)?)/.exec(src.slice(i))!
      push({ t: 'num', v: m[0], n: parseFloat(m[0]) }); i += m[0].length; continue
    }
    if (c === '"') {
      let s = ''; i++
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\') { const n = src[++i]; s += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '\r' : n === '"' ? '"' : n === '\\' ? '\\' : n === '/' ? '/' : '\\' + n } else s += src[i]
        i++
      }
      i++; push({ t: 'str', v: s }); continue
    }
    if (c === '/' && regexAllowed()) {
      let s = ''; i++
      while (i < src.length && src[i] !== '/') { if (src[i] === '\\' && src[i + 1] === '/') { s += '/'; i += 2 } else s += src[i++] }
      i++; push({ t: 're', v: s }); continue
    }
    if (/[A-Za-z_]/.test(c)) { const m = /^[A-Za-z_]\w*/.exec(src.slice(i))!; push({ t: 'id', v: m[0] }); i += m[0].length; continue }
    const three = src.slice(i, i + 3), two = src.slice(i, i + 2)
    if (['**='].includes(three)) { push({ t: 'op', v: '^=' }); i += 3; continue }
    if (['&&', '||', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '^=', '++', '--', '!~', '**'].includes(two)) { push({ t: 'op', v: two === '**' ? '^' : two }); i += 2; continue }
    push({ t: 'op', v: c }); i++
  }
  out.push({ t: 'eof', v: '' })
  return out
}

// ---------------------------------------------------------------- parser (to closures)
interface Env {
  vars: Map<string, Val>
  arrays: Map<string, Map<string, Val>>
  fields: string[]       // fields[0] is $0
  nf: number
  out: string[]
  next: boolean
}
type Expr = (e: Env) => Val
type Stmt = (e: Env) => void

const BREAK = Symbol('break'), CONTINUE = Symbol('continue')

class Parser {
  p = 0
  constructor(private toks: Tok[]) {}
  peek() { return this.toks[this.p] }
  isOp(v: string) { const t = this.peek(); return t.t === 'op' && t.v === v }
  eatOp(v: string) { if (this.isOp(v)) { this.p++; return true } return false }
  expectOp(v: string) { if (!this.eatOp(v)) throw new Error(`awk: syntax error, expected '${v}' near '${this.peek().v}'`) }
  skipNl() { while (this.peek().t === 'nl' || this.isOp(';')) this.p++ }

  parseProgram() {
    const begin: Stmt[] = [], end: Stmt[] = [], rules: { pat: Expr | null; act: Stmt | null }[] = []
    this.skipNl()
    while (this.peek().t !== 'eof') {
      const t = this.peek()
      if (t.t === 'id' && t.v === 'BEGIN') { this.p++; begin.push(this.parseBlock()) }
      else if (t.t === 'id' && t.v === 'END') { this.p++; end.push(this.parseBlock()) }
      else {
        let pat: Expr | null = null
        if (!this.isOp('{')) pat = this.parseExpr()
        const act = this.isOp('{') ? this.parseBlock() : null
        rules.push({ pat, act })
      }
      this.skipNl()
    }
    return { begin, end, rules }
  }
  parseBlock(): Stmt {
    this.expectOp('{')
    const stmts: Stmt[] = []
    this.skipNl()
    while (!this.isOp('}')) {
      if (this.peek().t === 'eof') throw new Error('awk: missing }')
      stmts.push(this.parseStmt()); this.skipNl()
    }
    this.expectOp('}')
    return (e) => { for (const s of stmts) { s(e); if (e.next) return } }
  }
  parseSimpleOrBlock(): Stmt { this.skipNl(); return this.isOp('{') ? this.parseBlock() : this.parseStmt() }
  parseStmt(): Stmt {
    const t = this.peek()
    if (t.t === 'id') {
      if (t.v === 'print' || t.v === 'printf') {
        this.p++
        const args: Expr[] = []
        const stop = () => this.peek().t === 'nl' || this.peek().t === 'eof' || this.isOp(';') || this.isOp('}')
        if (!stop()) { do { args.push(this.parseExpr(true)) } while (this.eatOp(',')) }
        if (this.isOp('>') ) throw new Error('awk: output redirection is not supported')
        if (t.v === 'print') return (e) => { e.out.push((args.length ? args.map((a) => toStr(a(e))).join(String(e.vars.get('OFS') ?? ' ')) : e.fields[0]) + '\n') }
        return (e) => { const [f, ...rest] = args.map((a) => a(e)); e.out.push(sprintf(toStr(f ?? ''), rest)) }
      }
      if (t.v === 'if') {
        this.p++; this.expectOp('('); const c = this.parseExpr(); this.expectOp(')')
        const th = this.parseSimpleOrBlock()
        const save = this.p; this.skipNl()
        if (this.peek().t === 'id' && this.peek().v === 'else') { this.p++; const el = this.parseSimpleOrBlock(); return (e) => (toBool(c(e)) ? th(e) : el(e)) }
        this.p = save
        return (e) => { if (toBool(c(e))) th(e) }
      }
      if (t.v === 'while') {
        this.p++; this.expectOp('('); const c = this.parseExpr(); this.expectOp(')')
        const body = this.parseSimpleOrBlock()
        return (e) => { let n = 0; try { while (toBool(c(e)) && !e.next) { if (++n > 1e7) throw new Error('awk: loop limit exceeded'); try { body(e) } catch (x) { if (x === CONTINUE) continue; throw x } } } catch (x) { if (x !== BREAK) throw x } }
      }
      if (t.v === 'for') {
        this.p++; this.expectOp('(')
        const k = this.toks[this.p], inn = this.toks[this.p + 1], arr = this.toks[this.p + 2], close = this.toks[this.p + 3]
        if (k.t === 'id' && inn.t === 'id' && inn.v === 'in' && arr.t === 'id' && close.t === 'op' && close.v === ')') {
          this.p += 4
          const body = this.parseSimpleOrBlock()
          return (e) => { for (const key of [...(e.arrays.get(arr.v)?.keys() ?? [])]) { e.vars.set(k.v, mkField(key)); try { body(e) } catch (x) { if (x === CONTINUE) continue; if (x === BREAK) break; throw x } if (e.next) break } }
        }
        const init = this.isOp(';') ? null : this.parseExpr(); this.expectOp(';')
        const cond = this.isOp(';') ? null : this.parseExpr(); this.expectOp(';')
        const inc = this.isOp(')') ? null : this.parseExpr(); this.expectOp(')')
        const body = this.parseSimpleOrBlock()
        return (e) => {
          if (init) init(e)
          let n = 0
          try { while ((!cond || toBool(cond(e))) && !e.next) { if (++n > 1e7) throw new Error('awk: loop limit exceeded'); try { body(e) } catch (x) { if (x !== CONTINUE) throw x } if (inc) inc(e) } } catch (x) { if (x !== BREAK) throw x }
        }
      }
      if (t.v === 'break') { this.p++; return () => { throw BREAK } }
      if (t.v === 'continue') { this.p++; return () => { throw CONTINUE } }
      if (t.v === 'delete') {
        this.p++
        const name = this.toks[this.p++].v
        if (this.eatOp('[')) { const k = this.parseExpr(); this.expectOp(']'); return (e) => { e.arrays.get(name)?.delete(toStr(k(e))) } }
        return (e) => { e.arrays.delete(name) }
      }
      if (t.v === 'next') { this.p++; return (e) => { e.next = true } }
      if (t.v === 'exit') { this.p++; return (e) => { e.next = true; e.vars.set('__exit', 1) } }
    }
    if (this.isOp('{')) return this.parseBlock()
    const x = this.parseExpr()
    return (e) => { x(e) }
  }

  parseExpr(noGt = false): Expr { return this.parseTernary(noGt) }
  parseTernary(noGt: boolean): Expr {
    const c = this.parseOr(noGt)
    if (this.eatOp('?')) { const a = this.parseTernary(noGt); this.expectOp(':'); const b = this.parseTernary(noGt); return (e) => (toBool(c(e)) ? a(e) : b(e)) }
    // assignment (right assoc) when lhs is an lvalue
    const t = this.peek()
    if (t.t === 'op' && /^(=|\+=|-=|\*=|\/=|%=|\^=)$/.test(t.v) && (this.lastLv)) {
      const lv = this.lastLv; this.lastLv = null; this.p++
      const rhs = this.parseTernary(noGt)
      const op = t.v
      return (e) => {
        let v = rhs(e)
        if (op !== '=') { const cur = toNum(lv.get(e)), r = toNum(v); v = op === '+=' ? cur + r : op === '-=' ? cur - r : op === '*=' ? cur * r : op === '/=' ? cur / r : op === '%=' ? cur % r : Math.pow(cur, r) }
        lv.set(e, v); return v
      }
    }
    return c
  }
  lastLv: { get: Expr; set: (e: Env, v: Val) => void } | null = null
  parseOr(noGt: boolean): Expr { let l = this.parseAnd(noGt); while (this.eatOp('||')) { const a = l, r = this.parseAnd(noGt); l = (e) => (toBool(a(e)) || toBool(r(e)) ? 1 : 0) } return l }
  parseAnd(noGt: boolean): Expr { let l = this.parseMatch(noGt); while (this.eatOp('&&')) { const a = l, r = this.parseMatch(noGt); l = (e) => (toBool(a(e)) && toBool(r(e)) ? 1 : 0) } return l }
  parseMatch(noGt: boolean): Expr {
    let l = this.parseCmp(noGt)
    for (;;) {
      const neg = this.isOp('!~')
      if (!(this.isOp('~') || neg)) return l
      this.p++
      const a = l, r = this.parseCmp(noGt)
      l = (e) => { const re = new RegExp(toStr(r(e))); return re.test(toStr(a(e))) !== neg ? 1 : 0 }
    }
  }
  parseCmp(noGt: boolean): Expr {
    const l = this.parseConcat(noGt)
    if (this.peek().t === 'id' && this.peek().v === 'in') {   // (key in array)
      this.p++
      const arr = this.toks[this.p++].v
      return (e) => (e.arrays.get(arr)?.has(toStr(l(e))) ? 1 : 0)
    }
    const t = this.peek()
    if (t.t === 'op' && ['<', '<=', '==', '!=', '>=', '>'].includes(t.v) && !(noGt && t.v === '>')) {
      this.p++
      const r = this.parseConcat(noGt); const op = t.v
      return (e) => {
        const a = l(e), b = r(e)
        const numeric = (typeof a === 'number' || isStrnum(a)) && (typeof b === 'number' || isStrnum(b))
        const x: number | string = numeric ? toNum(a) : toStr(a), y: number | string = numeric ? toNum(b) : toStr(b)
        return (op === '<' ? x < y : op === '<=' ? x <= y : op === '==' ? x === y : op === '!=' ? x !== y : op === '>=' ? x >= y : x > y) ? 1 : 0
      }
    }
    return l
  }
  startsOperand() {
    const t = this.peek()
    if (t.t === 'num' || t.t === 'str' || t.t === 're') return true
    if (t.t === 'id') return !/^(in|else)$/.test(t.v)
    return t.t === 'op' && (t.v === '$' || t.v === '(' || t.v === '!' || t.v === '-' && false || t.v === '++' || t.v === '--')
  }
  parseConcat(noGt: boolean): Expr {
    let l = this.parseAdd(noGt)
    while (this.startsOperand()) { const a = l, r = this.parseAdd(noGt); l = (e) => toStr(a(e)) + toStr(r(e)) }
    return l
  }
  parseAdd(noGt: boolean): Expr {
    let l = this.parseMul(noGt)
    for (;;) {
      if (this.isOp('+')) { this.p++; const a = l, r = this.parseMul(noGt); l = (e) => toNum(a(e)) + toNum(r(e)) }
      else if (this.isOp('-')) { this.p++; const a = l, r = this.parseMul(noGt); l = (e) => toNum(a(e)) - toNum(r(e)) }
      else return l
    }
  }
  parseMul(noGt: boolean): Expr {
    let l = this.parseUnary(noGt)
    for (;;) {
      const t = this.peek()
      if (t.t === 'op' && (t.v === '*' || t.v === '/' || t.v === '%')) {
        this.p++; const a = l, r = this.parseUnary(noGt), op = t.v
        l = (e) => { const x = toNum(a(e)), y = toNum(r(e)); return op === '*' ? x * y : op === '/' ? x / y : x % y }
      } else return l
    }
  }
  parseUnary(noGt: boolean): Expr {
    if (this.eatOp('!')) { const x = this.parseUnary(noGt); return (e) => (toBool(x(e)) ? 0 : 1) }
    if (this.eatOp('-')) { const x = this.parseUnary(noGt); return (e) => -toNum(x(e)) }
    if (this.eatOp('+')) { const x = this.parseUnary(noGt); return (e) => toNum(x(e)) }
    return this.parsePow(noGt)
  }
  parsePow(noGt: boolean): Expr {
    const base = this.parsePost(noGt)
    if (this.eatOp('^')) { const ex = this.parseUnary(noGt); return (e) => Math.pow(toNum(base(e)), toNum(ex(e))) }
    return base
  }
  parsePost(noGt: boolean): Expr {
    this.lastLv = null
    const x = this.parsePrimary(noGt)
    const lv = this.lastLv as { get: Expr; set: (e: Env, v: Val) => void } | null
    if (lv && (this.isOp('++') || this.isOp('--'))) {
      const inc = this.peek().v === '++' ? 1 : -1; this.p++
      this.lastLv = null
      return (e) => { const o = toNum(lv.get(e)); lv.set(e, o + inc); return o }
    }
    this.lastLv = lv
    return x
  }
  parsePrimary(noGt: boolean): Expr {
    const t = this.peek()
    this.lastLv = null
    if (t.t === 'num') { this.p++; const n = t.n!; return () => n }
    if (t.t === 'str') { this.p++; const s = t.v; return () => s }
    if (t.t === 're') { this.p++; const re = new RegExp(t.v); return (e) => (re.test(e.fields[0]) ? 1 : 0) }
    if (t.t === 'op') {
      if (t.v === '(') { this.p++; const x = this.parseExpr(); this.expectOp(')'); this.lastLv = null; return x }
      if (t.v === '$') {
        this.p++
        const idx = this.parsePrimaryForField()
        const get: Expr = (e) => { const i = Math.trunc(toNum(idx(e))); const s = i === 0 ? e.fields[0] : e.fields[i] ?? ''; return mkField(s) }
        const set = (e: Env, v: Val) => setField(e, Math.trunc(toNum(idx(e))), toStr(v))
        this.lastLv = { get, set }
        return get
      }
      if (t.v === '++' || t.v === '--') {
        this.p++; const inc = t.v === '++' ? 1 : -1
        this.lastLv = null
        const x = this.parsePrimary(noGt); const lv = this.lastLv as { get: Expr; set: (e: Env, v: Val) => void } | null
        if (!lv) throw new Error('awk: ++/-- needs a variable')
        this.lastLv = null
        return (e) => { const n = toNum(lv.get(e)) + inc; lv.set(e, n); return n }
      }
    }
    if (t.t === 'id') {
      this.p++
      if (this.isOp('(') ) return this.parseCall(t.v)
      if (this.isOp('[')) {
        this.p++; const k = this.parseExpr(); this.expectOp(']')
        const arr = (e: Env) => { let a = e.arrays.get(t.v); if (!a) { a = new Map(); e.arrays.set(t.v, a) } return a }
        const get: Expr = (e) => arr(e).get(toStr(k(e))) ?? ''
        this.lastLv = { get, set: (e, v) => { arr(e).set(toStr(k(e)), v) } }
        return get
      }
      const name = t.v
      const get: Expr = (e) => e.vars.get(name) ?? ''
      this.lastLv = { get, set: (e, v) => { e.vars.set(name, v) } }
      return name === 'NF' ? (e) => e.nf : get
    }
    throw new Error(`awk: syntax error near '${t.v || 'end of program'}'`)
  }
  parsePrimaryForField(): Expr {
    // $NF, $1, $(expr), $i  — binds tighter than arithmetic
    const t = this.peek()
    if (t.t === 'num') { this.p++; const n = t.n!; return () => n }
    if (t.t === 'op' && t.v === '(') { this.p++; const x = this.parseExpr(); this.expectOp(')'); return x }
    if (t.t === 'id') { this.p++; const n = t.v; return n === 'NF' ? (e) => e.nf : (e) => e.vars.get(n) ?? '' }
    if (t.t === 'op' && t.v === '$') { this.p++; const inner = this.parsePrimaryForField(); return (e) => mkField(e.fields[Math.trunc(toNum(inner(e)))] ?? '') as Val }
    throw new Error('awk: bad field reference')
  }
  parseCall(name: string): Expr {
    this.expectOp('(')
    const args: Expr[] = []
    const rawRe: (string | null)[] = []
    if (!this.isOp(')')) {
      do {
        const tk = this.peek()
        rawRe.push(tk.t === 're' ? tk.v : null)
        args.push(this.parseExpr())
      } while (this.eatOp(','))
    }
    this.expectOp(')')
    const A = (e: Env) => args.map((a) => a(e))
    switch (name) {
      case 'length': return (e) => (args.length ? toStr(args[0](e)).length : e.fields[0].length)
      case 'substr': return (e) => { const s = toStr(args[0](e)); const m = Math.round(toNum(args[1](e))); const n = args[2] ? Math.round(toNum(args[2](e))) : Infinity; const start = Math.max(1, m); const end = m + n; return s.slice(start - 1, Math.max(start - 1, end - 1)) }
      case 'index': return (e) => toStr(args[0](e)).indexOf(toStr(args[1](e))) + 1
      case 'sqrt': return (e) => Math.sqrt(toNum(args[0](e)))
      case 'sin': return (e) => Math.sin(toNum(args[0](e)))
      case 'cos': return (e) => Math.cos(toNum(args[0](e)))
      case 'atan2': return (e) => Math.atan2(toNum(args[0](e)), toNum(args[1](e)))
      case 'exp': return (e) => Math.exp(toNum(args[0](e)))
      case 'log': return (e) => Math.log(toNum(args[0](e)))
      case 'int': return (e) => Math.trunc(toNum(args[0](e)))
      case 'rand': return () => Math.random()
      case 'srand': return () => 0
      case 'tolower': return (e) => toStr(args[0](e)).toLowerCase()
      case 'toupper': return (e) => toStr(args[0](e)).toUpperCase()
      case 'sprintf': return (e) => { const [f, ...r] = A(e); return sprintf(toStr(f), r) }
      case 'split': {
        const arrName = this.lastArrName(args, name)
        return (e) => { const s = toStr(args[0](e)); const sep = args[2] ? toStr(args[2](e)) : String(e.vars.get('FS') ?? ' '); const parts = splitFields(s, sep); const a = new Map<string, Val>(); parts.forEach((p, i) => a.set(String(i + 1), mkField(p))); e.arrays.set(arrName, a); return parts.length }
      }
      case 'sub': case 'gsub': {
        const global = name === 'gsub'
        return (e) => {
          const reSrc = rawRe[0] ?? toStr(args[0](e)); const repl = toStr(args[1](e)).replace(/\\&/g, '\u0000').replace(/&/g, '$&').replace(/\u0000/g, '&')
          const target = e.fields[0]
          const re = new RegExp(reSrc, global ? 'g' : '')
          const next = target.replace(re, repl)
          const changed = next !== target ? 1 : 0
          if (changed) setField(e, 0, next)
          return changed
        }
      }
      default: throw new Error(`awk: function ${name} is not supported`)
    }
  }
  private lastArrName(_a: Expr[], _n: string) { return '__split' }
}

function splitFields(line: string, fs: string): string[] {
  if (fs === ' ') return line.trim() === '' ? [] : line.trim().split(/\s+/)
  if (fs === '\t') return line.split('\t')
  if (fs.length === 1) return line.split(fs)
  return line.split(new RegExp(fs))
}

function setField(e: Env, i: number, s: string) {
  if (i === 0) { e.fields = [s, ...splitFields(s, String(e.vars.get('FS') ?? ' '))]; e.nf = e.fields.length - 1; return }
  while (e.fields.length <= i) e.fields.push('')
  e.fields[i] = s
  e.nf = Math.max(e.nf, i)
  e.fields[0] = e.fields.slice(1, e.nf + 1).join(String(e.vars.get('OFS') ?? ' '))
}

export interface AwkOptions { fs?: string; vars?: Record<string, string> }

/** Run an AWK program over `input` and return its output. Throws Error with an awk-style message. */
export function runAwk(program: string, input: string, opts: AwkOptions = {}): string {
  const parser = new Parser(lex(program))
  const prog = parser.parseProgram()
  const env: Env = { vars: new Map(), arrays: new Map(), fields: [''], nf: 0, out: [], next: false }
  env.vars.set('FS', opts.fs ?? ' '); env.vars.set('OFS', ' '); env.vars.set('NR', 0)
  for (const [k, v] of Object.entries(opts.vars ?? {})) env.vars.set(k, mkField(v))
  const exited = () => env.vars.has('__exit')
  for (const b of prog.begin) { b(env); env.next = false }
  if (!exited() && (prog.rules.length || prog.end.length)) {
    const lines = input.split(/\r?\n/)
    if (lines.length && lines[lines.length - 1] === '') lines.pop()
    let nr = 0
    for (const line of lines) {
      nr++
      env.vars.set('NR', nr)
      env.fields = [line, ...splitFields(line, String(env.vars.get('FS')))]
      env.nf = env.fields.length - 1
      env.next = false
      for (const r of prog.rules) {
        if (r.pat && !toBool(r.pat(env))) continue
        if (r.act) r.act(env)
        else env.out.push(env.fields[0] + '\n')
        if (env.next) break
      }
      if (exited()) break
    }
  }
  for (const b of prog.end) { env.next = false; b(env) }
  return env.out.join('')
}
