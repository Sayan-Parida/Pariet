import { MindMapNode, MindMapEdge, NodeType, RelationshipType } from '../types';

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
  relationship: 'SESSION_TO_SEARCH' | 'SEARCH_TO_SOURCE' | 'SOURCE_TO_SOURCE';
}

export interface ProjectedGraph {
  nodes: ProjectedNode[];
  edges: ProjectedEdge[];
}

const SOURCE_TYPES: NodeType[] = ['PAGE', 'SOURCE_PAPER'];
const NAVIGATION_RELATIONSHIPS: RelationshipType[] = ['PAGE_TO_PAGE', 'NAVIGATED_FROM'];

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

function isSearchEngineResultsPage(node: MindMapNode): boolean {
  if (!node.url) return false;
  try {
    const url = new URL(node.url);
    const hostname = url.hostname.toLowerCase();
    if (!SEARCH_ENGINE_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d))) {
      return false;
    }
    const path = url.pathname.toLowerCase();
    return path.includes('/search') || 
           path.includes('/results') ||
           url.searchParams.has('q') ||
           url.searchParams.has('search_query') ||
           url.searchParams.has('p');
  } catch {
    return false;
  }
}

function isSourceType(type: NodeType): boolean {
  return SOURCE_TYPES.includes(type);
}

function isSearchType(type: NodeType): boolean {
  return type === 'SEARCH';
}

function isSessionType(type: NodeType): boolean {
  return type === 'SESSION';
}

function getStoppingPointId(nodes: MindMapNode[]): string | null {
  const sourceNodes = nodes.filter(n => isSourceType(n.type) && !isSearchEngineResultsPage(n));
  if (sourceNodes.length === 0) return null;

  const withTimestamp = sourceNodes
    .map(n => ({ node: n, time: n.timestamp ? new Date(n.timestamp).getTime() : 0 }))
    .filter(x => x.time > 0)
    .sort((a, b) => b.time - a.time);

  return withTimestamp[0]?.node.id ?? null;
}

function buildSearchToSourceMap(
  rawNodes: MindMapNode[],
  rawEdges: MindMapEdge[]
): Map<string, Set<string>> {
  const searchToSources = new Map<string, Set<string>>();

  for (const edge of rawEdges) {
    const sourceNode = rawNodes.find(n => n.id === edge.source);
    const targetNode = rawNodes.find(n => n.id === edge.target);
    if (!sourceNode || !targetNode) continue;

    if (isSearchType(sourceNode.type) && isSourceType(targetNode.type) && !isSearchEngineResultsPage(targetNode)) {
      if (!searchToSources.has(sourceNode.id)) {
        searchToSources.set(sourceNode.id, new Set());
      }
      searchToSources.get(sourceNode.id)!.add(targetNode.id);
    }
  }

  return searchToSources;
}

function buildSourceToSourceMap(rawEdges: MindMapEdge[], validSourceIds: Set<string>): Map<string, Set<string>> {
  const sourceToSource = new Map<string, Set<string>>();

  for (const edge of rawEdges) {
    const rel = edge.relationship as RelationshipType;
    if (NAVIGATION_RELATIONSHIPS.includes(rel)) {
      if (!validSourceIds.has(edge.source) || !validSourceIds.has(edge.target)) {
        continue;
      }
      if (!sourceToSource.has(edge.source)) {
        sourceToSource.set(edge.source, new Set());
      }
      sourceToSource.get(edge.source)!.add(edge.target);
    }
  }

  return sourceToSource;
}

function findSessionNode(rawNodes: MindMapNode[]): MindMapNode | null {
  return rawNodes.find(n => isSessionType(n.type)) ?? null;
}

function findSearchNodes(rawNodes: MindMapNode[]): MindMapNode[] {
  return rawNodes.filter(n => isSearchType(n.type));
}

function findSourceNodes(rawNodes: MindMapNode[]): MindMapNode[] {
  return rawNodes.filter(n => isSourceType(n.type) && !isSearchEngineResultsPage(n));
}

export function buildResearchMapProjection(
  rawNodes: MindMapNode[],
  rawEdges: MindMapEdge[]
): ProjectedGraph {
  const sessionNode = findSessionNode(rawNodes);
  const searchNodes = findSearchNodes(rawNodes);
  const sourceNodes = findSourceNodes(rawNodes);

  const stoppingPointId = getStoppingPointId(sourceNodes);
  const searchToSources = buildSearchToSourceMap(rawNodes, rawEdges);
  const validSourceIds = new Set(sourceNodes.map(n => n.id));
  const sourceToSource = buildSourceToSourceMap(rawEdges, validSourceIds);

  const projectedNodes: ProjectedNode[] = [];
  const projectedEdges: ProjectedEdge[] = [];
  const edgeIdSet = new Set<string>();

  if (sessionNode) {
    projectedNodes.push({
      id: sessionNode.id,
      type: 'SESSION',
      label: sessionNode.label,
      timestamp: sessionNode.timestamp,
      abstract: sessionNode.abstract
    });
  }

  for (const search of searchNodes) {
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
      visitCount: source.visitCount,
      isStoppingPoint: source.id === stoppingPointId
    });
  }

  if (sessionNode) {
    for (const search of searchNodes) {
      const edgeId = `session-to-search-${sessionNode.id}-${search.id}`;
      if (!edgeIdSet.has(edgeId)) {
        edgeIdSet.add(edgeId);
        projectedEdges.push({
          id: edgeId,
          source: sessionNode.id,
          target: search.id,
          relationship: 'SESSION_TO_SEARCH'
        });
      }
    }
  }

  for (const [searchId, sourceIds] of searchToSources) {
    for (const sourceId of sourceIds) {
      const edgeId = `search-to-source-${searchId}-${sourceId}`;
      if (!edgeIdSet.has(edgeId)) {
        edgeIdSet.add(edgeId);
        projectedEdges.push({
          id: edgeId,
          source: searchId,
          target: sourceId,
          relationship: 'SEARCH_TO_SOURCE'
        });
      }
    }
  }

  for (const [sourceId, targetIds] of sourceToSource) {
    for (const targetId of targetIds) {
      const edgeId = `source-to-source-${sourceId}-${targetId}`;
      if (!edgeIdSet.has(edgeId)) {
        edgeIdSet.add(edgeId);
        projectedEdges.push({
          id: edgeId,
          source: sourceId,
          target: targetId,
          relationship: 'SOURCE_TO_SOURCE'
        });
      }
    }
  }

  return { nodes: projectedNodes, edges: projectedEdges };
}

export function getNodeTypeForLayout(node: ProjectedNode): string {
  return node.type;
}

export function getEdgeRelationship(edge: ProjectedEdge): string {
  return edge.relationship;
}