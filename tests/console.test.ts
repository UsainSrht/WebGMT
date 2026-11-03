import { fold, severity } from '../src/lib/consoleLog'

let failed = 0, total = 0
const eq = (name: string, got: unknown, want: unknown) => {
  total++
  if (JSON.stringify(got) !== JSON.stringify(want)) { failed++; console.log(`FAIL ${name}
  got : ${JSON.stringify(got)}
  want: ${JSON.stringify(want)}`) }
}
const e = (stream: 'stdout' | 'stderr' | 'info', text: string, line?: number) => ({ stream, text, line })

eq('warning', severity(e('stderr', 'surface [WARNING]: 3 unusable points')), 'warning')
eq('information', severity(e('stderr', 'blockmedian [INFORMATION]: W: 245')), 'info')
eq('error', severity(e('stderr', 'psxy [ERROR]: Option -R: bad')), 'error')
eq('shell warning', severity(e('stderr', '[WARNING]: arithmetic expansion')), 'warning')
eq('unmarked stderr is an error', severity(e('stderr', 'something failed')), 'error')
eq('info stream', severity(e('info', '[NOTE]: x')), 'info')
eq('stdout', severity(e('stdout', 'N = 7')), 'plain')
eq('fold repeats', fold([e('stderr', 'a [WARNING]: x', 3), e('stderr', 'a [WARNING]: x', 3), e('stderr', 'b', 3)]).map((r) => r.n), [2, 1])
eq('different lines are not folded', fold([e('stderr', 'a', 3), e('stderr', 'a', 4)]).length, 2)
eq('stdout is never folded', fold([e('stdout', '0'), e('stdout', '0')]).length, 2)

if (failed) { console.error(`${failed}/${total} console tests failed`); process.exit(1) }
console.log(`console: ${total} checks passed`)
