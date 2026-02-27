import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Spinner, HTMLSelect } from '@blueprintjs/core';
import { RefreshCw, ZoomIn, ZoomOut, Maximize, WandSparkles, Download } from 'lucide-react';
import ReactFlow, {
  applyNodeChanges,
  BaseEdge,
  Background,
  Controls,
  EdgeLabelRenderer,
  getNodesBounds,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  useStore,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
} from 'reactflow';
import dagre from 'dagre';
import { toPng, toJpeg } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import type { ConnectionProfile } from '../../types';
import { metadataApi, type ErDiagramColumnRecord, type ErDiagramForeignKeyRecord } from '../../hooks/useTauri';
import { useAppStore } from '../../stores';
import { showExportSuccessNotice, showExportFailedNotice } from '../../utils/toolbarNotice';
import 'reactflow/dist/style.css';
import '../../styles/er-diagram-tab.css';

interface ERDiagramTabProps {
  tabId: string;
  connectionProfile: ConnectionProfile;
  database: string;
}

interface ErColumn {
  name: string;
  type: string;
  keyType: string;
}

interface RelationshipData {
  edgeId: string;
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  constraintName: string;
  label: string;
}

interface TableNodeData {
  tableName: string;
  nodeWidth: number;
  columns: ErColumn[];
  highlightedColumns: string[];
  onFieldHover: (tableName: string, columnName: string) => void;
  onFieldLeave: () => void;
}

interface RelationEdgeData {
  label: string;
  isHighlighted: boolean;
  routeBias?: number;
}

type ExportFormat = 'png' | 'jpg' | 'pdf' | 'sql';
type ExportMode = 'current' | 'full';

const NODE_HEADER_HEIGHT = 36;
const NODE_ROW_HEIGHT = 26;
const NODE_MIN_WIDTH = 260;
const ISOLATED_COLUMNS = 3;
const EDGE_STUB = 24;
const EDGE_OUTER_GAP = 70;
const EDGE_OBSTACLE_PADDING = 12;
const EDGE_CORRIDOR_MARGIN = 280;
const MIN_COMFORTABLE_ZOOM = 0.72;
const EDGE_CORNER_RADIUS = 10;

const getColumnHandleKey = (columnName: string): string => encodeURIComponent(columnName);
const getSourceHandleIdBySide = (columnName: string, side: 'left' | 'right'): string =>
  side === 'left' ? `srcL-${getColumnHandleKey(columnName)}` : `srcR-${getColumnHandleKey(columnName)}`;
const getTargetHandleIdBySide = (columnName: string, side: 'left' | 'right'): string =>
  side === 'left' ? `dstL-${getColumnHandleKey(columnName)}` : `dstR-${getColumnHandleKey(columnName)}`;

interface Point {
  x: number;
  y: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const toVec = (position: Position): Point => {
  switch (position) {
    case Position.Left:
      return { x: -1, y: 0 };
    case Position.Right:
      return { x: 1, y: 0 };
    case Position.Top:
      return { x: 0, y: -1 };
    case Position.Bottom:
      return { x: 0, y: 1 };
    default:
      return { x: 1, y: 0 };
  }
};

const segmentIntersectsRect = (a: Point, b: Point, rect: Rect): boolean => {
  const rx1 = rect.x;
  const ry1 = rect.y;
  const rx2 = rect.x + rect.width;
  const ry2 = rect.y + rect.height;

  if (Math.abs(a.x - b.x) < 0.1) {
    const x = a.x;
    if (x < rx1 || x > rx2) {
      return false;
    }
    const yMin = Math.min(a.y, b.y);
    const yMax = Math.max(a.y, b.y);
    return yMax >= ry1 && yMin <= ry2;
  }

  if (Math.abs(a.y - b.y) < 0.1) {
    const y = a.y;
    if (y < ry1 || y > ry2) {
      return false;
    }
    const xMin = Math.min(a.x, b.x);
    const xMax = Math.max(a.x, b.x);
    return xMax >= rx1 && xMin <= rx2;
  }

  return false;
};

const polylineLength = (points: Point[]): number => {
  let length = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    length += Math.abs(points[i + 1].x - points[i].x) + Math.abs(points[i + 1].y - points[i].y);
  }
  return length;
};

const getPointAtHalfLength = (points: Point[]): Point => {
  const total = polylineLength(points);
  const half = total / 2;
  let acc = 0;

  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const seg = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (acc + seg >= half) {
      const remain = half - acc;
      if (Math.abs(a.x - b.x) < 0.1) {
        const dir = b.y >= a.y ? 1 : -1;
        return { x: a.x, y: a.y + dir * remain };
      }
      const dir = b.x >= a.x ? 1 : -1;
      return { x: a.x + dir * remain, y: a.y };
    }
    acc += seg;
  }

  return points[Math.floor(points.length / 2)] || { x: 0, y: 0 };
};

const toPath = (points: Point[]): string => {
  if (points.length === 0) {
    return '';
  }
  return points.reduce((path, point, index) => {
    if (index === 0) {
      return `M ${point.x} ${point.y}`;
    }
    return `${path} L ${point.x} ${point.y}`;
  }, '');
};

const toRoundedOrthogonalPath = (points: Point[], radius: number): string => {
  if (points.length === 0) {
    return '';
  }
  if (points.length < 3) {
    return toPath(points);
  }

  const pathParts: string[] = [`M ${points[0].x} ${points[0].y}`];

  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    const inDx = curr.x - prev.x;
    const inDy = curr.y - prev.y;
    const outDx = next.x - curr.x;
    const outDy = next.y - curr.y;

    const inLen = Math.abs(inDx) + Math.abs(inDy);
    const outLen = Math.abs(outDx) + Math.abs(outDy);

    if (inLen < 0.1 || outLen < 0.1) {
      pathParts.push(`L ${curr.x} ${curr.y}`);
      continue;
    }

    const inUnit = { x: inDx / inLen, y: inDy / inLen };
    const outUnit = { x: outDx / outLen, y: outDy / outLen };
    const sameDirection = Math.abs(inUnit.x - outUnit.x) < 0.01 && Math.abs(inUnit.y - outUnit.y) < 0.01;
    if (sameDirection) {
      pathParts.push(`L ${curr.x} ${curr.y}`);
      continue;
    }

    const r = Math.min(radius, inLen / 2, outLen / 2);
    const before = { x: curr.x - inUnit.x * r, y: curr.y - inUnit.y * r };
    const after = { x: curr.x + outUnit.x * r, y: curr.y + outUnit.y * r };

    pathParts.push(`L ${before.x} ${before.y}`);
    pathParts.push(`Q ${curr.x} ${curr.y} ${after.x} ${after.y}`);
  }

  const last = points[points.length - 1];
  pathParts.push(`L ${last.x} ${last.y}`);
  return pathParts.join(' ');
};

const edgeHash = (edgeId: string): number => {
  let hash = 0;
  for (let i = 0; i < edgeId.length; i += 1) {
    hash = (hash * 31 + edgeId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
};

const expandedRect = (rect: Rect, padding: number): Rect => ({
  x: rect.x - padding,
  y: rect.y - padding,
  width: rect.width + padding * 2,
  height: rect.height + padding * 2,
});

const rectIntersectsRect = (a: Rect, b: Rect): boolean => {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
};

const scorePath = (points: Point[], obstacles: Rect[]): number => {
  let intersections = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    for (const rect of obstacles) {
      if (segmentIntersectsRect(points[i], points[i + 1], rect)) {
        intersections += 1;
      }
    }
  }
  const length = polylineLength(points);
  const bends = Math.max(0, points.length - 2);
  return intersections * 7000 + length + bends * 22;
};

const chooseOrthogonalPath = (
  edgeId: string,
  source: Point,
  target: Point,
  sourcePosition: Position,
  targetPosition: Position,
  obstacles: Rect[],
  routeBias: number,
): Point[] => {
  const sourceVec = toVec(sourcePosition);
  const targetVec = toVec(targetPosition);
  const sourceStub = { x: source.x + sourceVec.x * EDGE_STUB, y: source.y + sourceVec.y * EDGE_STUB };
  const targetStub = { x: target.x + targetVec.x * EDGE_STUB, y: target.y + targetVec.y * EDGE_STUB };
  const targetTip = { x: target.x + targetVec.x * 8, y: target.y + targetVec.y * 8 };

  const minObstacleX = obstacles.reduce((acc, rect) => Math.min(acc, rect.x), Math.min(source.x, target.x));
  const maxObstacleX = obstacles.reduce((acc, rect) => Math.max(acc, rect.x + rect.width), Math.max(source.x, target.x));
  const minObstacleY = obstacles.reduce((acc, rect) => Math.min(acc, rect.y), Math.min(source.y, target.y));
  const maxObstacleY = obstacles.reduce((acc, rect) => Math.max(acc, rect.y + rect.height), Math.max(source.y, target.y));

  const midX = (sourceStub.x + targetStub.x) / 2;
  const midY = (sourceStub.y + targetStub.y) / 2;
  const laneBias = (edgeHash(edgeId) % 3) - 1;
  const biasedOffset = routeBias * 28 + laneBias * 8;
  const leftLane = minObstacleX - EDGE_OUTER_GAP;
  const rightLane = maxObstacleX + EDGE_OUTER_GAP;
  const topLane = minObstacleY - EDGE_OUTER_GAP;
  const bottomLane = maxObstacleY + EDGE_OUTER_GAP;

  const candidates: Point[][] = [
    [source, sourceStub, { x: midX, y: sourceStub.y }, { x: midX, y: targetStub.y }, targetStub, targetTip],
    [source, sourceStub, { x: sourceStub.x, y: midY }, { x: targetStub.x, y: midY }, targetStub, targetTip],
    [source, sourceStub, { x: midX + biasedOffset, y: sourceStub.y }, { x: midX + biasedOffset, y: targetStub.y }, targetStub, targetTip],
    [source, sourceStub, { x: sourceStub.x, y: midY + biasedOffset }, { x: targetStub.x, y: midY + biasedOffset }, targetStub, targetTip],
    [source, sourceStub, { x: leftLane, y: sourceStub.y }, { x: leftLane, y: targetStub.y }, targetStub, targetTip],
    [source, sourceStub, { x: rightLane, y: sourceStub.y }, { x: rightLane, y: targetStub.y }, targetStub, targetTip],
    [source, sourceStub, { x: sourceStub.x, y: topLane }, { x: targetStub.x, y: topLane }, targetStub, targetTip],
    [source, sourceStub, { x: sourceStub.x, y: bottomLane }, { x: targetStub.x, y: bottomLane }, targetStub, targetTip],
  ];

  let best = candidates[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const score = scorePath(candidate, obstacles);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
};

const getNodeSize = (tableName: string, columns: ErColumn[]) => {
  const contentMaxLen = columns.reduce((maxLen, column) => {
    const pkMarkLen = column.keyType === 'PRI' ? 5 : 0;
    return Math.max(maxLen, column.name.length + column.type.length + pkMarkLen);
  }, tableName.length);

  const width = Math.max(NODE_MIN_WIDTH, contentMaxLen * 8 + 64);
  const height = NODE_HEADER_HEIGHT + columns.length * NODE_ROW_HEIGHT + 8;

  return { width, height };
};

const getEdgeLabel = (rel: Pick<RelationshipData, 'sourceTable' | 'sourceColumn' | 'targetTable' | 'targetColumn'>): string =>
  `${rel.sourceTable}.${rel.sourceColumn}->${rel.targetTable}.${rel.targetColumn}`;

const getEdgeId = (rel: Pick<RelationshipData, 'sourceTable' | 'sourceColumn' | 'targetTable' | 'targetColumn' | 'constraintName'>): string =>
  `${rel.sourceTable}.${getColumnHandleKey(rel.sourceColumn)}->${rel.targetTable}.${getColumnHandleKey(rel.targetColumn)}::${rel.constraintName || 'fk'}`;

const layoutGraph = (
  baseNodes: Array<Node<TableNodeData>>,
  baseEdges: Array<Edge>,
): Array<Node<TableNodeData>> => {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: 'LR',
    nodesep: 96,
    ranksep: 190,
    edgesep: 44,
    ranker: 'tight-tree',
    acyclicer: 'greedy',
  });

  const degreeMap = new Map<string, number>();
  for (const node of baseNodes) {
    degreeMap.set(node.id, 0);
  }

  for (const node of baseNodes) {
    graph.setNode(node.id, {
      width: node.width || NODE_MIN_WIDTH,
      height: node.height || NODE_HEADER_HEIGHT + 80,
    });
  }

  for (const edge of baseEdges) {
    degreeMap.set(edge.source, (degreeMap.get(edge.source) || 0) + 1);
    degreeMap.set(edge.target, (degreeMap.get(edge.target) || 0) + 1);
    graph.setEdge(edge.source, edge.target, { weight: 2, minlen: 1 });
  }

  dagre.layout(graph);

  const connectedNodes = baseNodes.filter((node) => (degreeMap.get(node.id) || 0) > 0);
  const isolatedNodes = baseNodes.filter((node) => (degreeMap.get(node.id) || 0) === 0);

  let maxConnectedY = 0;
  for (const node of connectedNodes) {
    const p = graph.node(node.id);
    if (p) {
      maxConnectedY = Math.max(maxConnectedY, p.y + (node.height || NODE_HEADER_HEIGHT + 80) / 2);
    }
  }

  const isolatedStartY = maxConnectedY + 120;

  return baseNodes.map((node, index) => {
    const nodeWithPosition = graph.node(node.id);
    const width = node.width || NODE_MIN_WIDTH;
    const height = node.height || NODE_HEADER_HEIGHT + 80;

    if ((degreeMap.get(node.id) || 0) === 0) {
      const isolatedIndex = isolatedNodes.findIndex((item) => item.id === node.id);
      const col = isolatedIndex % ISOLATED_COLUMNS;
      const row = Math.floor(isolatedIndex / ISOLATED_COLUMNS);
      return {
        ...node,
        position: {
          x: col * (NODE_MIN_WIDTH + 180),
          y: isolatedStartY + row * 220,
        },
      };
    }

    return {
      ...node,
      position: {
        x: (nodeWithPosition?.x || index * 280) - width / 2,
        y: (nodeWithPosition?.y || 0) - height / 2,
      },
    };
  });
};

const ERTableNode: React.FC<NodeProps<TableNodeData>> = ({ data }) => {
  return (
    <div className="er-table-node">
      <div className="er-table-header">{data.tableName}</div>
      <div className="er-table-body">
        {data.columns.map((column) => {
          const isHighlighted = data.highlightedColumns.includes(column.name);

          return (
            <div
              key={`${data.tableName}-${column.name}`}
              className={`er-table-row ${isHighlighted ? 'highlighted' : ''}`}
              onMouseEnter={() => data.onFieldHover(data.tableName, column.name)}
              onMouseLeave={data.onFieldLeave}
              title={`${column.name}: ${column.type}`}
            >
              <Handle
                type="target"
                position={Position.Left}
                id={getTargetHandleIdBySide(column.name, 'left')}
                isConnectable={false}
                className={`er-field-handle er-field-handle-left ${isHighlighted ? 'active' : ''}`}
                style={{ top: '50%' }}
              />
              <Handle
                type="target"
                position={Position.Right}
                id={getTargetHandleIdBySide(column.name, 'right')}
                isConnectable={false}
                className={`er-field-handle er-field-handle-right ${isHighlighted ? 'active' : ''}`}
                style={{ top: '50%' }}
              />
              <span className="er-table-col-name">
                {column.keyType === 'PRI' && <span className="er-table-pk">[PK]</span>}
                {column.name}
              </span>
              <span className="er-table-col-type">{column.type}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={getSourceHandleIdBySide(column.name, 'right')}
                isConnectable={false}
                className={`er-field-handle er-field-handle-right ${isHighlighted ? 'active' : ''}`}
                style={{ top: '50%' }}
              />
              <Handle
                type="source"
                position={Position.Left}
                id={getSourceHandleIdBySide(column.name, 'left')}
                isConnectable={false}
                className={`er-field-handle er-field-handle-left ${isHighlighted ? 'active' : ''}`}
                style={{ top: '50%' }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

const RelationEdge: React.FC<EdgeProps<RelationEdgeData>> = ({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
}) => {
  const nodeInternals = useStore((state) => state.nodeInternals);
  const obstacles = useMemo(() => {
    const rects: Rect[] = [];
    const corridor: Rect = {
      x: Math.min(sourceX, targetX) - EDGE_CORRIDOR_MARGIN,
      y: Math.min(sourceY, targetY) - EDGE_CORRIDOR_MARGIN,
      width: Math.abs(targetX - sourceX) + EDGE_CORRIDOR_MARGIN * 2,
      height: Math.abs(targetY - sourceY) + EDGE_CORRIDOR_MARGIN * 2,
    };

    nodeInternals.forEach((node) => {
      if (!node.width || !node.height || !node.positionAbsolute) {
        return;
      }
      if (node.id === source || node.id === target) {
        return;
      }
      const expanded = expandedRect(
        {
          x: node.positionAbsolute.x,
          y: node.positionAbsolute.y,
          width: node.width,
          height: node.height,
        },
        EDGE_OBSTACLE_PADDING,
      );

      if (rectIntersectsRect(expanded, corridor)) {
        rects.push(expanded);
      }
    });
    return rects;
  }, [nodeInternals, source, sourceX, sourceY, target, targetX, targetY]);

  const routedPoints = useMemo(
    () =>
      chooseOrthogonalPath(
        id,
        { x: sourceX, y: sourceY },
        { x: targetX, y: targetY },
        sourcePosition,
        targetPosition,
        obstacles,
        data?.routeBias || 0,
      ),
    [data?.routeBias, id, obstacles, sourcePosition, sourceX, sourceY, targetPosition, targetX, targetY],
  );

  const edgePath = useMemo(() => toRoundedOrthogonalPath(routedPoints, EDGE_CORNER_RADIUS), [routedPoints]);
  const labelPoint = useMemo(() => getPointAtHalfLength(routedPoints), [routedPoints]);

  const isHighlighted = Boolean(data?.isHighlighted);

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          className={`er-edge-label ${isHighlighted ? 'active' : ''}`}
          style={{
            transform: `translate(-50%, -50%) translate(${labelPoint.x}px, ${labelPoint.y}px)`,
          }}
        >
          {data?.label || ''}
        </div>
      </EdgeLabelRenderer>
    </>
  );
};

const nodeTypes = {
  erTable: ERTableNode,
};

const edgeTypes = {
  relation: RelationEdge,
};

export const ERDiagramTab: React.FC<ERDiagramTabProps> = ({
  tabId: _tabId,
  connectionProfile,
  database,
}) => {
  const { t } = useTranslation();
  const { setStatusMessage } = useAppStore();
  const [baseNodes, setBaseNodes] = useState<Array<Node<TableNodeData>>>([]);
  const [baseEdges, setBaseEdges] = useState<Array<Edge>>([]);
  const [relationships, setRelationships] = useState<RelationshipData[]>([]);
  const [hoveredFieldKey, setHoveredFieldKey] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('png');
  const [exportMode, setExportMode] = useState<ExportMode>('current');
  const [isExporting, setIsExporting] = useState(false);
  const flowInstanceRef = useRef<ReactFlowInstance | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const reactFlowWrapperRef = useRef<HTMLDivElement | null>(null);

  const handleFlowInit = useCallback((instance: ReactFlowInstance) => {
    flowInstanceRef.current = instance;
  }, []);

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    setBaseNodes((nodes) => applyNodeChanges(changes, nodes));
  }, []);

  const applyComfortableViewport = useCallback((nodesForView: Array<Node<TableNodeData>>, rels: RelationshipData[] = []) => {
    const instance = flowInstanceRef.current;
    const canvas = canvasRef.current;
    if (!instance || !canvas || nodesForView.length === 0) {
      return;
    }

    const pickFocusNodes = () => {
      if (nodesForView.length <= 8 || rels.length === 0) {
        return nodesForView;
      }

      const degreeMap = new Map<string, number>();
      for (const node of nodesForView) {
        degreeMap.set(node.id, 0);
      }

      for (const rel of rels) {
        degreeMap.set(rel.sourceTable, (degreeMap.get(rel.sourceTable) || 0) + 1);
        degreeMap.set(rel.targetTable, (degreeMap.get(rel.targetTable) || 0) + 1);
      }

      const hub = nodesForView.reduce((best, current) => {
        const bestDegree = degreeMap.get(best.id) || 0;
        const currentDegree = degreeMap.get(current.id) || 0;
        return currentDegree > bestDegree ? current : best;
      }, nodesForView[0]);

      const neighborhood = new Set<string>([hub.id]);
      for (const rel of rels) {
        if (rel.sourceTable === hub.id) {
          neighborhood.add(rel.targetTable);
        }
        if (rel.targetTable === hub.id) {
          neighborhood.add(rel.sourceTable);
        }
      }

      const focus = nodesForView.filter((node) => neighborhood.has(node.id));
      return focus.length > 0 ? focus : [hub];
    };

    const focusNodes = pickFocusNodes();
    const focusBounds = getNodesBounds(focusNodes as unknown as Node[]);
    instance.fitBounds(focusBounds, { duration: 260, padding: 0.26 });

    requestAnimationFrame(() => {
      const zoom = instance.getZoom();
      if (zoom >= MIN_COMFORTABLE_ZOOM) {
        return;
      }

      const bounds = nodesForView.reduce(
        (acc, node) => {
          const width = node.width || NODE_MIN_WIDTH;
          const height = node.height || NODE_HEADER_HEIGHT + 80;
          acc.minX = Math.min(acc.minX, node.position.x);
          acc.minY = Math.min(acc.minY, node.position.y);
          acc.maxX = Math.max(acc.maxX, node.position.x + width);
          acc.maxY = Math.max(acc.maxY, node.position.y + height);
          return acc;
        },
        {
          minX: Number.POSITIVE_INFINITY,
          minY: Number.POSITIVE_INFINITY,
          maxX: Number.NEGATIVE_INFINITY,
          maxY: Number.NEGATIVE_INFINITY,
        },
      );

      const centerX = (bounds.minX + bounds.maxX) / 2;
      const centerY = (bounds.minY + bounds.maxY) / 2;
      const canvasRect = canvas.getBoundingClientRect();

      instance.setViewport(
        {
          x: canvasRect.width / 2 - centerX * MIN_COMFORTABLE_ZOOM,
          y: canvasRect.height / 2 - centerY * MIN_COMFORTABLE_ZOOM,
          zoom: MIN_COMFORTABLE_ZOOM,
        },
        { duration: 260 },
      );
    });
  }, []);

  const loadDiagram = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setStatusMessage(t('erDiagram.status.loading'));
    const startedAt = performance.now();

    try {
      const erData = await metadataApi.getErDiagramData(connectionProfile, database);
      const tableNames = new Set(erData.tables);

      const columnMap = new Map<string, ErColumn[]>();
      for (const tableName of erData.tables) {
        columnMap.set(tableName, []);
      }

      erData.columns.forEach((column: ErDiagramColumnRecord) => {
        if (!tableNames.has(column.tableName)) {
          return;
        }
        const parsed: ErColumn = {
          name: column.columnName,
          type: column.columnType || column.dataType,
          keyType: column.columnKey,
        };
        const cols = columnMap.get(column.tableName);
        if (cols) {
          cols.push(parsed);
        }
      });

      const relData: RelationshipData[] = erData.foreignKeys
        .filter((fk: ErDiagramForeignKeyRecord) => tableNames.has(fk.tableName) && tableNames.has(fk.referencedTableName))
        .map((fk: ErDiagramForeignKeyRecord) => {
          const rel = {
            sourceTable: fk.tableName,
            sourceColumn: fk.columnName,
            targetTable: fk.referencedTableName,
            targetColumn: fk.referencedColumnName,
            constraintName: fk.constraintName,
          };
          return {
            ...rel,
            edgeId: getEdgeId(rel),
            label: getEdgeLabel(rel),
          };
        });

      const nodes: Array<Node<TableNodeData>> = erData.tables.map((tableName) => {
        const parsedColumns = columnMap.get(tableName) || [];
        const size = getNodeSize(tableName, parsedColumns);

        return {
          id: tableName,
          type: 'erTable',
          position: { x: 0, y: 0 },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          width: size.width,
          height: size.height,
          style: { width: size.width },
          data: {
            tableName,
            nodeWidth: size.width,
            columns: parsedColumns,
            highlightedColumns: [],
            onFieldHover: () => {},
            onFieldLeave: () => {},
          },
        };
      });

      const layoutEdges: Array<Edge> = relData.map((rel) => ({
        id: rel.edgeId,
        source: rel.sourceTable,
        target: rel.targetTable,
      }));

      const laidOutNodes = layoutGraph(nodes, layoutEdges);
      const nodeCenterX = new Map<string, number>(
        laidOutNodes.map((node) => [node.id, node.position.x + (node.width || NODE_MIN_WIDTH) / 2]),
      );
      const nodeCenterY = new Map<string, number>(
        laidOutNodes.map((node) => [node.id, node.position.y + (node.height || NODE_HEADER_HEIGHT + 80) / 2]),
      );

      const sourceGroups = new Map<string, RelationshipData[]>();
      relData.forEach((rel) => {
        const list = sourceGroups.get(rel.sourceTable) || [];
        list.push(rel);
        sourceGroups.set(rel.sourceTable, list);
      });

      const routeBiasMap = new Map<string, number>();
      sourceGroups.forEach((list) => {
        list
          .slice()
          .sort((a, b) => (nodeCenterY.get(a.targetTable) || 0) - (nodeCenterY.get(b.targetTable) || 0))
          .forEach((rel, index, arr) => {
            routeBiasMap.set(rel.edgeId, index - (arr.length - 1) / 2);
          });
      });

      const edges: Array<Edge<RelationEdgeData>> = relData.map((rel) => {
        const sourceCenterX = nodeCenterX.get(rel.sourceTable) || 0;
        const targetCenterX = nodeCenterX.get(rel.targetTable) || 0;
        const side: 'left' | 'right' = sourceCenterX <= targetCenterX ? 'right' : 'left';

        return {
          id: rel.edgeId,
          source: rel.sourceTable,
          target: rel.targetTable,
          sourceHandle: getSourceHandleIdBySide(rel.sourceColumn, side),
          targetHandle: getTargetHandleIdBySide(rel.targetColumn, side === 'right' ? 'left' : 'right'),
          type: 'relation',
          interactionWidth: 28,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: '#8a97ab',
            width: 18,
            height: 18,
          },
          style: {
            stroke: '#8a97ab',
            strokeWidth: 1.35,
          },
          data: {
            label: rel.label,
            isHighlighted: false,
            routeBias: routeBiasMap.get(rel.edgeId) || 0,
          },
        };
      });

      setRelationships(relData);
      setBaseNodes(laidOutNodes);
      setBaseEdges(edges);
      const elapsed = Math.max(1, Math.round(performance.now() - startedAt));
      setStatusMessage(t('erDiagram.status.loaded', { tables: erData.tables.length, relations: relData.length, time: elapsed }));
      setHoveredFieldKey(null);
      setHoveredEdgeId(null);

      requestAnimationFrame(() => {
        applyComfortableViewport(laidOutNodes, relData);
      });
    } catch (err) {
      const message = String(err);
      setError(t('erDiagram.status.loadFailed', { message }));
      setStatusMessage(t('erDiagram.status.loadFailed', { message }));
    } finally {
      setIsLoading(false);
    }
  }, [applyComfortableViewport, connectionProfile, database, setStatusMessage]);

  useEffect(() => {
    void loadDiagram();
  }, [loadDiagram]);

  useEffect(() => {
    const handleGlobalRefresh = () => {
      void loadDiagram();
    };

    window.addEventListener('dbw:global-refresh', handleGlobalRefresh);
    return () => {
      window.removeEventListener('dbw:global-refresh', handleGlobalRefresh);
    };
  }, [loadDiagram]);

  const { highlightedEdges, highlightedFieldMap } = useMemo(() => {
    const edgeSet = new Set<string>();
    const fieldMap = new Map<string, Set<string>>();

    const pushField = (tableName: string, columnName: string) => {
      if (!fieldMap.has(tableName)) {
        fieldMap.set(tableName, new Set());
      }
      fieldMap.get(tableName)?.add(columnName);
    };

    relationships.forEach((rel) => {
      const sourceKey = `${rel.sourceTable}.${rel.sourceColumn}`;
      const targetKey = `${rel.targetTable}.${rel.targetColumn}`;

      if (hoveredFieldKey && (sourceKey === hoveredFieldKey || targetKey === hoveredFieldKey)) {
        edgeSet.add(rel.edgeId);
        pushField(rel.sourceTable, rel.sourceColumn);
        pushField(rel.targetTable, rel.targetColumn);
      }
    });

    if (hoveredFieldKey) {
      const [hoveredTable, hoveredColumn] = hoveredFieldKey.split('.');
      if (hoveredTable && hoveredColumn) {
        pushField(hoveredTable, hoveredColumn);
      }
    }

    if (hoveredEdgeId) {
      const hoveredRel = relationships.find((rel) => rel.edgeId === hoveredEdgeId);
      if (hoveredRel) {
        edgeSet.add(hoveredRel.edgeId);
        pushField(hoveredRel.sourceTable, hoveredRel.sourceColumn);
        pushField(hoveredRel.targetTable, hoveredRel.targetColumn);
      }
    }

    return { highlightedEdges: edgeSet, highlightedFieldMap: fieldMap };
  }, [hoveredEdgeId, hoveredFieldKey, relationships]);

  const handleFieldHover = useCallback((tableName: string, columnName: string) => {
    setHoveredFieldKey(`${tableName}.${columnName}`);
  }, []);

  const handleFieldLeave = useCallback(() => {
    setHoveredFieldKey(null);
  }, []);

  const handleEdgeHover = useCallback((_event: React.MouseEvent, edge: Edge) => {
    setHoveredEdgeId(edge.id);
  }, []);

  const handleEdgeLeave = useCallback(() => {
    setHoveredEdgeId(null);
  }, []);

  const renderedNodes = useMemo(() => {
    return baseNodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        highlightedColumns: Array.from(highlightedFieldMap.get(node.id) || []),
        onFieldHover: handleFieldHover,
        onFieldLeave: handleFieldLeave,
      },
    }));
  }, [baseNodes, highlightedFieldMap, handleFieldHover, handleFieldLeave]);

  const renderedEdges = useMemo(() => {
    return baseEdges.map((edge) => {
      const isHighlighted = highlightedEdges.has(edge.id);
      const stroke = isHighlighted ? '#1e74ff' : '#8a97ab';
      return {
        ...edge,
        animated: isHighlighted,
        className: `er-edge ${isHighlighted ? 'is-highlighted' : ''}`,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: stroke,
          width: 18,
          height: 18,
        },
        style: {
          stroke,
          strokeWidth: isHighlighted ? 2.4 : 1.35,
          strokeDasharray: isHighlighted ? '6 4' : undefined,
        },
        data: {
          ...(edge.data || {}),
          isHighlighted,
        },
      };
    });
  }, [baseEdges, highlightedEdges]);

  const handleAutoLayout = useCallback(() => {
    const relaidOut = layoutGraph(baseNodes, baseEdges);
    setBaseNodes(relaidOut);
    requestAnimationFrame(() => {
      applyComfortableViewport(relaidOut, relationships);
    });
  }, [applyComfortableViewport, baseEdges, baseNodes, relationships]);

  // 导出处理函数
  const handleExport = useCallback(async () => {
    if (!reactFlowWrapperRef.current || !flowInstanceRef.current) return;

    setIsExporting(true);

    // 使用 requestAnimationFrame 延迟执行，给浏览器时间完成渲染
    await new Promise(resolve => requestAnimationFrame(resolve));

    // 添加导出模式class，隐藏控制组件
    document.body.classList.add('exporting-er-diagram');

    // 保存当前视口状态
    const instance = flowInstanceRef.current;
    const currentViewport = instance.getViewport();

    try {
      const timestamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      const defaultFileName = `${database}_ERDiagram_${timestamp}`;

      // 如果是全景模式，调整视口以包含所有节点
      if (exportMode === 'full' && exportFormat !== 'sql') {
        const bounds = getNodesBounds(baseNodes);
        if (bounds.width > 0 && bounds.height > 0) {
          // 添加边距
          const padding = 50;
          instance.fitBounds(
            { x: bounds.x - padding, y: bounds.y - padding, width: bounds.width + padding * 2, height: bounds.height + padding * 2 },
            { duration: 0 }
          );
          // 等待视口调整完成
          await new Promise(resolve => requestAnimationFrame(resolve));
        }
      }

      // 再次等待渲染完成
      await new Promise(resolve => requestAnimationFrame(resolve));

      switch (exportFormat) {
        case 'png':
        case 'jpg': {
          // 性能优化：降低像素比
          const pixelRatio = exportMode === 'full' ? Math.min(window.devicePixelRatio, 1.5) : Math.min(window.devicePixelRatio, 2);

          const dataUrl = exportFormat === 'png'
            ? await toPng(reactFlowWrapperRef.current, {
                quality: 0.92,
                backgroundColor: '#ffffff',
                pixelRatio,
                cacheBust: true,
              })
            : await toJpeg(reactFlowWrapperRef.current, {
                quality: 0.92,
                backgroundColor: '#ffffff',
                pixelRatio,
                cacheBust: true,
              });

          const selectedPath = await save({
            title: t('erDiagram.export.title', { format: exportFormat.toUpperCase() }),
            defaultPath: `${defaultFileName}.${exportFormat}`,
            filters: [{ name: exportFormat.toUpperCase(), extensions: [exportFormat] }],
            canCreateDirectories: true,
          });

          if (selectedPath) {
            // 下载文件
            const link = document.createElement('a');
            link.href = dataUrl;
            link.download = selectedPath.split(/[/\\]/).pop() || `${defaultFileName}.${exportFormat}`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            await showExportSuccessNotice(1, selectedPath);
          }
          break;
        }
        case 'pdf': {
          // 性能优化：降低像素比
          const pixelRatio = exportMode === 'full' ? 1.5 : 2;

          const dataUrl = await toPng(reactFlowWrapperRef.current, {
            quality: 0.92,
            backgroundColor: '#ffffff',
            pixelRatio,
            cacheBust: true,
          });

          const img = new Image();
          img.src = dataUrl;
          await new Promise((resolve) => { img.onload = resolve; });

          // 限制PDF尺寸
          const maxPdfSize = 3000;
          let pdfWidth = img.width;
          let pdfHeight = img.height;

          if (pdfWidth > maxPdfSize || pdfHeight > maxPdfSize) {
            const ratio = Math.min(maxPdfSize / pdfWidth, maxPdfSize / pdfHeight);
            pdfWidth *= ratio;
            pdfHeight *= ratio;
          }

          const pdf = new jsPDF({
            orientation: pdfWidth > pdfHeight ? 'landscape' : 'portrait',
            unit: 'px',
            format: [pdfWidth, pdfHeight],
          });

          pdf.addImage(dataUrl, 'PNG', 0, 0, pdfWidth, pdfHeight);

          const selectedPath = await save({
            title: t('erDiagram.export.title', { format: 'PDF' }),
            defaultPath: `${defaultFileName}.pdf`,
            filters: [{ name: 'PDF', extensions: ['pdf'] }],
            canCreateDirectories: true,
          });

          if (selectedPath) {
            pdf.save(selectedPath);
            await showExportSuccessNotice(1, selectedPath);
          }
          break;
        }
        case 'sql': {
          const selectedPath = await save({
            title: t('erDiagram.export.title', { format: 'SQL' }),
            defaultPath: `${defaultFileName}.sql`,
            filters: [{ name: 'SQL', extensions: ['sql'] }],
            canCreateDirectories: true,
          });

          if (selectedPath) {
            const sql = await invoke<string>('metadata_export_er_diagram_sql', {
              profile: connectionProfile,
              database,
            });

            // 创建Blob并下载
            const blob = new Blob([sql], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = selectedPath.split(/[/\\]/).pop() || `${defaultFileName}.sql`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            await showExportSuccessNotice(1, selectedPath);
          }
          break;
        }
      }
    } catch (error) {
      await showExportFailedNotice(String(error));
    } finally {
      // 恢复原始视口（如果是全景模式）
      if (exportMode === 'full' && exportFormat !== 'sql') {
        instance.setViewport(currentViewport);
      }

      // 移除导出模式class
      document.body.classList.remove('exporting-er-diagram');
      setIsExporting(false);
    }
  }, [exportFormat, exportMode, database, connectionProfile, baseNodes, t]);

  return (
    <div className="er-diagram-tab">
      <div className="er-diagram-toolbar">
        <Button small minimal icon={<RefreshCw size={14} />} onClick={() => void loadDiagram()} loading={isLoading}>
          {t('erDiagram.toolbar.refresh')}
        </Button>
        <Button small minimal icon={<ZoomIn size={14} />} onClick={() => flowInstanceRef.current?.zoomIn()}>
          {t('erDiagram.toolbar.zoomIn')}
        </Button>
        <Button small minimal icon={<ZoomOut size={14} />} onClick={() => flowInstanceRef.current?.zoomOut()}>
          {t('erDiagram.toolbar.zoomOut')}
        </Button>
        <Button small minimal icon={<Maximize size={14} />} onClick={() => applyComfortableViewport(baseNodes, relationships)}>
          {t('erDiagram.toolbar.reset')}
        </Button>
        <Button small minimal icon={<WandSparkles size={14} />} onClick={handleAutoLayout}>
          {t('erDiagram.toolbar.autoLayout')}
        </Button>
        <div className="er-diagram-toolbar-spacer" />
        <HTMLSelect
          className="er-diagram-mode-select"
          value={exportMode}
          onChange={(e) => setExportMode(e.target.value as ExportMode)}
          options={[
            { value: 'current', label: t('erDiagram.export.mode.current') },
            { value: 'full', label: t('erDiagram.export.mode.full') },
          ]}
          disabled={isLoading || isExporting || exportFormat === 'sql'}
        />
        <HTMLSelect
          className="er-diagram-format-select"
          value={exportFormat}
          onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
          options={[
            { value: 'png', label: 'PNG' },
            { value: 'jpg', label: 'JPG' },
            { value: 'pdf', label: 'PDF' },
            { value: 'sql', label: 'SQL' },
          ]}
          disabled={isLoading || isExporting}
        />
        <Button
          small
          minimal
          icon={<Download size={14} />}
          onClick={() => void handleExport()}
          loading={isExporting}
          disabled={isLoading || baseNodes.length === 0}
        >
          {t('erDiagram.toolbar.export')}
        </Button>
      </div>

      {isLoading && (
        <div className="er-diagram-loading">
          <Spinner size={36} />
          <span>{t('erDiagram.loading')}</span>
        </div>
      )}

      {!isLoading && error && (
        <div className="er-diagram-error">
          <span>{error}</span>
          <Button minimal small onClick={() => void loadDiagram()}>
            {t('erDiagram.retry')}
          </Button>
        </div>
      )}

      {!isLoading && !error && (
        <div className="er-diagram-canvas" ref={canvasRef}>
          <div className="er-diagram-flow-wrapper" ref={reactFlowWrapperRef}>
            <ReactFlow
              nodes={renderedNodes}
              edges={renderedEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onInit={handleFlowInit}
              onNodesChange={handleNodesChange}
              onEdgeMouseEnter={handleEdgeHover}
              onEdgeMouseLeave={handleEdgeLeave}
              onlyRenderVisibleElements
              nodesDraggable
              fitView={false}
            minZoom={0.2}
            maxZoom={2.5}
            proOptions={{ hideAttribution: true }}
          >
            <Controls showInteractive={false} />
            <Background gap={20} size={1} color="#b9c3d1" />
            <MiniMap
              className="er-diagram-minimap"
              pannable
              zoomable
              nodeStrokeWidth={2}
              nodeColor="#d7deea"
              maskColor="rgba(90, 120, 170, 0.14)"
            />
          </ReactFlow>
          </div>
        </div>
      )}
    </div>
  );
};

export default ERDiagramTab;
