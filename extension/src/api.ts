import { BrowserEventRequest } from './types';

const BASE_URL = 'http://localhost:8080';

async function fetchWithTimeout(resource: RequestInfo, options: RequestInit = {}): Promise<Response> {
  const { timeout = 5000 } = options as any;
  
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(resource, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

export const api = {
  async sendEvent(event: BrowserEventRequest): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${BASE_URL}/api/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event)
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async sendBatch(events: BrowserEventRequest[]): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${BASE_URL}/api/events/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(events)
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${BASE_URL}/api/health`, { method: 'GET' });
      return res.ok;
    } catch {
      return false;
    }
  },

  async createSession(title?: string, windowId?: number | null): Promise<string | null> {
    try {
      const payload: { title?: string; windowId?: number } = {};
      if (title) payload.title = title;
      if (windowId != null) payload.windowId = windowId;
      const res = await fetchWithTimeout(`${BASE_URL}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const data = await res.json();
        return data.id || data.sessionId || null; // Assume returning the ID
      }
      return null;
    } catch {
      return null;
    }
  },

  async endSession(sessionId: string): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${BASE_URL}/api/sessions/${sessionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'COMPLETED' })
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async getSession(sessionId: string): Promise<{ id: string; title: string | null; status: string } | null> {
    try {
      const res = await fetchWithTimeout(`${BASE_URL}/api/sessions/${sessionId}`, { method: 'GET' });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },

  async listSessions(): Promise<Array<{ id: string; title: string | null; status: string }>> {
    try {
      const res = await fetchWithTimeout(`${BASE_URL}/api/sessions`, { method: 'GET' });
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  }
};
