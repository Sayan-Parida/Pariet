import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import {
  Globe,
  Search,
  Compass
} from 'lucide-react';

interface CustomNodeProps {
  id: string;
  data: {
    label: string;
    type: 'SESSION' | 'SEARCH' | 'SOURCE';
    domain?: string | null;
    url?: string;
    abstract?: string;
    authors?: string[];
    citationCount?: number;
    visitCount?: number;
    isDimmed?: boolean;
    isFocused?: boolean;
    isStoppingPoint?: boolean;
    compact?: boolean;
  };
  selected?: boolean;
}

const NodeWrapper = memo(({
  children,
  selected,
  isDimmed,
  isFocused,
  accentColor,
  accentBg,
  typeLabel,
  icon: Icon,
  showTypeBadge,
  typeBadgeBg,
  typeBadgeFg,
  typeBadgeLabel,
  compact,
  isStoppingPoint
}: {
  children: React.ReactNode;
  selected?: boolean;
  isDimmed?: boolean;
  isFocused?: boolean;
  accentColor: string;
  accentBg: string;
  typeLabel: string;
  icon: any;
  showTypeBadge?: boolean;
  typeBadgeBg?: string;
  typeBadgeFg?: string;
  typeBadgeLabel?: string;
  compact?: boolean;
  isStoppingPoint?: boolean;
}) => {
  return (
    <div
      className={`pariet-node relative ${compact ? 'p-2.5' : 'p-3'} transition-all duration-150 cursor-pointer select-none border-l-4`}
      style={{
        width: compact ? 205 : 250,
        backgroundColor: `var(${isFocused ? '--surface-elevated' : '--surface-base'})`,
        borderTop: `2px solid ${selected || isFocused ? 'var(--accent)' : 'var(--border-strong)'}`,
        borderRight: `2px solid ${selected || isFocused ? 'var(--accent)' : 'var(--border-strong)'}`,
        borderBottom: `2px solid ${selected || isFocused ? 'var(--accent)' : 'var(--border-strong)'}`,
        borderLeftColor: accentColor,
        borderLeftWidth: 4,
        borderRadius: 'var(--radius-sm)',
        boxShadow: selected || isFocused ? 'var(--shadow-md)' : 'var(--shadow-xs)',
        opacity: isDimmed ? 0.18 : 1,
      }}
    >
      <Handle 
        id="tgt-left"
        type="target" 
        position={Position.Left} 
        style={{
          width: 5,
          height: 5,
          background: 'var(--border-strong)',
          border: 'none',
          left: -3,
          opacity: 1,
          cursor: 'default'
        }} 
      />
      <Handle 
        id="src-right"
        type="source" 
        position={Position.Right} 
        style={{
          width: 5,
          height: 5,
          background: 'var(--border-strong)',
          border: 'none',
          right: -3,
          opacity: 1,
          cursor: 'default'
        }} 
      />
      <Handle 
        id="tgt-top"
        type="target" 
        position={Position.Top} 
        style={{
          width: 5,
          height: 5,
          background: 'var(--border-strong)',
          border: 'none',
          top: -3,
          opacity: 1,
          cursor: 'default'
        }} 
      />
      <Handle 
        id="src-bottom"
        type="source" 
        position={Position.Bottom} 
        style={{
          width: 5,
          height: 5,
          background: 'var(--border-strong)',
          border: 'none',
          bottom: -3,
          opacity: 1,
          cursor: 'default'
        }} 
      />

      <div className="flex items-center justify-between gap-1.5 mb-2 text-[9px] font-mono uppercase tracking-[0.08em]">
        <span 
          className="inline-flex items-center gap-1 px-1 py-0.5 border-[1.5px] font-bold"
          style={{
            backgroundColor: accentBg,
            color: accentColor,
            borderColor: 'var(--border-strong)',
            borderRadius: 'var(--radius-xs)'
          }}
        >
          <Icon className="w-2.5 h-2.5" />
          <span>{typeLabel}</span>
        </span>
        {showTypeBadge && (
          <span className="ml-1 text-[0.65em] font-bold border-[1.5px] px-1.5 py-0.5 text-xs tracking-[0.08em]"
            style={{ backgroundColor: typeBadgeBg, color: typeBadgeFg, borderColor: 'var(--border-medium)', borderRadius: 'var(--radius-xs)' }}
          >
            {typeBadgeLabel}
          </span>
        )}
        {isStoppingPoint && (
          <span className="ml-auto inline-flex items-center gap-1 text-[8px] font-bold tracking-[0.08em] py-0.5 px-1"
            style={{ color: 'var(--accent)', backgroundColor: 'var(--accent-bg)', borderColor: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 'var(--radius-xs)' }}
          >
            ★ YOU STOPPED HERE
          </span>
        )}
      </div>

      {children}
    </div>
  );
});
NodeWrapper.displayName = 'NodeWrapper';

export const SessionNode = memo(({ data, selected }: CustomNodeProps) => {
  return (
    <NodeWrapper
      selected={selected}
      isDimmed={data.isDimmed}
      isFocused={data.isFocused}
      accentColor="var(--node-session)"
      accentBg="var(--node-session-bg)"
      typeLabel="Session"
      icon={Compass}
      compact={data.compact}
      isStoppingPoint={data.isStoppingPoint}
    >
      <div style={{ fontFamily: 'var(--font-display)' }} className="text-[14px] font-semibold text-[var(--text-primary)] leading-[1.12] line-clamp-2 mb-2">
        {data.label}
      </div>
      <div className="text-[10px] font-mono text-[var(--text-muted)] pt-2 border-t-2 border-[var(--border-strong)]">
        Root workspace
      </div>
    </NodeWrapper>
  );
});
SessionNode.displayName = 'SessionNode';

export const SearchNode = memo(({ data, selected }: CustomNodeProps) => {
  return (
    <NodeWrapper
      selected={selected}
      isDimmed={data.isDimmed}
      isFocused={data.isFocused}
      accentColor="var(--node-search)"
      accentBg="var(--node-search-bg)"
      typeLabel="Query"
      icon={Search}
      showTypeBadge
      typeBadgeBg="var(--node-search)"
      typeBadgeFg="var(--text-primary)"
      typeBadgeLabel="SEARCH"
      compact={data.compact}
      isStoppingPoint={data.isStoppingPoint}
    >
      <div style={{ fontFamily: 'var(--font-display)' }} className="text-[14px] italic text-[var(--text-primary)] leading-[1.12] mb-2">
        &ldquo;{data.label}&rdquo;
      </div>
    </NodeWrapper>
  );
});
SearchNode.displayName = 'SearchNode';

export const SourceNode = memo(({ data, selected }: CustomNodeProps) => {
  return (
    <NodeWrapper
      selected={selected}
      isDimmed={data.isDimmed}
      isFocused={data.isFocused}
      accentColor="var(--node-page)"
      accentBg="var(--node-page-bg)"
      typeLabel="Source"
      icon={Globe}
      showTypeBadge
      typeBadgeBg="var(--node-page)"
      typeBadgeFg="var(--text-primary)"
      typeBadgeLabel="SOURCE"
      compact={data.compact}
      isStoppingPoint={data.isStoppingPoint}
    >
      <div style={{ fontFamily: 'var(--font-display)' }} className="text-[14px] font-semibold text-[var(--text-primary)] leading-[1.12] line-clamp-2 mb-2">
        {data.label}
      </div>

      <div className="text-[10px] font-mono text-[var(--text-muted)] pt-2 border-t-2 border-[var(--border-strong)]">
        {data.domain || data.url?.replace(/^https?:\/\//, '')}
      </div>
    </NodeWrapper>
  );
});
SourceNode.displayName = 'SourceNode';

export const nodeTypes = {
  SESSION: SessionNode,
  SEARCH: SearchNode,
  SOURCE: SourceNode,
  custom: SourceNode
};