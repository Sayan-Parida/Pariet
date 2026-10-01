import { SessionState, BackendStatus } from './types';
import { callServiceWorker, type SessionSummary } from './messages';

/** Fire-and-forget message to the service worker. */
function sendMessage(type: string): Promise<void> {
  return new Promise((resolve) => chrome.runtime.sendMessage({ type }, () => resolve()));
}

document.addEventListener('DOMContentLoaded', () => {
  const statusIndicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('status-text');
  const sessionLabel = document.getElementById('session-label');
  const sessionInfo = document.getElementById('session-info');
  const captureNote = document.getElementById('capture-note');
  const queueInfo = document.getElementById('queue-info');
  const startSessionDiv = document.getElementById('start-session-div');
  const endSessionDiv = document.getElementById('end-session-div');
  const noSessionSection = document.getElementById('no-session-section');
  const sessionSection = document.getElementById('session-section');
  const sessionTitleInput = document.getElementById('session-title') as HTMLInputElement;
  const startBtn = document.getElementById('start-btn');
  const endBtn = document.getElementById('end-btn');
  const dashboardBtn = document.getElementById('dashboard-btn');

  function applyView(sessionState: SessionState | null, storageReady: boolean, queueLength: number) {
    // Storage is local, so "connected" means the local store is ready rather
    // than a server being reachable.
    if (storageReady) {
      statusIndicator!.className = 'st-dot st-dot--on';
      statusText!.textContent = 'READY';
    } else {
      statusIndicator!.className = 'st-dot';
      statusText!.textContent = 'STARTING';
    }

    // The event queue no longer exists: events are written straight to the
    // local database, so there is nothing pending to report.
    queueInfo!.classList.add('meta--hidden');

    if (sessionState?.isActive && sessionState.sessionId) {
      noSessionSection!.classList.add('hidden');
      sessionSection!.classList.remove('hidden');
      sessionLabel!.textContent = 'ACTIVE RESEARCH';
      sessionInfo!.textContent = sessionState.sessionTitle || 'Untitled research session';
      captureNote!.style.display = 'block';
      startSessionDiv!.style.display = 'none';
      endSessionDiv!.style.display = 'block';
    } else {
      noSessionSection!.classList.remove('hidden');
      sessionSection!.classList.add('hidden');
      sessionLabel!.textContent = '';
      sessionInfo!.textContent = 'No active research session.';
      captureNote!.style.display = 'none';
      startSessionDiv!.style.display = 'block';
      endSessionDiv!.style.display = 'none';
    }
  }

  /**
   * Keep the popup's view honest against the local store.
   *
   * The service worker is the single source of truth, so this only needs to
   * drop a stale session id (for example after "delete all data") and adopt an
   * active session that is still recorded but not in the cached state.
   */
  async function reconcile(sessionState: SessionState | null): Promise<SessionState | null> {
    try {
      const sessions = await callServiceWorker<SessionSummary[]>('LIST_SESSIONS');
      const active = sessions.find((s) => s.status === 'ACTIVE') ?? null;

      if (sessionState?.isActive && sessionState.sessionId) {
        if (!active || active.id !== sessionState.sessionId) {
          await sendMessage('CLEAR_SESSION_STATE');
          return { sessionId: null, sessionTitle: null, isActive: false, windowId: null };
        }
        return sessionState;
      }

      // A session is recorded as active but the cached state lost it, which
      // happens if the worker was restarted. Adopt it.
      if (active) {
        return {
          sessionId: active.id,
          sessionTitle: active.title,
          isActive: true,
          // Unknown window: tab rules apply until the worker resolves it.
          windowId: null
        };
      }
    } catch (error) {
      console.warn('Could not reconcile with local store', error);
    }
    return sessionState;
  }

  function updateUI() {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
      if (!response) return;

      const { sessionState, backendStatus } = response as {
        sessionState: SessionState;
        backendStatus: BackendStatus;
      };

      const storageReady = Boolean(backendStatus?.connected);
      applyView(sessionState, storageReady, 0);

      if (!storageReady) return;

      reconcile(sessionState).then((effective) => {
        applyView(effective, storageReady, 0);
      });
    });
  }

  startBtn?.addEventListener('click', () => {
    const title = sessionTitleInput.value.trim();
    chrome.runtime.sendMessage({ type: 'START_SESSION', title }, () => {
      sessionTitleInput.value = '';
      updateUI();
    });
  });

  endBtn?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'END_SESSION' }, () => {
      updateUI();
    });
  });

  dashboardBtn?.addEventListener('click', () => {
    // The dashboard ships inside the extension, so it opens straight from the
    // package. No dev server, no local backend, nothing to install.
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/index.html') });
  });

  updateUI();
  setInterval(updateUI, 5000);
});
