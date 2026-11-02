import type { ComponentProps } from 'react'
import { SplitLayout } from './SplitLayout'
import { MobileLayout, type Pane } from './MobileLayout'

type Props = ComponentProps<typeof SplitLayout> & {
  /** phones, tablets and narrow windows: one pane at a time */
  compact: boolean
  pane: Pane
  onPane: (p: Pane) => void
  running: boolean
}

/** The desktop three-column layout, or the compact one when there is no room for it. */
export function ResponsiveLayout({ compact, pane, onPane, running, ...layout }: Props) {
  return compact ? <MobileLayout {...layout} pane={pane} onPane={onPane} running={running} /> : <SplitLayout {...layout} />
}
