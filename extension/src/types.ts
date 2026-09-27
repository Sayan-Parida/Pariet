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
}

export interface QueuedEvent {
  event: BrowserEventRequest;
  retryCount: number;
}

export interface BackendStatus {
  connected: boolean;
  lastCheck: number;
}
