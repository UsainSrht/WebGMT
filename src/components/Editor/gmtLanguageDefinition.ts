import type * as Monaco from 'monaco-editor'

export const GMT_MODULES = [
  'begin', 'end', 'figure', 'basemap', 'coast', 'plot', 'plot3d', 'text', 'makecpt', 'grd2cpt', 'grdimage', 'grdcontour',
  'contour', 'colorbar', 'legend', 'inset', 'subplot', 'grdcut', 'grdmath', 'grdgradient', 'grdinfo', 'surface', 'nearneighbor',
  'blockmean', 'select', 'project', 'math', 'info', 'select', 'histogram', 'rose', 'wiggle', 'solar', 'psconvert', 'set', 'clear',
]

const FLAGS: [string, string][] = [
  ['-R', 'Region: -Rwest/east/south/north, -Rg (global 0/360), -Rd (global -180/180)'],
  ['-J', 'Map projection, e.g. -JM15c, -JQ0/18c, -JX15c/10c, -JW15c'],
  ['-B', 'Frame and axes annotation, e.g. -Bafg -BWSen+t"Title"'],
  ['-X', 'Shift plot origin in x'], ['-Y', 'Shift plot origin in y'],
  ['-W', 'Pen: width,color,style e.g. -W0.5p,red'],
  ['-G', 'Fill color / pattern'], ['-S', 'Symbol (plot) or water fill (coast)'],
  ['-C', 'Color palette / contour interval'], ['-T', 'Range for makecpt: -Tmin/max/inc'],
  ['-V', 'Verbosity'], ['-p', '3-D perspective'], ['-D', 'Resolution (coast) / position (colorbar)'],
  ['-N', 'Political boundaries (coast)'], ['-I', 'Rivers (coast)'], ['-F', 'Font / frame settings'],
]

let registered = false

export function registerGmtLanguage(monaco: typeof Monaco) {
  if (registered) return
  registered = true
  monaco.languages.register({ id: 'gmt' })

  monaco.languages.setMonarchTokensProvider('gmt', {
    defaultToken: '',
    modules: GMT_MODULES,
    tokenizer: {
      root: [
        [/^#!.*$/, 'comment.shebang'],
        [/#.*$/, 'comment'],
        [/\bgmt\b(?=\s)/, 'keyword.gmt'],
        [/<<-?\s*['"]?(\w+)['"]?/, { token: 'keyword.heredoc', next: '@heredoc.$1' }],
        [/(?<=\bgmt\s+)[a-z0-9_]+/, { cases: { '@modules': 'keyword', '@default': 'identifier' } }],
        [/\b(?:cat|echo|export|set|rm|mkdir)\b/, 'keyword.shell'],
        [/\$\{?[A-Za-z_]\w*\}?/, 'variable'],
        [/^[A-Za-z_]\w*(?==)/, 'variable.name'],
        [/\s-[A-Za-z](?=[\w/+.,:@-]|\s|$)/, 'flag'],
        [/>>?|2>&1|\|/, 'operator'],
        [/"/, { token: 'string', next: '@dq' }],
        [/'[^']*'/, 'string'],
        [/-?\d+(\.\d+)?([eE][+-]?\d+)?[cipd]?/, 'number'],
      ],
      dq: [
        [/\$\{?[A-Za-z_]\w*\}?/, 'variable'],
        [/[^"$\\]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, { token: 'string', next: '@pop' }],
      ],
      heredoc: [
        [/^(\w+)\s*$/, { cases: { '$1==$S2': { token: 'keyword.heredoc', next: '@pop' }, '@default': 'string.heredoc' } }],
        [/.*/, 'string.heredoc'],
      ],
    },
  } as Monaco.languages.IMonarchLanguage)

  monaco.languages.setLanguageConfiguration('gmt', {
    comments: { lineComment: '#' },
    brackets: [['(', ')'], ['[', ']'], ['{', '}']],
    autoClosingPairs: [
      { open: '"', close: '"' }, { open: "'", close: "'" }, { open: '(', close: ')' }, { open: '[', close: ']' }, { open: '{', close: '}' },
    ],
  })

  monaco.editor.defineTheme('gmt-dark', {
    base: 'vs-dark', inherit: true,
    rules: [
      { token: 'keyword.gmt', foreground: '4fc1ff', fontStyle: 'bold' }, { token: 'keyword', foreground: 'c586c0' },
      { token: 'flag', foreground: 'dcdcaa' }, { token: 'variable', foreground: '9cdcfe' }, { token: 'comment', foreground: '6a9955' },
      { token: 'string.heredoc', foreground: 'ce9178' }, { token: 'keyword.heredoc', foreground: 'c586c0' },
    ],
    colors: {},
  })
  monaco.editor.defineTheme('gmt-light', {
    base: 'vs', inherit: true,
    rules: [
      { token: 'keyword.gmt', foreground: '0b5cad', fontStyle: 'bold' }, { token: 'keyword', foreground: 'af00db' },
      { token: 'flag', foreground: '795e26' }, { token: 'variable', foreground: '001080' }, { token: 'comment', foreground: '008000' },
      { token: 'string.heredoc', foreground: 'a31515' }, { token: 'keyword.heredoc', foreground: 'af00db' },
    ],
    colors: {},
  })

  monaco.languages.registerCompletionItemProvider('gmt', {
    triggerCharacters: [' ', '-'],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position)
      const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn }
      const before = model.getValueInRange({ startLineNumber: position.lineNumber, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column })
      const K = monaco.languages.CompletionItemKind
      const out: Monaco.languages.CompletionItem[] = []
      if (/\bgmt\s+\w*$/.test(before)) {
        for (const m of new Set(GMT_MODULES)) out.push({ label: m, kind: K.Function, insertText: m, range })
      }
      if (/\s-\w*$/.test(before) || /\s$/.test(before)) {
        const r = { ...range, startColumn: Math.max(1, word.startColumn - (before.endsWith('-' + word.word) ? 1 : 0)) }
        for (const [f, d] of FLAGS) out.push({ label: f, kind: K.Property, insertText: f, documentation: d, detail: d, range: r })
      }
      out.push({
        label: 'gmt begin…end', kind: K.Snippet, range, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        insertText: 'gmt begin ${1:figure} png\n\tgmt basemap -R${2:-180/180/-80/80} -J${3:Q15c} -Bafg\n\tgmt coast -G${4:tan} -S${5:lightblue}\ngmt end', documentation: 'Modern-mode figure skeleton',
      })
      return { suggestions: out }
    },
  })
}
