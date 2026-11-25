import type { StoredEvent, StoredPageVisit, StoredSearchQuery, StoredSession } from './records';
import { redactUrl, redactUrlInTitle } from './privacy';

function read<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Runs in the version-upgrade transaction. Rekeying is necessary: page IDs and
// saved layout keys also contain URLs. A failure rolls back the whole upgrade.
export async function migratePrivacy(tx: IDBTransaction): Promise<void> {
  const [sessions, pages, events, searches, layouts] = await Promise.all([
    read(tx.objectStore('sessions').getAll()) as Promise<StoredSession[]>,
    read(tx.objectStore('pageVisits').getAll()) as Promise<StoredPageVisit[]>,
    read(tx.objectStore('events').getAll()) as Promise<StoredEvent[]>,
    read(tx.objectStore('searchQueries').getAll()) as Promise<StoredSearchQuery[]>,
    read(tx.objectStore('positions').getAll()) as Promise<Array<{ sessionId: string; positions: Record<string, unknown> }>>
  ]);
  const valid = new Set(sessions.map(session => session.id));
  const pageIds = new Map<string, string>();
  const originalPageIds = new Set(pages.map(page => page.id));
  const cleanPages = new Map<string, StoredPageVisit>();
  for (const page of pages) {
    if (!valid.has(page.sessionId)) continue;
    const url = redactUrl(page.url);
    if (!url) continue;
    const id = `${page.sessionId}:${url}`;
    pageIds.set(page.id, id);
    const clean = { ...page, id, url, domain: new URL(url).hostname, title: redactUrlInTitle(page.title, page.url, url) };
    const existing = cleanPages.get(id);
    if (existing) {
      existing.visitCount += clean.visitCount;
      existing.durationMs = (existing.durationMs ?? 0) + (clean.durationMs ?? 0);
      existing.firstVisited = Math.min(existing.firstVisited, clean.firstVisited);
      if (clean.lastVisited >= existing.lastVisited) {
        existing.lastVisited = clean.lastVisited;
        existing.title = clean.title || existing.title;
      }
    } else cleanPages.set(id, clean);
  }

  const cleanEvents: StoredEvent[] = [];
  const dedup = new Set<string>();
  for (const event of events) {
    if (!event.sessionId || !valid.has(event.sessionId)) continue;
    const url = redactUrl(event.url);
    const key = JSON.stringify([event.tabId, url ?? '', event.timestamp]);
    if (dedup.has(key)) continue;
    dedup.add(key);
    cleanEvents.push({ ...event, url, referrerUrl: redactUrl(event.referrerUrl),
      title: redactUrlInTitle(event.title, event.url, url),
      pageVisitId: event.pageVisitId ? pageIds.get(event.pageVisitId) ?? null : null });
  }
  const cleanSearches = searches.flatMap(search => {
    if (!valid.has(search.sessionId)) return [];
    const sourceUrl = redactUrl(search.sourceUrl);
    if (!sourceUrl) return [];
    return [{ ...search, sourceUrl, pageVisitId: search.pageVisitId ? pageIds.get(search.pageVisitId) ?? null : null }];
  });
  const cleanLayouts = layouts.filter(layout => valid.has(layout.sessionId)).map(layout => ({
    ...layout,
    positions: Object.fromEntries(Object.entries(layout.positions ?? {})
      .filter(([id]) => !originalPageIds.has(id) || pageIds.has(id))
      .map(([id, point]) => [pageIds.get(id) ?? id, point]))
  }));

  for (const [name, records] of [
    ['pageVisits', [...cleanPages.values()]], ['events', cleanEvents],
    ['searchQueries', cleanSearches], ['positions', cleanLayouts]
  ] as const) {
    const store = tx.objectStore(name);
    await read(store.clear());
    // Keep all requests in the upgrade transaction, including empty stores.
    await Promise.all(records.map(record => read(store.put(record))));
  }
}
