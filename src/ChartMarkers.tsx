import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import { MAX_CHART_LABEL_TEXT, type ChartMarkerSymbol } from "./chart";

export interface ChartMarkerPoint {
  x: number;
  y: number;
  index: number;
  color: string;
  value: number;
}
export interface ChartPointHover {
  key: string;
  index: number;
  x: number;
  y: number;
  text: string;
}
export interface ChartPointTooltipHandle {
  show(point: ChartPointHover): void;
  hide(): void;
}
const MIN_BATCH_POINTS = 512;
const MAX_STYLE_RUNS = 128;

// Normalized, filled symbol polygons allow the dense and individual paths to
// share identical geometry. Star is the chart's asterisk, not a decorative star.
type Point = [number, number];
const rectangle = (x: number, y: number): Point[] => [
  [-x, -y],
  [x, -y],
  [x, y],
  [-x, y],
];
const rotate = (polygon: Point[], angle: number): Point[] =>
  polygon.map(([x, y]) => [
    x * Math.cos(angle) - y * Math.sin(angle),
    x * Math.sin(angle) + y * Math.cos(angle),
  ]);
const plus: Point[] = [
  [-0.2, -1],
  [0.2, -1],
  [0.2, -0.2],
  [1, -0.2],
  [1, 0.2],
  [0.2, 0.2],
  [0.2, 1],
  [-0.2, 1],
  [-0.2, 0.2],
  [-1, 0.2],
  [-1, -0.2],
  [-0.2, -0.2],
];
const rotatedX = rotate(plus, Math.PI / 4);
const xExtent = Math.max(
  ...rotatedX.flatMap(([x, y]) => [Math.abs(x), Math.abs(y)]),
);
const polygons: Partial<Record<ChartMarkerSymbol, Point[][]>> = {
  square: [rectangle(1, 1)],
  diamond: [
    [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ],
  ],
  triangle: [
    [
      [0, -1],
      [1, 1],
      [-1, 1],
    ],
  ],
  plus: [plus],
  x: [rotatedX.map(([x, y]) => [x / xExtent, y / xExtent])],
  dash: [rectangle(1, 0.16)],
  dot: [rectangle(0.35, 0.16)],
  star: [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4].map((angle) =>
    rotate(rectangle(1, 0.13), angle),
  ),
};
export function markerPath(
  x: number,
  y: number,
  radius: number,
  symbol: ChartMarkerSymbol = "circle",
): string {
  if (symbol === "circle")
    return `M${x - radius} ${y}a${radius} ${radius} 0 1 0 ${radius * 2} 0a${radius} ${radius} 0 1 0 ${-radius * 2} 0Z`;
  return polygons[symbol]!.map(
    (polygon) =>
      `M${x + polygon[0][0] * radius} ${y + polygon[0][1] * radius}` +
      polygon
        .slice(1)
        .map(
          ([px, py], index) =>
            `l${(px - polygon[index][0]) * radius} ${(py - polygon[index][1]) * radius}`,
        )
        .join("") +
      "Z",
  ).join("");
}
function markerContains(
  x: number,
  y: number,
  radius: number,
  symbol: ChartMarkerSymbol,
) {
  if (symbol === "circle") return x * x + y * y <= radius * radius;
  const px = x / radius,
    py = y / radius;
  return polygons[symbol]!.some((polygon) => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [ax, ay] = polygon[i],
        [bx, by] = polygon[j];
      if (ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax)
        inside = !inside;
    }
    return inside;
  });
}

/** Adjacent equal styles only: regrouping all red/blue points would change
 * which source point wins when different colors overlap. */
export function markerBatches(
  points: ChartMarkerPoint[],
  radius: number,
  symbol: ChartMarkerSymbol = "circle",
) {
  if (points.length < MIN_BATCH_POINTS) return;
  let runs = 0,
    previous = "";
  for (const point of points)
    if (!/^#[0-9a-f]{6}$/i.test(point.color)) return;
    else if (point.color !== previous) {
      if (++runs > MAX_STYLE_RUNS) return;
      previous = point.color;
    }
  const paths: { color: string; d: string; count: number }[] = [];
  let commands: string[] = [];
  for (const point of points) {
    if (paths.at(-1)?.color !== point.color) {
      if (paths.length) paths[paths.length - 1].d = commands.join("");
      paths.push({ color: point.color, d: "", count: 0 });
      commands = [];
    }
    commands.push(markerPath(point.x, point.y, radius, symbol));
    paths[paths.length - 1].count++;
  }
  paths[paths.length - 1].d = commands.join("");
  return paths;
}

/** Preserve exact point centers/order. The grid only accelerates pointer hits;
 * it never changes the geometry or the data stored in the chart package. */
export function markerHitIndex(
  points: ChartMarkerPoint[],
  radius: number,
  symbol: ChartMarkerSymbol = "circle",
) {
  const cell = Math.max(4, radius * 2),
    buckets = new Map<string, number[]>();
  points.forEach((point, index) => {
    const key = `${Math.floor(point.x / cell)},${Math.floor(point.y / cell)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(index);
    else buckets.set(key, [index]);
  });
  return (x: number, y: number) => {
    const column = Math.floor(x / cell),
      row = Math.floor(y / cell);
    let hit = -1;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = buckets.get(`${column + dx},${row + dy}`);
        // Drawing order is source order. Search the topmost candidates first,
        // so thousands of coincident points do not slow every pointer move.
        for (let i = (bucket?.length ?? 0) - 1; i >= 0; i--) {
          const index = bucket![i];
          if (index <= hit) break;
          const point = points[index];
          if (markerContains(x - point.x, y - point.y, radius, symbol)) {
            hit = index;
            break;
          }
        }
      }
    return hit < 0 ? undefined : points[hit];
  };
}

export function ChartMarkers({
  id,
  points,
  radius,
  symbol = "circle",
  seriesName,
  title,
  onHover,
  onLeave,
}: {
  id: string;
  points: ChartMarkerPoint[];
  radius: number;
  symbol?: ChartMarkerSymbol;
  seriesName: string;
  title(point: ChartMarkerPoint): string;
  onHover(point: ChartPointHover): void;
  onLeave(): void;
}) {
  const batches = useMemo(
    () => markerBatches(points, radius, symbol),
    [points, radius, symbol],
  );
  const hit = useMemo(
    () => (batches ? markerHitIndex(points, radius, symbol) : undefined),
    [batches, points, radius, symbol],
  );
  if (!batches)
    return (
      <g data-chart-marker-layer={id} data-chart-marker-symbol={symbol}>
        {points.map((point) =>
          symbol === "circle" ? (
            <circle
              key={point.index}
              data-chart-point={id}
              cx={point.x}
              cy={point.y}
              r={radius}
              fill={point.color}
            >
              <title>{title(point).slice(0, MAX_CHART_LABEL_TEXT)}</title>
            </circle>
          ) : (
            <path
              key={point.index}
              data-chart-point={id}
              d={markerPath(point.x, point.y, radius, symbol)}
              fill={point.color}
            >
              <title>{title(point).slice(0, MAX_CHART_LABEL_TEXT)}</title>
            </path>
          ),
        )}
      </g>
    );
  return (
    <g
      data-chart-marker-layer={id}
      data-chart-marker-count={points.length}
      data-chart-marker-symbol={symbol}
      onPointerMove={(event) => {
        const matrix = event.currentTarget.getScreenCTM();
        if (!matrix) return;
        const local = new DOMPoint(
          event.clientX,
          event.clientY,
        ).matrixTransform(matrix.inverse());
        const point = hit?.(local.x, local.y);
        if (point)
          onHover({
            key: id,
            index: point.index,
            x: point.x,
            y: point.y,
            text: title(point).slice(0, MAX_CHART_LABEL_TEXT),
          });
        else onLeave();
      }}
      onPointerLeave={onLeave}
    >
      {batches.map((batch, index) => (
        <path
          key={index}
          data-chart-marker-batch={id}
          data-chart-point-count={batch.count}
          d={batch.d}
          fill={batch.color}
        />
      ))}
    </g>
  );
}

/** A separate state owner avoids rebuilding dense geometry on each pointer
 * move. The chart's existing image accessible name remains unchanged. */
export const ChartPointTooltip = forwardRef<
  ChartPointTooltipHandle,
  { width: number; height: number; source: object }
>(function ChartPointTooltip({ width, height, source }, ref) {
  const [point, setPoint] = useState<ChartPointHover | null>(null);
  useImperativeHandle(ref, () => ({
    show(value) {
      setPoint((previous) =>
        previous?.key === value.key && previous.index === value.index
          ? previous
          : value,
      );
    },
    hide() {
      setPoint(null);
    },
  }));
  useEffect(() => setPoint(null), [source, width, height]);
  useEffect(() => {
    if (!point) return;
    const clear = () => setPoint(null),
      key = (event: KeyboardEvent) => {
        if (event.key === "Escape") clear();
      };
    window.addEventListener("blur", clear);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("blur", clear);
      window.removeEventListener("keydown", key);
    };
  }, [!!point]);
  if (!point) return null;
  const limit = Math.max(8, Math.floor((width - 36) / 9)),
    text =
      point.text.length > limit
        ? point.text.slice(0, limit - 1) + "…"
        : point.text,
    boxWidth = Math.min(width - 16, text.length * 9 + 18),
    x = Math.max(8, Math.min(width - boxWidth - 8, point.x + 12)),
    y = Math.max(8, Math.min(height - 36, point.y - 36));
  return (
    <g
      data-chart-point-tooltip={point.key}
      data-chart-point-index={point.index}
      role="tooltip"
      aria-label={point.text}
      pointerEvents="none"
      transform={`translate(${x} ${y})`}
    >
      <rect width={boxWidth} height={28} rx={4} fill="#111827" opacity={0.96} />
      <text x={9} y={19} fontSize={14} fill="white">
        {text}
      </text>
    </g>
  );
});
