export const LAYOUT_NODE_WIDTH = 250;
export const LAYOUT_NODE_HEIGHT = 100;

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  relationship: string;
}

export interface NodeTypeMap {
  [nodeId: string]: string;
}

const STEP_X = 340;
const STEP_Y = 176;
const WAVE_AMP_DEG = 16;
const WAVE_FREQ = 0.85;
const COLLISION_PADDING = 20;
const COLLISION_ITERATIONS = 80;
const SHELF_ROW_WIDTH = 2500;
const SHELF_GAP_X = 170;
const SHELF_GAP_Y = 150;

interface TreeNode {
  id: string;
  children: TreeChild[];
  center: { x: number; y: number };
  size: number;
}

interface TreeChild {
  node: TreeNode;
  rel: number;
}

function relRank(relationship: string): number {
  switch (relationship) {
    case 'SEARCH_TO_SOURCE':
      return 0;
    case 'SEARCH_TO_SEARCH':
      return 1;
    case 'SOURCE_TO_SOURCE':
      return 2;
    default:
      return 3;
  }
}

function childDelta(index: number, sideFlip: number): number {
  if (index === 0) return 0;
  const deviant = index - 1;
  const magnitude = Math.min(58 * (Math.floor(deviant / 2) + 1), 125);
  const sign = (deviant % 2 === 0 ? 1 : -1) * sideFlip;
  return sign * magnitude;
}

function buildAdjacency(
  layoutIds: string[],
  edges: LayoutEdge[]
): Map<string, Map<string, number>> {
  const adjacency = new Map<string, Map<string, number>>();
  for (const id of layoutIds) adjacency.set(id, new Map());

  for (const edge of edges) {
    const from = adjacency.get(edge.source);
    const to = adjacency.get(edge.target);
    if (!from || !to || edge.source === edge.target) continue;
    const rank = relRank(edge.relationship);
    const existingForward = from.get(edge.target);
    if (existingForward === undefined || rank < existingForward) {
      from.set(edge.target, rank);
    }
    const existingBack = to.get(edge.source);
    if (existingBack === undefined || rank < existingBack) {
      to.set(edge.source, rank);
    }
  }

  return adjacency;
}

function computeInDegrees(
  layoutIds: string[],
  edges: LayoutEdge[]
): Map<string, number> {
  const inDeg = new Map<string, number>(layoutIds.map(id => [id, 0]));
  const seen = new Set<string>();
  for (const edge of edges) {
    if (!inDeg.has(edge.source) || !inDeg.has(edge.target)) continue;
    if (edge.source === edge.target) continue;
    const key = edge.source + ' ' + edge.target;
    if (seen.has(key)) continue;
    seen.add(key);
    inDeg.set(edge.target, (inDeg.get(edge.target) ?? 0) + 1);
  }
  return inDeg;
}

function findComponents(
  layoutIds: string[],
  adjacency: Map<string, Map<string, number>>
): string[][] {
  const visited = new Set<string>();
  const components: string[][] = [];
  const sorted = [...layoutIds].sort();

  for (const id of sorted) {
    if (visited.has(id)) continue;
    const component: string[] = [];
    const queue: string[] = [id];
    visited.add(id);
    let head = 0;
    while (head < queue.length) {
      const current = queue[head++];
      component.push(current);
      const neighbors = [...(adjacency.get(current)?.keys() ?? [])].sort();
      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    components.push(component);
  }

  return components;
}

function pickRoot(
  component: string[],
  adjacency: Map<string, Map<string, number>>,
  inDeg: Map<string, number>,
  types: NodeTypeMap
): string {
  let best = component[0];
  const better = (candidate: string, current: string): boolean => {
    const candidateIn = (inDeg.get(candidate) ?? 0) > 0 ? 1 : 0;
    const currentIn = (inDeg.get(current) ?? 0) > 0 ? 1 : 0;
    if (candidateIn !== currentIn) return candidateIn < currentIn;
    const candidateSearch = types[candidate] === 'SEARCH' ? 0 : 1;
    const currentSearch = types[current] === 'SEARCH' ? 0 : 1;
    if (candidateSearch !== currentSearch) return candidateSearch < currentSearch;
    const candidateDegree = adjacency.get(candidate)?.size ?? 0;
    const currentDegree = adjacency.get(current)?.size ?? 0;
    if (candidateDegree !== currentDegree) return candidateDegree > currentDegree;
    return candidate < current;
  };
  for (const id of component) {
    if (better(id, best)) best = id;
  }
  return best;
}

function buildTree(
  rootId: string,
  adjacency: Map<string, Map<string, number>>
): Map<string, TreeNode> {
  const nodes = new Map<string, TreeNode>();
  const root: TreeNode = { id: rootId, children: [], center: { x: 0, y: 0 }, size: 1 };
  nodes.set(rootId, root);

  const queue: TreeNode[] = [root];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const neighbors = [...(adjacency.get(current.id) ?? [])].sort((a, b) => {
      if (a[1] !== b[1]) return a[1] - b[1];
      return a[0].localeCompare(b[0]);
    });
    for (const [neighborId, rank] of neighbors) {
      if (nodes.has(neighborId)) continue;
      const child: TreeNode = {
        id: neighborId,
        children: [],
        center: { x: 0, y: 0 },
        size: 1
      };
      nodes.set(neighborId, child);
      current.children.push({ node: child, rel: rank });
      queue.push(child);
    }
  }

  return nodes;
}

function computeSubtreeSizes(node: TreeNode): number {
  let total = 1;
  for (const child of node.children) {
    total += computeSubtreeSizes(child.node);
  }
  node.size = total;
  return total;
}

function sortChildren(node: TreeNode): void {
  node.children.sort((a, b) => {
    if (a.node.size !== b.node.size) return b.node.size - a.node.size;
    if (a.rel !== b.rel) return a.rel - b.rel;
    return a.node.id.localeCompare(b.node.id);
  });
  for (const child of node.children) sortChildren(child.node);
}

function placeTree(
  node: TreeNode,
  center: { x: number; y: number },
  baseDir: number,
  depth: number,
  state: { deviantParents: number }
): void {
  node.center = center;
  const sideFlip =
    node.children.length > 1
      ? state.deviantParents++ % 2 === 0
        ? 1
        : -1
      : 1;
  node.children.forEach((child, index) => {
    const delta = childDelta(index, sideFlip);
    const wave = WAVE_AMP_DEG * Math.sin((depth + 1) * WAVE_FREQ);
    const childBase = baseDir + delta + wave;
    const radians = (childBase * Math.PI) / 180;
    const childCenter = {
      x: center.x + STEP_X * Math.cos(radians),
      y: center.y + STEP_Y * Math.sin(radians)
    };
    placeTree(child.node, childCenter, childBase, depth + 1, state);
  });
}

function resolveOverlaps(nodeIds: string[], nodes: Map<string, TreeNode>): void {
  const sorted = [...nodeIds].sort();
  const limitX = LAYOUT_NODE_WIDTH + COLLISION_PADDING;
  const limitY = LAYOUT_NODE_HEIGHT + COLLISION_PADDING;

  for (let iteration = 0; iteration < COLLISION_ITERATIONS; iteration++) {
    let moved = false;
    for (let i = 0; i < sorted.length; i++) {
      const a = nodes.get(sorted[i]);
      if (!a) continue;
      for (let j = i + 1; j < sorted.length; j++) {
        const b = nodes.get(sorted[j]);
        if (!b) continue;
        const dx = b.center.x - a.center.x;
        const dy = b.center.y - a.center.y;
        const overlapX = limitX - Math.abs(dx);
        const overlapY = limitY - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        moved = true;
        if (overlapX <= overlapY) {
          const push = overlapX / 2;
          const direction = dx >= 0 ? 1 : -1;
          a.center.x -= direction * push;
          b.center.x += direction * push;
        } else {
          const push = overlapY / 2;
          const direction = dy >= 0 ? 1 : -1;
          a.center.y -= direction * push;
          b.center.y += direction * push;
        }
      }
    }
    if (!moved) break;
  }
}

function shelfPackComponents(
  components: string[][],
  nodes: Map<string, TreeNode>
): void {
  const halfW = LAYOUT_NODE_WIDTH / 2;
  const halfH = LAYOUT_NODE_HEIGHT / 2;

  const boxes = components.map(component => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let minId = component[0];
    for (const id of component) {
      const node = nodes.get(id);
      if (!node) continue;
      minX = Math.min(minX, node.center.x - halfW);
      minY = Math.min(minY, node.center.y - halfH);
      maxX = Math.max(maxX, node.center.x + halfW);
      maxY = Math.max(maxY, node.center.y + halfH);
      if (id < minId) minId = id;
    }
    return { component, minX, minY, maxX, maxY, minId };
  });

  boxes.sort((a, b) => {
    const sizeDiff = b.component.length - a.component.length;
    if (sizeDiff !== 0) return sizeDiff;
    return a.minId.localeCompare(b.minId);
  });

  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;

  for (const box of boxes) {
    const width = box.maxX - box.minX;
    const height = box.maxY - box.minY;
    if (cursorX > 0 && cursorX + width > SHELF_ROW_WIDTH) {
      cursorX = 0;
      cursorY += rowHeight + SHELF_GAP_Y;
      rowHeight = 0;
    }
    const shiftX = cursorX - box.minX;
    const shiftY = cursorY - box.minY;
    for (const id of box.component) {
      const node = nodes.get(id);
      if (!node) continue;
      node.center.x += shiftX;
      node.center.y += shiftY;
    }
    cursorX += width + SHELF_GAP_X;
    rowHeight = Math.max(rowHeight, height);
  }
}

export async function layoutResearchGraph(
  nodeIds: string[],
  edges: LayoutEdge[],
  _direction: 'LR' | 'TB' = 'LR',
  types?: NodeTypeMap,
  _compact?: boolean
): Promise<Record<string, { x: number; y: number }>> {
  const typeMap: NodeTypeMap = types ?? {};
  const ids = [...new Set(nodeIds)];

  if (ids.length === 0) return {};

  const layoutIds = ids.filter(id => typeMap[id] !== 'SESSION');
  const positions: Record<string, { x: number; y: number }> = {};

  if (layoutIds.length > 0) {
    const adjacency = buildAdjacency(layoutIds, edges);
    const inDeg = computeInDegrees(layoutIds, edges);
    const components = findComponents(layoutIds, adjacency);
    const nodes = new Map<string, TreeNode>();

    for (const component of components) {
      const rootId = pickRoot(component, adjacency, inDeg, typeMap);
      const treeNodes = buildTree(rootId, adjacency);
      for (const [id, node] of treeNodes) nodes.set(id, node);
      const root = treeNodes.get(rootId);
      if (!root) continue;
      computeSubtreeSizes(root);
      sortChildren(root);
      placeTree(root, { x: 0, y: 0 }, 0, 0, { deviantParents: 0 });
      resolveOverlaps(component, treeNodes);
    }

    shelfPackComponents(components, nodes);

    for (const [id, node] of nodes) {
      positions[id] = {
        x: node.center.x - LAYOUT_NODE_WIDTH / 2,
        y: node.center.y - LAYOUT_NODE_HEIGHT / 2
      };
    }
  }

  const sessionId = ids.find(id => typeMap[id] === 'SESSION');
  if (sessionId) {
    const placed = Object.values(positions);
    const minX = placed.length ? Math.min(...placed.map(p => p.x)) : 0;
    const minY = placed.length ? Math.min(...placed.map(p => p.y)) : 0;
    positions[sessionId] = { x: minX - 90, y: minY - LAYOUT_NODE_HEIGHT - 50 };
  }

  return positions;
}
