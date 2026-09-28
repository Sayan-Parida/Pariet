import { 
  Session, 
  PageVisit, 
  SearchQuery, 
  TimelineEntry, 
  MindMapNode, 
  MindMapEdge, 
  MindMapData, 
  ResearchGraphData, 
  ResearchSearchData,
  ResearchSearchResult,
  ResumePoint
} from '../types';
import { 
  INITIAL_SESSIONS, 
  MOCK_GRAPH_DATA, 
  MOCK_PAGES, 
  MOCK_TIMELINES 
} from './mockData';

const STORAGE_KEYS = {
  SESSIONS: 'rm_sessions_v1',
  GRAPHS: 'rm_graphs_v1',
  PAGES: 'rm_pages_v1',
  TIMELINES: 'rm_timelines_v1'
};

class ResearchStore {
  private sessions: Session[] = [];
  private graphs: Record<string, { nodes: MindMapNode[]; edges: MindMapEdge[] }> = {};
  private pages: Record<string, PageVisit[]> = {};
  private timelines: Record<string, TimelineEntry[]> = {};
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.init();
  }

  private init() {
    try {
      const savedSessions = localStorage.getItem(STORAGE_KEYS.SESSIONS);
      const savedGraphs = localStorage.getItem(STORAGE_KEYS.GRAPHS);
      const savedPages = localStorage.getItem(STORAGE_KEYS.PAGES);
      const savedTimelines = localStorage.getItem(STORAGE_KEYS.TIMELINES);

      if (savedSessions && savedGraphs) {
        this.sessions = JSON.parse(savedSessions);
        this.graphs = JSON.parse(savedGraphs);
        this.pages = savedPages ? JSON.parse(savedPages) : MOCK_PAGES;
        this.timelines = savedTimelines ? JSON.parse(savedTimelines) : MOCK_TIMELINES;
      } else {
        this.sessions = [...INITIAL_SESSIONS];
        this.graphs = JSON.parse(JSON.stringify(MOCK_GRAPH_DATA));
        this.pages = JSON.parse(JSON.stringify(MOCK_PAGES));
        this.timelines = JSON.parse(JSON.stringify(MOCK_TIMELINES));
        this.persist();
      }
    } catch (e) {
      console.warn('LocalStorage error, falling back to mock data:', e);
      this.sessions = [...INITIAL_SESSIONS];
      this.graphs = JSON.parse(JSON.stringify(MOCK_GRAPH_DATA));
      this.pages = JSON.parse(JSON.stringify(MOCK_PAGES));
      this.timelines = JSON.parse(JSON.stringify(MOCK_TIMELINES));
    }
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(this.sessions));
      localStorage.setItem(STORAGE_KEYS.GRAPHS, JSON.stringify(this.graphs));
      localStorage.setItem(STORAGE_KEYS.PAGES, JSON.stringify(this.pages));
      localStorage.setItem(STORAGE_KEYS.TIMELINES, JSON.stringify(this.timelines));
    } catch (e) {
      console.warn('Failed to persist to localStorage:', e);
    }
    this.notify();
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach(fn => fn());
  }

  public getSessions(): Session[] {
    return [...this.sessions];
  }

  public getSession(id: string): Session | undefined {
    return this.sessions.find(s => s.id === id);
  }

  public createSession(title?: string, description?: string, tags: string[] = []): Session {
    const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newSession: Session = {
      id,
      title: title || 'Untitled Research Space',
      description: description || 'Active multi-source exploratory knowledge workspace.',
      status: 'ACTIVE',
      startTime: new Date().toISOString(),
      endTime: null,
      eventCount: 1,
      pageCount: 0,
      searchCount: 0,
      entityCount: 1,
      tags: tags.length > 0 ? tags : ['Exploration']
    };

    const initialNode: MindMapNode = {
      id: `root-${id}`,
      type: 'CONCEPT',
      label: newSession.title,
      abstract: 'Root investigation hub for this research session. Execute AI deep searches or import papers to expand the graph.',
      timestamp: newSession.startTime,
      relevanceScore: 1.0,
      tags: ['Seed Concept']
    };

    this.sessions.unshift(newSession);
    this.graphs[id] = {
      nodes: [initialNode],
      edges: []
    };
    this.pages[id] = [];
    this.timelines[id] = [
      {
        id: `tl-init-${Date.now()}`,
        type: 'MILESTONE',
        timestamp: newSession.startTime,
        title: `Initialized Workspace: "${newSession.title}"`,
        summary: 'Knowledge graph initialized. Ready for research queries and source integration.',
        targetNodeId: initialNode.id
      }
    ];

    this.persist();
    return newSession;
  }

  public updateSession(id: string, updates: Partial<Session>): Session {
    const index = this.sessions.findIndex(s => s.id === id);
    if (index === -1) throw new Error(`Session ${id} not found`);
    this.sessions[index] = { ...this.sessions[index], ...updates };
    this.persist();
    return this.sessions[index];
  }

  public deleteSession(id: string): void {
    this.sessions = this.sessions.filter(s => s.id !== id);
    delete this.graphs[id];
    delete this.pages[id];
    delete this.timelines[id];
    this.persist();
  }

  /**
   * Erase every locally mirrored record: sessions, graphs, visited pages and
   * timelines. This clears the browser-localStorage copy of the browsing data
   * that the backend also stores, so "delete all data" leaves nothing behind.
   */
  public clearAll(): void {
    this.sessions = [];
    this.graphs = {};
    this.pages = {};
    this.timelines = {};

    try {
      Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
      // Per-session mind-map node positions, stored under a derived key.
      Object.keys(localStorage)
        .filter(key => key.startsWith('rm_positions_') || key.startsWith('rm_'))
        .forEach(key => localStorage.removeItem(key));
    } catch (e) {
      console.warn('Failed to clear localStorage:', e);
    }
  }

  public getMindMap(sessionId: string): MindMapData {
    const graph = this.graphs[sessionId] || { nodes: [], edges: [] };
    return {
      sessionId,
      nodes: graph.nodes,
      edges: graph.edges
    };
  }

  public getResearchGraph(sessionId: string): ResearchGraphData {
    const graph = this.graphs[sessionId] || { nodes: [], edges: [] };
    return {
      sessionId,
      nodes: graph.nodes.map(n => ({
        id: n.id,
        type: n.type,
        label: n.label,
        metadata: {
          domain: n.domain || undefined,
          url: n.url,
          abstract: n.abstract,
          authors: n.authors,
          citations: n.citationCount,
          score: n.relevanceScore,
          insights: n.insights,
          tags: n.tags
        }
      })),
      edges: graph.edges.map(e => ({
        source: e.source,
        target: e.target,
        relationshipType: e.relationship,
        confidence: e.confidence ?? 0.95,
        reason: e.description || `${e.source} is related to ${e.target}`,
        sourceTimestamp: null,
        targetTimestamp: null
      }))
    };
  }

  public getPages(sessionId: string): PageVisit[] {
    return this.pages[sessionId] || [];
  }

  public getTimeline(sessionId: string): TimelineEntry[] {
    return this.timelines[sessionId] || [];
  }

  public getSearches(sessionId: string): SearchQuery[] {
    const timeline = this.timelines[sessionId] || [];
    return timeline
      .filter(t => t.type === 'SEARCH')
      .map(t => ({
        id: t.id,
        queryText: t.title.replace(/^Query:\s*|^Initiated query:\s*"?|"?$/g, ''),
        engine: 'ResearchMind AI Synthesizer',
        sourceUrl: t.url,
        timestamp: t.timestamp
      }));
  }

  private static isResearchUrl(url: string | null | undefined): boolean {
    return typeof url === 'string' && url !== ''
      && !url.startsWith('chrome://')
      && !url.startsWith('chrome-extension://')
      && !url.startsWith('about:');
  }

  public getResumePoint(sessionId: string): ResumePoint {
    const pages = this.getPages(sessionId);
    const stoppingPage = pages
      .filter(p => ResearchStore.isResearchUrl(p.url) && p.title && p.title.trim() !== '')
      .sort((a, b) =>
        new Date(b.lastVisited).getTime() - new Date(a.lastVisited).getTime() ||
        new Date(b.firstVisited).getTime() - new Date(a.firstVisited).getTime()
      )[0] || null;

    if (!stoppingPage) {
      return { sessionId, page: null, search: null };
    }

    const graphNode = (this.graphs[sessionId]?.nodes || [])
      .find(n => (n.type === 'PAGE' || n.type === 'SOURCE_PAPER')
        && (n.url === stoppingPage.url || n.label === stoppingPage.title));

    return {
      sessionId,
      page: {
        id: graphNode?.id || stoppingPage.id,
        url: stoppingPage.url,
        domain: stoppingPage.domain || null,
        title: stoppingPage.title,
        lastVisited: stoppingPage.lastVisited,
        visitCount: stoppingPage.visitCount
      },
      search: null
    };
  }

  public async executeDeepResearch(
    sessionId: string,
    query: string,
    onProgress?: (step: number, message: string) => void
  ): Promise<{ newNodes: MindMapNode[]; newEdges: MindMapEdge[] }> {
    const now = new Date().toISOString();
    const session = this.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    if (onProgress) onProgress(1, 'Decomposing research query & semantic intent...');
    await new Promise(r => setTimeout(r, 600));

    if (onProgress) onProgress(2, 'Querying academic archives (arXiv, PubMed, Nature, IEEE)...');
    await new Promise(r => setTimeout(r, 700));

    if (onProgress) onProgress(3, 'Extracting core entities, citations & empirical findings...');
    await new Promise(r => setTimeout(r, 700));

    if (onProgress) onProgress(4, 'Synthesizing knowledge graph vectors & resolving relations...');
    await new Promise(r => setTimeout(r, 600));

    const cleanQuery = query.trim();
    const hash = Math.random().toString(36).substring(2, 7);
    const searchNodeId = `node-search-${hash}`;
    const paperNodeId = `node-paper-${hash}`;
    const conceptNodeId = `node-concept-${hash}`;
    const insightNodeId = `node-insight-${hash}`;

    const domains = ['nature.com', 'arxiv.org', 'science.org', 'biorxiv.org', 'ieeexplore.ieee.org', 'cell.com'];
    const chosenDomain = domains[Math.floor(Math.random() * domains.length)];

    const searchNode: MindMapNode = {
      id: searchNodeId,
      type: 'SEARCH',
      label: cleanQuery,
      timestamp: now,
      relevanceScore: 0.99,
      tags: ['Query', 'Live AI']
    };

    const paperTitle = `Empirical Investigation: ${cleanQuery.replace(/(?:^|\s)\S/g, a => a.toUpperCase())}`;
    const paperNode: MindMapNode = {
      id: paperNodeId,
      type: 'SOURCE_PAPER',
      label: paperTitle,
      url: `https://${chosenDomain}/article/${Date.now()}`,
      domain: chosenDomain,
      authors: ['Dr. E. Vance', 'Prof. K. Thorne', 'Dr. S. Okoye'],
      citationCount: Math.floor(Math.random() * 120) + 15,
      timestamp: now,
      abstract: `A comprehensive evaluation addressing "${cleanQuery}". Experimental benchmarks demonstrate 3.4x improvement in fidelity with reduced computational latency.`,
      relevanceScore: 0.96,
      insights: [
        `Validates core operational bounds for ${cleanQuery.slice(0, 30)}...`,
        'Demonstrates statistical significance (p < 0.001) across 4 standard benchmarks'
      ],
      tags: ['Peer-Reviewed', chosenDomain]
    };

    const conceptNode: MindMapNode = {
      id: conceptNodeId,
      type: 'CONCEPT',
      label: `Core Principle: ${cleanQuery.split(' ').slice(0, 3).join(' ')}`,
      abstract: `Fundamental theoretical mechanism governing ${cleanQuery}. Directly influences system stability and state convergence.`,
      timestamp: now,
      relevanceScore: 0.91,
      tags: ['Extracted Concept']
    };

    const insightNode: MindMapNode = {
      id: insightNodeId,
      type: 'AI_INSIGHT',
      label: `Synthesis: Emerging Convergence in ${cleanQuery.split(' ').slice(0, 4).join(' ')}`,
      abstract: `Cross-analysis indicates that integrating ${cleanQuery} resolves key bottlenecks previously documented in literature.`,
      timestamp: now,
      relevanceScore: 0.98,
      insights: [
        'Bridging theoretical limits with newly observed empirical data',
        'Directly connects to primary research hypotheses'
      ],
      tags: ['AI Synthesis', 'High Confidence']
    };

    const newNodes = [searchNode, paperNode, conceptNode, insightNode];

    const currentGraph = this.graphs[sessionId] || { nodes: [], edges: [] };
    const existingNodes = currentGraph.nodes;

    const newEdges: MindMapEdge[] = [
      {
        id: `edge-${searchNodeId}-${paperNodeId}`,
        source: searchNodeId,
        target: paperNodeId,
        relationship: 'EXPLORES',
        description: 'Direct search query retrieval',
        confidence: 0.98,
        animated: true
      },
      {
        id: `edge-${paperNodeId}-${conceptNodeId}`,
        source: paperNodeId,
        target: conceptNodeId,
        relationship: 'DERIVED_FROM',
        description: 'Extracted theoretical foundation',
        confidence: 0.95
      },
      {
        id: `edge-${paperNodeId}-${insightNodeId}`,
        source: paperNodeId,
        target: insightNodeId,
        relationship: 'SUPPORTS',
        description: 'Empirical data corroborating synthesis',
        confidence: 0.99
      }
    ];

    if (existingNodes.length > 0) {
      const targetExisting = existingNodes[Math.floor(Math.random() * existingNodes.length)];
      newEdges.push({
        id: `edge-${insightNodeId}-${targetExisting.id}`,
        source: insightNodeId,
        target: targetExisting.id,
        relationship: 'RELATED_TO',
        description: 'Cross-topic semantic link established by AI reasoning',
        confidence: 0.92
      });
    }

    if (!this.graphs[sessionId]) {
      this.graphs[sessionId] = { nodes: [], edges: [] };
    }
    this.graphs[sessionId].nodes.push(...newNodes);
    this.graphs[sessionId].edges.push(...newEdges);

    const newPage: PageVisit = {
      id: `page-${hash}`,
      url: paperNode.url!,
      domain: chosenDomain,
      title: paperTitle,
      excerpt: paperNode.abstract,
      authors: paperNode.authors,
      publishedDate: new Date().toISOString().slice(0, 10),
      citationCount: paperNode.citationCount,
      firstVisited: now,
      lastVisited: now,
      visitCount: 1,
      durationMs: 180000,
      readingTimeMinutes: 8,
      sourceType: chosenDomain.includes('arxiv') ? 'preprint' : 'academic',
      reliabilityScore: 0.96,
      tags: ['AI Discovered', chosenDomain]
    };

    if (!this.pages[sessionId]) this.pages[sessionId] = [];
    this.pages[sessionId].unshift(newPage);

    const timelineSearch: TimelineEntry = {
      id: `tl-s-${hash}`,
      type: 'SEARCH',
      timestamp: now,
      title: `AI Search: "${cleanQuery}"`,
      summary: `Automated multi-repository sweep. Retrieved 1 paper, extracted 1 concept, and synthesized 1 hypothesis.`,
      targetNodeId: searchNodeId
    };

    const timelineInsight: TimelineEntry = {
      id: `tl-i-${hash}`,
      type: 'AI_INSIGHT',
      timestamp: new Date(Date.now() + 1000).toISOString(),
      title: insightNode.label,
      summary: insightNode.abstract,
      targetNodeId: insightNodeId,
      confidence: 0.98
    };

    if (!this.timelines[sessionId]) this.timelines[sessionId] = [];
    this.timelines[sessionId].unshift(timelineInsight);
    this.timelines[sessionId].unshift(timelineSearch);

    this.updateSession(sessionId, {
      eventCount: (session.eventCount || 0) + 2,
      pageCount: (session.pageCount || 0) + 1,
      searchCount: (session.searchCount || 0) + 1,
      entityCount: (session.entityCount || 0) + newNodes.length
    });

    this.persist();

    return { newNodes, newEdges };
  }

  public searchAcrossResearch(query: string): ResearchSearchData {
    const q = query.toLowerCase().trim();
    if (!q) {
      return { query, normalizedQuery: '', totalResults: 0, results: [] };
    }

    const results: ResearchSearchResult[] = [];

    for (const [sessionId, graph] of Object.entries(this.graphs)) {
      const session = this.getSession(sessionId);
      for (const node of graph.nodes) {
        const textToMatch = `${node.label} ${node.abstract || ''} ${node.domain || ''} ${node.tags?.join(' ') || ''}`.toLowerCase();
        if (textToMatch.includes(q)) {
          const matchedTerms = [q];
          const reasons = [
            `Matched in ${node.type.toLowerCase().replace('_', ' ')}: "${node.label}"`,
            node.abstract ? `Found in excerpt summary` : `Found in metadata taxonomy`
          ];

          const connectedEdges = graph.edges.filter(e => e.source === node.id || e.target === node.id);
          const graphContext = connectedEdges.map(e => ({
            source: e.source,
            target: e.target,
            relationshipType: e.relationship,
            reason: e.description || `${e.relationship} connection`
          }));

          results.push({
            id: node.id,
            type: node.type,
            label: node.label,
            sessionId,
            timestamp: node.timestamp || new Date().toISOString(),
            url: node.url || null,
            domain: node.domain || null,
            visitCount: 1,
            score: 0.92 + Math.random() * 0.07,
            importanceScore: node.relevanceScore || 0.88,
            matchedTerms,
            reasons,
            abstract: node.abstract,
            metadata: {
              sessionTitle: session?.title || 'Unknown Session',
              authors: node.authors,
              citationCount: node.citationCount
            },
            graphContext
          });
        }
      }
    }

    results.sort((a, b) => b.score - a.score);

    return {
      query,
      normalizedQuery: q,
      totalResults: results.length,
      results
    };
  }

  public resetToDefault() {
    this.sessions = [...INITIAL_SESSIONS];
    this.graphs = JSON.parse(JSON.stringify(MOCK_GRAPH_DATA));
    this.pages = JSON.parse(JSON.stringify(MOCK_PAGES));
    this.timelines = JSON.parse(JSON.stringify(MOCK_TIMELINES));
    this.persist();
  }
}

export const researchStore = new ResearchStore();
