const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename);
};
require('fake-indexeddb/auto');
const listeners = {};
const listen = key => ({ addListener: fn => { listeners[key] = fn; } });
let state = {};
let tabs = new Map();
global.chrome = {
  storage: { local: {
    get: async () => structuredClone(state),
    set: async patch => { Object.assign(state, structuredClone(patch)); }
  } },
  runtime: {
    id: 'pariet-test', getURL: path => `chrome-extension://pariet-test/${path}`,
    onMessage: listen('message'), onStartup: listen('startup')
  },
  tabs: {
    get: async id => { if (!tabs.has(id)) throw new Error('Missing tab'); return tabs.get(id); },
    query: async () => [...tabs.values()], create: async () => {},
    onCreated: listen('created'), onActivated: listen('activated'), onRemoved: listen('removed')
  },
  windows: { onRemoved: listen('windowRemoved'), getLastFocused: async () => ({ id: 1, incognito: false }) },
  webNavigation: { onCommitted: listen('navigation'), onCreatedNavigationTarget: listen('target') }
};
const db = require('../extension/src/store/db.ts');
const sessions = require('../extension/src/store/sessions.ts');
const { ingestEvent } = require('../extension/src/store/ingest.ts');
const { exclusive } = require('../extension/src/operations.ts');
const { isTrustedMessage } = require('../extension/src/validateMessage.ts');
const { redactUrl } = require('../extension/src/store/privacy.ts');
const { buildResearchMapProjection } = require('../frontend/src/utils/researchMapViewModel.ts');
const sender = { id: chrome.runtime.id, url: chrome.runtime.getURL('dashboard/index.html'), tab: { id: 99 } };
const message = (request, from = sender) => new Promise(resolve => listeners.message(request, from, resolve));
const records = store => db.withTx(store, 'readonly', tx => db.req(tx.objectStore(store).getAll()));
const tick = () => new Promise(resolve => setImmediate(resolve));
async function setup() {
  await exclusive(async () => {});
  await db.deleteDatabase();
  const session = await sessions.createSession('Synthetic research', 1);
  state = { sessionState: { sessionId: session.id, isActive: true, windowId: 1, startedAt: session.startTime }, preExistingTabIds: [7] };
  tabs = new Map([
    [7, { id: 7, windowId: 1, incognito: false, url: 'https://example.org/preexisting', title: 'Existing' }],
    [8, { id: 8, windowId: 1, incognito: false, url: 'https://example.org/research', title: 'Research' }],
    [9, { id: 9, windowId: 2, incognito: false, url: 'https://example.org/private', title: 'Other window' }]
  ]);
  return session;
}
async function navigate(id) {
  await listeners.navigation({ frameId: 0, tabId: id, url: tabs.get(id).url, transitionType: 'link' });
}

test('security regressions', async t => {
  require('../extension/src/background.ts');
  await exclusive(async () => {});

  await t.test('research pages without navigation edges remain visible on the map', () => {
    const graph = buildResearchMapProjection([
      { id: 'session:s', type: 'SESSION', label: 'Research' },
      { id: 'page', type: 'PAGE', label: 'Directly opened page', url: 'https://example.org/' }
    ], [{ source: 'session:s', target: 'page', relationship: 'CONTAINS' }]);
    assert.deepEqual(graph.nodes.map(node => node.id), ['session:s', 'page']);
    assert.deepEqual(graph.edges, []);
  });

  await t.test('excluded windows, unknown windows, pre-existing and incognito tabs leave no records', async () => {
    const session = await setup();
    await navigate(9);
    await listeners.activated({ tabId: 7, windowId: 1 });
    tabs.get(8).incognito = true;
    await navigate(8);
    tabs.get(8).incognito = false;
    tabs.get(8).windowId = undefined;
    await navigate(8);
    assert.deepEqual(await records(db.STORE_EVENTS), []);
    tabs.get(8).windowId = 1;
    await navigate(8);
    assert.equal((await sessions.getPages(session.id)).length, 1);
    assert.equal((await sessions.getEvents(session.id)).length, 1);
    tabs.get(8).windowId = 2;
    await navigate(8);
    assert.equal((await sessions.getEvents(session.id)).length, 1);
  });

  await t.test('pre-existing tabs become eligible after navigation', async () => {
    const session = await setup();
    await navigate(7);
    assert.deepEqual(state.preExistingTabIds, []);
    assert.equal((await sessions.getPages(session.id)).length, 1);
  });

  await t.test('URL credentials, signed parameters, fragments and nested redirects are redacted', () => {
    for (const key of ['access_token', 'id_token', 'refresh-token', 'api_key', 'password', 'code', 'state', 'sessionId', 'X-Amz-Signature', 'X-Goog-Credential', 'AWSAccessKeyId', 'sig', 'SAMLResponse']) {
      const result = redactUrl(`https://user:secret@example.org/p?q=research&${key}=TOPSECRET#fragmentsecret`);
      assert.equal(result, 'https://example.org/p?q=research');
      assert.equal(redactUrl(result), result);
    }
    const result = redactUrl('https://example.org/?redirect=' + encodeURIComponent('https://a:b@example.net/c?token=TOPSECRET&q=science#secret'));
    assert.equal(new URL(result).searchParams.get('redirect'), 'https://example.net/c?q=science');
    assert.equal(redactUrl('https://example.org/p?q=research&page=2&tag=a&tag=b'), 'https://example.org/p?q=research&page=2&tag=a&tag=b');
    assert.equal(redactUrl('javascript:alert(1)'), null);
  });

  await t.test('ingestion redacts every URL copy, title echo and generated page key before writing', async () => {
    const session = await setup();
    const original = 'https://user:TOPSECRET@example.org/path?q=science&token=TOPSECRET#TOPSECRET';
    const input = { eventType: 'NAVIGATION', url: original, referrerUrl: original, title: `Reading ${original}`,
      tabId: 8, windowId: 1, timestamp: Date.now(), sessionId: session.id };
    await ingestEvent(input);
    assert.equal(input.url, original);
    const snapshot = JSON.stringify(await Promise.all([records(db.STORE_EVENTS), records(db.STORE_PAGES)]));
    assert.equal(snapshot.includes('TOPSECRET'), false);
    assert.equal((await sessions.getPages(session.id))[0].url, 'https://example.org/path?q=science');
    tabs.get(8).url = 'https://www.google.com/search?q=local+research&access_token=TOPSECRET';
    await navigate(8);
    const searches = await sessions.getSearches(session.id);
    assert.equal(searches[0].queryText, 'local research');
    assert.equal(JSON.stringify(searches).includes('TOPSECRET'), false);
  });

  await t.test('deleting active research stops capture and removes every record', async () => {
    const session = await setup();
    await navigate(8);
    const response = await message({ type: 'DELETE_SESSION', sessionId: session.id });
    assert.equal(response.ok, true);
    assert.equal(state.sessionState.isActive, false);
    await navigate(8);
    for (const store of [db.STORE_SESSIONS, db.STORE_EVENTS, db.STORE_PAGES, db.STORE_SEARCHES]) {
      assert.deepEqual(await records(store), []);
    }
  });

  await t.test('deleting another session preserves the active session', async () => {
    const active = await setup();
    const old = await sessions.createSession('Old', 1);
    await sessions.endSession(old.id);
    await message({ type: 'DELETE_SESSION', sessionId: old.id });
    await navigate(8);
    assert.equal(state.sessionState.sessionId, active.id);
    assert.equal((await sessions.getEvents(active.id)).length, 1);
  });

  await t.test('queued deletion and concurrent navigation cannot repopulate erased data', async () => {
    await setup();
    await navigate(8);
    const wipe = message({ type: 'DELETE_ALL_DATA' });
    await Promise.all([wipe, navigate(8)]);
    assert.equal((await wipe).ok, true);
    assert.deepEqual(await records(db.STORE_EVENTS), []);
    assert.equal(state.sessionState.isActive, false);
  });

  await t.test('storage rejects orphaned, completed and mismatched session writes', async () => {
    const session = await setup();
    const event = { eventType: 'NAVIGATION', url: 'https://example.org/', tabId: 8, windowId: 1, timestamp: Date.now(), sessionId: null };
    await assert.rejects(ingestEvent(event));
    await assert.rejects(ingestEvent({ ...event, sessionId: 'deleted' }));
    await assert.rejects(ingestEvent({ ...event, sessionId: session.id, windowId: 2 }));
    await sessions.endSession(session.id);
    await assert.rejects(ingestEvent({ ...event, sessionId: session.id }));
    assert.deepEqual(await records(db.STORE_EVENTS), []);
  });

  await t.test('blocked wipe reports failure and prevents reopening until actual deletion', async () => {
    await setup();
    await navigate(8);
    const external = await db.req(indexedDB.open(db.DB_NAME, db.DB_VERSION));
    try {
      const response = await message({ type: 'DELETE_ALL_DATA' });
      assert.equal(response.ok, false);
      assert.match(response.error, /blocked/i);
      assert.equal(state.sessionState.isActive, false);
      await assert.rejects(db.openDb(), /pending/i);
    } finally { external.close(); }
    // Wait for the pending IDB delete request to complete after closing it.
    for (let attempt = 0; ; attempt++) {
      try { await db.openDb(); break; } catch (error) { if (attempt > 50) throw error; await tick(); }
    }
    assert.deepEqual(await records(db.STORE_EVENTS), []);
  });

  await t.test('message validation accepts the dashboard and rejects websites and malformed payloads', async () => {
    assert.equal(isTrustedMessage({ type: 'LIST_SESSIONS' }, sender), true);
    assert.equal(isTrustedMessage({ type: 'LIST_SESSIONS' }, { ...sender, url: 'https://example.org/' }), false);
    assert.equal(isTrustedMessage({ type: 'DELETE_ALL_DATA' }, { ...sender, id: 'other' }), false);
    for (const request of [null, {}, { type: 'DELETE_SESSION' }, { type: 'RESTORE_TABS', urls: ['javascript:alert(1)'], focusUrl: null }, { type: 'RESTORE_TABS', urls: Array(101).fill('https://example.org'), focusUrl: null }, { type: 'SAVE_POSITIONS', sessionId: 's', positions: { x: { x: NaN, y: 0 } } }]) {
      assert.equal(isTrustedMessage(request, sender), false);
    }
    assert.equal((await message(null)).ok, false);
  });

  await t.test('migration removes legacy orphan data and preserves legitimate research', async () => {
    await db.deleteDatabase();
    const legacy = await new Promise((resolve, reject) => {
      const request = indexedDB.open(db.DB_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        database.createObjectStore('sessions', { keyPath: 'id' }).put({ id: 'valid', status: 'COMPLETED' });
        for (const name of ['events', 'pageVisits', 'searchQueries', 'positions']) {
          const store = database.createObjectStore(name, { keyPath: 'id' });
          store.put({ id: 1, sessionId: null });
          store.put({ id: 2, sessionId: 'deleted' });
          store.put({ id: 3, sessionId: 'valid', url: 'https://example.org/', sourceUrl: 'https://example.org/' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    legacy.close();
    await db.openDb();
    for (const name of ['events', 'pageVisits', 'searchQueries', 'positions']) {
      const result = await records(name);
      assert.equal(result.length, 1);
      assert.equal(result[0].sessionId, 'valid');
    }
    await db.deleteDatabase();
  });

  await t.test('upgrade redacts old URL keys and layouts, merges pages and preserves graph links', async () => {
    await db.deleteDatabase();
    const oldUrls = ['https://example.org/p?token=TOPSECRET', 'https://example.org/p?token=ANOTHERSECRET'];
    const ids = oldUrls.map(url => `valid:${url}`);
    const legacy = await new Promise((resolve, reject) => {
      const request = indexedDB.open(db.DB_NAME, 2);
      request.onupgradeneeded = () => {
        const database = request.result;
        database.createObjectStore('sessions', { keyPath: 'id' }).put({ id: 'valid', status: 'COMPLETED' });
        const pages = database.createObjectStore('pageVisits', { keyPath: 'id' });
        const events = database.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
        events.createIndex('dedup', ['tabId', 'url', 'timestamp'], { unique: true });
        const searches = database.createObjectStore('searchQueries', { keyPath: 'id' });
        const positions = database.createObjectStore('positions', { keyPath: 'sessionId' });
        oldUrls.forEach((url, index) => {
          pages.put({ id: ids[index], url, title: url, sessionId: 'valid', visitCount: 1, durationMs: 10,
            firstVisited: index + 1, lastVisited: index + 2 });
          events.put({ id: index + 1, sessionId: 'valid', url, title: url, referrerUrl: url, tabId: 8, timestamp: 1, pageVisitId: ids[index] });
        });
        searches.put({ id: 'search', sessionId: 'valid', sourceUrl: oldUrls[0], queryText: 'science', pageVisitId: ids[0] });
        positions.put({ sessionId: 'valid', positions: { [ids[0]]: { x: 1, y: 2 } } });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    legacy.close();
    await db.openDb();
    const pages = await records(db.STORE_PAGES);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].id, 'valid:https://example.org/p');
    assert.equal(pages[0].visitCount, 2);
    assert.equal(pages[0].durationMs, 20);
    const events = await records(db.STORE_EVENTS);
    assert.equal(events.length, 1); // redaction made the duplicate keys identical
    assert.equal(events[0].pageVisitId, pages[0].id);
    assert.equal((await records(db.STORE_SEARCHES))[0].pageVisitId, pages[0].id);
    assert.deepEqual((await records(db.STORE_POSITIONS))[0].positions, { [pages[0].id]: { x: 1, y: 2 } });
    const snapshot = JSON.stringify(await Promise.all(['events', 'pageVisits', 'searchQueries', 'positions'].map(records)));
    assert.equal(snapshot.includes('SECRET'), false);
    await db.deleteDatabase();
  });
});
