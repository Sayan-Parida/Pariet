import { useState, useRef, useEffect } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
  MapPin,
  Filter,
  Download,
  Check
} from 'lucide-react';

export interface MapFilterState {
  sessions: boolean;
  searches: boolean;
  sources: boolean;
  researchConnections: boolean;
  searchConnections: boolean;
}

export const DEFAULT_MAP_FILTER: MapFilterState = {
  sessions: true,
  searches: true,
  sources: true,
  researchConnections: true,
  searchConnections: true
};

export const PRIMARY_RELATIONSHIPS = new Set([
  'SEARCH_TO_SOURCE',
  'SEARCH_TO_SEARCH'
]);

interface MapControlsProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  onResetLayout: () => void;
  filter: MapFilterState;
  onFilterChange: (filter: MapFilterState) => void;
  onResetFilter: () => void;
  showMinimap: boolean;
  onToggleMinimap: () => void;
  onExport: () => void;
}

type FilterKey = keyof MapFilterState;

const NODE_FILTER_ROWS: Array<{ key: Exclude<FilterKey, 'researchConnections' | 'searchConnections'>; label: string; tone: string }> = [
  { key: 'sessions', label: 'Sessions', tone: 'var(--node-session)' },
  { key: 'searches', label: 'Searches', tone: 'var(--node-search)' },
  { key: 'sources', label: 'Sources', tone: 'var(--node-page)' }
];

const CONNECTION_FILTER_ROWS: Array<{ key: 'researchConnections' | 'searchConnections'; label: string; hint: string; tone: string }> = [
  { key: 'researchConnections', label: 'Search → Source', hint: 'how searches lead to sources', tone: 'var(--node-search)' },
  { key: 'searchConnections', label: 'Search → Search', hint: 'related search queries', tone: 'var(--node-search)' }
];

export const MapControls = ({
  zoom,
  onZoomIn,
  onZoomOut,
  onFitView,
  onResetLayout,
  filter,
  onFilterChange,
  onResetFilter,
  showMinimap,
  onToggleMinimap,
  onExport
}: MapControlsProps) => {
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowFilterMenu(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowFilterMenu(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  const handleExport = () => {
    onExport();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isFilterActive =
    filter.sessions !== DEFAULT_MAP_FILTER.sessions ||
    filter.searches !== DEFAULT_MAP_FILTER.searches ||
    filter.sources !== DEFAULT_MAP_FILTER.sources ||
    filter.researchConnections !== DEFAULT_MAP_FILTER.researchConnections ||
    filter.searchConnections !== DEFAULT_MAP_FILTER.searchConnections;

  const handleToggle = (key: FilterKey) => {
    onFilterChange({ ...filter, [key]: !filter[key] });
  };

  const FilterRow = ({ label, hint, tone, checked, onToggle }: {
    label: string;
    hint?: string;
    tone: string;
    checked: boolean;
    onToggle: () => void;
  }) => (
    <button
      onClick={onToggle}
      title={`${checked ? 'Hide' : 'Show'} ${label}`}
      className="w-full flex items-center justify-between gap-2 py-[7px] px-0.5 rounded-[var(--radius-xs)] text-left group"
    >
      <span className="flex items-center gap-2 min-w-0">
        <span
          className="w-2.5 h-2.5 shrink-0 border-2 border-[var(--border-strong)]"
          style={{ backgroundColor: tone, opacity: 1 }}
        />
        <span className="flex flex-col min-w-0">
          <span className={`text-[11px] font-semibold tracking-[0.01em] leading-none ${checked ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>
            {label}
          </span>
          {hint && (
            <span className="text-[9px] font-mono text-[var(--text-faint)] leading-none mt-1">
              {hint}
            </span>
          )}
        </span>
      </span>
      <span
        className={`w-4 h-4 shrink-0 flex items-center justify-center border-2 transition-all ${
          checked
            ? 'border-[var(--border-strong)]'
            : 'border-[var(--border-medium)] bg-[var(--surface-base)]'
        }`}
        style={checked
          ? { backgroundColor: tone, boxShadow: '1px 1px 0 var(--shadow-ink)' }
          : undefined}
      >
        {checked && <Check className="w-3 h-3 text-[var(--ink)]" strokeWidth={3.5} />}
      </span>
    </button>
  );

  return (
    <>
      <div className="absolute top-4 right-4 z-10 flex items-center gap-1.5">
        <div ref={filterRef} className="relative">
          <button
            onClick={() => setShowFilterMenu(!showFilterMenu)}
            title="Filter graph visibility [F]"
            className={`b-btn text-xs ${
              isFilterActive
                ? 'bg-[var(--accent)] text-[var(--surface-base)] border-[var(--border-strong)]'
                : showFilterMenu
                  ? 'bg-[var(--surface-selected)] text-[var(--text-primary)]'
                  : ''
            }`}
          >
            <Filter className="w-3 h-3" />
            <span>Filter</span>
            {isFilterActive && (
              <span className="w-1.5 h-1.5 border-[1.5px] border-[var(--border-strong)] bg-[var(--surface-base)]" />
            )}
          </button>

          {showFilterMenu && (
            <div className="b-panel absolute right-0 mt-2 w-56 z-20">
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b-2 border-[var(--border-strong)] bg-[var(--surface-subtle)]">
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-primary)]">
                  Filter map
                </span>
                <button
                  onClick={onResetFilter}
                  title="Reset to default visibility"
                  className="b-btn b-btn--warm text-[10px] px-2 py-0.5"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                  Reset
                </button>
              </div>

              <div className="px-3 py-2.5 space-y-3">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                      Nodes
                    </span>
                    <span className="h-[2px] flex-1 bg-[var(--border-subtle)]" />
                  </div>
                  <div className="space-y-0.5">
                    {NODE_FILTER_ROWS.map((row) => (
                      <div key={row.key}>
                        <FilterRow
                          label={row.label}
                          tone={row.tone}
                          checked={filter[row.key]}
                          onToggle={() => handleToggle(row.key)}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                      Connections
                    </span>
                    <span className="h-[2px] flex-1 bg-[var(--border-subtle)]" />
                  </div>
                  <div className="space-y-0.5">
                    {CONNECTION_FILTER_ROWS.map((row) => (
                      <FilterRow
                        key={row.key}
                        label={row.label}
                        hint={row.hint}
                        tone={row.tone}
                        checked={filter[row.key]}
                        onToggle={() => handleToggle(row.key)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <button
          onClick={handleExport}
          title="Export Graph JSON"
          className="b-btn b-btn--square"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-[var(--status-active)]" /> : <Download className="w-3.5 h-3.5" />}
        </button>
      </div>

      <div className="absolute bottom-4 left-4 z-10 flex items-center gap-0.5 p-1 border-2 border-[var(--border-strong)] rounded-[var(--radius-sm)] bg-[var(--surface-base)] box-shadow-[3px_3px_0_var(--shadow-ink)] select-none">
        <button
          onClick={onZoomOut}
          title="Zoom Out"
          className="p-1 rounded-[var(--radius-xs)] hover:bg-[var(--surface-selected)] text-[var(--text-secondary)]"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>

        <span className="px-1.5 text-xs font-mono font-bold text-[var(--text-primary)] min-w-[46px] text-center">
          {Math.round(zoom * 100)}%
        </span>

        <button
          onClick={onZoomIn}
          title="Zoom In"
          className="p-1 rounded-[var(--radius-xs)] hover:bg-[var(--surface-selected)] text-[var(--text-secondary)]"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>

        <div className="w-[2px] h-4 bg-[var(--border-strong)] mx-0.5" />

        <button
          onClick={onFitView}
          title="Fit to Screen [F]"
          className="p-1 rounded-[var(--radius-xs)] hover:bg-[var(--surface-selected)] text-[var(--text-secondary)]"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={onResetLayout}
          title="Reset node layout"
          className="p-1 rounded-[var(--radius-xs)] hover:bg-[var(--surface-selected)] text-[var(--text-secondary)]"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>

        <div className="w-[2px] h-4 bg-[var(--border-strong)] mx-0.5" />

        <button
          onClick={onToggleMinimap}
          title={showMinimap ? 'Hide Minimap' : 'Show Minimap'}
          className={`p-1 rounded-[var(--radius-xs)] transition-colors ${
            showMinimap ? 'bg-[var(--accent)] text-[var(--surface-base)]' : 'text-[var(--text-secondary)] hover:bg-[var(--surface-selected)]'
          }`}
        >
          <MapPin className="w-3.5 h-3.5" />
        </button>
      </div>
    </>
  );
};