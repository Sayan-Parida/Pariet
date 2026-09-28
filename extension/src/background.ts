import { BrowserEventRequest, SessionState } from './types';
import { ingestEvent, DuplicateEventError } from './store/ingest';
import { createSession, endSession, getSession, deleteSession, deleteAllData,
         listSessions, getPositions, savePositions } from './store/sessions';
import { getMindMap, getPageViews, getSearchViews, getTimeline, getResumePoint } from './store/api';
import { isResearchUrl } from './store/urls';
import type { ParietRequest, ParietResponse } from './messages';

// Session bookkeeping lives in chrome.storage.local because the service worker
// needs it synchronously at event time. The research data itself lives in
// IndexedDB (see store/).
async function initState() {
  const data = await chrome.storage.local.get(['sessionState', 'preExistingTabIds']);
  const patch: Record<string, unknown> = {};
  if (!data.sessionState) {
    patch.sessionState = { sessionId: null, sessionTitle: null, isActive: false, windowId: null } as SessionState;
  }
  if (!data.preExistingTabIds) {
    patch.preExistingTabIds = [] as number[];
  }
  if (Object.keys(patch).length > 0) {
    await chrome.storage.local.set(patch);
  }
}

initState();

/**
 * End the active session.
 *
 * A session belongs to one window, so it ends the moment that window closes.
 * The service worker is single-threaded and the write is a local transaction,
 * so unlike a network call this completes even while Chrome is shutting down.
 */
async function endActiveSession(reason: string, endedAtMs?: number): Promise<boolean> {
  const data = await chrome.storage.local.get(['sessionState']);
  const sessionState: SessionState | undefined = data.sessionState;
  if (!sessionState?.isActive || !sessionState.sessionId) return true;

  try {
    await endSession(sessionState.sessionId, endedAtMs);
    await chrome.storage.local.set({
      sessionState: { sessionId: null, sessionTitle: null, isActive: false, windowId: null } as SessionState,
      preExistingTabIds: []
    });
    console.log(`Ended session ${sessionState.sessionId} (${reason})`);
    return true;
  } catch (error) {
    console.error(`Could not end session ${sessionState.sessionId} (${reason})`, error);
    return false;
  }
}

/**
 * Safety net for a full browser quit.
 *
 * Chrome may terminate the worker before the window-close handler runs, so on
 * every start we close any session left over from a previous browser run.
 */
async function reconcileLeftoverSession() {
  const data = await chrome.storage.local.get(['sessionState']);
  const sessionState: SessionState | undefined = data.sessionState;
  if (!sessionState?.isActive || !sessionState.sessionId) return;
  await endActiveSession('leftover from a previous browser run', sessionState.startedAt ?? undefined);
}

// The session's window is what defines the session, so closing it ends the
// session immediately. This covers closing the research window and quitting
// Chrome, since quitting removes every window.
chrome.windows.onRemoved.addListener((windowId) => {
  chrome.storage.local.get(['sessionState']).then(async (data) => {
    const sessionState: SessionState | undefined = data.sessionState;
    if (!sessionState?.isActive || sessionState.windowId == null) return;
    if (sessionState.windowId !== windowId) return;
    await endActiveSession('session window closed');
  }).catch((e) => console.warn('Window close handler failed', e));
});

reconcileLeftoverSession().catch((e) => console.warn('Session reconcile failed', e));

// Window isolation rule: a Research Session belongs to the Chrome window
// where it was started. Only events carrying that windowId may be
// attributed to the session. A null window on either side (unknown /
// legacy) falls back to the pre-existing tab rules below.
//
// Moved-tab decision (deterministic, based on the event's authoritative
// windowId at event time, never on tabId history):
// - Tab moved OUT of the research window: later events carry the new
//   windowId and are NOT attributed, even if the tab was previously eligible.
// - Tab moved INTO the research window: later events carry the research
//   windowId and are evaluated under the normal rules (an unknown tab id is
//   treated like a newly created tab).
function windowMatchesSession(sessionState: SessionState, event: BrowserEventRequest): boolean {
  if (sessionState.windowId == null) return true;
  if (event.windowId == null) return true;
  return event.windowId === sessionState.windowId;
}

// Queue and processing
async function processEvent(event: BrowserEventRequest) {
  const data = await chrome.storage.local.get(['sessionState', 'eventQueue', 'preExistingTabIds']);
  const sessionState: SessionState = data.sessionState;
  const preExistingTabIds: number[] = data.preExistingTabIds || [];
  
  // Determine if this event should be attributed to the active session
  let shouldAttributeSession = false;
  
  if (sessionState.isActive && sessionState.sessionId && windowMatchesSession(sessionState, event)) {
    const isPreExistingTab = preExistingTabIds.includes(event.tabId);
    
    if (!isPreExistingTab) {
      // Tab was created after session started - attribute all events
      shouldAttributeSession = true;
    } else {
      // Pre-existing tab: only attribute NAVIGATION events (actual research activity)
      // Do NOT attribute TAB_ACTIVATED, TAB_CREATED, TAB_CLOSED for pre-existing tabs
      if (event.eventType === 'NAVIGATION') {
        shouldAttributeSession = true;
        // Once a pre-existing tab has navigation, it becomes a session tab
        // Remove from pre-existing list so future events are attributed
        const updatedPreExisting = preExistingTabIds.filter(id => id !== event.tabId);
        await chrome.storage.local.set({ preExistingTabIds: updatedPreExisting });
      }
    }
  }
  
  // Capture is session-scoped: nothing is recorded while no Research Session
  // is active. Previously every tab event was sent unconditionally, which
  // stored a permanent record of all browsing activity even outside sessions.
  if (!sessionState.isActive || !sessionState.sessionId) {
    return;
  }

  if (shouldAttributeSession) {
    event.sessionId = sessionState.sessionId;
  }

  // Recorded straight into IndexedDB on the user's device. There is no server
  // to reach, so a write is a write: no queue, no health check, nothing to
  // retry. A failure is surfaced rather than silently dropped.
  try {
    await ingestEvent({
      eventType: event.eventType,
      url: event.url ?? null,
      title: event.title ?? null,
      tabId: event.tabId,
      windowId: event.windowId ?? null,
      transitionType: event.transitionType ?? null,
      referrerUrl: event.referrerUrl ?? null,
      openerTabId: event.openerTabId ?? null,
      sourceTabId: event.sourceTabId ?? null,
      timestamp: event.timestamp,
      sessionId: event.sessionId ?? null,
      pageVisitId: null
    });
  } catch (error) {
    // A replayed event is expected and harmless.
    if (error instanceof DuplicateEventError) return;
    console.error('Failed to record event', error);
  }
}

// There is no server to be offline from, so no queue and no health check.
// The service worker only needs to run when Chrome wakes it.

// Only real web pages are recorded. This rejects internal browser pages and
// Pariet's own surfaces, so they never reach the local database. It delegates
// to the shared rule in store/urls.ts so capture and storage cannot disagree.
const isTrackableUrl = isResearchUrl;

// Helper to check incognito
async function isIncognito(tabId: number): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.incognito;
  } catch {
    return false;
  }
}

// Event Listeners

chrome.tabs.onCreated.addListener(async (tab) => {
  if (tab.incognito) return;
  // A new tab often has no URL yet (chrome://newtab/ or blank); such tabs are
  // recorded once they commit a real navigation, so skip them here.
  const url = tab.url || tab.pendingUrl;
  if (!isTrackableUrl(url)) return;
  const event: BrowserEventRequest = {
    eventType: 'TAB_CREATED',
    url: url,
    title: tab.title,
    tabId: tab.id!,
    windowId: tab.windowId,
    openerTabId: tab.openerTabId,
    timestamp: Date.now()
  };
  await processEvent(event);
});

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return; // Main frame only
  
  const url = details.url;
  if (!isTrackableUrl(url)) return;

  const incognito = await isIncognito(details.tabId);
  if (incognito) return;

  try {
    const tab = await chrome.tabs.get(details.tabId);
    const event: BrowserEventRequest = {
      eventType: 'NAVIGATION',
      url: url,
      title: tab.title,
      tabId: details.tabId,
      windowId: tab.windowId,
      transitionType: details.transitionType,
      transitionQualifiers: details.transitionQualifiers,
      timestamp: Date.now(),
    };
    await processEvent(event);
  } catch (e) {
    // Ignore if tab is already gone
  }
});

// Track source tab for new-tab navigations (e.g., Ctrl+click → new tab)
chrome.webNavigation.onCreatedNavigationTarget.addListener(async (details) => {
  if (details.tabId <= 0) return;
  
  const url = details.url;
  if (!isTrackableUrl(url)) return;

  try {
    const tab = await chrome.tabs.get(details.tabId);
    if (tab.incognito) return;
    const event: BrowserEventRequest = {
      eventType: 'TAB_CREATED',
      url: url,
      title: tab.title,
      tabId: details.tabId,
      windowId: tab.windowId,
      sourceTabId: details.sourceTabId,
      timestamp: Date.now()
    };
    await processEvent(event);
  } catch {
    // Ignore
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.incognito) return;
    const url = tab.url;
    if (!isTrackableUrl(url)) return;

    const event: BrowserEventRequest = {
      eventType: 'TAB_ACTIVATED',
      url: url,
      title: tab.title,
      tabId: activeInfo.tabId,
      windowId: activeInfo.windowId,
      timestamp: Date.now()
    };
    await processEvent(event);
  } catch {
    // Ignore
  }
});

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  // The tab is already gone, so its URL and incognito flag are unavailable.
  // A close event carries no URL at all, so nothing page-identifying is sent.
  const event: BrowserEventRequest = {
    eventType: 'TAB_CLOSED',
    tabId: tabId,
    windowId: removeInfo.windowId,
    timestamp: Date.now()
  };
  await processEvent(event);
});

function isParseableHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// Opens restored research tabs in study order. The stopping-point URL is
// expected last and is opened active so it becomes the focused tab.
async function restoreTabs(urls: string[], focusUrl: string | null): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    let count = 0;
    for (const url of urls) {
      if (!isParseableHttpUrl(url)) continue;
      await chrome.tabs.create({ url, active: url === focusUrl });
      count++;
    }
    return { ok: true, count: count };
  } catch (error) {
    return { ok: false, count: 0, error: error instanceof Error ? error.message : 'Failed to restore tabs' };
  }
}

/** The dashboard's API, served from IndexedDB. */
async function handleDashboardRequest(request: ParietRequest): Promise<unknown> {
  switch (request.type) {
    case 'LIST_SESSIONS':
      return listSessions();
    case 'GET_MINDMAP':
      return getMindMap(request.sessionId);
    case 'GET_PAGES':
      return getPageViews(request.sessionId);
    case 'GET_SEARCHES':
      return getSearchViews(request.sessionId);
    case 'GET_TIMELINE':
      return getTimeline(request.sessionId);
    case 'GET_RESUME_POINT':
      return getResumePoint(request.sessionId);
    case 'DELETE_SESSION':
      await deleteSession(request.sessionId);
      return null;
    case 'DELETE_ALL_DATA':
      await deleteAllData();
      await chrome.storage.local.set({
        sessionState: { sessionId: null, sessionTitle: null, isActive: false, windowId: null } as SessionState,
        preExistingTabIds: []
      });
      return null;
    case 'GET_POSITIONS':
      return getPositions(request.sessionId);
    case 'SAVE_POSITIONS':
      await savePositions(request.sessionId, request.positions);
      return null;
    case 'RESTORE_TABS':
      return restoreTabs(request.urls, request.focusUrl);
    case 'GET_EXTENSION_STATUS':
      return { ready: true, storage: 'indexeddb' };
    default:
      throw new Error('Unknown request');
  }
}

/** Request types handled by the dashboard API rather than the popup. */
const DASHBOARD_REQUESTS = new Set<ParietRequest['type']>([
  'LIST_SESSIONS', 'GET_MINDMAP', 'GET_PAGES', 'GET_SEARCHES', 'GET_TIMELINE',
  'GET_RESUME_POINT', 'GET_POSITIONS', 'GET_EXTENSION_STATUS',
  'DELETE_SESSION', 'DELETE_ALL_DATA', 'SAVE_POSITIONS', 'RESTORE_TABS'
]);

// Messages from the popup and dashboard
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Dashboard API. Checked first because its requests share the GET_ prefix.
  if (message && DASHBOARD_REQUESTS.has(message.type)) {
    handleDashboardRequest(message as ParietRequest)
      .then((data) => sendResponse({ ok: true, data } satisfies ParietResponse))
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Request failed'
      } satisfies ParietResponse));
    return true;
  }

  if (message.type === 'GET_STATE') {
    chrome.storage.local.get(['sessionState', 'preExistingTabIds']).then(data => {
      sendResponse({
        sessionState: data.sessionState,
        // There is no server, so the extension is always "connected" to its own
        // local store. The indicator now means "storage is ready".
        backendStatus: { connected: true, lastCheck: Date.now() },
        queueLength: 0,
        preExistingTabCount: (data.preExistingTabIds || []).length
      });
    });
    return true; // keep channel open
  } else if (message.type === 'START_SESSION') {
    // The session belongs to the currently focused window. Events from any
    // other window must never be attributed to it (see windowMatchesSession).
    (async () => {
      const focusedWindow = await chrome.windows.getLastFocused().catch(() => null);
      const sessionWindowId: number | null =
        focusedWindow && focusedWindow.id != null ? focusedWindow.id : null;

      const session = await createSession(message.title ?? null, sessionWindowId);

      // Tabs already open in the session window are pre-existing: they are not
      // attributed to the new session unless the user navigates in them.
      const tabs = await chrome.tabs.query(sessionWindowId != null ? { windowId: sessionWindowId } : {});
      const preExistingTabIds = tabs
        .filter(tab => !tab.incognito)
        .filter(tab => isResearchUrl(tab.url))
        .map(tab => tab.id!);

      await chrome.storage.local.set({
        sessionState: {
          sessionId: session.id,
          sessionTitle: message.title,
          isActive: true,
          windowId: sessionWindowId,
          startedAt: Date.now()
        } as SessionState,
        preExistingTabIds
      });
      sendResponse({ success: true, sessionId: session.id, preExistingTabCount: preExistingTabIds.length });
    })().catch((error) => {
      console.error('Failed to start session', error);
      sendResponse({ success: false, error: error instanceof Error ? error.message : 'Failed to start session' });
    });
    return true;
  } else if (message.type === 'END_SESSION') {
    endActiveSession('ended by user')
      .then((ok) => sendResponse({ success: ok }))
      .catch(() => sendResponse({ success: false }));
    return true;
  } else if (message.type === 'CLEAR_SESSION_STATE') {
    chrome.storage.local.set({
      sessionState: { sessionId: null, sessionTitle: null, isActive: false, windowId: null } as SessionState,
      preExistingTabIds: []
    }).then(() => sendResponse({ success: true }));
    return true;
  }
});
