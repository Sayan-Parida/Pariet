/** Record shapes persisted in IndexedDB. */

export interface StoredSession {
  id: string;
  title: string | null;
  status: 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
  startTime: number;
  endTime: number | null;
  /** Chrome window the session belongs to; null = unknown/legacy. */
  windowId: number | null;
}

export type StoredEventType =
  | 'TAB_CREATED'
  | 'NAVIGATION'
  | 'TAB_ACTIVATED'
  | 'TAB_CLOSED';

export interface StoredEvent {
  id?: number;
  eventType: StoredEventType;
  url: string | null;
  title: string | null;
  tabId: number;
  windowId: number | null;
  transitionType: string | null;
  referrerUrl: string | null;
  openerTabId: number | null;
  sourceTabId: number | null;
  /** Milliseconds since epoch. Exact: the search/event join depends on it. */
  timestamp: number;
  sessionId: string | null;
  pageVisitId: string | null;
}

export interface StoredPageVisit {
  /** `${sessionId}:${url}` so a page is unique per session. */
  id: string;
  url: string;
  domain: string | null;
  title: string | null;
  firstVisited: number;
  lastVisited: number;
  visitCount: number;
  durationMs: number;
  sessionId: string;
}

export interface StoredSearchQuery {
  id: string;
  queryText: string;
  normalizedQuery: string;
  engine: string;
  sourceUrl: string;
  timestamp: number;
  sessionId: string;
  pageVisitId: string | null;
}
