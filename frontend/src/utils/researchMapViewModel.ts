import { MindMapNode, MindMapEdge, NodeType } from '../types';

export interface ProjectedNode {
  id: string;
  type: 'SESSION' | 'SEARCH' | 'SOURCE';
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
  relationship: 'SEARCH_TO_SOURCE' | 'SOURCE_TO_SOURCE' | 'SEARCH_TO_SEARCH';
}

export interface ProjectedGraph {
  nodes: ProjectedNode[];
  edges: ProjectedEdge[];
}

const SOURCE_TYPES: NodeType[] = ['PAGE', 'SOURCE_PAPER'];
const NAVIGATION_RELATIONSHIPS = ['PAGE_TO_PAGE', 'NAVIGATED_FROM'];

const SEARCH_ENGINE_DOMAINS = [
  'google.com',
  'www.google.com',
  'bing.com',
  'www.bing.com',
  'duckduckgo.com',
  'www.duckduckgo.com',
  'youtube.com',
  'www.youtube.com',
  'search.yahoo.com',
  'www.search.yahoo.com',
];

const BROWSER_NOISE_PREFIXES = [
  'chrome://',
  'chrome-extension://',
  'about:',
  'edge://',
  'brave://',
];

function isBrowserNoise(url: string | undefined): boolean {
  if (!url) return true;
  const lower = url.toLowerCase();
  if (BROWSER_NOISE_PREFIXES.some(p => lower.startsWith(p))) return true;
  if (lower === 'blank' || lower === 'about:blank') return true;
  return false;
}

function isSearchEngineResultsPage(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (!SEARCH_ENGINE_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d))) {
      return false;
    }
    const path = parsed.pathname.toLowerCase();
    return path.includes('/search') ||
           path.includes('/results') ||
           parsed.searchParams.has('q') ||
           parsed.searchParams.has('search_query') ||
           parsed.searchParams.has('p');
  } catch {
    return false;
  }
}

function shouldIncludeSource(node: MindMapNode): boolean {
  if (!SOURCE_TYPES.includes(node.type)) return false;
  if (isBrowserNoise(node.url)) return false;
  if (isSearchEngineResultsPage(node.url)) return false;
  return true;
}

function getStoppingPointId(nodes: ProjectedNode[]): string | null {
  const sources = nodes.filter(n => n.type === 'SOURCE');
  if (sources.length === 0) return null;

  const withTimestamp = sources
    .map(n => ({ id: n.id, time: n.timestamp ? new Date(n.timestamp).getTime() : 0 }))
    .filter(x => x.time > 0)
    .sort((a, b) => b.time - a.time);

  return withTimestamp[0]?.id ?? null;
}

function normalizedSearchLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function buildResearchMapProjection(
  rawNodes: MindMapNode[],
  rawEdges: MindMapEdge[]
): ProjectedGraph {
  const sessionNode = rawNodes.find(n => n.type === 'SESSION') ?? null;
  const searchNodes = rawNodes.filter(n => n.type === 'SEARCH');
  const sourceNodes = rawNodes.filter(n => shouldIncludeSource(n));

  const validSourceIds = new Set(sourceNodes.map(n => n.id));
  const searchesByLabel = new Map<string, MindMapNode[]>();
  for (const search of searchNodes) {
    const key = normalizedSearchLabel(search.label);
    const group = searchesByLabel.get(key) ?? [];
    group.push(search);
    searchesByLabel.set(key, group);
  }
  const canonicalSearchId = new Map<string, string>();
  const visibleSearches: MindMapNode[] = [];
  for (const group of searchesByLabel.values()) {
    const canonical = [...group].sort((a, b) => a.id.localeCompare(b.id))[0];
    visibleSearches.push(canonical);
    for (const search of group) canonicalSearchId.set(search.id, canonical.id);
  }
  const validSearchIds = new Set(visibleSearches.map(n => n.id));

  const projectedNodes: ProjectedNode[] = [];
  const projectedEdges: ProjectedEdge[] = [];
  const edgeIdSet = new Set<string>();

  const addEdge = (source: string, target: string, relationship: ProjectedEdge['relationship']) => {
    const id = `${relationship}:${source}->${target}`;
    if (edgeIdSet.has(id)) return;
    if (relationship === 'SEARCH_TO_SEARCH') {
      if (!validSearchIds.has(source) || !validSearchIds.has(target)) return;
      if (source === target) return;
      edgeIdSet.add(id);
      projectedEdges.push({ id, source, target, relationship });
      return;
    }
    if (!validSearchIds.has(source) && relationship === 'SEARCH_TO_SOURCE') return;
    if (!validSourceIds.has(target) && relationship === 'SEARCH_TO_SOURCE') return;
    if (!validSourceIds.has(source) && !validSearchIds.has(source)) return;
    if (!validSourceIds.has(target)) return;
    edgeIdSet.add(id);
    projectedEdges.push({ id, source, target, relationship });
  };

  if (sessionNode) {
    projectedNodes.push({
      id: sessionNode.id,
      type: 'SESSION',
      label: sessionNode.label,
      timestamp: sessionNode.timestamp,
      abstract: sessionNode.abstract
    });
  }

  for (const search of visibleSearches) {
    projectedNodes.push({
      id: search.id,
      type: 'SEARCH',
      label: search.label,
      timestamp: search.timestamp,
      abstract: search.abstract
    });
  }

  for (const source of sourceNodes) {
    projectedNodes.push({
      id: source.id,
      type: 'SOURCE',
      label: source.label,
      url: source.url,
      domain: source.domain ?? undefined,
      timestamp: source.timestamp,
      abstract: source.abstract,
      authors: source.authors,
      citationCount: source.citationCount,
      visitCount: source.visitCount
    });
  }

  for (const edge of rawEdges) {
    const rel = edge.relationship;

    if (rel === 'RESULTS_IN') {
      const canonicalSource = canonicalSearchId.get(edge.source);
      if (canonicalSource) addEdge(canonicalSource, edge.target, 'SEARCH_TO_SOURCE');
    }

    if (NAVIGATION_RELATIONSHIPS.includes(rel)) {
      if (validSourceIds.has(edge.source) && validSourceIds.has(edge.target)) {
        addEdge(edge.source, edge.target, 'SOURCE_TO_SOURCE');
      }
    }

    if (rel === 'SEARCH_TO_SEARCH') {
      const canonicalSource = canonicalSearchId.get(edge.source);
      const canonicalTarget = canonicalSearchId.get(edge.target);
      if (canonicalSource && canonicalTarget) {
        addEdge(canonicalSource, canonicalTarget, 'SEARCH_TO_SEARCH');
      }
    }

  }

  const stoppingPointId = getStoppingPointId(projectedNodes);
  if (stoppingPointId) {
    const node = projectedNodes.find(n => n.id === stoppingPointId);
    if (node) node.isStoppingPoint = true;
  }

  const connectedIds = new Set<string>();
  for (const e of projectedEdges) {
    connectedIds.add(e.source);
    connectedIds.add(e.target);
  }

  return {
    nodes: projectedNodes.filter(n => n.type === 'SESSION' || connectedIds.has(n.id)),
    edges: projectedEdges
  };
}
