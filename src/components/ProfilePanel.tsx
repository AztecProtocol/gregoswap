/**
 * Profiling panel — canvas-based waterfall chart.
 * Activated by ?profile query parameter.
 *
 * Shows every instrumented wallet/PXE/node/RPC/WASM span as a horizontal bar
 * on a time axis. Nesting is derived from timing containment (parent spans
 * fully enclose child spans). Click row labels to collapse/expand subtrees.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Box, Button, Chip, Paper, Slider, Tooltip, Typography } from '@mui/material';
import { profiler, type ProfileReport, type ProfileRecord, type Category } from '../profiling';
import { useWallet } from '../contexts/wallet';

// ─── Constants ───────────────────────────────────────────────────────────────

const ROW_H = 22;
const ROW_GAP = 1;
const ROW_STEP = ROW_H + ROW_GAP;
const LABEL_W = 220;
const INDENT_PX = 14;
const FONT = '11px monospace';
const MIN_BAR_PX = 2;

const CATEGORY_COLORS: Record<Category, string> = {
  wallet: '#5c7cfa',
  pxe: '#ce93d8',
  sim: '#ffd54f',
  oracle: '#ffab40',
  node: '#66bb6a',
  rpc: '#4fc3f7',
  wasm: '#ff7043',
};

const fmt = (ms: number) =>
  ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(1)}ms`;

// ─── Tree model ──────────────────────────────────────────────────────────────

interface TreeNode {
  id: string;
  record: ProfileRecord;
  children: TreeNode[];
  depth: number;
}

/**
 * Build a containment tree. A record A "contains" B when:
 *   A.start <= B.start AND A.start + A.duration >= B.start + B.duration
 * We pick the tightest (smallest-duration) container as parent.
 */
function buildTree(records: ProfileRecord[]): TreeNode[] {
  if (records.length === 0) return [];

  // Sort: earlier start first, longer duration first (parents before children)
  const sorted = [...records].sort(
    (a, b) => a.start - b.start || b.duration - a.duration,
  );

  // Stable IDs from record content (disambiguated by occurrence count)
  const idCounts = new Map<string, number>();
  function makeId(r: ProfileRecord): string {
    const base = `${r.start.toFixed(3)}|${r.category}|${r.name}`;
    const n = idCounts.get(base) ?? 0;
    idCounts.set(base, n + 1);
    return n === 0 ? base : `${base}#${n}`;
  }

  const nodes: TreeNode[] = sorted.map(r => ({
    id: makeId(r),
    record: r,
    children: [],
    depth: 0,
  }));
  const roots: TreeNode[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const c = nodes[i].record;
    const cEnd = c.start + c.duration;
    let bestParent: TreeNode | null = null;

    for (let j = 0; j < i; j++) {
      const p = nodes[j].record;
      const pEnd = p.start + p.duration;
      if (p.start <= c.start && pEnd >= cEnd) {
        if (!bestParent || p.duration < bestParent.record.duration) {
          bestParent = nodes[j];
        }
      }
    }

    if (bestParent) {
      bestParent.children.push(nodes[i]);
      nodes[i].depth = bestParent.depth + 1;
    } else {
      roots.push(nodes[i]);
    }
  }

  return roots;
}

// ─── Layout ──────────────────────────────────────────────────────────────────

interface LayoutItem {
  record: ProfileRecord;
  nodeId: string;
  depth: number;
  row: number;
  hasChildren: boolean;
}

/**
 * Flatten the tree into row assignments, respecting collapsed state.
 *
 * Each node occupies one row. Its children are laid out directly below:
 *   Children are grouped into temporal clusters: overlapping children form
 *   a group. Each group is rendered in chronological order:
 *     - All-leaf groups are lane-packed for compactness.
 *     - Mixed/block groups render each child in time order.
 *
 * This keeps parallel calls (batched RPCs) visually adjacent and maintains
 * chronological order between sequential circuit executions and their
 * surrounding oracle calls.
 */
function layoutTree(
  roots: TreeNode[],
  expanded: Set<string>,
): { items: LayoutItem[]; expandableIds: Set<string> } {
  const items: LayoutItem[] = [];
  const expandableIds = new Set<string>();
  let nextRow = 0;

  // Only true leaves get lane-packed. Nodes with children always get their
  // own row so each has its own label + collapse triangle.
  function isLeafLike(node: TreeNode): boolean {
    return node.children.length === 0;
  }

  function visitNode(node: TreeNode) {
    if (node.children.length > 0) expandableIds.add(node.id);

    items.push({
      record: node.record,
      nodeId: node.id,
      depth: node.depth,
      row: nextRow,
      hasChildren: node.children.length > 0,
    });
    nextRow++;

    if (!expanded.has(node.id) || node.children.length === 0) return;

    const children = [...node.children].sort(
      (a, b) => a.record.start - b.record.start,
    );

    // Group children into temporal clusters.
    // Children whose time ranges overlap form a group. This keeps parallel
    // calls (e.g. batched RPCs) together and preserves chronological order
    // between sequential blocks and their surrounding oracle calls.
    type Group = { nodes: TreeNode[]; end: number };
    const groups: Group[] = [];
    for (const child of children) {
      const childEnd = child.record.start + child.record.duration;
      const last = groups[groups.length - 1];
      if (last && child.record.start < last.end) {
        last.nodes.push(child);
        last.end = Math.max(last.end, childEnd);
      } else {
        groups.push({ nodes: [child], end: childEnd });
      }
    }

    for (const group of groups) {
      const allLeafLike = group.nodes.every(c => isLeafLike(c));

      if (allLeafLike) {
        // All leaves → lane-pack for compactness
        const laneEnds: number[] = [];
        const baseRow = nextRow;
        for (const child of group.nodes) {
          const end = child.record.start + child.record.duration;
          let lane = laneEnds.findIndex(e => child.record.start >= e);
          if (lane === -1) {
            lane = laneEnds.length;
            laneEnds.push(0);
          }
          laneEnds[lane] = end;
          items.push({
            record: child.record,
            nodeId: child.id,
            depth: child.depth,
            row: baseRow + lane,
            hasChildren: false,
          });
        }
        nextRow += Math.max(1, laneEnds.length);
      } else {
        // Mixed group or blocks → each child in time order
        for (const child of group.nodes) {
          if (isLeafLike(child)) {
            items.push({
              record: child.record,
              nodeId: child.id,
              depth: child.depth,
              row: nextRow,
              hasChildren: false,
            });
            nextRow++;
          } else {
            visitNode(child);
          }
        }
      }
    }
  }

  const sorted = [...roots].sort((a, b) => a.record.start - b.record.start);
  for (const root of sorted) {
    visitNode(root);
  }

  return { items, expandableIds };
}

// ─── Waterfall chart ─────────────────────────────────────────────────────────

interface ViewRange {
  start: number;
  end: number;
}

interface HoverInfo {
  item: LayoutItem;
  x: number;
  y: number;
}

function WaterfallChart({ report, minDuration }: { report: ProfileReport; minDuration: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [viewportW, setViewportW] = useState(800);
  // Zoom: 1 = fit everything, 2 = 2x, etc.
  const [zoom, setZoom] = useState(1);
  // Everything starts collapsed; click a bar to expand it.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Filter records by min duration
  const filtered = useMemo(
    () => report.records.filter(r => r.duration >= minDuration),
    [report, minDuration],
  );

  // Build stable tree (doesn't depend on expand state)
  const tree = useMemo(() => buildTree(filtered), [filtered]);

  // Helper maps for sibling-aware expand/collapse
  const { parentMap, childrenMap } = useMemo(() => {
    const pMap = new Map<string, string | null>();
    const cMap = new Map<string, string[]>();
    function walk(node: TreeNode, parentId: string | null) {
      pMap.set(node.id, parentId);
      cMap.set(node.id, node.children.map(c => c.id));
      for (const child of node.children) walk(child, node.id);
    }
    for (const root of tree) walk(root, null);
    return { parentMap: pMap, childrenMap: cMap };
  }, [tree]);

  // Root IDs for sibling lookup of top-level nodes
  const rootIds = useMemo(() => tree.map(r => r.id), [tree]);

  // Toggle expand: expanding a node collapses its siblings (accordion style)
  const toggleExpand = useCallback((nodeId: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        // Collapse: remove this node + all its descendants
        next.delete(nodeId);
        const removeDesc = (id: string) => {
          for (const child of childrenMap.get(id) ?? []) {
            next.delete(child);
            removeDesc(child);
          }
        };
        removeDesc(nodeId);
      } else {
        // Expand: collapse siblings first (accordion), then expand this
        const parentId = parentMap.get(nodeId);
        const siblings = parentId != null
          ? (childrenMap.get(parentId) ?? [])
          : rootIds;
        const removeDesc = (id: string) => {
          for (const child of childrenMap.get(id) ?? []) {
            next.delete(child);
            removeDesc(child);
          }
        };
        for (const sib of siblings) {
          if (sib !== nodeId) {
            next.delete(sib);
            removeDesc(sib);
          }
        }
        next.add(nodeId);
      }
      return next;
    });
  }, [parentMap, childrenMap, rootIds]);

  // Layout (depends on expand state)
  const { items: layout, expandableIds } = useMemo(
    () => layoutTree(tree, expanded),
    [tree, expanded],
  );
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const numRows = layout.length > 0 ? Math.max(...layout.map(l => l.row)) + 1 : 1;
  const canvasH = numRows * ROW_STEP + 4;
  const totalMs = report.durationMs;

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      setCanvasW(entries[0].contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Draw ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasW * dpr;
    canvas.height = canvasH * dpr;
    ctx.scale(dpr, dpr);

    const { start: vs, end: ve } = view;
    const span = ve - vs || 1;
    const chartW = canvasW - LABEL_W;
    const msToX = (ms: number) => LABEL_W + ((ms - vs) / span) * chartW;

    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.font = FONT;

    // Alternating row backgrounds
    for (let r = 0; r < numRows; r++) {
      const y = r * ROW_STEP;
      ctx.fillStyle = r % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0)';
      ctx.fillRect(0, y, canvasW, ROW_STEP);
    }

    // Separator line
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(LABEL_W, 0);
    ctx.lineTo(LABEL_W, canvasH);
    ctx.stroke();

    // Grid lines
    const rawStep = span / 6;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
    const step = [1, 2, 5, 10].map(n => n * mag).find(s => span / s <= 8) ?? mag;
    const firstTick = Math.ceil(vs / step) * step;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    for (let t = firstTick; t <= ve; t += step) {
      const x = Math.round(msToX(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvasH);
      ctx.stroke();
    }

    // Bars + labels
    const drawnLabelRows = new Set<number>();
    for (const item of layout) {
      const r = item.record;
      const rEnd = r.start + r.duration;
      if (rEnd < vs || r.start > ve) continue;

      const x = msToX(Math.max(r.start, vs));
      const w = Math.max(MIN_BAR_PX, msToX(Math.min(rEnd, ve)) - x);
      const y = item.row * ROW_STEP + 1;
      const color = CATEGORY_COLORS[r.category];

      // Bar
      ctx.fillStyle = r.error ? '#e53935' : color;
      ctx.globalAlpha = r.category === 'wasm' ? 0.7 : 0.85;
      ctx.fillRect(x, y, w, ROW_H - 1);
      ctx.globalAlpha = 1;

      // Bar label (inside bar if wide enough)
      if (w > 50) {
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + 2, y, w - 4, ROW_H);
        ctx.clip();
        ctx.fillText(`${r.name} ${fmt(r.duration)}`, x + 3, y + ROW_H - 6);
        ctx.restore();
      }

      // Row label (left column, first item per row wins)
      if (!drawnLabelRows.has(item.row)) {
        drawnLabelRows.add(item.row);
        const indent = item.depth * INDENT_PX;
        const labelX = 4 + indent;
        const cy = y + ROW_H / 2;

        // Collapse triangle for expandable nodes
        if (item.hasChildren) {
          const isExp = expanded.has(item.nodeId);
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          ctx.beginPath();
          if (isExp) {
            // ▼ expanded
            ctx.moveTo(labelX, cy - 3);
            ctx.lineTo(labelX + 8, cy - 3);
            ctx.lineTo(labelX + 4, cy + 4);
          } else {
            // ▶ collapsed
            ctx.moveTo(labelX, cy - 4);
            ctx.lineTo(labelX, cy + 4);
            ctx.lineTo(labelX + 7, cy);
          }
          ctx.closePath();
          ctx.fill();
        }

        // Label text
        const textX = labelX + (item.hasChildren ? 11 : 0);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.save();
        ctx.beginPath();
        ctx.rect(textX, y + 2, LABEL_W - textX - 4, ROW_H - 2);
        ctx.clip();
        ctx.fillText(r.name, textX, y + ROW_H - 6);
        ctx.restore();
      }
    }
  }, [view, canvasW, canvasH, layout, numRows, expanded]);

  // ── Hit test (chart area) ──────────────────────────────────────────────────
  const hitTest = useCallback((clientX: number, clientY: number): LayoutItem | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < LABEL_W) return null;
    const { start: vs, end: ve } = viewRef.current;
    const span = ve - vs || 1;
    const chartW = rect.width - LABEL_W;
    const ms = vs + ((x - LABEL_W) / chartW) * span;
    const row = Math.floor(y / ROW_STEP);
    let best: LayoutItem | null = null;
    for (const item of layoutRef.current) {
      if (item.row !== row) continue;
      const r = item.record;
      if (ms >= r.start && ms <= r.start + r.duration) {
        if (!best || r.duration < best.record.duration) best = item;
      }
    }
    return best;
  }, []);

  // ── Hit test (label area — for collapse toggle) ────────────────────────────
  const hitLabel = useCallback((clientX: number, clientY: number): LayoutItem | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    if (x >= LABEL_W) return null;
    const y = clientY - rect.top;
    const row = Math.floor(y / ROW_STEP);
    for (const item of layoutRef.current) {
      if (item.row === row && item.hasChildren) return item;
    }
    return null;
  }, []);

  // ── Mouse events ───────────────────────────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    // Don't start drag in label area (that's for collapse toggle)
    if (x < LABEL_W) return;
    dragRef.current = { x0: x, moved: false };
    setDragX({ x0: x, x1: x });
    setHover(null);
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;

    if (dragRef.current) {
      const x1 = x;
      if (Math.abs(x1 - dragRef.current.x0) > 3) dragRef.current.moved = true;
      setDragX({ x0: dragRef.current.x0, x1 });
      return;
    }

    if (x < LABEL_W) {
      // Label area — show pointer if expandable node
      const item = hitLabel(e.clientX, e.clientY);
      canvas.style.cursor = item ? 'pointer' : 'default';
      setHover(null);
      return;
    }

    const item = hitTest(e.clientX, e.clientY);
    if (item) {
      setHover({ item, x: e.clientX, y: e.clientY });
      canvas.style.cursor = 'pointer';
    } else {
      setHover(null);
      canvas.style.cursor = 'crosshair';
    }
  }, [hitTest, hitLabel]);

  const onMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;

    // Label area click → toggle expand/collapse
    if (x < LABEL_W && !dragRef.current) {
      const item = hitLabel(e.clientX, e.clientY);
      if (item) toggleExpand(item.nodeId);
      return;
    }

    if (!dragRef.current) return;
    const { x0, moved } = dragRef.current;
    dragRef.current = null;
    setDragX(null);

    // Single click on a bar → expand/collapse it
    if (!moved || Math.abs(x - x0) < 4) {
      const item = hitTest(e.clientX, e.clientY);
      if (item?.hasChildren) toggleExpand(item.nodeId);
      return;
    }

    // Drag → zoom
    const { start: vs, end: ve } = viewRef.current;
    const span = ve - vs;
    const chartW = rect.width - LABEL_W;
    const lo = Math.max(0, Math.min(x0, x) - LABEL_W);
    const hi = Math.max(0, Math.max(x0, x) - LABEL_W);
    const newStart = vs + (lo / chartW) * span;
    const newEnd = vs + (hi / chartW) * span;
    if (newEnd > newStart) setView({ start: newStart, end: newEnd });
  }, [hitLabel, hitTest, toggleExpand]);

  const onDblClick = useCallback(() => {
    setView({ start: 0, end: totalMs });
  }, [totalMs]);

  const onMouseLeave = useCallback(() => {
    if (dragRef.current) {
      dragRef.current = null;
      setDragX(null);
    }
    setHover(null);
  }, []);

  const isZoomed = view.end - view.start < totalMs * 0.99;

  return (
    <Box sx={{ fontFamily: 'monospace', userSelect: 'none' }}>
      {/* Toolbar */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <Typography sx={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', flexGrow: 1 }}>
          {isZoomed
            ? `${fmt(view.start)} \u2013 ${fmt(view.end)} (${fmt(view.end - view.start)})  \u00b7  drag to zoom  \u00b7  dbl-click reset`
            : `${fmt(totalMs)} total  \u00b7  ${filtered.length} spans  \u00b7  drag to zoom  \u00b7  click labels to collapse`}
        </Typography>
        {isZoomed && (
          <Button size="small" variant="text"
            onClick={() => setView({ start: 0, end: totalMs })}
            sx={{ fontSize: 9, py: 0, px: 0.5, minWidth: 0, color: 'rgba(255,255,255,0.5)' }}>
            reset zoom
          </Button>
        )}
        {expanded.size > 0 && (
          <Button size="small" variant="text"
            onClick={() => setExpanded(new Set())}
            sx={{ fontSize: 9, py: 0, px: 0.5, minWidth: 0, color: 'rgba(255,255,255,0.5)' }}>
            collapse all
          </Button>
        )}
        {expanded.size < expandableIds.size && expandableIds.size > 0 && (
          <Button size="small" variant="text"
            onClick={() => setExpanded(new Set(expandableIds))}
            sx={{ fontSize: 9, py: 0, px: 0.5, minWidth: 0, color: 'rgba(255,255,255,0.5)' }}>
            expand all
          </Button>
        )}
      </Box>

      {/* Canvas */}
      <Box ref={containerRef} sx={{ position: 'relative', minWidth: 0 }}>
        <canvas
          ref={canvasRef}
          width={canvasW}
          height={canvasH}
          style={{ display: 'block', width: '100%', height: canvasH, cursor: 'crosshair' }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseLeave}
          onDoubleClick={onDblClick}
        />
        {dragX && (() => {
          const left = Math.min(dragX.x0, dragX.x1);
          const width = Math.abs(dragX.x1 - dragX.x0);
          return (
            <Box sx={{
              position: 'absolute', top: 0, bottom: 0, left, width,
              backgroundColor: 'rgba(212,255,40,0.12)',
              border: '1px solid rgba(212,255,40,0.5)',
              pointerEvents: 'none',
            }} />
          );
        })()}
      </Box>

      {/* Time axis */}
      <Box sx={{ position: 'relative', height: 14, mt: 0.25 }}>
        {(() => {
          const { start: vs, end: ve } = view;
          const span = ve - vs || 1;
          const rawStep = span / 6;
          const mag = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
          const step = [1, 2, 5, 10].map(n => n * mag).find(s => span / s <= 8) ?? mag;
          const first = Math.ceil(vs / step) * step;
          const ticks: number[] = [];
          for (let t = first; t <= ve; t += step) ticks.push(t);
          return ticks.map(t => (
            <Box key={t} sx={{
              position: 'absolute',
              left: `calc(${LABEL_W}px + (100% - ${LABEL_W}px) * ${(t - vs) / span})`,
              transform: 'translateX(-50%)',
            }}>
              <Typography sx={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                {fmt(t)}
              </Typography>
            </Box>
          ));
        })()}
      </Box>

      {/* Legend */}
      <Box sx={{ display: 'flex', gap: 1.5, mt: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
        {(Object.entries(CATEGORY_COLORS) as [Category, string][]).map(([cat, color]) => (
          <Box key={cat} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 10, height: 10, backgroundColor: color, borderRadius: '2px' }} />
            <Typography sx={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>{cat}</Typography>
          </Box>
        ))}
      </Box>

      {/* Tooltip */}
      {hover && <SpanTooltip info={hover} totalMs={totalMs} />}
    </Box>
  );
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────

function SpanTooltip({ info, totalMs }: { info: HoverInfo; totalMs: number }) {
  const { record } = info.item;
  const color = record.error ? '#e53935' : CATEGORY_COLORS[record.category];
  return (
    <Paper elevation={12} sx={{
      position: 'fixed',
      left: Math.min(info.x + 14, window.innerWidth - 320),
      top: Math.min(info.y + 14, window.innerHeight - 200),
      zIndex: 99999, p: 1.5, maxWidth: 300, maxHeight: 250, overflow: 'auto',
      backgroundColor: 'rgba(18,18,28,0.98)', border: `1px solid ${color}`,
      pointerEvents: 'none',
    }}>
      <Typography sx={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color, mb: 0.5, wordBreak: 'break-all' }}>
        {record.name}
      </Typography>
      <Typography sx={{ fontSize: 10, color: 'rgba(255,255,255,0.65)' }}>
        {record.category} &middot; {fmt(record.start)} &rarr; {fmt(record.start + record.duration)} &middot; {fmt(record.duration)} &middot; {((record.duration / totalMs) * 100).toFixed(1)}%
      </Typography>
      {record.detail && (
        <Typography sx={{ fontSize: 9, color: 'rgba(255,255,255,0.45)', mt: 0.5 }}>
          {record.detail}
        </Typography>
      )}
    </Paper>
  );
}

// ─── Summary table ───────────────────────────────────────────────────────────

function SummaryTable({ report, minDuration }: { report: ProfileReport; minDuration: number }) {
  const filtered = report.records.filter(r => r.duration >= minDuration);

  // Aggregate by category
  const byCat = new Map<Category, { count: number; totalMs: number }>();
  for (const r of filtered) {
    const entry = byCat.get(r.category) ?? { count: 0, totalMs: 0 };
    entry.count++;
    entry.totalMs += r.duration;
    byCat.set(r.category, entry);
  }

  // Circuit executions (sim category) — all of them, not just top N
  const simAgg = new Map<string, { count: number; totalMs: number; maxMs: number }>();
  for (const r of report.records.filter(r => r.category === 'sim')) {
    const entry = simAgg.get(r.name) ?? { count: 0, totalMs: 0, maxMs: 0 };
    entry.count++;
    entry.totalMs += r.duration;
    if (r.duration > entry.maxMs) entry.maxMs = r.duration;
    simAgg.set(r.name, entry);
  }
  const allSim = [...simAgg.entries()]
    .sort((a, b) => b[1].totalMs - a[1].totalMs);

  // Top WASM operations by total time
  const wasmAgg = new Map<string, { count: number; totalMs: number; maxMs: number }>();
  for (const r of report.records.filter(r => r.category === 'wasm')) {
    const entry = wasmAgg.get(r.name) ?? { count: 0, totalMs: 0, maxMs: 0 };
    entry.count++;
    entry.totalMs += r.duration;
    if (r.duration > entry.maxMs) entry.maxMs = r.duration;
    wasmAgg.set(r.name, entry);
  }
  const topWasm = [...wasmAgg.entries()]
    .sort((a, b) => b[1].totalMs - a[1].totalMs)
    .slice(0, 15);

  // Top RPC calls
  const rpcAgg = new Map<string, { count: number; totalMs: number; maxMs: number }>();
  for (const r of report.records.filter(r => r.category === 'rpc')) {
    const entry = rpcAgg.get(r.name) ?? { count: 0, totalMs: 0, maxMs: 0 };
    entry.count++;
    entry.totalMs += r.duration;
    if (r.duration > entry.maxMs) entry.maxMs = r.duration;
    rpcAgg.set(r.name, entry);
  }
  const topRpc = [...rpcAgg.entries()]
    .sort((a, b) => b[1].totalMs - a[1].totalMs)
    .slice(0, 15);

  const tableStyle = { fontSize: 10, color: 'rgba(255,255,255,0.6)', fontFamily: 'monospace', py: 0.25, px: 1 };

  return (
    <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', mt: 2 }}>
      {/* Category breakdown */}
      <Box>
        <Typography sx={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', mb: 0.5, fontWeight: 700 }}>
          BY CATEGORY
        </Typography>
        <Box component="table" sx={{ borderCollapse: 'collapse' }}>
          <tbody>
            {([...byCat.entries()] as [Category, { count: number; totalMs: number }][])
              .sort((a, b) => b[1].totalMs - a[1].totalMs)
              .map(([cat, { count, totalMs }]) => (
                <tr key={cat}>
                  <Box component="td" sx={{ ...tableStyle, color: CATEGORY_COLORS[cat], fontWeight: 700 }}>{cat}</Box>
                  <Box component="td" sx={{ ...tableStyle, textAlign: 'right' }}>{count}</Box>
                  <Box component="td" sx={{ ...tableStyle, textAlign: 'right' }}>{fmt(totalMs)}</Box>
                </tr>
              ))}
          </tbody>
        </Box>
      </Box>

      {/* Circuit executions */}
      {allSim.length > 0 && (
        <Box>
          <Typography sx={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', mb: 0.5, fontWeight: 700 }}>
            CIRCUIT EXECUTIONS
          </Typography>
          <Box component="table" sx={{ borderCollapse: 'collapse' }}>
            <tbody>
              {allSim.map(([name, { count, totalMs, maxMs }]) => (
                <tr key={name}>
                  <Box component="td" sx={{ ...tableStyle, color: CATEGORY_COLORS.sim, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</Box>
                  <Box component="td" sx={{ ...tableStyle, textAlign: 'right' }}>&times;{count}</Box>
                  <Box component="td" sx={{ ...tableStyle, textAlign: 'right' }}>{fmt(totalMs)}</Box>
                  <Box component="td" sx={{ ...tableStyle, textAlign: 'right', color: 'rgba(255,255,255,0.35)' }}>max {fmt(maxMs)}</Box>
                </tr>
              ))}
            </tbody>
          </Box>
        </Box>
      )}

      {/* Top WASM ops */}
      {topWasm.length > 0 && (
        <Box>
          <Typography sx={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', mb: 0.5, fontWeight: 700 }}>
            TOP WASM
          </Typography>
          <Box component="table" sx={{ borderCollapse: 'collapse' }}>
            <tbody>
              {topWasm.map(([name, { count, totalMs, maxMs }]) => (
                <tr key={name}>
                  <Box component="td" sx={{ ...tableStyle, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</Box>
                  <Box component="td" sx={{ ...tableStyle, textAlign: 'right' }}>&times;{count}</Box>
                  <Box component="td" sx={{ ...tableStyle, textAlign: 'right' }}>{fmt(totalMs)}</Box>
                  <Box component="td" sx={{ ...tableStyle, textAlign: 'right', color: 'rgba(255,255,255,0.35)' }}>max {fmt(maxMs)}</Box>
                </tr>
              ))}
            </tbody>
          </Box>
        </Box>
      )}

      {/* Top RPC calls */}
      {topRpc.length > 0 && (
        <Box>
          <Typography sx={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', mb: 0.5, fontWeight: 700 }}>
            TOP RPC
          </Typography>
          <Box component="table" sx={{ borderCollapse: 'collapse' }}>
            <tbody>
              {topRpc.map(([name, { count, totalMs, maxMs }]) => (
                <tr key={name}>
                  <Box component="td" sx={{ ...tableStyle, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</Box>
                  <Box component="td" sx={{ ...tableStyle, textAlign: 'right' }}>&times;{count}</Box>
                  <Box component="td" sx={{ ...tableStyle, textAlign: 'right' }}>{fmt(totalMs)}</Box>
                  <Box component="td" sx={{ ...tableStyle, textAlign: 'right', color: 'rgba(255,255,255,0.35)' }}>max {fmt(maxMs)}</Box>
                </tr>
              ))}
            </tbody>
          </Box>
        </Box>
      )}
    </Box>
  );
}

// ─── Full-screen profile page (portal) ──────────────────────────────────────

function ProfilePage({ report, onClose }: { report: ProfileReport; onClose: () => void }) {
  const [minDuration, setMinDuration] = useState(0.5);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return createPortal(
    <Box sx={{
      position: 'fixed', inset: 0, zIndex: 99998,
      backgroundColor: 'rgba(8,8,14,0.98)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1, flexShrink: 0,
        borderBottom: '1px solid rgba(212,255,40,0.15)', backgroundColor: 'rgba(10,10,18,0.98)',
      }}>
        <Typography sx={{ color: 'rgba(212,255,40,0.9)', fontWeight: 700, fontSize: 12, fontFamily: 'monospace' }}>
          PROFILE \u2014 {report.name} \u2014 {fmt(report.durationMs)}
        </Typography>
        <Chip label={`${report.records.length} spans`} size="small"
          sx={{ fontSize: 9, height: 16, backgroundColor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)' }} />
        <Box sx={{ flexGrow: 1 }} />

        {/* Min duration filter */}
        <Typography sx={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace', mr: 0.5 }}>
          min {fmt(minDuration)}
        </Typography>
        <Slider
          size="small"
          min={0} max={50} step={0.5}
          value={minDuration}
          onChange={(_, v) => setMinDuration(v as number)}
          sx={{ width: 100, color: 'rgba(212,255,40,0.5)', '& .MuiSlider-thumb': { width: 10, height: 10 } }}
        />

        <Button size="small" variant="text"
          onClick={() => profiler.download(report)}
          sx={{ fontSize: 10, py: 0.25, minWidth: 0, color: 'rgba(255,255,255,0.5)' }}>
          JSON
        </Button>
        <Button size="small" variant="outlined"
          onClick={onClose}
          sx={{ fontSize: 10, py: 0.25, minWidth: 0, ml: 1 }}>
          Close
        </Button>
      </Box>

      {/* Body */}
      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        <WaterfallChart report={report} minDuration={minDuration} />
        <SummaryTable report={report} minDuration={minDuration} />
      </Box>
    </Box>,
    document.body,
  );
}

// ─── Main panel — compact pill ──────────────────────────────────────────────

export function ProfilePanel() {
  const [enabled] = useState(() => new URLSearchParams(location.search).has('profile'));
  const [recording, setRecording] = useState(false);
  const [report, setReport] = useState<ProfileReport | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const instrumentedRef = useRef(false);
  const { wallet } = useWallet();

  // Install global interceptors on mount
  useEffect(() => {
    if (!enabled) return;
    profiler.install();
  }, [enabled]);

  // Instrument wallet when available
  useEffect(() => {
    if (!enabled || !wallet || instrumentedRef.current) return;
    profiler.instrumentWallet(wallet);
    instrumentedRef.current = true;
    console.info('[profiler] Wallet instrumented');
  }, [enabled, wallet]);

  const handleToggle = useCallback(() => {
    if (recording) {
      const r = profiler.stop();
      setReport(r);
      setRecording(false);
      setFullscreen(true);
    } else {
      profiler.start('profile');
      setRecording(true);
      setReport(null);
    }
  }, [recording]);

  if (!enabled) return null;

  return (
    <>
      <Paper elevation={8} sx={{
        position: 'fixed', bottom: 16, left: 16, zIndex: 9999,
        display: 'flex', alignItems: 'center', gap: 0.75,
        px: 1.25, py: 0.75,
        backgroundColor: 'rgba(14,14,20,0.97)',
        border: '1px solid rgba(212,255,40,0.25)',
        borderRadius: '20px', userSelect: 'none',
      }}>
        <Box sx={{
          width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
          backgroundColor: recording ? '#f44336' : '#4caf50',
          ...(recording && { animation: 'pp 1s infinite', '@keyframes pp': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.3 } } }),
        }} />
        <Typography sx={{ fontFamily: 'monospace', color: 'rgba(212,255,40,0.9)', fontWeight: 700, fontSize: 10 }}>
          PROF
        </Typography>
        <Button
          size="small"
          variant={recording ? 'outlined' : 'contained'}
          color={recording ? 'error' : 'primary'}
          onClick={handleToggle}
          sx={{ fontSize: 9, py: 0.1, px: 1, minWidth: 0, borderRadius: '12px' }}
        >
          {recording ? 'Stop' : 'Rec'}
        </Button>
        {report && !recording && (
          <>
            <Chip
              label={fmt(report.durationMs)}
              size="small"
              onClick={() => setFullscreen(true)}
              sx={{ fontSize: 9, height: 18, cursor: 'pointer', backgroundColor: 'rgba(212,255,40,0.15)', color: 'rgba(212,255,40,0.9)', '&:hover': { backgroundColor: 'rgba(212,255,40,0.25)' } }}
            />
            <Tooltip title="Open profile">
              <Button size="small" variant="text" onClick={() => setFullscreen(true)}
                sx={{ fontSize: 9, py: 0, px: 0.5, minWidth: 0, color: 'rgba(255,255,255,0.5)' }}>
                view
              </Button>
            </Tooltip>
            <Tooltip title="Download JSON">
              <Button size="small" variant="text" onClick={() => profiler.download(report)}
                sx={{ fontSize: 9, py: 0, px: 0.5, minWidth: 0, color: 'rgba(255,255,255,0.5)' }}>
                JSON
              </Button>
            </Tooltip>
          </>
        )}
      </Paper>

      {fullscreen && report && <ProfilePage report={report} onClose={() => setFullscreen(false)} />}
    </>
  );
}
