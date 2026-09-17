import { forceSimulation, forceLink, forceManyBody, forceCollide, forceCenter } from 'd3-force';

export const LAYOUT_NODE_WIDTH = 250;
export const LAYOUT_NODE_HEIGHT = 100;
const LAYOUT_NODE_WIDTH_COMPACT = 205;

export interface ProjectedNode {
  id: string;
  type: 'SESSION' | 'SEARCH' | 'SOURCE';
  label: string;
}

export interface ProjectedEdge {
  id: string;
  source: string;
  target: string;
  relationship: 'SESSION_TO_SEARCH' | 'SEARCH_TO_SOURCE' | 'SOURCE_TO_SOURCE';
}

export interface NodeTypeMap {
  [nodeId: string]: string;
}

interface SimulationNode {
  id: string;
  type: 'SESSION' | 'SEARCH' | 'SOURCE';
  label: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  index?: number;
}

interface SimulationLink {
  source: string | SimulationNode;
  target: string | SimulationNode;
  relationship: 'SESSION_TO_SEARCH' | 'SEARCH_TO_SOURCE' | 'SOURCE_TO_SOURCE';
  strength: number;
}

function deterministicHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function deterministicRandom(seed: string): number {
  const x = Math.sin(deterministicHash(seed)) * 10000;
  return x - Math.floor(x);
}

function getInitialPosition(nodeId: string): { x: number; y: number } {
  const angle = (deterministicRandom(nodeId) * 2 - 1) * Math.PI;
  const radius = 200 + deterministicRandom(nodeId + 'r') * 300;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius
  };
}

function getLinkStrength(relationship: ProjectedEdge['relationship']): number {
  switch (relationship) {
    case 'SESSION_TO_SEARCH': return 0.7;
    case 'SEARCH_TO_SOURCE': return 0.5;
    case 'SOURCE_TO_SOURCE': return 0.25;
    default: return 0.35;
  }
}

function getNodeCharge(type: ProjectedNode['type']): number {
  switch (type) {
    case 'SESSION': return -600;
    case 'SEARCH': return -350;
    case 'SOURCE': return -120;
    default: return -180;
  }
}

function getCollisionRadius(type: ProjectedNode['type'], compact: boolean): number {
  const baseWidth = compact ? LAYOUT_NODE_WIDTH_COMPACT : LAYOUT_NODE_WIDTH;
  switch (type) {
    case 'SESSION': return baseWidth / 2 + 80;
    case 'SEARCH': return baseWidth / 2 + 40;
    case 'SOURCE': return baseWidth / 2 + 25;
    default: return baseWidth / 2 + 25;
  }
}

function runForceLayout(
  nodes: SimulationNode[],
  links: SimulationLink[],
  nodeMap: Map<string, SimulationNode>,
  isCompact: boolean,
  maxIterations: number
): Promise<Record<string, { x: number; y: number }>> {
  return new Promise((resolve) => {
    const simulation = forceSimulation<SimulationNode, SimulationLink>(nodes)
      .force('link', forceLink<SimulationNode, SimulationLink>(links)
        .id(d => d.id)
        .distance(d => {
          const sourceNode = nodeMap.get(typeof d.source === 'string' ? d.source : d.source.id);
          const targetNode = nodeMap.get(typeof d.target === 'string' ? d.target : d.target.id);
          const sourceRadius = sourceNode ? getCollisionRadius(sourceNode.type, isCompact) : 100;
          const targetRadius = targetNode ? getCollisionRadius(targetNode.type, isCompact) : 100;
          return sourceRadius + targetRadius + 35;
        })
        .strength(d => d.strength))
      .force('charge', forceManyBody<SimulationNode>()
        .strength(d => getNodeCharge(d.type))
        .distanceMax(500))
      .force('collide', forceCollide<SimulationNode>()
        .radius(d => getCollisionRadius(d.type, isCompact) + 15)
        .strength(0.9)
        .iterations(3))
      .force('center', forceCenter(0, 0).strength(0.03))
      .stop();

    let alpha = 1;
    const alphaDecay = 1 - Math.pow(0.001, 1 / maxIterations);

    function tick() {
      for (let i = 0; i < 8; i++) {
        simulation.alpha(alpha).tick();
        alpha *= alphaDecay;
        if (alpha < 0.001) {
          const positions: Record<string, { x: number; y: number }> = {};
          for (const node of nodes) {
            positions[node.id] = { x: Math.round(node.x), y: Math.round(node.y) };
          }
          resolve(positions);
          return;
        }
      }
      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  });
}

export async function layoutResearchGraph(
  nodeIds: string[],
  edges: ProjectedEdge[],
  _direction: 'LR' | 'TB' = 'LR',
  types?: NodeTypeMap,
  compact?: boolean
): Promise<Record<string, { x: number; y: number }>> {
  const typeMap = types ?? {};
  const ids = [...new Set(nodeIds)];
  const typeOf = (id: string) => typeMap[id] ?? '';
  const isCompact = compact ?? false;

  if (ids.length === 0) return {};

  const nodes: SimulationNode[] = ids.map((id) => {
    const initialPos = getInitialPosition(id);
    return {
      id,
      type: typeOf(id) as 'SESSION' | 'SEARCH' | 'SOURCE',
      label: '',
      x: initialPos.x,
      y: initialPos.y,
      vx: 0,
      vy: 0
    };
  });

  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  const links: SimulationLink[] = edges.map(e => ({
    source: e.source,
    target: e.target,
    relationship: e.relationship,
    strength: getLinkStrength(e.relationship)
  }));

  const maxIterations = Math.min(300, 50 + nodes.length * 3);

  return runForceLayout(nodes, links, nodeMap, isCompact, maxIterations);
}