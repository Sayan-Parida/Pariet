import React, { useEffect, useState } from 'react';
import { 
  Search, 
  ChevronLeft, 
  ChevronRight, 
  Trash2
} from 'lucide-react';
import { Session, SessionStatus } from '../types';
import { apiClient } from '../api/client';
import { sanitizeSessions } from '../api/sanitize';
import { researchStore } from '../api/researchStore';
import { shortcutLabel } from '../utils/platform';

const formatArchiveDate = (value: string | undefined) => {
  if (!value || Number.isNaN(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric'
  }).format(new Date(value));
};

interface Props {
  selectedSessionId: string | null;
  onSelectSession: (id: string | null) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export default function SessionList({
  selectedSessionId,
  onSelectSession,
  isCollapsed,
  onToggleCollapse
}: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [searchFilter, setSearchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | SessionStatus>('ALL');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSessions = async () => {
    try {
      setLoading(true);
      setSessions(sanitizeSessions(await apiClient.getSessions()));
    } catch (e) {
      console.warn('Error fetching sessions:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
    const unsubscribe = researchStore.subscribe(() => {
      fetchSessions();
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm('Delete this research session?')) return;
    try {
      await apiClient.deleteSession(id);
      setDeleteError(null);
      setSessions(prev => prev.filter(s => s.id !== id));
      researchStore.deleteSession(id);
      if (selectedSessionId === id) {
        const remaining = sessions.filter(s => s.id !== id);
        onSelectSession(remaining.length > 0 ? remaining[0].id : null);
      }
    } catch {
      setDeleteError('Could not delete this session.');
    }
  };

  const filteredSessions = sessions.filter((s) => {
    const query = searchFilter.trim().toLowerCase();
    const title = typeof s?.title === 'string' ? s.title : '';
    const matchesSearch = !query ||
      query.split(/\s+/).every((token) => title.toLowerCase().includes(token));
    const matchesStatus = statusFilter === 'ALL' || s?.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  if (isCollapsed) {
    return (
      <aside 
        className="h-full flex flex-col items-center py-2 border-r-2 transition-all duration-200 z-10 shrink-0 select-none"
        style={{
          width: 48,
          backgroundColor: 'var(--surface-base)',
          borderColor: 'var(--border-strong)',
        }}
      >
        <button
          onClick={onToggleCollapse}
          title={`Expand Sessions (${shortcutLabel('B')})`}
          className="b-btn b-btn--square mb-2"
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        <div className="flex-1 w-full overflow-y-auto flex flex-col items-center gap-1.5 px-1">
          {sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => onSelectSession(session.id)}
              title={session.title}
              className={`w-8 h-8 flex items-center justify-center text-[10px] font-mono font-bold transition-all ${
                selectedSessionId === session.id
                  ? 'bg-[var(--accent)] text-[var(--surface-base)] border-2 border-[var(--border-strong)] shadow-[2px_2px_0_var(--shadow-ink)]'
                  : 'bg-[var(--surface-base)] text-[var(--text-muted)] border border-[var(--border-medium)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]'
              }`}
            >
              {(session.title || 'Untitled').slice(0, 2).toUpperCase()}
            </button>
          ))}
        </div>
      </aside>
    );
  }

  return (
    <aside 
      className="h-full flex flex-col border-r-2 transition-all duration-200 z-10 shrink-0 select-none"
      style={{
        width: 300,
        backgroundColor: 'var(--surface-base)',
        borderColor: 'var(--border-strong)',
      }}
    >
      {/* Sidebar Header */}
      <div 
        className="h-14 px-3.5 border-b-2 flex items-center justify-between shrink-0"
        style={{ borderColor: 'var(--border-strong)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-[var(--text-primary)]">
            Research archive
          </span>
          <span 
            className="font-mono text-[10px] font-bold px-1.5 py-0.5 leading-none rounded-[var(--radius-xs)] bg-[var(--border-strong)] text-[var(--surface-base)]"
          >
            {sessions.length}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={onToggleCollapse}
            title={`Collapse Sidebar (${shortcutLabel('B')})`}
            className="b-btn b-btn--square"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Filter / Search mini-bar */}
      <div className="p-3.5 border-b-2 space-y-2.5" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="b-input">
          <Search className="w-3 h-3 text-[var(--text-faint)] shrink-0" />
          <input
            type="text"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Search sessions..."
          />
        </div>

        {/* Status filter tabs */}
        <div className="flex items-center gap-1.5 text-[11px]">
          {(['ALL', 'ACTIVE', 'COMPLETED'] as const).map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`b-seg ${statusFilter === st ? 'b-seg--on' : ''}`}
            >
              {st === 'ALL' ? 'All' : st[0] + st.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
        {deleteError && (
          <div
            className="border-2 border-[var(--status-danger)] bg-[var(--surface-base)] px-2.5 py-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.08em] text-[var(--status-danger)]"
          >
            {deleteError}
          </div>
        )}
        {loading && sessions.length === 0 ? (
          <div className="text-center py-8 text-xs font-mono text-[var(--text-muted)]">
            <span className="inline-block w-2 h-2 animate-pulse bg-[var(--accent)] mr-2" />
            LOADING ARCHIVE&hellip;
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="b-panel text-center py-8 px-3 text-xs font-mono text-[var(--text-muted)]">
            No sessions found.
            {searchFilter.trim() && (
              <>
                <br />
                <span className="text-[var(--text-faint)]">Try a different search.</span>
              </>
            )}
          </div>
        ) : (
          filteredSessions.map((session, index) => {
            const isSelected = selectedSessionId === session.id;
            const statusTone = session.status === 'ACTIVE'
              ? 'var(--status-active)'
              : session.status === 'ARCHIVED'
                ? 'var(--accent-warm)'
                : 'var(--border-strong)';
            return (
              <div
                key={session.id}
                onClick={() => onSelectSession(session.id)}
                className={`group border-2 rounded-[var(--radius-sm)] text-left cursor-pointer flex flex-col gap-1.5 transition-all ${
                  isSelected
                    ? 'bg-[var(--surface-elevated)] border-[var(--border-strong)] shadow-[4px_4px_0_var(--shadow-ink)] -translate-x-[2px] -translate-y-[2px]'
                    : 'bg-[var(--surface-base)] border-[var(--border-subtle)] hover:border-[var(--border-medium)] hover:shadow-[2px_2px_0_var(--shadow-ink)]'
                }`}
              >
                {/* Top row: live indicator + index + actions */}
                <div className="flex items-center justify-between gap-2 px-3 pt-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span 
                      className={`inline-block w-2 h-2 shrink-0 ${session.status === 'ACTIVE' ? 'b-live--on' : ''}`}
                      style={{ background: statusTone }}
                    />
                    <span className="font-mono text-[10px] font-bold text-[var(--text-faint)]">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-faint)] shrink-0">
                      {session.status}
                    </span>
                  </div>

                  <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => handleDelete(e, session.id)}
                      className="w-6 h-6 flex items-center justify-center border border-transparent hover:border-[var(--status-danger)] text-[var(--text-muted)] hover:text-[var(--status-danger)]"
                      title="Delete session"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Title */}
                <div className="px-3">
                  <span 
                    className="font-display text-[15px] font-bold leading-[1.1] text-[var(--text-primary)] line-clamp-2"
                  >
                    {session.title}
                  </span>
                </div>

                {/* Meta strip */}
                <div 
                  className="px-3 pb-2.5 flex items-center justify-between gap-2 font-mono text-[10px] text-[var(--text-muted)]"
                >
                  <span className="font-bold text-[var(--text-secondary)]">
                    {formatArchiveDate(session.startTime)}
                  </span>
                  <span className="flex items-center gap-1 flex-wrap justify-end">
                    <span className="border border-[var(--border-subtle)] px-1 py-px rounded-[var(--radius-xs)]">P {session.pageCount}</span>
                    <span className="border border-[var(--border-subtle)] px-1 py-px rounded-[var(--radius-xs)]">Q {session.searchCount}</span>
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div 
        className="h-8 px-3 text-[10px] font-mono font-bold text-[var(--surface-base)] flex items-center justify-between shrink-0"
        style={{ backgroundColor: 'var(--border-strong)' }}
      >
        <span className="uppercase tracking-[0.14em]">Pariet / Local</span>
        <button
          aria-label="Reset"
          onClick={() => {
            if (window.confirm('Reset sample research graphs?')) {
              researchStore.resetToDefault();
            }
          }}
          className="uppercase tracking-[0.1em] border border-[var(--surface-base)] px-1.5 py-px hover:bg-[var(--surface-base)] hover:text-[var(--border-strong)] transition-colors"
        >
        </button>
      </div>
    </aside>
  );
}
