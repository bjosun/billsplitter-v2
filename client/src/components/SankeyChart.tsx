import { useMemo, useState } from 'react';

interface SankeyNode {
  name: string;
}

interface SankeyLink {
  source: number;
  target: number;
  value: number;
}

interface SankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

interface SankeyChartProps {
  data: SankeyData;
  title?: string;
  width?: number;
  height?: number;
  formatValue?: (value: number) => string;
}

interface NodeLayout {
  index: number;
  name: string;
  stage: number;
  total: number;
  x: number;
  y: number;
  height: number;
  color: string;
  isTerminal: boolean;
}

interface LinkLayout {
  sourceIndex: number;
  targetIndex: number;
  value: number;
  sourceX: number;
  targetX: number;
  sourceY0: number;
  sourceY1: number;
  targetY0: number;
  targetY1: number;
  color: string;
}

const PALETTE = [
  '#6366f1',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#0ea5e9',
  '#a855f7',
  '#14b8a6',
  '#ef4444',
  '#f97316',
  '#22c55e',
];

const defaultFormat = (value: number) => `kr ${Math.round(value).toLocaleString('sv-SE')}`;

const NODE_WIDTH = 14;
const NODE_GAP = 10;
const PADDING_Y = 24;
const LABEL_SPACE = 130;

function computeStages(nodeCount: number, links: SankeyLink[]): number[] {
  const stage = new Array<number>(nodeCount).fill(0);
  const incoming = new Array<number>(nodeCount).fill(0);
  links.forEach((l) => {
    incoming[l.target] = (incoming[l.target] || 0) + 1;
  });

  // Iteratively relax: stage(target) = max(stage(target), stage(source)+1)
  // Repeat until stable (DAG assumed).
  let changed = true;
  let safety = 0;
  while (changed && safety < nodeCount + 5) {
    changed = false;
    safety += 1;
    links.forEach((l) => {
      const candidate = stage[l.source] + 1;
      if (candidate > stage[l.target]) {
        stage[l.target] = candidate;
        changed = true;
      }
    });
  }

  return stage;
}

export default function SankeyChart({
  data,
  title,
  width = 820,
  height = 420,
  formatValue = defaultFormat,
}: SankeyChartProps) {
  const [hoveredLink, setHoveredLink] = useState<number | null>(null);

  const layout = useMemo(() => {
    const { nodes, links } = data;
    if (!nodes.length || !links.length) {
      return null;
    }

    const stages = computeStages(nodes.length, links);
    const numStages = Math.max(...stages) + 1;
    const usedNodeIndices = new Set<number>();
    links.forEach((l) => {
      usedNodeIndices.add(l.source);
      usedNodeIndices.add(l.target);
    });

    const nodesByStage: number[][] = Array.from({ length: numStages }, () => []);
    usedNodeIndices.forEach((idx) => {
      nodesByStage[stages[idx]].push(idx);
    });

    const totalFlow = links.reduce((sum, l) => sum + l.value, 0);
    if (totalFlow <= 0) return null;

    // Compute per-node "size": for a node, total = max(sum of incoming, sum of outgoing).
    const incomingSum = new Map<number, number>();
    const outgoingSum = new Map<number, number>();
    links.forEach((l) => {
      outgoingSum.set(l.source, (outgoingSum.get(l.source) || 0) + l.value);
      incomingSum.set(l.target, (incomingSum.get(l.target) || 0) + l.value);
    });
    const nodeTotal = (idx: number) =>
      Math.max(incomingSum.get(idx) || 0, outgoingSum.get(idx) || 0);

    // pxPerUnit: pick smallest available height across stages
    const availablePerStage = nodesByStage.map((indices) => {
      const gaps = Math.max(0, indices.length - 1) * NODE_GAP;
      return height - 2 * PADDING_Y - gaps;
    });
    const stageTotals = nodesByStage.map((indices) => indices.reduce((s, i) => s + nodeTotal(i), 0));

    const pxPerUnitCandidates = nodesByStage.map((_indices, i) =>
      stageTotals[i] > 0 ? availablePerStage[i] / stageTotals[i] : Infinity
    );
    const pxPerUnit = Math.min(...pxPerUnitCandidates);

    // Column positions
    const innerWidth = width - 2 * LABEL_SPACE;
    const stageX = (stage: number) => {
      if (numStages === 1) return LABEL_SPACE;
      return LABEL_SPACE + (innerWidth - NODE_WIDTH) * (stage / (numStages - 1));
    };

    const nodeByIndex = new Map<number, NodeLayout>();

    nodesByStage.forEach((indices, stage) => {
      // Sort within stage by total desc for nicer layout
      indices.sort((a, b) => nodeTotal(b) - nodeTotal(a));
      const totalGroupHeight =
        indices.reduce((s, i) => s + Math.max(2, nodeTotal(i) * pxPerUnit), 0) +
        Math.max(0, indices.length - 1) * NODE_GAP;
      const startY = PADDING_Y + Math.max(0, (height - 2 * PADDING_Y - totalGroupHeight) / 2);
      let cursor = startY;
      indices.forEach((idx, i) => {
        const total = nodeTotal(idx);
        const nodeHeight = Math.max(2, total * pxPerUnit);
        const palette = stage === 0 ? PALETTE[i % PALETTE.length] : '#94a3b8';
        const isTerminal = !(outgoingSum.get(idx) && outgoingSum.get(idx)! > 0);
        nodeByIndex.set(idx, {
          index: idx,
          name: nodes[idx]?.name || '',
          stage,
          total,
          x: stageX(stage),
          y: cursor,
          height: nodeHeight,
          color: palette,
          isTerminal,
        });
        cursor += nodeHeight + NODE_GAP;
      });
    });

    // For each node, sort outgoing by target stage/y, and incoming by source y.
    const sortedOutgoing = new Map<number, SankeyLink[]>();
    const sortedIncoming = new Map<number, SankeyLink[]>();
    links.forEach((l) => {
      if (!sortedOutgoing.has(l.source)) sortedOutgoing.set(l.source, []);
      sortedOutgoing.get(l.source)!.push(l);
      if (!sortedIncoming.has(l.target)) sortedIncoming.set(l.target, []);
      sortedIncoming.get(l.target)!.push(l);
    });
    sortedOutgoing.forEach((arr) =>
      arr.sort((a, b) => {
        const ay = nodeByIndex.get(a.target)?.y ?? 0;
        const by = nodeByIndex.get(b.target)?.y ?? 0;
        return ay - by;
      })
    );
    sortedIncoming.forEach((arr) =>
      arr.sort((a, b) => {
        const ay = nodeByIndex.get(a.source)?.y ?? 0;
        const by = nodeByIndex.get(b.source)?.y ?? 0;
        return ay - by;
      })
    );

    // Inherit color from upstream (stage 0 source).
    const linkColor = (link: SankeyLink): string => {
      let cursor = link.source;
      let safety = 0;
      while (safety < 16) {
        const node = nodeByIndex.get(cursor);
        if (!node) break;
        if (node.stage === 0) return node.color;
        const upstream = sortedIncoming.get(cursor);
        if (!upstream || upstream.length === 0) return node.color;
        // pick largest upstream link
        const biggest = upstream.reduce((a, b) => (a.value >= b.value ? a : b));
        cursor = biggest.source;
        safety += 1;
      }
      return '#6366f1';
    };

    // Lay out link y-offsets per node side.
    const sourceCursor = new Map<number, number>();
    const targetCursor = new Map<number, number>();

    const linkLayouts: LinkLayout[] = [];
    // Process links in node-order so cursor stacks correctly
    for (let stage = 0; stage < numStages - 1; stage++) {
      const stageNodes = nodesByStage[stage].slice().sort((a, b) => {
        const ay = nodeByIndex.get(a)?.y ?? 0;
        const by = nodeByIndex.get(b)?.y ?? 0;
        return ay - by;
      });
      stageNodes.forEach((srcIdx) => {
        const out = sortedOutgoing.get(srcIdx) || [];
        out.forEach((l) => {
          const sNode = nodeByIndex.get(l.source);
          const tNode = nodeByIndex.get(l.target);
          if (!sNode || !tNode) return;
          const linkH = l.value * pxPerUnit;
          const sStart = sourceCursor.get(l.source) ?? sNode.y;
          const tStart = targetCursor.get(l.target) ?? tNode.y;
          sourceCursor.set(l.source, sStart + linkH);
          targetCursor.set(l.target, tStart + linkH);
          linkLayouts.push({
            sourceIndex: l.source,
            targetIndex: l.target,
            value: l.value,
            sourceX: sNode.x + NODE_WIDTH,
            targetX: tNode.x,
            sourceY0: sStart,
            sourceY1: sStart + linkH,
            targetY0: tStart,
            targetY1: tStart + linkH,
            color: linkColor(l),
          });
        });
      });
    }

    return {
      nodes: Array.from(nodeByIndex.values()),
      links: linkLayouts,
      numStages,
      totalFlow,
    };
  }, [data, width, height]);

  if (!layout) {
    return (
      <div className="w-full">
        {title && <h3 className="text-lg font-semibold mb-4">{title}</h3>}
        <div
          className="w-full border border-dashed border-gray-200 rounded-lg flex items-center justify-center text-sm text-gray-400"
          style={{ height }}
        >
          No flow to display.
        </div>
      </div>
    );
  }

  const { nodes, links, numStages } = layout;

  const buildRibbonPath = (l: LinkLayout) => {
    const cx = (l.sourceX + l.targetX) / 2;
    return [
      `M ${l.sourceX} ${l.sourceY0}`,
      `C ${cx} ${l.sourceY0}, ${cx} ${l.targetY0}, ${l.targetX} ${l.targetY0}`,
      `L ${l.targetX} ${l.targetY1}`,
      `C ${cx} ${l.targetY1}, ${cx} ${l.sourceY1}, ${l.sourceX} ${l.sourceY1}`,
      'Z',
    ].join(' ');
  };

  const hovered = hoveredLink !== null ? links[hoveredLink] : null;
  const nameByIndex = new Map(nodes.map((n) => [n.index, n.name]));

  return (
    <div className="w-full">
      {title && <h3 className="text-lg font-semibold mb-4">{title}</h3>}
      <div className="relative w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          className="bg-white rounded-lg border border-gray-100"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Ribbons */}
          <g>
            {links.map((l, i) => {
              const isHovered = hoveredLink === i;
              const dim = hoveredLink !== null && !isHovered;
              return (
                <path
                  key={`link-${i}`}
                  d={buildRibbonPath(l)}
                  fill={l.color}
                  fillOpacity={isHovered ? 0.75 : dim ? 0.1 : 0.4}
                  stroke="none"
                  onMouseEnter={() => setHoveredLink(i)}
                  onMouseLeave={() => setHoveredLink(null)}
                  style={{ transition: 'fill-opacity 120ms ease', cursor: 'pointer' }}
                />
              );
            })}
          </g>

          {/* Link value labels (only when ribbon thick enough) */}
          <g pointerEvents="none">
            {links.map((l, i) => {
              const linkH = l.sourceY1 - l.sourceY0;
              if (linkH < 13) return null;
              const cx = (l.sourceX + l.targetX) / 2;
              const cy = (l.sourceY0 + l.sourceY1 + l.targetY0 + l.targetY1) / 4;
              return (
                <text
                  key={`linkv-${i}`}
                  x={cx}
                  y={cy + 4}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={600}
                  fill="#1f2937"
                  opacity={hoveredLink === null || hoveredLink === i ? 1 : 0.25}
                >
                  {formatValue(l.value)}
                </text>
              );
            })}
          </g>

          {/* Nodes */}
          <g>
            {nodes.map((n) => (
              <rect
                key={`node-${n.index}`}
                x={n.x}
                y={n.y}
                width={NODE_WIDTH}
                height={n.height}
                fill={n.color}
                rx={3}
              />
            ))}
          </g>

          {/* Node labels */}
          <g pointerEvents="none">
            {nodes.map((n) => {
              const isFirstStage = n.stage === 0;
              const isLastStage = n.stage === numStages - 1 || n.isTerminal;
              const labelX = isFirstStage ? n.x - 8 : isLastStage ? n.x + NODE_WIDTH + 8 : n.x + NODE_WIDTH + 8;
              const anchor: 'end' | 'start' = isFirstStage ? 'end' : 'start';
              const labelY = n.y + n.height / 2;
              return (
                <g key={`label-${n.index}`}>
                  <text
                    x={labelX}
                    y={labelY - 4}
                    textAnchor={anchor}
                    fontSize={12}
                    fontWeight={600}
                    fill="#111827"
                  >
                    {n.name}
                  </text>
                  <text
                    x={labelX}
                    y={labelY + 11}
                    textAnchor={anchor}
                    fontSize={11}
                    fill="#6b7280"
                  >
                    {formatValue(n.total)}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {hovered && (
          <div className="pointer-events-none absolute top-2 right-2 rounded-md border border-gray-200 bg-white shadow-md px-3 py-2 text-xs">
            <div className="font-semibold text-gray-800">
              {nameByIndex.get(hovered.sourceIndex)} → {nameByIndex.get(hovered.targetIndex)}
            </div>
            <div className="text-gray-600 mt-0.5">{formatValue(hovered.value)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
