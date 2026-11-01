import { BookOpen, Github } from 'lucide-react'
import { APP_VERSION, AUTHOR, AUTHOR_URL, GMT_DOCS, GMT_REPO, GMT_VERSION, WEBGMT_REPO } from '../../lib/version'

const a = 'flex items-center gap-1 text-slate-600 hover:text-blue-600 dark:text-slate-300 dark:hover:text-blue-400'

/** Credits docked at the bottom of the side panel. */
export function SidebarFooter({ onAbout }: { onAbout: (tab: 'about' | 'license') => void }) {
  return (
    <footer className="shrink-0 space-y-1 border-t border-slate-200 px-3 py-2 text-[11px] text-slate-500 dark:border-slate-700">
      <div className="flex items-center justify-between">
        <button onClick={() => onAbout('about')} className="font-semibold text-slate-700 hover:text-blue-600 dark:text-slate-200 dark:hover:text-blue-400" title="About WebGMT">
          WebGMT v{APP_VERSION}
        </button>
        <span>GMT {GMT_VERSION}</span>
      </div>
      <div className="flex items-center gap-3">
        <a className={a} href={GMT_REPO} target="_blank" rel="noreferrer" title="GMT source code on GitHub"><Github size={12} /> GMT</a>
        <a className={a} href={WEBGMT_REPO} target="_blank" rel="noreferrer" title="WebGMT source code on GitHub"><Github size={12} /> WebGMT</a>
        <a className={a} href={GMT_DOCS} target="_blank" rel="noreferrer" title="GMT 6.6 documentation"><BookOpen size={12} /> Docs</a>
      </div>
      <div>
        Made by <a className="font-medium hover:text-blue-600 dark:hover:text-blue-400" href={AUTHOR_URL} target="_blank" rel="noreferrer">{AUTHOR}</a>
        {' · '}
        <button onClick={() => onAbout('license')} className="hover:text-blue-600 dark:hover:text-blue-400" title="MIT License and third-party notices">MIT License</button>
      </div>
    </footer>
  )
}
