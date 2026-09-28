import { 
  Session, 
  PageVisit, 
  SearchQuery, 
  TimelineEntry, 
  MindMapData, 
  ResearchGraphData, 
  ResearchSearchData,
  ResumePoint
} from '../types';
import { researchStore } from './researchStore';
import { sanitizeSessions } from './sanitize';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export const apiClient = {
  getSessions: async (): Promise<Session[]> => {
    try {
      return sanitizeSessions(await fetchJson<Session[]>('/api/sessions'));
    } catch {
      return sanitizeSessions(researchStore.getSessions());
    }
  },

  getSession: async (id: string): Promise<Session> => {
    try {
      return await fetchJson<Session>(`/api/sessions/${id}`);
    } catch {
      const session = researchStore.getSession(id);
      if (!session) throw new Error(`Session ${id} not found`);
      return session;
    }
  },

  createSession: async (title?: string, description?: string, tags: string[] = []): Promise<Session> => {
    try {
      return await fetchJson<Session>('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, tags })
      });
    } catch {
      return researchStore.createSession(title, description, tags);
    }
  },

  updateSession: async (id: string, data: Partial<Session>): Promise<Session> => {
    try {
      return await fetchJson<Session>(`/api/sessions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
    } catch {
      return researchStore.updateSession(id, data);
    }
  },

  deleteSession: async (id: string): Promise<void> => {
    let response: Response;
    try {
      response = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
    } catch {
      // Backend unreachable - fall back to the local mirror.
      researchStore.deleteSession(id);
      return;
    }
    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }
    researchStore.deleteSession(id);
  },

  /**
   * Erase all browsing data from the backend database and the browser's
   * localStorage mirror. Irreversible.
   */
  deleteAllData: async (): Promise<void> => {
    let response: Response;
    try {
      response = await fetch('/api/sessions/all', { method: 'DELETE' });
    } catch {
      // Backend unreachable: clear the local mirror so nothing persists here.
      researchStore.clearAll();
      return;
    }
    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }
    researchStore.clearAll();
  },

  getDataRetention: async (): Promise<{ eventDays: number; sessionDays: number; pruneHourUtc: string }> => {
    return fetchJson<{ eventDays: number; sessionDays: number; pruneHourUtc: string }>('/api/sessions/data-retention');
  },

  getTimeline: async (id: string): Promise<TimelineEntry[]> => {
    try {
      return await fetchJson<TimelineEntry[]>(`/api/sessions/${id}/timeline`);
    } catch {
      return researchStore.getTimeline(id);
    }
  },

  getPages: async (id: string): Promise<PageVisit[]> => {
    try {
      return await fetchJson<PageVisit[]>(`/api/sessions/${id}/pages`);
    } catch {
      return researchStore.getPages(id);
    }
  },

  getSearches: async (id: string): Promise<SearchQuery[]> => {
    try {
      return await fetchJson<SearchQuery[]>(`/api/sessions/${id}/searches`);
    } catch {
      return researchStore.getSearches(id);
    }
  },

  getResumePoint: async (id: string): Promise<ResumePoint> => {
    try {
      return await fetchJson<ResumePoint>(`/api/sessions/${id}/resume-point`);
    } catch {
      return researchStore.getResumePoint(id);
    }
  },

  getMindMap: async (id: string): Promise<MindMapData> => {
    try {
      return await fetchJson<MindMapData>(`/api/sessions/${id}/mindmap`);
    } catch {
      return researchStore.getMindMap(id);
    }
  },

  getResearchGraph: async (id: string): Promise<ResearchGraphData> => {
    try {
      return await fetchJson<ResearchGraphData>(`/api/sessions/${id}/research-graph`);
    } catch {
      return researchStore.getResearchGraph(id);
    }
  },

  searchResearch: async (query: string): Promise<ResearchSearchData> => {
    try {
      return await fetchJson<ResearchSearchData>(`/api/research/search?q=${encodeURIComponent(query)}`);
    } catch {
      return researchStore.searchAcrossResearch(query);
    }
  },

  executeDeepResearch: async (
    sessionId: string, 
    query: string, 
    onProgress?: (step: number, message: string) => void
  ) => {
    return researchStore.executeDeepResearch(sessionId, query, onProgress);
  }
};
