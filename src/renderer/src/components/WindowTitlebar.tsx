import { Maximize2, Minus, X } from 'lucide-react'

type WindowTitlebarProps = {
  isMaximized: boolean
  onClose: () => void
  onMinimize: () => void
  onToggleMaximize: () => void
}

export function WindowTitlebar({
  isMaximized,
  onClose,
  onMinimize,
  onToggleMaximize
}: WindowTitlebarProps): JSX.Element {
  return (
    <header className="window-titlebar">
      <div className="window-titlebar-brand">
        <span className="window-title-dot" />
        <strong>Reading Partner</strong>
      </div>
      <div className="window-controls">
        <button title="最小化" onClick={onMinimize}>
          <Minus size={14} />
        </button>
        <button title={isMaximized ? '还原' : '最大化'} onClick={onToggleMaximize}>
          <Maximize2 size={14} />
        </button>
        <button className="close" title="关闭" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
    </header>
  )
}
