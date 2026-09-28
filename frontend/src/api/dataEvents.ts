/**
 * Change notifications for the dashboard.
 *
 * The research data itself lives in the extension's IndexedDB store, read
 * through the service worker (see api/client.ts). This is only a signal that
 * something changed, so views know to re-read, plus the one-shot in-memory
 * cache used for node positions while a layout is in progress.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
const positions = new Map<string, Record<string, { x: number; y: number }>>();

export const dataEvents = {
  /** Subscribe to changes. Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Tell every subscriber that stored data changed. */
  notify(): void {
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        console.warn('Data change listener failed', error);
      }
    }
  },

  /** In-memory position cache, so a layout does not re-read on every render. */
  getCachedPositions(sessionId: string): Record<string, { x: number; y: number }> {
    return positions.get(sessionId) ?? {};
  },

  setCachedPositions(sessionId: string, value: Record<string, { x: number; y: number }>): void {
    positions.set(sessionId, value);
  },

  clearCache(): void {
    positions.clear();
  }
};
