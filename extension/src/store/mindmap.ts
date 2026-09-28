/**
 * Mind map construction.
 *
 * Ported from the backend's ResearchSessionService.getMindMap. The output
 * shape is a contract with the dashboard's researchMapViewModel, which
 * consumes the relationship names RESULTS_IN, PAGE_TO_PAGE, NAVIGATED_FROM and
 * SEARCH_TO_SEARCH, so those strings must not change.
 *
 * The whole graph is derived from the raw event stream, not from the
 * aggregated tables. Two joins make that possible and are the fragile parts:
 *   - a search is matched to its event by (pageVisitId, exact timestamp)
 *   - "results in" follows consecutive link-navigations in the same tab
 */

import type { StoredEvent, StoredPageVisit, StoredSearchQuery, StoredSession } from './records';
import { isSearchEngineUrl } from './searchDetect';

export interface MapNode {
  id: string;
  type: 'SESSION' | 'SEARCH' | 'PAGE' | 'DOMAIN';
  label: string;
  url: string | null;
  domain: string | null;
  timestamp: string | null;
  metadata: Record<string, unknown>;
}

export interface MapEdge {
  source: string;
  target: string;
  relationship: string;
  description: string;
}

export interface MindMap {
  sessionId: string;
  nodes: MapNode[];
  edges: MapEdge[];
}

function iso(ms: number | null): string | null {
  return ms == null ? null : new Date(ms).toISOString();
}

/** Pages belonging to the session's own time window. */
function sessionScopedPages(session: StoredSession, pages: StoredPageVisit[]): StoredPageVisit[] {
  return pages.filter((p) => {
    if (p.firstVisited < session.startTime) return false;
    if (session.endTime != null && p.firstVisited > session.endTime) return false;
    return true;
  });
}

export function buildMindMap(
  session: StoredSession,
  events: StoredEvent[],
  allPages: StoredPageVisit[],
  searches: StoredSearchQuery[]
): MindMap {
  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
  const pages = sessionScopedPages(session, allPages);

  // Session root.
  nodes.push({
    id: `session:${session.id}`,
    type: 'SESSION',
    label: session.title && session.title.trim() ? session.title : 'Research Session',
    url: null,
    domain: null,
    timestamp: iso(session.startTime),
    metadata: { status: session.status }
  });

  for (const search of searches) {
    nodes.push({
      id: search.id,
      type: 'SEARCH',
      label: search.queryText,
      url: search.sourceUrl,
      domain: domainOf(search.sourceUrl),
      timestamp: iso(search.timestamp),
      metadata: {}
    });
    edges.push({
      source: `session:${session.id}`,
      target: search.id,
      relationship: 'CONTAINS',
      description: 'Search within this session'
    });
  }

  for (const page of pages) {
    nodes.push({
      id: page.id,
      type: 'PAGE',
      label: page.title || page.url,
      url: page.url,
      domain: page.domain,
      timestamp: iso(page.firstVisited),
      metadata: { visits: page.visitCount }
    });
    edges.push({
      source: `session:${session.id}`,
      target: page.id,
      relationship: 'CONTAINS',
      description: 'Page visited in this session'
    });
  }

  // ── Page → page navigation ──────────────────────────────────────────────
  // Consecutive navigations within the same tab.
  const navByTab = new Map<number, StoredEvent[]>();
  for (const event of events) {
    if (event.eventType !== 'NAVIGATION' || !event.pageVisitId) continue;
    const list = navByTab.get(event.tabId) ?? [];
    list.push(event);
    navByTab.set(event.tabId, list);
  }

  for (const list of navByTab.values()) {
    list.sort((a, b) => a.timestamp - b.timestamp);
    for (let i = 1; i < list.length; i++) {
      const from = list[i - 1];
      const to = list[i];
      if (from.pageVisitId === to.pageVisitId) continue;
      edges.push({
        source: from.pageVisitId!,
        target: to.pageVisitId!,
        relationship: 'PAGE_TO_PAGE',
        description: 'Navigated from this page'
      });
      edges.push({
        source: from.pageVisitId!,
        target: to.pageVisitId!,
        relationship: 'NAVIGATED_FROM',
        description: 'Navigation followed the previous page in the same tab'
      });
    }
  }

  // ── Search → search ─────────────────────────────────────────────────────
  // Match each search to its originating event so tab and ordering are exact.
  const eventBySearch = new Map<string, StoredEvent>();
  for (const search of searches) {
    const match = events.find(
      (e) => e.pageVisitId === search.pageVisitId && e.timestamp === search.timestamp
    );
    if (match) eventBySearch.set(search.id, match);
  }

  const orderedSearches = [...searches].sort((a, b) => a.timestamp - b.timestamp);
  for (let i = 1; i < orderedSearches.length; i++) {
    const previous = orderedSearches[i - 1];
    const current = orderedSearches[i];
    const previousEvent = eventBySearch.get(previous.id);
    const currentEvent = eventBySearch.get(current.id);
    if (!previousEvent || !currentEvent) continue;
    if (previousEvent.tabId !== currentEvent.tabId) continue;
    edges.push({
      source: previous.id,
      target: current.id,
      relationship: 'SEARCH_TO_SEARCH',
      description: 'Subsequent search in the same tab'
    });
  }

  // ── Search → result page provenance ─────────────────────────────────────
  // A search leads to a page when the user clicked through from the results,
  // either in the same tab or in a tab opened from it. Search-engine result
  // pages are never visible nodes, so the chain is search → [hidden] → page.
  const associatedPages = new Set<string>();
  for (const search of searches) {
    if (search.pageVisitId) associatedPages.add(search.pageVisitId);
  }

  // Same tab: walk forward from the results page through link navigations.
  for (const search of searches) {
    const searchEvent = eventBySearch.get(search.id);
    if (!searchEvent) continue;

    const navs = (navByTab.get(searchEvent.tabId) ?? []).slice().sort((a, b) => a.timestamp - b.timestamp);
    const startIndex = navs.findIndex(
      (e) => e.timestamp >= search.timestamp && e.pageVisitId === search.pageVisitId
    );
    if (startIndex === -1) continue;

    for (let i = startIndex + 1; i < navs.length; i++) {
      const event = navs[i];
      if (event.transitionType !== 'link') break;
      if (!event.pageVisitId) continue;
      if (isSearchEngineUrl(event.url)) continue;
      if (associatedPages.has(event.pageVisitId)) continue;
      associatedPages.add(event.pageVisitId);
      edges.push({
        source: search.id,
        target: event.pageVisitId,
        relationship: 'RESULTS_IN',
        description: 'Result page opened via link click from search results'
      });
      break;
    }
  }

  // New tab: a tab opened from the search tab, first landing on a real page.
  for (const event of events) {
    if (event.eventType !== 'NAVIGATION') continue;
    if (event.transitionType !== 'link') continue;
    if (!event.pageVisitId || isSearchEngineUrl(event.url)) continue;
    if (associatedPages.has(event.pageVisitId)) continue;

    const openerTabId = event.sourceTabId ?? event.openerTabId;
    if (openerTabId == null) continue;

    const openerSearch = searches.find((s) => {
      const se = eventBySearch.get(s.id);
      return se != null && se.tabId === openerTabId;
    });
    if (!openerSearch) continue;

    associatedPages.add(event.pageVisitId);
    edges.push({
      source: openerSearch.id,
      target: event.pageVisitId,
      relationship: 'RESULTS_IN',
      description: 'Result opened in a new tab from the search results'
    });
  }

  // ── Page → domain ───────────────────────────────────────────────────────
  const domains = new Map<string, StoredPageVisit[]>();
  for (const page of pages) {
    if (!page.domain) continue;
    const list = domains.get(page.domain) ?? [];
    list.push(page);
    domains.set(page.domain, list);
  }

  for (const [domain, members] of domains) {
    const domainId = `domain:${domain}`;
    nodes.push({
      id: domainId,
      type: 'DOMAIN',
      label: domain,
      url: null,
      domain,
      timestamp: iso(members[0]?.firstVisited ?? null),
      metadata: { pageCount: members.length }
    });
    for (const page of members) {
      edges.push({
        source: page.id,
        target: domainId,
        relationship: 'BELONGS_TO',
        description: 'Page on this domain'
      });
    }
  }

  return { sessionId: session.id, nodes, edges };
}

function domainOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}
