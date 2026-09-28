/**
 * Event ingestion.
 *
 * Ported from the backend's EventIngestionService, PageVisitService and
 * SessionDetector so a single browser event is turned into the same records
 * the server used to produce. The ordering and the guards matter:
 *
 *   1. deduplicate replays (the extension can resend a queued event)
 *   2. attribute to a session only if the window matches and the URL is
 *      research-worthy
 *   3. upsert the page visit, remembering it on the event
 *   4. for navigations only, detect a search query
 *
 * The exact-timestamp link between a search and its event is what lets the
 * mind map join "this search led to that page", so timestamps are stored as
 * raw milliseconds and never rounded.
 *
 * Session and window eligibility are decided upstream, in the service
 * worker's attribution step, which is the single place that rule lives.
 */

import { req, withTx, STORE_EVENTS, STORE_PAGES, STORE_SEARCHES } from './db';
import type { StoredEvent, StoredPageVisit, StoredSearchQuery } from './records';
import { detectSearch } from './searchDetect';
import { normalize } from './text';
import { isResearchUrl } from './urls';

function pageKey(sessionId: string, url: string): string {
  return `${sessionId}:${url}`;
}

function searchKey(): string {
  return crypto.randomUUID();
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

export class DuplicateEventError extends Error {
  constructor() {
    super('Duplicate event');
    this.name = 'DuplicateEventError';
  }
}

/**
 * Store one browser event and everything derived from it.
 * Runs in a single transaction so a failure leaves no partial records.
 */
export async function ingestEvent(event: Omit<StoredEvent, 'id'>): Promise<StoredEvent> {
  return withTx<StoredEvent>(
    [STORE_EVENTS, STORE_PAGES, STORE_SEARCHES],
    'readwrite',
    async (tx) => {
      const events = tx.objectStore(STORE_EVENTS);
      const pages = tx.objectStore(STORE_PAGES);
      const searches = tx.objectStore(STORE_SEARCHES);

      // 1. Deduplicate a replayed event.
      const dedupKey = [event.tabId, event.url ?? '', event.timestamp];
      const existing = await req(events.index('dedup').get(dedupKey));
      if (existing) throw new DuplicateEventError();

      // 2. Page visit upsert, keyed by (session, url).
      let pageVisitId: string | null = null;
      if (event.sessionId && isResearchUrl(event.url)) {
        const key = pageKey(event.sessionId, event.url!);
        const prior = (await req(pages.get(key))) as StoredPageVisit | undefined;

        if (prior) {
          prior.visitCount += 1;
          if (event.timestamp > prior.lastVisited) prior.lastVisited = event.timestamp;
          if (event.title && event.title.trim()) prior.title = event.title;
          await req(pages.put(prior));
        } else {
          const record: StoredPageVisit = {
            id: key,
            url: event.url!,
            domain: hostOf(event.url!),
            title: event.title,
            firstVisited: event.timestamp,
            lastVisited: event.timestamp,
            visitCount: 1,
            durationMs: 0,
            sessionId: event.sessionId
          };
          await req(pages.put(record));
        }
        pageVisitId = key;
      }

      // 3. Search detection, navigations only.
      let searchRecord: StoredSearchQuery | null = null;
      if (event.eventType === 'NAVIGATION' && event.url) {
        const detected = detectSearch(event.url);
        if (detected && event.sessionId) {
          searchRecord = {
            id: searchKey(),
            queryText: detected.queryText,
            normalizedQuery: normalize(detected.queryText),
            engine: detected.engine,
            sourceUrl: event.url,
            timestamp: event.timestamp,
            sessionId: event.sessionId,
            pageVisitId
          };
          await req(searches.put(searchRecord));
        }
      }

      // 4. The event itself, carrying its page link for the graph.
      const stored: StoredEvent = { ...event, pageVisitId };
      const key = await req(events.add(stored));
      return { ...stored, id: key as number };
    }
  );
}
