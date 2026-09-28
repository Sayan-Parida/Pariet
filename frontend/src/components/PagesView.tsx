import { useEffect, useState } from 'react';
import { 
  Search, 
  LayoutGrid, 
  List, 
  Loader2
} from 'lucide-react';
import { PageVisit } from '../types';
import { apiClient } from '../api/client';
import { dataEvents } from '../api/dataEvents';
import SourceReaderModal from './SourceReaderModal';

interface Props {
  sessionId: string;
}

export default function PagesView({ sessionId }: Props) {
  const [pages, setPages] = useState<PageVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedDomain, setSelectedDomain] = useState<string>('ALL');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [activeReaderPage, setActiveReaderPage] = useState<PageVisit | null>(null);

  const fetchPages = async () => {
    try {
      setLoading(true);
      const data = await apiClient.getPages(sessionId);
      setPages(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load sources');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPages();
    const unsubscribe = dataEvents.subscribe(() => {
      fetchPages();
    });
    return () => {
      unsubscribe();
    };
  }, [sessionId]);

  const domains = Array.from(new Set(pages.map((p) => p.domain).filter(Boolean)));

  const filteredPages = pages.filter((p) => {
    const matchesSearch = !search.trim() || 
      p.title.toLowerCase().includes(search.toLowerCase()) ||
      p.domain.toLowerCase().includes(search.toLowerCase());
    const matchesDomain = selectedDomain === 'ALL' || p.domain === selectedDomain;
    return matchesSearch && matchesDomain;
  });

  if (loading && pages.length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-xs text-[var(--text-muted)] font-mono">
        <Loader2 className="w-4 h-4 animate-spin text-[var(--text-secondary)]" />
        <span>Loading source library...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-4 text-xs text-[var(--status-danger)]">
        {error}
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-y-auto px-6 py-8 select-none lg:px-10">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header & Controls */}
        <div className="flex items-center justify-between gap-3 pb-3 border-b border-[var(--border-subtle)]">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-[var(--accent)]">Research library</div>
            <h2 className="mt-1 font-[var(--font-display)] text-xl text-[var(--text-primary)]">
              Sources
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {/* Search Input */}
            <div 
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-sm)] border bg-[var(--surface-subtle)] text-sm"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <Search className="w-3 h-3 text-[var(--text-faint)] shrink-0" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter sources..."
                className="bg-transparent text-xs text-[var(--text-primary)] placeholder-[var(--text-faint)] focus:outline-none w-36"
              />
            </div>

            {/* Domain Filter */}
            {domains.length > 0 && (
              <select
                value={selectedDomain}
                onChange={(e) => setSelectedDomain(e.target.value)}
                className="px-2.5 py-1.5 rounded-[var(--radius-sm)] border bg-[var(--surface-subtle)] text-sm text-[var(--text-secondary)] focus:outline-none"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <option value="ALL">All Domains</option>
                {domains.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            )}

            {/* View Mode Toggle */}
            <div className="flex items-center rounded border border-[var(--border-subtle)] overflow-hidden">
              <button
                onClick={() => setViewMode('list')}
                className={`p-1 transition-colors ${
                  viewMode === 'list' ? 'bg-[var(--surface-selected)] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
                title="List View"
              >
                <List className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1 transition-colors ${
                  viewMode === 'grid' ? 'bg-[var(--surface-selected)] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
                title="Grid View"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        {filteredPages.length === 0 ? (
          <div className="text-center py-12 text-xs text-[var(--text-muted)]">
            No source documents in this workspace.
          </div>
        ) : viewMode === 'list' ? (
          /* Clean Table */
          <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[var(--border-subtle)] bg-[var(--surface-subtle)] text-[10px] font-mono uppercase text-[var(--text-muted)]">
                <tr>
                  <th className="py-2 px-3">Title</th>
                  <th className="py-2 px-3">Domain</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {filteredPages.map((page) => (
                  <tr
                    key={page.id}
                    onClick={() => setActiveReaderPage(page)}
                    className="hover:bg-[var(--surface-hover)] cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-4 font-[var(--font-display)] text-sm font-medium text-[var(--text-primary)] max-w-sm truncate">
                      {page.title}
                    </td>
                    <td className="py-2 px-3 font-mono text-[11px] text-[var(--text-muted)]">
                      {page.domain}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* Compact Grid */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {filteredPages.map((page) => (
              <div
                key={page.id}
                onClick={() => setActiveReaderPage(page)}
                className="p-3 rounded border border-[var(--border-subtle)] hover:border-[var(--border-medium)] hover:bg-[var(--surface-hover)] cursor-pointer transition-colors flex flex-col justify-between"
                style={{ backgroundColor: 'var(--surface-base)' }}
              >
                <div>
                  <div className="text-[10px] font-mono text-[var(--text-muted)] mb-1">
                    {page.domain}
                  </div>
                  <h3 className="text-xs font-semibold text-[var(--text-primary)] leading-tight line-clamp-2 mb-1">
                    {page.title}
                  </h3>
                  {page.excerpt && (
                    <p className="text-[11px] text-[var(--text-secondary)] line-clamp-2 leading-relaxed">
                      {page.excerpt}
                    </p>
                  )}
                </div>

                <div className="pt-2 mt-2 border-t border-[var(--border-subtle)] flex items-center justify-between text-[10px] font-mono text-[var(--text-faint)]">
                  <span>{page.citationCount ? `${page.citationCount} cited` : 'Document'}</span>
                  <span>{page.visitCount} visits</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Deep Reader Modal */}
        {activeReaderPage && (
          <SourceReaderModal
            page={activeReaderPage}
            onClose={() => setActiveReaderPage(null)}
          />
        )}
      </div>
    </div>
  );
}
