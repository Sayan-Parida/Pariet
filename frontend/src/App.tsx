import { useEffect, useState, useCallback, useRef } from 'react';
import { 
  MapPinned
} from 'lucide-react';
import Navbar from './components/Navbar';
import SessionList from './components/SessionList';
import MindMap from './components/MindMap';
import Timeline from './components/Timeline';
import PagesView from './components/PagesView';
import ResearchSearch from './components/ResearchSearch';
import ShortcutsModal from './components/ShortcutsModal';
import ResumePanel from './components/ResumePanel';
import { Session } from './types';
import { apiClient } from './api/client';
import { dataEvents } from './api/dataEvents';

const formatSessionDate = (value: string) => new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric'
}).format(new Date(value));

const formatSessionDuration = (startTime: string, endTime: string | null) => {
  if (!endTime) return 'In progress';
  const minutes = Math.max(1, Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
};

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'mindmap' | 'timeline' | 'pages'>('mindmap');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);

  // Load sessions
  const loadSessions = useCallback(async () => {
    try {
      const data = await apiClient.getSessions();
      setSessions(data);
      if (!selectedSessionId && data.length > 0) {
        setSelectedSessionId(data[0].id);
      }
    } catch (e) {
      console.warn('Error loading sessions:', e);
    }
  }, [selectedSessionId]);

  useEffect(() => {
    loadSessions();
    const unsubscribe = dataEvents.subscribe(() => {
      loadSessions();
    });
    return () => {
      unsubscribe();
    };
  }, [loadSessions]);

  // A session started or ended from the extension must be reflected here
  // without a manual reload, otherwise the status badge keeps showing a stale
  // COMPLETED and its indicator never turns green. Poll while any session is
  // running, and back off to a slow poll when everything is settled.
  const hasActiveSession = sessions.some((s) => s.status === 'ACTIVE');
  useEffect(() => {
    const interval = window.setInterval(() => {
      // Skip refreshes while the tab is hidden; resume promptly on return.
      if (document.visibilityState === 'visible') {
        loadSessions();
      }
    }, hasActiveSession ? 4000 : 15000);
    return () => window.clearInterval(interval);
  }, [loadSessions, hasActiveSession]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadSessions();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadSessions]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen(true);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setIsSidebarCollapsed(prev => !prev);
      } else if (e.key === 'Escape') {
        setShowShortcutsModal(false);
        setIsSearchOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const activeSession = sessions.find((s) => s.id === selectedSessionId);

  // Keep the last known session so the header shell stays mounted (and keeps its
  // previous content) during the brief window where a session switch triggers a
  // re-fetch. Prevents any mid-switch collapse/resize of the header.
  const lastSessionRef = useRef<Session | null>(null);
  if (activeSession) lastSessionRef.current = activeSession;
  const headerSession = activeSession ?? lastSessionRef.current;

  const handleViewPath = useCallback((nodeId: string) => {
    setFocusNodeId(nodeId);
    setActiveTab('mindmap');
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-app)] text-[var(--text-primary)] font-sans select-none antialiased">
      {/* Compact Collapsible Sidebar */}
      <SessionList
        selectedSessionId={selectedSessionId}
        onSelectSession={setSelectedSessionId}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />

      {/* Main App Workspace Shell */}
      <main className="relative flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Desktop Top Bar */}
        <Navbar
          activeSession={activeSession}
          activeTab={activeTab}
          onChangeTab={setActiveTab}
          onOpenShortcuts={() => setShowShortcutsModal(true)}
          onFocusSearch={() => setIsSearchOpen(true)}
        />

        {/* Command Search Overlay / Dropdown */}
        {isSearchOpen && (
          <div className="fixed inset-0 z-40 flex items-start justify-center pt-16 bg-black/70">
            <div className="w-full max-w-lg p-2">
              <ResearchSearch
                activeSessionId={selectedSessionId}
                isOpen={isSearchOpen}
                onClose={() => setIsSearchOpen(false)}
                onFocusNode={(nodeId) => {
                  setFocusNodeId(nodeId);
                  setIsSearchOpen(false);
                }}
              />
            </div>
          </div>
        )}

        {selectedSessionId && headerSession && (
          <section className="shrink-0 relative bg-[var(--surface-base)] px-4 lg:px-6 py-2 border-b-2 border-[var(--border-strong)]">
            <div className="flex items-center gap-3 min-h-[44px]">
              {/* Left: Research session badge + status (session name lives in the top breadcrumb) */}
              <div className="flex shrink-0 items-center gap-2">
                <span className="b-tag b-tag--accent">
                  <MapPinned className="w-2.5 h-2.5" />
                  Research session
                </span>
                <span
                  className={`b-live ${headerSession.status === 'ACTIVE' ? 'b-live--on' : ''}`}
                  style={{ background: headerSession.status === 'ACTIVE' ? 'var(--status-active)' : 'var(--status-muted)' }}
                />
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  {headerSession.status}
                  {headerSession.status === 'ACTIVE' ? ' • live trail' : ''}
                </span>
              </div>

              {/* Center: compact single-line session stats */}
              <div className="mx-auto flex items-center gap-1.5">
                <div className="flex items-center gap-1.5 border-2 border-[var(--accent)] bg-[var(--accent-subtle)] rounded-[var(--radius-sm)] px-2 py-1">
                  <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-muted)]">Started</span>
                  <span className="font-mono text-[11px] font-bold text-[var(--text-primary)] min-w-[5.5rem]">{formatSessionDate(headerSession.startTime)}</span>
                </div>
                <div className="flex items-center gap-1.5 border-2 border-[var(--border-medium)] bg-[var(--surface-elevated)] rounded-[var(--radius-sm)] px-2 py-1">
                  <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-faint)]">Duration</span>
                  <span className="font-mono text-[11px] font-bold text-[var(--text-primary)] min-w-[4.75rem]">{formatSessionDuration(headerSession.startTime, headerSession.endTime)}</span>
                </div>
                <div className="flex items-center gap-1.5 border-2 border-[var(--accent-warm)] bg-[var(--accent-warm-subtle)] rounded-[var(--radius-sm)] px-2 py-1">
                  <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-muted)]">Searches</span>
                  <span className="font-mono text-[11px] font-bold text-[var(--text-primary)] min-w-[0.75rem]">{headerSession.searchCount}</span>
                </div>
                <div className="flex items-center gap-1.5 border-2 border-[var(--node-page)] bg-[var(--node-page-bg)] rounded-[var(--radius-sm)] px-2 py-1 hidden md:flex">
                  <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-muted)]">Pages</span>
                  <span className="font-mono text-[11px] font-bold text-[var(--text-primary)] min-w-[0.75rem]">{headerSession.pageCount}</span>
                </div>
              </div>

              {/* Right: compact Resume Research card */}
              <div className="hidden shrink-0 lg:block">
                <ResumePanel sessionId={headerSession.id} onViewPath={handleViewPath} />
              </div>
            </div>
          </section>
        )}

        {/* Hero Canvas Area */}
        <div className="flex-1 min-h-0 relative overflow-hidden bg-[var(--graph-bg)]">
          {!selectedSessionId ? (
            /* Welcome State */
            <div className="h-full flex flex-col items-center justify-center p-6 text-center max-w-lg mx-auto space-y-5">
              <img
                src="./pariet-logo.png"
                alt="Pariet logo"
                className="w-14 h-14 object-contain"
              />

              <div>
                <h1 className="font-display text-2xl font-bold tracking-tight text-[var(--text-primary)]">
                  Pariet
                </h1>
                <p className="text-xs font-mono text-[var(--text-secondary)] tracking-wide">
                  Interactive knowledge graph workspace.
                </p>
              </div>
            </div>
          ) : (
            /* Active Views */
            <div key={activeTab} className="view-enter w-full h-full">
              {activeTab === 'mindmap' && (
                <MindMap
                  key={selectedSessionId}
                  sessionId={selectedSessionId}
                  session={activeSession}
                  focusNodeId={focusNodeId}
                  onFocusNodeConsumed={() => setFocusNodeId(null)}
                />
              )}
              {activeTab === 'timeline' && (
                <Timeline 
                  sessionId={selectedSessionId} 
                  onJumpToNode={() => setActiveTab('mindmap')}
                />
              )}
              {activeTab === 'pages' && (
                <PagesView sessionId={selectedSessionId} />
              )}
            </div>
          )}
        </div>
      </main>

      {/* Shortcuts Guide Modal */}
      {showShortcutsModal && (
        <ShortcutsModal onClose={() => setShowShortcutsModal(false)} />
      )}
    </div>
  );
}
