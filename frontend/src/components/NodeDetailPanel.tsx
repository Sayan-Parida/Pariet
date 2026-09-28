import { 
  X, 
  ExternalLink, 
  ArrowRight
} from 'lucide-react';
import { NodeType, Session } from '../types';

interface NodeDetailPanelProps {
  data: {
    id: string;
    label: string;
    type: NodeType;
    domain?: string | null;
    url?: string;
    abstract?: string;
    authors?: string[];
    insights?: string[];
    timestamp?: string;
    metadata?: Record<string, unknown>;
  };
  connectedNodes?: Array<{
    id: string;
    label: string;
    type: NodeType;
    relationship: string;
  }>;
  session?: Session;
  onSelectConnectedNode?: (nodeId: string) => void;
  onClose: () => void;
}

const formatTime = (value: string) =>
  new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const formatDuration = (startTime: string, endTime: string | null) => {
  if (!endTime) return 'In progress';
  const minutes = Math.max(1, Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
};

const typeLabel = (type: NodeType): string => {
  switch (type) {
    case 'SESSION': return 'Session';
    case 'SEARCH': return 'Search';
    case 'PAGE': return 'Source page';
    case 'SOURCE_PAPER': return 'Paper';
    case 'DOMAIN': return 'Domain';
    case 'CONCEPT': return 'Concept';
    case 'AI_INSIGHT': return 'Synthesis';
    default: return String(type).replace(/_/g, ' ');
  }
};

const toneOf = (type: NodeType): string => {
  switch (type) {
    case 'SESSION': return 'var(--node-session)';
    case 'SEARCH': return 'var(--node-search)';
    case 'PAGE': return 'var(--node-page)';
    case 'SOURCE_PAPER': return 'var(--node-paper)';
    case 'DOMAIN': return 'var(--node-domain)';
    case 'CONCEPT': return 'var(--node-concept)';
    case 'AI_INSIGHT': return 'var(--node-insight)';
    default: return 'var(--accent)';
  }
};

const metaNumber = (metadata: Record<string, unknown> | undefined, key: string): number | undefined => {
  const value = metadata?.[key];
  if (value == null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

// Human labels only for relationships the graph genuinely produces. Anything
// unknown keeps the graph's own label — nothing is invented.
// Relationship phrases arrive already written from the reader's point of view
// (see RELATION_PHRASE in MindMap.tsx), so they are matched as-is. The
// lower-cased type names are kept for edges that still arrive as raw types.
const PATH_LABEL: Record<string, string> = {
  'opened from this search': 'Opened from this search',
  'led to this result': 'Led to this result',
  'navigated to this page': 'Navigated to this page',
  'arrived from this page': 'Arrived from this page',
  'followed by this search': 'Followed by this search',
  'preceded by this search': 'Preceded by this search',
  'results in': 'Opened from this search',
  'inbound: results in': 'Led to this result',
  'page to page': 'Navigated to this page',
  'inbound: page to page': 'Arrived from this page',
  'navigated from': 'Navigated from this page',
  'inbound: navigated from': 'Navigated to this page',
  'search to search': 'Followed by this search',
  'inbound: search to search': 'Preceded by this search',
  'belongs to': 'Domain of this page',
  'inbound: belongs to': 'Page in this domain'
};

const humanizeRel = (rel: string): string => {
  if (!rel) return '';
  const stripped = rel.replace(/^inbound: /, '').trim();
  return PATH_LABEL[stripped.toLowerCase()] ?? stripped;
};

const wordJoin = (parts: Array<string | null | undefined>) => {
  const visible = parts.filter((p): p is string => Boolean(p));
  return visible.length > 0 ? visible.join(' · ') : null;
};

interface StatRow { label: string; value: string | null }

function StatGrid({ rows }: { rows: StatRow[] }) {
  const present = rows.filter((r) => r.value != null && r.value !== '');
  if (present.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-px border-2 border-[var(--border-subtle)] bg-[var(--border-subtle)] rounded-[var(--radius-sm)] overflow-hidden">
      {present.map((row) => (
        <div key={row.label} className="bg-[var(--surface-subtle)] px-2 py-1.5">
          <span className="block text-[9px] font-mono uppercase tracking-[0.12em] text-[var(--text-faint)]">{row.label}</span>
          <span className="mt-0.5 block font-mono text-[11px] font-bold text-[var(--text-primary)]">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function NodeDetailPanel({
  data,
  connectedNodes = [],
  session,
  onSelectConnectedNode,
  onClose
}: NodeDetailPanelProps) {
  if (!data) return null;

  const accent = toneOf(data.type);
  const metaLine = (() => {
    if (data.type === 'SEARCH') {
      return wordJoin([data.domain ? `via ${data.domain}` : null, data.timestamp ? formatTime(data.timestamp) : null]);
    }
    if (data.type === 'PAGE' || data.type === 'SOURCE_PAPER') {
      const visits = metaNumber(data.metadata, 'visits');
      const parts = [data.domain];
      if (data.timestamp) parts.push(`visited ${formatTime(data.timestamp)}`);
      if (visits != null && visits > 1) parts.push(`${visits} visits`);
      return wordJoin(parts);
    }
    if (data.type === 'DOMAIN') {
      const pageCount = metaNumber(data.metadata, 'pageCount');
      return wordJoin([pageCount != null ? `${pageCount} page${pageCount === 1 ? '' : 's'}` : null, 'domain group']);
    }
    if (data.timestamp) return wordJoin([`recorded ${formatTime(data.timestamp)}`]);
    return null;
  })();

  let statRows: StatRow[] = [];
  if (data.type === 'SESSION') {
    const sess = session;
    statRows = [
      { label: 'Status', value: sess?.status ?? (typeof data.metadata?.['status'] === 'string' ? String(data.metadata['status']) : null) },
      { label: 'Started', value: sess ? formatTime(sess.startTime) : (data.timestamp ? formatTime(data.timestamp) : null) },
      { label: 'Duration', value: sess ? formatDuration(sess.startTime, sess.endTime) : null },
      { label: 'Searches', value: sess != null ? String(sess.searchCount) : null },
      { label: 'Pages', value: sess != null ? String(sess.pageCount) : null }
    ];
  }

  // Only graph relationships the graph actually records; the SESSION root's
  // "CONTAINS" container edges are pure noise and are dropped, then deduped.
  const pathRows = (() => {
    if (data.type === 'SESSION') return [];
    const seen = new Set<string>();
    const rows: typeof connectedNodes = [];
    for (const c of connectedNodes) {
      const rel = (c.relationship || '').toLowerCase();
      if (!rel || rel.includes('contains')) continue;
      const key = `${c.id}|${rel}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        ...c,
        relationship: humanizeRel(rel)
      });
    }
    return rows.slice(0, 6);
  })();

  const isSource = data.type === 'PAGE' || data.type === 'SOURCE_PAPER';

  return (
    <aside 
      className="absolute top-5 right-5 z-20 w-[24rem] max-w-[calc(100vw-40px)] max-h-[calc(100%-40px)] flex flex-col rounded-[var(--radius-sm)] border shadow-panel select-none overflow-hidden"
      style={{
        backgroundColor: 'var(--surface-base)',
        borderTop: '1px solid var(--border-subtle)',
        borderRight: '1px solid var(--border-subtle)',
        borderBottom: '1px solid var(--border-subtle)',
        borderLeft: `3px solid ${accent}`,
      }}
    >
      {/* Header */}
      <div 
        className="h-11 px-4 border-b flex items-center justify-between shrink-0"
        style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface-subtle)' }}
      >
        <span className="text-[10px] font-mono uppercase font-semibold tracking-[0.14em]" style={{ color: accent }}>
          {typeLabel(data.type)}
        </span>

        <button 
          onClick={onClose}
          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          title="Close (Esc)"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Body Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-[13px]">
        {/* Title / Query / Domain */}
        <div>
          <h3 style={{ fontFamily: 'var(--font-display)' }} className={`text-2xl font-semibold text-[var(--text-primary)] leading-[1.05] tracking-[-0.02em] ${data.type === 'SEARCH' ? 'italic' : ''}`}>
            {data.label}
          </h3>
          {data.type === 'SEARCH' && (
            <p className="mt-1 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--node-search)]">
              Search query
            </p>
          )}
          {data.authors && data.authors.length > 0 && (
            <p className="text-[11px] text-[var(--text-muted)] mt-1 truncate">
              {data.authors.join(', ')}
            </p>
          )}
        </div>

        {metaLine && (
          <div className="font-mono text-[11px] text-[var(--text-muted)]">
            {metaLine}
          </div>
        )}

        {statRows.length > 0 && <StatGrid rows={statRows} />}

        {/* Research note (only when the node carries real excerpt text) */}
        {data.abstract && (
          <div className="space-y-1">
            <span className="text-[10px] font-mono uppercase font-semibold tracking-[0.12em]" style={{ color: accent }}>
              Research note
            </span>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              {data.abstract}
            </p>
          </div>
        )}

        {/* Key findings for synthesis nodes only */}
        {data.type === 'AI_INSIGHT' && data.insights && data.insights.length > 0 && (
          <div className="space-y-1">
            <span className="text-[10px] font-mono uppercase font-semibold tracking-[0.12em]" style={{ color: accent }}>
              Key findings
            </span>
            <ul className="space-y-1.5 text-xs text-[var(--text-secondary)] pl-3 list-disc">
              {data.insights.map((ins, i) => (
                <li key={i}>{ins}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Research path — only meaningful relationships present in the graph */}
        {pathRows.length > 0 && (
          <div className="space-y-1 pt-2 border-t border-[var(--border-subtle)]">
            <span className="text-[10px] font-mono uppercase font-semibold tracking-[0.12em]" style={{ color: accent }}>
              Research path
            </span>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {pathRows.map((c, index) => (
                <button
                  key={`${c.id}-${c.relationship}-${index}`}
                  onClick={() => onSelectConnectedNode?.(c.id)}
                  className="w-full flex items-center justify-between gap-2 p-2 rounded-[var(--radius-sm)] hover:bg-[var(--surface-hover)] border border-[var(--border-subtle)] transition-colors group text-left"
                >
                  <div className="min-w-0 flex-1 pr-1 text-left">
                    <span className="text-[9px] font-mono text-[var(--text-faint)] uppercase block truncate">
                      {c.relationship}
                    </span>
                    <span className="text-xs font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] truncate block">
                      {c.label}
                    </span>
                  </div>
                  <ArrowRight className="w-3 h-3 text-[var(--text-faint)] group-hover:text-[var(--text-primary)] shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer — source nodes only */}
      {isSource && data.url && (
        <div 
          className="h-10 px-3 border-t flex items-center justify-between shrink-0"
          style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface-subtle)' }}
        >
          <a
            href={data.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[11px] font-semibold text-[var(--accent)] hover:underline"
          >
            <span>Open source</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}
    </aside>
  );
}