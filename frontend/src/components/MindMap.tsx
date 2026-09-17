import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  MiniMap,
  useNodesState,
  useEdgesState,
  useNodesInitialized,
  useReactFlow,
  BaseEdge,
  getSmoothStepPath,
  EdgeProps,
  Node,
  Edge,
  MarkerType
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { layoutResearchGraph, LAYOUT_NODE_WIDTH, LAYOUT_NODE_HEIGHT } from '../utils/graphLayout';
import { buildResearchMapProjection, type ProjectedGraph } from '../utils/researchMapViewModel';
import { apiClient } from '../api/client';
import { researchStore } from '../api/researchStore';
import { nodeTypes } from './CustomNodes';
import NodeDetailPanel from './NodeDetailPanel';
import { MapControls, MapFilterState, DEFAULT_MAP_FILTER } from './MapControls';
import { MindMapNode, MindMapEdge, NodeType, Session } from '../types';
import { Loader2 } from 'lucide-react';

interface Props {
  sessionId: string;
  session?: Session;
  focusNodeId?: string | null;
  onFocusNodeConsumed?: () => void;
}

const positionsKey = (sessionId: string) => `researchmind:node-positions:${sessionId}`;

type SavedPositions = Record<string, { x: number; y: number }>;

const readSavedPositions = (sessionId: string): SavedPositions => {
  try {
    const value = localStorage.getItem(positionsKey(sessionId));
    return value ? JSON.parse(value) as SavedPositions : {};
  } catch {
    return {};
  }
};

const writeSavedPositions = (sessionId: string, positions: SavedPositions) => {
  localStorage.setItem(positionsKey(sessionId), JSON.stringify(positions));
};

function ResearchEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  selected,
  data
}: EdgeProps) {
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 10,
    offset: 24
  });
  const [hovered, setHovered] = useState(false);
  const priority = String(data?.priority || 'context');
  const active = hovered || selected;

  return (
    <BaseEdge
      path={edgePath}
      markerEnd={markerEnd}
      interactionWidth={28}
      style={{
        ...style,
        stroke: active ? 'var(--accent)' : priority === 'anchor' ? 'var(--node-search)' : 'var(--border-strong)',
        strokeWidth: active || priority === 'anchor' ? 1.8 : 1,
        opacity: active ? 1 : priority === 'anchor' ? 0.84 : priority === 'movement' ? 0.55 : 0.24
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    />
  );
}

const edgeTypes = { research: ResearchEdge };

function ViewportFitter({ nodeCount, disabled }: { nodeCount: number; disabled?: boolean }) {
  const { fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();

  useEffect(() => {
    if (disabled || !nodesInitialized || nodeCount === 0) return;
    const frame = requestAnimationFrame(() => {
      fitView({ padding: 0.05, duration: 300 });
    });
    return () => cancelAnimationFrame(frame);
  }, [nodeCount, nodesInitialized, fitView, disabled]);

  return null;
}

function InnerMindMap({ sessionId, session, focusNodeId, onFocusNodeConsumed }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeData, setSelectedNodeData] = useState<any | null>(null);
  const [filter, setFilter] = useState<MapFilterState>(DEFAULT_MAP_FILTER);
  const [showMinimap, setShowMinimap] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);

  const { fitView, zoomIn, zoomOut, setCenter, getZoom } = useReactFlow();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const savedPositionsRef = useRef<SavedPositions>({});
  const resettingLayoutRef = useRef(false);
  const rawDataRef = useRef<{ nodes: MindMapNode[]; edges: MindMapEdge[] }>({ nodes: [], edges: [] });
  const focusHandledRef = useRef<string | null>(null);
  const layoutGenerationRef = useRef(0);
  const loadInFlightRef = useRef(false);
  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  const focusPendingRef = useRef(false);
  const projectedDataRef = useRef<ProjectedGraph>({ nodes: [], edges: [] });
  const currentLoadSessionRef = useRef<string | null>(null);
  const loadTimingRef = useRef<{ t1: number; t2: number; t3: number; t4: number; t5: number; t6: number; t7: number; t8: number } | null>(null);

  const loadGraph = useCallback(async () => {
    if (loadInFlightRef.current) return;
    loadInFlightRef.current = true;
    
    const loadSessionId = sessionId;
    const loadToken = ++layoutGenerationRef.current;
    currentLoadSessionRef.current = loadSessionId;
    
    const t1 = performance.now();
    loadTimingRef.current = { t1, t2: 0, t3: 0, t4: 0, t5: 0, t6: 0, t7: 0, t8: 0 };
    
    try {
      setLoading(true);
      const t2 = performance.now();
      loadTimingRef.current!.t2 = t2;
      const data = await apiClient.getMindMap(loadSessionId);
      const t3 = performance.now();
      loadTimingRef.current!.t3 = t3;
      
      if (currentLoadSessionRef.current !== loadSessionId || loadToken !== layoutGenerationRef.current) {
        return;
      }
      
      rawDataRef.current = { nodes: data.nodes, edges: data.edges };
      const savedPositions = readSavedPositions(loadSessionId);
      savedPositionsRef.current = savedPositions;

      const t4 = performance.now();
      loadTimingRef.current!.t4 = t4;
      const projected = buildResearchMapProjection(data.nodes, data.edges);
      projectedDataRef.current = projected;
      const t5 = performance.now();
      loadTimingRef.current!.t5 = t5;

      const flowNodes: Node[] = projected.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: { x: 0, y: 0 },
        data: {
          ...n,
          compact: projected.nodes.length > 15 && n.type === 'SOURCE',
          isDimmed: false,
          isFocused: false
        }
      }));

      const flowEdges: Edge[] = projected.edges.map((e) => {
        const priority = e.relationship === 'SESSION_TO_SEARCH' ? 'anchor' : 
                         e.relationship === 'SEARCH_TO_SOURCE' ? 'movement' : 'context';
        const labelOffset = e.relationship === 'SESSION_TO_SEARCH' ? -18 :
                            e.relationship === 'SEARCH_TO_SOURCE' ? 16 : 22;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.relationship.replace(/_/g, ' ').toLowerCase(),
          type: 'research',
          data: {
            priority,
            relationship: e.relationship,
            labelOffset
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 10,
            height: 10,
            color: 'var(--border-strong)'
          }
        };
      });

      const types: NodeTypeMap = {};
      for (const n of flowNodes) types[n.id] = String(n.type ?? '');

      const t6 = performance.now();
      loadTimingRef.current!.t6 = t6;
      const canonicalPositions = await layoutResearchGraph(
        flowNodes.map((node) => node.id),
        projected.edges,
        'LR',
        types,
        projected.nodes.length > 15
      );
      const t7 = performance.now();
      loadTimingRef.current!.t7 = t7;

      if (currentLoadSessionRef.current !== loadSessionId || loadToken !== layoutGenerationRef.current) {
        return;
      }

      const layoutedNodes = flowNodes.map((node) => ({
        ...node,
        position: savedPositions[node.id] || canonicalPositions[node.id] || node.position
      }));

      setNodes(layoutedNodes);
      setEdges(flowEdges);
      nodesRef.current = layoutedNodes;
      edgesRef.current = flowEdges;
      setError(null);
      
      const t8 = performance.now();
      loadTimingRef.current!.t8 = t8;
      if (loadTimingRef.current) {
        const t = loadTimingRef.current;
        console.debug('[MindMap] Load timing:', {
          sessionId: loadSessionId,
          apiMs: Math.round(t.t3 - t.t2),
          projectionMs: Math.round(t.t5 - t.t4),
          layoutMs: Math.round(t.t7 - t.t6),
          renderMs: Math.round(t.t8 - t.t7),
          totalMs: Math.round(t.t8 - t.t1),
          nodes: layoutedNodes.length,
          edges: flowEdges.length
        });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load research graph');
    } finally {
      loadInFlightRef.current = false;
      setLoading(false);
    }
  }, [sessionId, setNodes, setEdges]);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;

    let frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      if (focusPendingRef.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        fitView({ padding: 0.05, duration: 0 });
      });
    });
    observer.observe(container);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [fitView]);

  useEffect(() => {
    loadGraph();
    const unsubscribe = researchStore.subscribe(() => {
      loadGraph();
    });
    return () => {
      unsubscribe();
    };
  }, [loadGraph, sessionId]);

  const handleViewportChange = useCallback(() => {
    const currentZoom = getZoom();
    if (currentZoom) setZoomLevel(currentZoom);
  }, [getZoom]);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);

  const resetLayout = useCallback(async () => {
    resettingLayoutRef.current = true;
    localStorage.removeItem(positionsKey(sessionId));
    savedPositionsRef.current = {};
    const gen = ++layoutGenerationRef.current;
    currentLoadSessionRef.current = sessionId;
    const currentNodes = nodesRef.current;
    const currentEdges = edgesRef.current;
    const types: NodeTypeMap = {};
    for (const n of currentNodes) types[n.id] = String(n.type ?? '');
    const canonicalPositions = await layoutResearchGraph(
      currentNodes.map((node) => node.id),
      projectedDataRef.current.edges,
      'LR',
      types,
      currentNodes.length > 15
    );
    if (currentLoadSessionRef.current !== sessionId || gen !== layoutGenerationRef.current) return;
    setNodes(currentNodes.map((node) => ({
      ...node,
      position: canonicalPositions[node.id] || node.position
    })));
    setEdges(currentEdges);
    requestAnimationFrame(() => {
      localStorage.removeItem(positionsKey(sessionId));
      resettingLayoutRef.current = false;
      fitView({ padding: 0.05, duration: 250 });
    });
  }, [sessionId, setNodes, setEdges, fitView]);

  const handleNodeDragStop = useCallback((_: MouseEvent | TouchEvent, node: Node) => {
    if (resettingLayoutRef.current) return;
    const nextPositions = {
      ...savedPositionsRef.current,
      [node.id]: { x: node.position.x, y: node.position.y }
    };
    savedPositionsRef.current = nextPositions;
    writeSavedPositions(sessionId, nextPositions);
  }, [sessionId]);

  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedNodeData(node.data);

    const connectedIds = new Set<string>();
    connectedIds.add(node.id);
    edges.forEach((edge) => {
      if (edge.source === node.id) connectedIds.add(edge.target);
      if (edge.target === node.id) connectedIds.add(edge.source);
    });

    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: {
          ...n.data,
          isDimmed: !connectedIds.has(n.id),
          isFocused: n.id === node.id
        }
      }))
    );

    setEdges((current) => current.map((edge) => ({
      ...edge,
      selected: edge.source === node.id || edge.target === node.id
    })));
  }, [edges, setEdges, setNodes]);

  const onPaneClick = useCallback(() => {
    setSelectedNodeData(null);
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: {
          ...n.data,
          isDimmed: false,
          isFocused: false
        }
      }))
    );
    setEdges((current) => current.map((edge) => ({ ...edge, selected: false })));
  }, [setEdges, setNodes]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('input, textarea, [contenteditable="true"]')) return;
      if (e.key.toLowerCase() === 'f') {
        fitView({ padding: 0.05, duration: 250 });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fitView]);

  useEffect(() => {
    const hiddenNodeIds = new Set<string>();
    const isTypeVisible = (type: string, f: MapFilterState): boolean => {
      switch (type) {
        case 'SESSION': return f.sessions;
        case 'SEARCH': return f.searches;
        case 'SOURCE': return f.sources;
        default: return true;
      }
    };

    setNodes((nds) =>
      nds.map((n) => {
        const visible = isTypeVisible(String(n.type), filter);
        if (!visible) hiddenNodeIds.add(n.id);
        return { ...n, hidden: !visible };
      })
    );
    setEdges((current) =>
      current.map((edge) => {
        const relationship = String(edge.data?.relationship || edge.label || '');
        const relationshipVisible = (relationship === 'SESSION_TO_SEARCH' || relationship === 'SEARCH_TO_SOURCE')
          ? filter.researchConnections
          : relationship === 'SOURCE_TO_SOURCE'
            ? filter.navigationConnections
            : true;
        const touchesHiddenNode = hiddenNodeIds.has(edge.source) || hiddenNodeIds.has(edge.target);
        return {
          ...edge,
          hidden: !relationshipVisible || touchesHiddenNode
        };
      })
    );
  }, [filter, setEdges, setNodes]);

  const connectedNodesForSelected = useMemo(() => {
    if (!selectedNodeData) return [];
    const relations: Array<{ id: string; label: string; type: NodeType; relationship: string }> = [];

    edges.forEach((edge) => {
      if (edge.source === selectedNodeData.id) {
        const targetNode = nodes.find((n) => n.id === edge.target);
        if (targetNode) {
          const tData = targetNode.data as Record<string, any>;
          relations.push({
            id: targetNode.id,
            label: String(tData.label || targetNode.id),
            type: targetNode.type as NodeType,
            relationship: String(edge.label || 'relates to')
          });
        }
      } else if (edge.target === selectedNodeData.id) {
        const sourceNode = nodes.find((n) => n.id === edge.source);
        if (sourceNode) {
          const sData = sourceNode.data as Record<string, any>;
          relations.push({
            id: sourceNode.id,
            label: String(sData.label || sourceNode.id),
            type: sourceNode.type as NodeType,
            relationship: `inbound: ${String(edge.label || 'relates to')}`
          });
        }
      }
    });

    return relations;
  }, [selectedNodeData, edges, nodes]);

  const handleJumpToNode = useCallback((nodeId: string) => {
    const targetNode = nodes.find((n) => n.id === nodeId);
    if (targetNode) {
      setSelectedNodeData(targetNode.data);
      setCenter(targetNode.position.x + LAYOUT_NODE_WIDTH / 2, targetNode.position.y + LAYOUT_NODE_HEIGHT / 2, {
        zoom: 1.1,
        duration: 400
      });
    }
  }, [nodes, setCenter]);

  useEffect(() => {
    if (!focusNodeId) return;
    if (focusHandledRef.current === focusNodeId) return;
    if (nodes.length === 0) return;
    const target = nodes.find((n) => n.id === focusNodeId);
    if (target) {
      focusHandledRef.current = focusNodeId;
      onNodeClick(null, target);
      handleJumpToNode(focusNodeId);
    }
    onFocusNodeConsumed?.();
  }, [focusNodeId, nodes, onNodeClick, handleJumpToNode, onFocusNodeConsumed]);

  const handleExportGraph = useCallback(() => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(rawDataRef.current, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `researchmind-graph-${sessionId}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }, [sessionId]);

  if (loading && nodes.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center select-none bg-[var(--graph-bg)]">
        <div className="b-panel px-6 py-5 flex items-center gap-3">
          <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
          <span className="font-mono text-xs font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
            Reconstructing your research trail&hellip;
          </span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center gap-4 select-none bg-[var(--graph-bg)]">
        <div className="b-panel px-6 py-5 flex flex-col items-center gap-2 max-w-sm">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--status-danger)]">
            Graph load failure
          </span>
          <span className="font-display text-sm font-bold text-[var(--text-primary)]">
            Couldn&apos;t load this research map.
          </span>
          <span className="text-[11px] text-[var(--text-muted)] font-mono leading-relaxed">
            {error}
          </span>
        </div>
        <button
          onClick={loadGraph}
          className="b-btn b-btn--accent text-xs px-4 py-1.5"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div ref={mapContainerRef} className="w-full h-full min-w-0 min-h-0 relative select-none">
      {nodes.filter((n) => n.type !== 'SESSION').length === 0 ? (
        <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-[var(--graph-bg)] select-none">
          <div className="b-panel px-6 py-5 max-w-sm flex flex-col gap-1.5">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-faint)]">Empty canvas</span>
            <span className="font-display text-sm font-bold text-[var(--text-primary)]">No research activity captured</span>
            <span className="text-[11px] font-mono text-[var(--text-muted)] leading-relaxed">This session doesn&apos;t contain any captured research activity.</span>
          </div>
        </div>
      ) : (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={handleNodeDragStop}
          onEdgeClick={(_, edge) => setEdges((current) => current.map((item) => ({
            ...item,
            selected: item.id === edge.id
          })))}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onMove={handleViewportChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          minZoom={0.5}
          maxZoom={2.5}
          fitView
          fitViewOptions={{ padding: 0.05 }}
          proOptions={{ hideAttribution: true }}
        >
          <ViewportFitter nodeCount={nodes.length} disabled={focusPendingRef.current} />
          
          <Background 
            gap={20} 
            size={1} 
            color="var(--graph-dot)" 
          />

          {showMinimap && (
            <MiniMap
              style={{
                position: 'absolute',
                bottom: 12,
                right: 12,
                width: 150,
                height: 96,
                margin: 0,
                border: '2px solid var(--border-strong)',
                borderRadius: 2,
                boxShadow: 'var(--shadow-md)'
              }}
              nodeStrokeWidth={1.5}
              nodeColor={(n) => {
                switch (n.type) {
                  case 'SESSION': return 'var(--node-session)';
                  case 'SEARCH': return 'var(--node-search)';
                  case 'SOURCE': return 'var(--node-page)';
                  default: return 'var(--text-muted)';
                }
              }}
              maskColor="rgba(0, 0, 0, 0.35)"
            />
          )}

          <MapControls
            zoom={zoomLevel}
            onZoomIn={() => zoomIn({ duration: 200 })}
            onZoomOut={() => zoomOut({ duration: 200 })}
            onFitView={() => fitView({ padding: 0.05, duration: 250 })}
            onResetLayout={resetLayout}
            filter={filter}
            onFilterChange={setFilter}
            onResetFilter={() => setFilter(DEFAULT_MAP_FILTER)}
            showMinimap={showMinimap}
            onToggleMinimap={() => setShowMinimap(!showMinimap)}
            onExport={handleExportGraph}
          />
        </ReactFlow>
      )}

      {selectedNodeData && (
        <NodeDetailPanel
          data={selectedNodeData}
          connectedNodes={connectedNodesForSelected}
          session={session}
          onSelectConnectedNode={handleJumpToNode}
          onClose={() => {
            setSelectedNodeData(null);
            onPaneClick();
          }}
        />
      )}
    </div>
  );
}

export default function MindMap({ sessionId, session, focusNodeId, onFocusNodeConsumed }: Props) {
  return (
    <ReactFlowProvider>
      <InnerMindMap sessionId={sessionId} session={session} focusNodeId={focusNodeId} onFocusNodeConsumed={onFocusNodeConsumed} />
    </ReactFlowProvider>
  );
}

type NodeTypeMap = {
  [nodeId: string]: string;
};