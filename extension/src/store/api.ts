/**
 * The API the dashboard talks to.
 *
 * The dashboard runs as an extension page, so it can call the service worker
 * directly with chrome.runtime.sendMessage instead of fetching a local HTTP
 * server. Every method is implemented against IndexedDB, so there is no
 * backend to run and nothing leaves the device.
 */

import { getSession, getPages, getSearches, getEvents } from './sessions';
import { buildMindMap, type MindMap } from './mindmap';

export interface TimelineEntry {
  id: string;
  type: 'EVENT' | 'SEARCH';
  timestamp: string;
  title: string;
  url: string | null;
  domain: string | null;
}

export interface ResumePoint {
  sessionId: string;
  page: {
    id: string;
    url: string;
    domain: string | null;
    title: string | null;
    lastVisited: string;
    visitCount: number;
  } | null;
  search: {
    id: string;
    queryText: string;
    engine: string;
    timestamp: string;
  } | null;
}

export interface PageVisitView {
  id: string;
  url: string;
  domain: string | null;
  title: string | null;
  firstVisited: string;
  lastVisited: string;
  visitCount: number;
  durationMs: number;
}

export interface SearchQueryView {
  id: string;
  queryText: string;
  engine: string;
  sourceUrl: string;
  timestamp: string;
}

/** Events and searches merged into one chronological trail. */
export async function getTimeline(sessionId: string): Promise<TimelineEntry[]> {
  const [events, searches] = await Promise.all([getEvents(sessionId), getSearches(sessionId)]);

  const entries: TimelineEntry[] = events.map((e) => ({
    id: String(e.id),
    type: 'EVENT' as const,
    timestamp: new Date(e.timestamp).toISOString(),
    title: e.title || e.eventType,
    url: e.url,
    domain: null
  }));

  for (const s of searches) {
    entries.push({
      id: s.id,
      type: 'SEARCH',
      timestamp: new Date(s.timestamp).toISOString(),
      title: s.queryText,
      url: s.sourceUrl,
      domain: null
    });
  }

  return entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/** The page you were last reading, and the search that led you there. */
export async function getResumePoint(sessionId: string): Promise<ResumePoint> {
  const pages = await getPages(sessionId);
  const searches = await getSearches(sessionId);

  let best: (typeof pages)[number] | null = null;
  for (const page of pages) {
    if (!page.title || !page.title.trim()) continue;
    if (!best || page.lastVisited > best.lastVisited) best = page;
  }

  let search: SearchQueryView | null = null;
  if (best) {
    const match = searches
      .filter((s) => s.pageVisitId === best!.id)
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    if (match) {
      search = {
        id: match.id,
        queryText: match.queryText,
        engine: match.engine,
        sourceUrl: match.sourceUrl,
        timestamp: new Date(match.timestamp).toISOString()
      };
    }
  }

  return {
    sessionId,
    page: best
      ? {
          id: best.id,
          url: best.url,
          domain: best.domain,
          title: best.title,
          lastVisited: new Date(best.lastVisited).toISOString(),
          visitCount: best.visitCount
        }
      : null,
    search
  };
}

export async function getMindMap(sessionId: string): Promise<MindMap> {
  const session = await getSession(sessionId);
  if (!session) throw new Error('Session not found');
  const [events, pages, searches] = await Promise.all([
    getEvents(sessionId),
    getPages(sessionId),
    getSearches(sessionId)
  ]);
  return buildMindMap(session, events, pages, searches);
}

export async function getPageViews(sessionId: string): Promise<PageVisitView[]> {
  const pages = await getPages(sessionId);
  return pages.map((p) => ({
    id: p.id,
    url: p.url,
    domain: p.domain,
    title: p.title,
    firstVisited: new Date(p.firstVisited).toISOString(),
    lastVisited: new Date(p.lastVisited).toISOString(),
    visitCount: p.visitCount,
    durationMs: p.durationMs ?? 0
  }));
}

export async function getSearchViews(sessionId: string): Promise<SearchQueryView[]> {
  const searches = await getSearches(sessionId);
  return searches.map((s) => ({
    id: s.id,
    queryText: s.queryText,
    engine: s.engine,
    sourceUrl: s.sourceUrl,
    timestamp: new Date(s.timestamp).toISOString()
  }));
}
