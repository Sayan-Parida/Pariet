export type NodeType =
  | 'SESSION'
  | 'SEARCH'
  | 'PAGE'
  | 'SOURCE_PAPER'
  | 'CONCEPT'
  | 'DOMAIN'
  | 'AI_INSIGHT';

export type VisibleNodeType = 'SESSION' | 'SEARCH' | 'SOURCE';

export type RelationshipType = 
  | 'CITES' 
  | 'DERIVED_FROM' 
  | 'SUPPORTS' 
  | 'CONTRADICTS' 
  | 'EXPLORES' 
  | 'RELATED_TO' 
  | 'SEARCH_TO_PAGE'
  | 'PAGE_TO_PAGE'
  | 'NAVIGATED_FROM';

export type VisibleRelationshipType = 
  | 'SESSION_TO_SEARCH' 
  | 'SEARCH_TO_SOURCE' 
  | 'SOURCE_TO_SOURCE';

export type SessionStatus = 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';

export interface Session {
  id: string;
  title: string;
  description?: string;
  status: SessionStatus;
  startTime: string;
  endTime: string | null;
  eventCount: number;
  pageCount: number;
  searchCount: number;
  entityCount: number;
  tags?: string[];
}

export interface PageVisit {
  id: string;
  url: string;
  domain: string;
  title: string;
  excerpt?: string;
  authors?: string[];
  publishedDate?: string;
  citationCount?: number;
  firstVisited: string;
  lastVisited: string;
  visitCount: number;
  durationMs: number;
  readingTimeMinutes?: number;
  sourceType?: 'academic' | 'preprint' | 'documentation' | 'article' | 'patent';
  reliabilityScore?: number;
  tags?: string[];
}

export interface SearchQuery {
  id: string;
  queryText: string;
  engine: string;
  sourceUrl?: string;
  timestamp: string;
  intent?: 'exploratory' | 'factual' | 'comparative' | 'deep-synthesis';
  resultsFound?: number;
}

export interface TimelineEntry {
  id: string;
  type: 'SEARCH' | 'PAGE_VISIT' | 'AI_INSIGHT' | 'MILESTONE' | 'NOTE';
  timestamp: string;
  title: string;
  url?: string;
  domain?: string;
  summary?: string;
  targetNodeId?: string;
  details?: Record<string, unknown>;
  confidence?: number;
}

export interface MindMapNode {
  id: string;
  type: NodeType;
  label: string;
  url?: string;
  domain?: string | null;
  timestamp?: string;
  abstract?: string;
  authors?: string[];
  citationCount?: number;
  visitCount?: number;
  relevanceScore?: number;
  insights?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface MindMapEdge {
  id?: string;
  source: string;
  target: string;
  relationship: RelationshipType | VisibleRelationshipType;
  description?: string;
  confidence?: number;
  animated?: boolean;
}

export interface MindMapData {
  sessionId: string;
  nodes: MindMapNode[];
  edges: MindMapEdge[];
}

export interface ResearchGraphNode {
  id: string;
  type: NodeType;
  label: string;
  metadata: {
    domain?: string;
    url?: string;
    abstract?: string;
    authors?: string[];
    citations?: number;
    year?: number;
    score?: number;
    insights?: string[];
    [key: string]: unknown;
  };
}

export interface ResearchGraphEdge {
  source: string;
  target: string;
  relationshipType: RelationshipType | string;
  confidence: number;
  reason: string;
  sourceTimestamp: string | null;
  targetTimestamp: string | null;
  metadata?: Record<string, unknown>;
}

export interface ResearchGraphData {
  sessionId: string;
  nodes: ResearchGraphNode[];
  edges: ResearchGraphEdge[];
}

export interface ResearchSearchResult {
  id: string;
  type: NodeType | string;
  label: string;
  sessionId: string;
  timestamp: string;
  url: string | null;
  domain: string | null;
  visitCount: number;
  score: number;
  importanceScore: number;
  matchedTerms: string[];
  reasons: string[];
  abstract?: string;
  metadata: Record<string, unknown>;
  graphContext: Array<{
    source: string;
    target: string;
    relationshipType: string;
    reason: string;
  }>;
}

export interface ResearchSearchData {
  query: string;
  normalizedQuery: string;
  totalResults: number;
  results: ResearchSearchResult[];
}

export interface ResumePoint {
  sessionId: string;
  page: {
    id: string;
    url: string;
    domain: string | null;
    title: string;
    lastVisited: string;
    visitCount: number;
  } | null;
  search: {
    id: string;
    queryText: string;
    engine: string;
    timestamp: string;
  } | null;
}

export interface ResearchSynthesisStep {
  step: number;
  title: string;
  description: string;
  status: 'pending' | 'running' | 'completed';
}

export interface ProjectedNode {
  id: string;
  type: VisibleNodeType;
  label: string;
  url?: string;
  domain?: string;
  timestamp?: string;
  abstract?: string;
  authors?: string[];
  citationCount?: number;
  visitCount?: number;
  isStoppingPoint?: boolean;
}

export interface ProjectedEdge {
  id: string;
  source: string;
  target: string;
  relationship: VisibleRelationshipType;
}

export interface ProjectedGraph {
  nodes: ProjectedNode[];
  edges: ProjectedEdge[];
}