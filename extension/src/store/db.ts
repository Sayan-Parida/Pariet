/**
 * IndexedDB schema for locally stored research data.
 *
 * Replaces the SQLite database the extension used to POST to. Everything stays
 * on the user's device: nothing is sent anywhere, and no server is required.
 *
 * Object stores:
 *   sessions     - one record per research session
 *   events       - the raw browser event log (the provenance backbone)
 *   pageVisits   - deduplicated pages, keyed by (sessionId, url)
 *   searchQueries- detected search queries
 *   positions    - saved mind-map node positions, keyed by sessionId
 *
 * The `events` store is the important one: the mind map, the timeline and
 * dwell-time estimation are all derived from it rather than from the
 * aggregated tables.
 */

export const DB_NAME = 'pariet';
export const DB_VERSION = 1;

export const STORE_SESSIONS = 'sessions';
export const STORE_EVENTS = 'events';
export const STORE_PAGES = 'pageVisits';
export const STORE_SEARCHES = 'searchQueries';
export const STORE_POSITIONS = 'positions';

let dbPromise: Promise<IDBDatabase> | null = null;

/** Open (and if needed create or upgrade) the database. */
export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      migrate(db, event.oldVersion);
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Pariet database upgrade blocked by another tab'));
  });

  // Do not cache a rejected promise; a later attempt should retry.
  dbPromise.catch(() => { dbPromise = null; });

  return dbPromise;
}

function migrate(db: IDBDatabase, oldVersion: number) {
  // v1 - initial schema.
  if (oldVersion < 1) {
    const sessions = db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
    sessions.createIndex('startTime', 'startTime');
    sessions.createIndex('status', 'status');

    const events = db.createObjectStore(STORE_EVENTS, { keyPath: 'id', autoIncrement: true });
    // Dedup lookup: the same navigation replayed must not be stored twice.
    events.createIndex('dedup', ['tabId', 'url', 'timestamp'], { unique: true });
    events.createIndex('sessionId', 'sessionId');
    events.createIndex('timestamp', 'timestamp');

    const pages = db.createObjectStore(STORE_PAGES, { keyPath: 'id' });
    pages.createIndex('sessionId', 'sessionId');
    pages.createIndex('lastVisited', 'lastVisited');

    const searches = db.createObjectStore(STORE_SEARCHES, { keyPath: 'id' });
    searches.createIndex('sessionId', 'sessionId');
    searches.createIndex('timestamp', 'timestamp');
    searches.createIndex('pageVisitId', 'pageVisitId');

    db.createObjectStore(STORE_POSITIONS, { keyPath: 'sessionId' });
  }
}

/**
 * Run `fn` inside a transaction, resolving with its return value once the
 * transaction commits. The value is only trustworthy on commit; a rejection
 * aborts the transaction so a failure never leaves partial records.
 */
export async function withTx<T>(
  stores: string | string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => T | Promise<T>
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result: T;
    let settled = false;

    tx.oncomplete = () => {
      settled = true;
      resolve(result);
    };
    tx.onerror = () => reject(tx.error ?? new Error('Transaction failed'));
    tx.onabort = () => {
      if (!settled) reject(tx.error ?? new Error('Transaction aborted'));
    };

    Promise.resolve(fn(tx))
      .then((value) => { result = value; })
      .catch((err) => {
        try { tx.abort(); } catch { /* already finished */ }
        if (!settled) reject(err);
      });
  });
}

/** Promisified single request. */
export function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Delete the whole database. Used by "delete all data". */
export async function deleteDatabase(): Promise<void> {
  if (dbPromise) {
    try {
      (await dbPromise).close();
    } catch {
      // Already closed or never opened; closing is best effort.
    }
    dbPromise = null;
  }
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}
