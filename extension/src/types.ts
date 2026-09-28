export type EventType = 'TAB_CREATED' | 'NAVIGATION' | 'TAB_ACTIVATED' | 'TAB_CLOSED';

export interface BrowserEventRequest {
  eventType: EventType;
  url?: string;
  title?: string;
  tabId: number;
  windowId?: number;
  transitionType?: string;
  transitionQualifiers?: string[];
  referrerUrl?: string;
  openerTabId?: number;
  sourceTabId?: number;
  timestamp: number;
  sessionId?: string;
}

export interface SessionState {
    sessionId: string | null;
    sessionTitle: string | null;
    isActive: boolean;
    // Chrome window the session belongs to. Events from other windows must
    // not be attributed to this session. Null = unknown (legacy behavior).
    windowId: number | null;
    // Epoch ms when this session was started. Lets a restart tell a session
    // still running in the current browser from one left over by a previous
    // run, so closing Chrome ends the session at the right moment.
    startedAt?: number | null;
  }

/**
 * Status indicator shown in the popup.
 *
 * There is no server any more, so `connected` now means "the local store is
 * ready" rather than "a backend is reachable".
 */
export interface BackendStatus {
  connected: boolean;
  lastCheck: number;
}
