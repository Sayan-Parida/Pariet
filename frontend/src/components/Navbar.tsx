import { useState, useRef, useEffect } from 'react';
import { shortcutLabel } from '../utils/platform';
import { 
  Network, 
  Clock, 
  BookOpen, 
  Settings, 
  Search
} from 'lucide-react';
import { Session } from '../types';

interface Props {
  activeSession: Session | undefined;
  activeTab: 'mindmap' | 'timeline' | 'pages';
  onChangeTab: (tab: 'mindmap' | 'timeline' | 'pages') => void;
  onOpenShortcuts: () => void;
  onFocusSearch: () => void;
}

export default function Navbar({
  activeSession,
  activeTab,
  onChangeTab,
  onOpenShortcuts,
  onFocusSearch
}: Props) {
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowSettingsMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header 
      className="flex items-center justify-between gap-4 px-4 h-14 border-b-2 z-30 select-none shrink-0"
      style={{
        backgroundColor: 'var(--surface-base)',
        borderColor: 'var(--border-strong)',
      }}
    >
      {/* Left: Brand & Session Breadcrumb */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="flex items-center gap-2 shrink-0">
          <img
            src="/pariet-logo.png"
            alt="Pariet logo"
            className="w-7 h-7 shrink-0 object-contain"
          />
          <span className="font-display text-base font-bold tracking-tight leading-none text-[var(--text-primary)]">
            Pariet
          </span>
          <span className="hidden md:inline-flex font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--text-faint)] border-[1.5px] border-[var(--border-medium)] px-1 py-0.5 rounded-[var(--radius-xs)]">
            ResearchLab
          </span>
        </div>

        {activeSession && (
          <>
            <span className="text-[var(--text-faint)] font-bold text-lg leading-none select-none">/</span>
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-[11px] text-[var(--text-muted)] uppercase tracking-[0.06em] hidden lg:inline">
                SESSION
              </span>
              <span className="text-[13px] text-[var(--text-secondary)] font-semibold truncate max-w-[140px] sm:max-w-[220px]">
                {activeSession.title}
              </span>
              <span 
                className={`b-live shrink-0 ${activeSession.status === 'ACTIVE' ? 'b-live--on' : ''}`}
              />
            </div>
          </>
        )}
      </div>

      {/* Center: View Tabs — three separate brutal boxes */}
      {activeSession && (
        <nav className="flex items-center gap-3">
          <button
            onClick={() => onChangeTab('mindmap')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-[var(--radius-xs)] text-sm font-semibold border-2 transition-all ${
              activeTab === 'mindmap'
                ? 'bg-[var(--accent-yellow)] text-[var(--ink)] border-[var(--border-strong)] shadow-[3px_3px_0_var(--shadow-ink)]'
                : 'bg-[var(--surface-base)] text-[var(--text-muted)] border-[var(--border-medium)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] hover:shadow-[2px_2px_0_var(--shadow-ink)] hover:-translate-x-[1px] hover:-translate-y-[1px]'
            }`}
          >
            <Network className="w-3.5 h-3.5" />
            <span>Research Map</span>
          </button>

          <button
            onClick={() => onChangeTab('timeline')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-[var(--radius-xs)] text-sm font-semibold border-2 transition-all ${
              activeTab === 'timeline'
                ? 'bg-[var(--accent-yellow)] text-[var(--ink)] border-[var(--border-strong)] shadow-[3px_3px_0_var(--shadow-ink)]'
                : 'bg-[var(--surface-base)] text-[var(--text-muted)] border-[var(--border-medium)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] hover:shadow-[2px_2px_0_var(--shadow-ink)] hover:-translate-x-[1px] hover:-translate-y-[1px]'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Timeline</span>
          </button>

          <button
            onClick={() => onChangeTab('pages')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-[var(--radius-xs)] text-sm font-semibold border-2 transition-all ${
              activeTab === 'pages'
                ? 'bg-[var(--accent-yellow)] text-[var(--ink)] border-[var(--border-strong)] shadow-[3px_3px_0_var(--shadow-ink)]'
                : 'bg-[var(--surface-base)] text-[var(--text-muted)] border-[var(--border-medium)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] hover:shadow-[2px_2px_0_var(--shadow-ink)] hover:-translate-x-[1px] hover:-translate-y-[1px]'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Sources ({activeSession.pageCount})</span>
          </button>
        </nav>
      )}

      {/* Right: FIND, Settings */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={onFocusSearch}
          className="b-btn text-xs"
          title={`Find a research session (${shortcutLabel('K')})`}
        >
          <Search className="w-3 h-3" />
          <span className="hidden sm:inline text-[11px]">FIND</span>
          <kbd className="font-mono text-[10px] font-bold text-[var(--text-muted)] bg-[var(--surface-subtle)] border border-[var(--border-medium)] px-1 rounded-[var(--radius-xs)]">{shortcutLabel('K')}</kbd>
        </button>

        {/* Settings Dropdown */}
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setShowSettingsMenu(!showSettingsMenu)}
            className={`b-btn b-btn--square ${showSettingsMenu ? 'bg-[var(--surface-selected)]' : ''}`}
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>

          {showSettingsMenu && (
            <div className="b-panel absolute right-0 mt-2 w-48 p-1.5 z-40 text-xs">
              <button
                onClick={() => { onOpenShortcuts(); setShowSettingsMenu(false); }}
                className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-[var(--surface-hover)] text-left text-[var(--text-secondary)]"
              >
                <span>Shortcuts Guide</span>
                <kbd className="font-mono text-[10px] font-bold text-[var(--text-faint)] border border-[var(--border-medium)] px-1.5 rounded-[var(--radius-xs)]">?</kbd>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
