import {
  Session,
  PageVisit,
  SearchQuery,
  TimelineEntry,
  MindMapData,
  ResumePoint
} from '../types';
import { sanitizeSessions } from './sanitize';

/**
 * The dashboard's data source.
 *
 * The dashboard ships inside the extension and talks to the service worker
 * over chrome.runtime messaging. The worker reads and writes IndexedDB on this
 * device, so there is no server to run and nothing to configure.
 *
 * If the page is opened outside the extension (a plain dev server, for
 * example) there is no worker to talk to, and every call fails with a clear
 * message rather than quietly showing invented data.
 */

interface WorkerResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
}

declare const chrome:
  | { runtime?: { sendMessage?: (message: unknown) => Promise<unknown> } }
  | undefined;

const NOT_IN_EXTENSION =
  'Open Pariet from the extension. This page needs the Pariet extension to read your research.';

function inExtension(): boolean {
  return typeof chrome !== 'undefined' && typeof chrome.runtime?.sendMessage === 'function';
}

async function callWorker<T>(request: Record<string, unknown>): Promise<T> {
  const send = chrome?.runtime?.sendMessage;
  if (!send) throw new Error(NOT_IN_EXTENSION);

  // A Manifest V3 service worker is stopped whenever it is idle, so the first
  // message after a pause can arrive while the worker is still waking up and
  // fail with "Receiving end does not exist". Retry once so a cold worker does
  // not surface as an error to the user.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = (await send(request)) as WorkerResponse | undefined;
      if (!response) throw new Error('No response from the Pariet service worker');
      if (!response.ok) throw new Error(response.error ?? 'Request failed');
      return response.data as T;
    } catch (error) {
      const waking = /Receiving end does not exist|Could not establish connection/i.test(
        error instanceof Error ? error.message : String(error)
      );
      if (!waking || attempt === 1) throw error;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error('Request failed');
}

export const apiClient = {
  isAvailable(): boolean {
    return inExtension();
  },

  getSessions: async (): Promise<Session[]> => {
    return sanitizeSessions(await callWorker<Session[]>({ type: 'LIST_SESSIONS' }));
  },

  deleteSession: async (id: string): Promise<void> => {
    await callWorker({ type: 'DELETE_SESSION', sessionId: id });
  },

  deleteAllData: async (): Promise<void> => {
    await callWorker({ type: 'DELETE_ALL_DATA' });
  },

  getTimeline: async (id: string): Promise<TimelineEntry[]> => {
    return callWorker<TimelineEntry[]>({ type: 'GET_TIMELINE', sessionId: id });
  },

  getPages: async (id: string): Promise<PageVisit[]> => {
    return callWorker<PageVisit[]>({ type: 'GET_PAGES', sessionId: id });
  },

  getSearches: async (id: string): Promise<SearchQuery[]> => {
    return callWorker<SearchQuery[]>({ type: 'GET_SEARCHES', sessionId: id });
  },

  getResumePoint: async (id: string): Promise<ResumePoint> => {
    return callWorker<ResumePoint>({ type: 'GET_RESUME_POINT', sessionId: id });
  },

  getMindMap: async (id: string): Promise<MindMapData> => {
    const map = await callWorker<{ nodes: MindMapData['nodes']; edges: MindMapData['edges'] }>({
      type: 'GET_MINDMAP',
      sessionId: id
    });
    return { sessionId: id, nodes: map.nodes, edges: map.edges };
  },

  /** Saved mind-map layout, stored locally with everything else. */
  getPositions: async (id: string): Promise<Record<string, { x: number; y: number }>> => {
    return callWorker<Record<string, { x: number; y: number }>>({ type: 'GET_POSITIONS', sessionId: id });
  },

  savePositions: async (
    id: string,
    positions: Record<string, { x: number; y: number }>
  ): Promise<void> => {
    await callWorker({ type: 'SAVE_POSITIONS', sessionId: id, positions });
  },

  /** Reopen a session's pages as tabs, with the stopping point focused. */
  restoreTabs: async (urls: string[], focusUrl: string | null): Promise<number> => {
    const result = await callWorker<{ ok: boolean; count: number }>({
      type: 'RESTORE_TABS',
      urls,
      focusUrl
    });
    return result.count;
  }
};
