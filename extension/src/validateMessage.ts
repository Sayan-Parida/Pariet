import type { ParietRequest } from './messages';

export function isTrustedMessage(message: unknown, sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id) return false;
  if (![chrome.runtime.getURL('popup.html'), chrome.runtime.getURL('dashboard/index.html')].includes((sender.url ?? '').split(/[?#]/)[0])) return false;
  if (!message || typeof message !== 'object') return false;
  const value = message as Record<string, unknown>;
  const shortString = (s: unknown) => typeof s === 'string' && s.length > 0 && s.length <= 512;
  switch (value.type) {
    case 'GET_STATE': case 'END_SESSION': case 'CLEAR_SESSION_STATE':
    case 'LIST_SESSIONS': case 'DELETE_ALL_DATA': case 'GET_EXTENSION_STATUS':
      return true;
    case 'START_SESSION':
      return value.title == null || (typeof value.title === 'string' && value.title.length <= 512);
    case 'GET_MINDMAP': case 'GET_PAGES': case 'GET_SEARCHES': case 'GET_TIMELINE':
    case 'GET_RESUME_POINT': case 'DELETE_SESSION': case 'GET_POSITIONS':
      return shortString(value.sessionId);
    case 'SAVE_POSITIONS': {
      if (!shortString(value.sessionId) || !value.positions || typeof value.positions !== 'object' || Array.isArray(value.positions)) return false;
      const entries = Object.entries(value.positions);
      return entries.length <= 10000 && entries.every(([id, point]) =>
        shortString(id) && point && typeof point === 'object' &&
        typeof point.x === 'number' && Number.isFinite(point.x) &&
        typeof point.y === 'number' && Number.isFinite(point.y));
    }
    case 'RESTORE_TABS': {
      const request = value as unknown as Extract<ParietRequest, { type: 'RESTORE_TABS' }>;
      const http = (url: unknown) => {
        if (typeof url !== 'string' || url.length > 32768) return false;
        try { return ['http:', 'https:'].includes(new URL(url).protocol); } catch { return false; }
      };
      return Array.isArray(request.urls) && request.urls.length <= 100 && request.urls.every(http)
        && (request.focusUrl === null || http(request.focusUrl));
    }
    default: return false;
  }
}
