/**
 * Message contract between the dashboard and the service worker.
 *
 * The dashboard is an extension page, so it calls the worker directly rather
 * than fetching an HTTP API. Keeping the shapes in one shared module means the
 * two sides cannot drift.
 */

import type { SessionSummary } from './store/sessions';
import type { MindMap } from './store/mindmap';
import type {
  PageVisitView, SearchQueryView, ResumePoint, TimelineEntry
} from './store/api';

export type ParietRequest =
  | { type: 'LIST_SESSIONS' }
  | { type: 'GET_MINDMAP'; sessionId: string }
  | { type: 'GET_PAGES'; sessionId: string }
  | { type: 'GET_SEARCHES'; sessionId: string }
  | { type: 'GET_TIMELINE'; sessionId: string }
  | { type: 'GET_RESUME_POINT'; sessionId: string }
  | { type: 'DELETE_SESSION'; sessionId: string }
  | { type: 'DELETE_ALL_DATA' }
  | { type: 'GET_POSITIONS'; sessionId: string }
  | { type: 'SAVE_POSITIONS'; sessionId: string; positions: Record<string, { x: number; y: number }> }
  | { type: 'RESTORE_TABS'; urls: string[]; focusUrl: string | null }
  | { type: 'GET_EXTENSION_STATUS' };

export type ParietResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

/** Call the service worker. Never throws; failures come back as ok:false. */
export async function callServiceWorker<T = unknown>(request: ParietRequest | string): Promise<T> {
  const response = (await chrome.runtime.sendMessage(
    typeof request === 'string' ? { type: request } : request
  )) as ParietResponse | undefined;
  if (!response) {
    throw new Error('No response from the Pariet background service');
  }
  if (!response.ok) {
    throw new Error(response.error);
  }
  return response.data as T;
}

export type {
  SessionSummary, MindMap, PageVisitView, SearchQueryView, ResumePoint, TimelineEntry
};
