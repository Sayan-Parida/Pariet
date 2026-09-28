/**
 * Session lifecycle and read queries over IndexedDB.
 */

import {
  req, withTx, deleteDatabase,
  STORE_SESSIONS, STORE_EVENTS, STORE_PAGES, STORE_SEARCHES, STORE_POSITIONS
} from './db';
import type {
  StoredSession, StoredEvent, StoredPageVisit, StoredSearchQuery
} from './records';

export interface SessionSummary {
  id: string;
  title: string | null;
  status: 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
  startTime: string;
  endTime: string | null;
  eventCount: number;
  pageCount: number;
  searchCount: number;
}

function toIso(ms: number | null): string | null {
  return ms == null ? null : new Date(ms).toISOString();
}

export async function createSession(
  title: string | null,
  windowId: number | null
): Promise<StoredSession> {
  const session: StoredSession = {
    id: crypto.randomUUID(),
    title,
    status: 'ACTIVE',
    startTime: Date.now(),
    endTime: null,
    windowId
  };
  await withTx([STORE_SESSIONS], 'readwrite', (tx) => req(tx.objectStore(STORE_SESSIONS).put(session)));
  return session;
}

export async function getSession(id: string): Promise<StoredSession | undefined> {
  return withTx<StoredSession | undefined>([STORE_SESSIONS], 'readonly', (tx) =>
    req(tx.objectStore(STORE_SESSIONS).get(id))
  );
}

/**
 * End a session. `endedAt` is explicit when the browser was closed mid-session
 * so the duration reflects the research that actually happened. It is never
 * allowed to precede the start.
 */
export async function endSession(
  id: string,
  endedAt?: number,
  status: 'COMPLETED' | 'ARCHIVED' = 'COMPLETED'
): Promise<StoredSession> {
  return withTx<StoredSession>([STORE_SESSIONS, STORE_EVENTS, STORE_PAGES], 'readwrite', async (tx) => {
    const store = tx.objectStore(STORE_SESSIONS);
    const session = (await req(store.get(id))) as StoredSession | undefined;
    if (!session) throw new Error('Session not found');

    const end = Math.max(endedAt ?? Date.now(), session.startTime);
    session.status = status;
    session.endTime = end;

    // Dwell time is derived from the event stream, so finalize it on close.
    await estimateDuration(id, end, tx);

    await req(store.put(session));
    return session;
  });
}

export async function listSessions(): Promise<SessionSummary[]> {
  const sessions = await withTx<StoredSession[]>([STORE_SESSIONS], 'readonly', (tx) =>
    req(tx.objectStore(STORE_SESSIONS).getAll())
  );
  if (sessions.length === 0) return [];

  // One pass per store rather than a query per session.
  const [events, pages, searches] = await Promise.all([
    allBySession(STORE_EVENTS),
    allBySession(STORE_PAGES),
    allBySession(STORE_SEARCHES)
  ]);

  return sessions
    .sort((a, b) => b.startTime - a.startTime)
    .map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      startTime: toIso(s.startTime)!,
      endTime: toIso(s.endTime),
      eventCount: events.get(s.id) ?? 0,
      pageCount: pages.get(s.id) ?? 0,
      searchCount: searches.get(s.id) ?? 0
    }));
}

async function allBySession(storeName: string): Promise<Map<string, number>> {
  const records = await withTx<Array<{ sessionId: string }>>([storeName], 'readonly', (tx) =>
    req(tx.objectStore(storeName).getAll())
  );
  const counts = new Map<string, number>();
  for (const record of records) {
    if (!record?.sessionId) continue;
    counts.set(record.sessionId, (counts.get(record.sessionId) ?? 0) + 1);
  }
  return counts;
}

export async function getEvents(sessionId: string): Promise<StoredEvent[]> {
  const events = await withTx<StoredEvent[]>([STORE_EVENTS], 'readonly', (tx) =>
    req(tx.objectStore(STORE_EVENTS).index('sessionId').getAll(sessionId))
  );
  return events.sort((a, b) => a.timestamp - b.timestamp || (a.id ?? 0) - (b.id ?? 0));
}

export async function getPages(sessionId: string): Promise<StoredPageVisit[]> {
  const pages = await withTx<StoredPageVisit[]>([STORE_PAGES], 'readonly', (tx) =>
    req(tx.objectStore(STORE_PAGES).index('sessionId').getAll(sessionId))
  );
  return pages.sort((a, b) => a.firstVisited - b.firstVisited);
}

export async function getSearches(sessionId: string): Promise<StoredSearchQuery[]> {
  const searches = await withTx<StoredSearchQuery[]>([STORE_SEARCHES], 'readonly', (tx) =>
    req(tx.objectStore(STORE_SEARCHES).index('sessionId').getAll(sessionId))
  );
  return searches.sort((a, b) => a.timestamp - b.timestamp);
}

export async function deleteSession(id: string): Promise<void> {
  await withTx(
    [STORE_SESSIONS, STORE_EVENTS, STORE_PAGES, STORE_SEARCHES, STORE_POSITIONS],
    'readwrite',
    async (tx) => {
      await req(tx.objectStore(STORE_SESSIONS).delete(id));
      await deleteBySession(tx.objectStore(STORE_EVENTS), id);
      await deleteBySession(tx.objectStore(STORE_PAGES), id);
      await deleteBySession(tx.objectStore(STORE_SEARCHES), id);
      await req(tx.objectStore(STORE_POSITIONS).delete(id));
    }
  );
}

async function deleteBySession(store: IDBObjectStore, sessionId: string) {
  const keys = await req(store.index('sessionId').getAllKeys(sessionId));
  for (const key of keys) {
    await req(store.delete(key));
  }
}

/** Erase everything, including saved layouts. */
export async function deleteAllData(): Promise<void> {
  await deleteDatabase();
}

export async function getPositions(sessionId: string): Promise<Record<string, { x: number; y: number }>> {
  const record = await withTx<{ sessionId: string; positions: Record<string, { x: number; y: number }> } | undefined>(
    [STORE_POSITIONS], 'readonly', (tx) => req(tx.objectStore(STORE_POSITIONS).get(sessionId))
  );
  return record?.positions ?? {};
}

export async function savePositions(
  sessionId: string,
  positions: Record<string, { x: number; y: number }>
): Promise<void> {
  await withTx([STORE_POSITIONS], 'readwrite', (tx) =>
    req(tx.objectStore(STORE_POSITIONS).put({ sessionId, positions }))
  );
}

/**
 * Dwell time per page, replayed from the event stream.
 *
 * A tab is "active" from when it is activated (or a navigation happens in it)
 * until it is switched away or closed; the elapsed time is added to the page
 * being viewed. Ported from the backend's PageVisitService.estimateDuration.
 */
export async function estimateDuration(
  sessionId: string,
  endTime: number | null,
  tx: IDBTransaction
): Promise<void> {
  const events = (await req(
    tx.objectStore(STORE_EVENTS).index('sessionId').getAll(sessionId)
  )) as StoredEvent[];
  const pages = (await req(
    tx.objectStore(STORE_PAGES).index('sessionId').getAll(sessionId)
  )) as StoredPageVisit[];

  if (events.length === 0 || pages.length === 0) return;
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const elapsed = new Map<string, number>();

  let activeTabId: number | null = null;
  let activePageId: string | null = null;
  let activeSince = 0;

  const close = (at: number) => {
    if (activePageId != null && at > activeSince) {
      elapsed.set(activePageId, (elapsed.get(activePageId) ?? 0) + (at - activeSince));
    }
    activeTabId = null;
    activePageId = null;
  };

  for (const event of events) {
    switch (event.eventType) {
      case 'TAB_ACTIVATED':
        if (activeTabId !== event.tabId) {
          close(event.timestamp);
          activeTabId = event.tabId;
          activeSince = event.timestamp;
        }
        break;
      case 'NAVIGATION':
        if (activeTabId !== event.tabId) {
          close(event.timestamp);
          activeTabId = event.tabId;
          activeSince = event.timestamp;
        } else {
          close(event.timestamp);
          activeSince = event.timestamp;
        }
        if (event.pageVisitId) activePageId = event.pageVisitId;
        break;
      case 'TAB_CLOSED':
        if (activeTabId === event.tabId) close(event.timestamp);
        break;
      default:
        break;
    }
  }
  close(endTime ?? Date.now());

  const store = tx.objectStore(STORE_PAGES);
  for (const [pageId, ms] of elapsed) {
    const page = pageById.get(pageId);
    if (!page) continue;
    page.durationMs = (page.durationMs ?? 0) + ms;
    await req(store.put(page));
  }
}
