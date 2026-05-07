import { BookMarked, Bot, Search, Settings, StickyNote } from 'lucide-react'

export type InspectorTab = 'notes' | 'search' | 'ai' | 'vocab' | 'settings'

type InspectorTabBarProps = {
  activeTab: InspectorTab
  onChange: (tab: InspectorTab) => void
}

export function InspectorTabBar({ activeTab, onChange }: InspectorTabBarProps): JSX.Element {
  return (
    <nav className="tab-bar">
      <button className={activeTab === 'notes' ? 'active' : ''} onClick={() => onChange('notes')}>
        <StickyNote size={16} />
        笔记
      </button>
      <button className={activeTab === 'search' ? 'active' : ''} onClick={() => onChange('search')}>
        <Search size={16} />
        搜索
      </button>
      <button className={activeTab === 'ai' ? 'active' : ''} onClick={() => onChange('ai')}>
        <Bot size={16} />
        AI
      </button>
      <button className={activeTab === 'vocab' ? 'active' : ''} onClick={() => onChange('vocab')}>
        <BookMarked size={16} />
        词汇
      </button>
      <button className={activeTab === 'settings' ? 'active' : ''} onClick={() => onChange('settings')}>
        <Settings size={16} />
        配置
      </button>
    </nav>
  )
}
