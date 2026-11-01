import { useEffect, useState } from 'react'
import { FileQuestion } from 'lucide-react'
import { formatSize } from '../../lib/fileTypes'

/** Shown for files the editor cannot show as text. */
export function BinaryNotice({ name, size, tooLarge }: { name: string; size: number; tooLarge?: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-slate-500">
      <FileQuestion size={40} strokeWidth={1.5} />
      <p className="font-medium text-slate-700 dark:text-slate-200">{name}</p>
      <p className="text-sm">
        {tooLarge ? 'This file is too large to edit and its contents are not shown.' : 'This is a binary file and its contents are not readable.'}
      </p>
      <p className="text-xs">{formatSize(size)} ({size.toLocaleString()} bytes)</p>
    </div>
  )
}

/** Image preview (no editing). The data is turned into an object URL for the lifetime of the view. */
export function ImagePreview({ name, data, mime }: { name: string; data: ArrayBuffer; mime: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [broken, setBroken] = useState(false)

  useEffect(() => {
    const u = URL.createObjectURL(new Blob([data], { type: mime }))
    setUrl(u); setDims(null); setBroken(false)
    return () => URL.revokeObjectURL(u)
  }, [data, mime])

  if (broken) return <BinaryNotice name={name} size={data.byteLength} />
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto p-4 [background:conic-gradient(#e2e8f0_25%,#f8fafc_0_50%,#e2e8f0_0_75%,#f8fafc_0)_0_0/16px_16px] dark:[background:conic-gradient(#1e293b_25%,#0f172a_0_50%,#1e293b_0_75%,#0f172a_0)_0_0/16px_16px]">
        {url && (
          <img
            src={url}
            alt={name}
            onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            onError={() => setBroken(true)}
            className="mx-auto max-h-full max-w-full object-contain shadow"
          />
        )}
      </div>
      <p className="border-t border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800">
        {name} · {dims ? `${dims.w} × ${dims.h} px · ` : ''}{formatSize(data.byteLength)}
      </p>
    </div>
  )
}
