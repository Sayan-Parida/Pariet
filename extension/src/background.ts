import { api } from './api';
import { BrowserEventRequest, SessionState, QueuedEvent, BackendStatus, EventType } from './types';

// Constants
const QUEUE_LIMIT = 1000;

// Initialize state if missing
async function initState() {
  const data = await chrome.storage.local.get(['sessionState', 'eventQueue', 'backendStatus', 'preExistingTabIds']);
  if (!data.sessionState) {
    await chrome.storage.local.set({ sessionState: { sessionId: null, sessionTitle: null, isActive: false } as SessionState });
  }
  if (!data.eventQueue) {
    await chrome.storage.local.set({ eventQueue: [] as QueuedEvent[] });
  }
  if (!data.backendStatus) {
    await chrome.storage.local.set({ backendStatus: { connected: false, lastCheck: Date.now() } as BackendStatus });
  }
  if (!data.preExistingTabIds) {
    await chrome.storage.local.set({ preExistingTabIds: [] as number[] });
  }
}

initState();

// Queue and processing
async function processEvent(event: BrowserEventRequest) {
  const data = await chrome.storage.local.get(['sessionState', 'eventQueue', 'preExistingTabIds']);
  const sessionState: SessionState = data.sessionState;
  const preExistingTabIds: number[] = data.preExistingTabIds || [];
  
  // Determine if this event should be attributed to the active session
  let shouldAttributeSession = false;
  
  if (sessionState.isActive && sessionState.sessionId) {
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
  
  if (shouldAttributeSession && sessionState.sessionId) {
    event.sessionId = sessionState.sessionId;
  }
  
  const success = await api.sendEvent(event);
  
  if (success) {
    await updateBackendStatus(true);
    flushQueue();
  } else {
    const queue: QueuedEvent[] = data.eventQueue || [];
    if (queue.length < QUEUE_LIMIT) {
      queue.push({ event, retryCount: 0 });
      await chrome.storage.local.set({ eventQueue: queue });
    }
    await updateBackendStatus(false);
  }
}

async function flushQueue() {
  const data = await chrome.storage.local.get(['eventQueue', 'sessionState', 'preExistingTabIds']);
  let queue: QueuedEvent[] = data.eventQueue || [];
  const sessionState: SessionState = data.sessionState;
  const preExistingTabIds: number[] = data.preExistingTabIds || [];
  
  if (queue.length === 0) return;

  const failedEvents: number[] = [];

  for (let i = 0; i < queue.length; i++) {
    const queuedEvent = queue[i].event;
    let shouldAttributeSession = false;
    
    if (sessionState.isActive && sessionState.sessionId) {
      const isPreExistingTab = preExistingTabIds.includes(queuedEvent.tabId);
      
      if (!isPreExistingTab) {
        shouldAttributeSession = true;
      } else if (queuedEvent.eventType === 'NAVIGATION') {
        shouldAttributeSession = true;
        const updatedPreExisting = preExistingTabIds.filter(id => id !== queuedEvent.tabId);
        await chrome.storage.local.set({ preExistingTabIds: updatedPreExisting });
      }
    }
    
    if (shouldAttributeSession && sessionState.sessionId) {
      queuedEvent.sessionId = sessionState.sessionId;
    }
    
    const success = await api.sendEvent(queuedEvent);
    if (!success) {
      failedEvents.push(i);
    }
  }

  if (failedEvents.length < queue.length) {
    queue = queue.filter((_, idx) => failedEvents.includes(idx));
    await chrome.storage.local.set({ eventQueue: queue });
  }
}

async function updateBackendStatus(connected: boolean) {
  await chrome.storage.local.set({
    backendStatus: { connected, lastCheck: Date.now() }
  });
}

// Alarms for periodic tasks
chrome.alarms.create('flushQueue', { periodInMinutes: 0.5 }); // 30 seconds
chrome.alarms.create('healthCheck', { periodInMinutes: 0.5 }); // 30 seconds

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'flushQueue') {
    flushQueue();
  } else if (alarm.name === 'healthCheck') {
    const isHealthy = await api.checkHealth();
    const data = await chrome.storage.local.get(['backendStatus']);
    const wasConnected = data.backendStatus?.connected;
    
    await updateBackendStatus(isHealthy);
    
    if (isHealthy && !wasConnected) {
      flushQueue();
    }
  }
});

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
  const url = tab.url || tab.pendingUrl;
  if (url != null && (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:'))) return;
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
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) return;

  const incognito = await isIncognito(details.tabId);
  if (incognito) return;

  try {
    const tab = await chrome.tabs.get(details.tabId);
    const event: BrowserEventRequest = {
      eventType: 'NAVIGATION',
      url: url,
      title: tab.title,
      tabId: details.tabId,
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
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) return;

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
    if (url != null && (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:'))) return;

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
  // We can't check incognito here reliably since tab is gone, but we only have tabId anyway
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

// Messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_STATE') {
    chrome.storage.local.get(['sessionState', 'backendStatus', 'eventQueue', 'preExistingTabIds']).then(data => {
      sendResponse({
        sessionState: data.sessionState,
        backendStatus: data.backendStatus,
        queueLength: (data.eventQueue || []).length,
        preExistingTabCount: (data.preExistingTabIds || []).length
      });
    });
    return true; // keep channel open
  } else if (message.type === 'START_SESSION') {
    api.createSession(message.title).then(async (id) => {
      if (id) {
        // Capture all currently open tabs as pre-existing (they should NOT be attributed to the new session
        // unless the user actively navigates in them after session start)
        const tabs = await chrome.tabs.query({});
        const preExistingTabIds = tabs
          .filter(tab => !tab.incognito)
          .filter(tab => tab.url != null && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://') && !tab.url.startsWith('about:'))
          .map(tab => tab.id!);
        
        await chrome.storage.local.set({ 
          sessionState: { sessionId: id, sessionTitle: message.title, isActive: true } as SessionState,
          preExistingTabIds
        });
        sendResponse({ success: true, preExistingTabCount: preExistingTabIds.length });
      } else {
        sendResponse({ success: false });
      }
    });
    return true;
  } else if (message.type === 'END_SESSION') {
    chrome.storage.local.get(['sessionState']).then(async data => {
      const sessionId = data.sessionState?.sessionId;
      if (sessionId) {
        const success = await api.endSession(sessionId);
        if (success) {
          await chrome.storage.local.set({ 
            sessionState: { sessionId: null, sessionTitle: null, isActive: false } as SessionState,
            preExistingTabIds: []
          });
        } else {
          console.error(`Failed to end session ${sessionId}; preserving local session state`);
        }
        sendResponse({ success });
        return;
      }
      sendResponse({ success: true });
    });
    return true;
  } else if (message.type === 'RESTORE_TABS') {
    restoreTabs(message.urls || [], message.focusUrl ?? null).then((response) => sendResponse(response));
    return true;
  } else if (message.type === 'CLEAR_SESSION_STATE') {
    chrome.storage.local.set({ 
      sessionState: { sessionId: null, sessionTitle: null, isActive: false } as SessionState,
      preExistingTabIds: []
    }).then(() => sendResponse({ success: true }));
    return true;
  } else if (message.type === 'SET_SESSION_STATE') {
    chrome.storage.local.set({
      sessionState: { sessionId: message.sessionId, sessionTitle: message.sessionTitle ?? null, isActive: true } as SessionState
    }).then(() => sendResponse({ success: true }));
    return true;
  }
});