import { Globe2, Moon, Sun } from 'lucide-react'
import { DownloadIndicator } from './DownloadIndicator'

export function Header({ dark, onToggleTheme }: { dark: boolean; onToggleTheme: () => void }) {
  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-900">
      <Globe2 size={18} className="text-blue-600" />
      <span className="font-semibold">WebGMT</span>
      <span className="text-xs text-slate-500">Generic Mapping Tools in your browser</span>
      <span className="flex-1" />
      <DownloadIndicator />
      <button onClick={onToggleTheme} className="rounded p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700" aria-label="Toggle theme">
        {dark ? <Sun size={16} /> : <Moon size={16} />}
      </button>
    </header>
  )
}
