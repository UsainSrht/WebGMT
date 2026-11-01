import { useEffect, useRef } from 'react'
import Editor, { loader, type OnMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import { applyMarkers } from '../../services/errorParser'
import { registerGmtLanguage } from './gmtLanguageDefinition'
import type { EditorMarker } from '../../types'

// Bundle Monaco locally (no CDN) so it works under COEP: require-corp.
;(self as any).MonacoEnvironment = { getWorker: () => new editorWorker() }
loader.config({ monaco })

/** Frees the model of a closed tab (the editor keeps one model per path). */
export function disposeModel(path: string) {
  monaco.editor.getModel(monaco.Uri.parse(path))?.dispose()
}

interface Props {
  /** one Monaco model per path keeps undo history and view state per tab */
  path: string
  language: string
  value: string
  onChange: (v: string) => void
  onRun: () => void
  markers: EditorMarker[]
  dark: boolean
  insertRequest?: { text: string; nonce: number } | null
}

export function MonacoGmtEditor({ path, language, value, onChange, onRun, markers, dark, insertRequest }: Props) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const runRef = useRef(onRun)
  runRef.current = onRun

  const onMount: OnMount = (editor) => {
    editorRef.current = editor
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current())
  }

  useEffect(() => {
    const model = editorRef.current?.getModel()
    if (model) applyMarkers(monaco, model, markers)
  }, [markers, path])

  useEffect(() => {
    const ed = editorRef.current
    if (!ed || !insertRequest) return
    const sel = ed.getSelection()
    if (sel) ed.executeEdits('insert-path', [{ range: sel, text: insertRequest.text, forceMoveMarkers: true }])
    ed.focus()
  }, [insertRequest])

  return (
    <Editor
      height="100%"
      path={path}
      language={language}
      theme={dark ? 'gmt-dark' : 'gmt-light'}
      value={value}
      beforeMount={(m) => registerGmtLanguage(m)}
      onMount={onMount}
      onChange={(v) => onChange(v ?? '')}
      options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, automaticLayout: true, tabSize: 2, wordWrap: 'off' }}
    />
  )
}
