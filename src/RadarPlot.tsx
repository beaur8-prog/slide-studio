import type { ReactNode } from "react";
import {
  formatChartNumber,
  MAX_CHART_LABEL_TEXT,
  type ChartAxis,
  type ChartPlot,
  type ChartSeries,
} from "./chart";
import { radarSeriesPath } from "./chart-radar";
import { fontStack } from "./text-layout";
import { ChartMarkers, type ChartPointHover } from "./ChartMarkers";

interface RadarArtworkOptions {
  plot: ChartPlot;
  categoryAxis: ChartAxis;
  valueAxis: ChartAxis;
  labels: string[];
  blankMode: "gap" | "span" | "zero";
  left: number;
  right: number;
  top: number;
  bottom: number;
  domain: [number, number];
  ticks: number[];
  clipId: string;
  appendLabel: (
    series: ChartSeries,
    index: number,
    value: number,
    x: number,
    y: number,
  ) => void;
  onHover: (point: ChartPointHover) => void;
  onLeave: () => void;
}

/** Radar uses the same source values and marker renderer as Cartesian charts;
 * only their projection changes. Grid segments share paths at high density. */
export function radarArtwork(options: RadarArtworkOptions): ReactNode {
  const {
    plot,
    categoryAxis,
    valueAxis,
    labels,
    blankMode,
    left,
    right,
    top,
    bottom,
    domain,
  } = options;
  const cx = (left + right) / 2,
    cy = (top + bottom) / 2;
  const radius = Math.max(
    1,
    Math.min(
      (right - left) / 2 - categoryAxis.fontSize * 2,
      (bottom - top) / 2 - categoryAxis.fontSize * 1.8,
    ),
  );
  const count = labels.length;
  const directions = labels.map((_, i) => {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / count;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  });
  const point = (index: number, distance: number) => ({
    x: cx + directions[index].x * distance,
    y: cy + directions[index].y * distance,
  });
  const normalize = Math.max(
    Number.MIN_VALUE,
    Math.abs(domain[0]),
    Math.abs(domain[1]),
  );
  const span = domain[1] / normalize - domain[0] / normalize;
  const distance = (v: number) => {
    const fraction = (v / normalize - domain[0] / normalize) / span;
    return (
      Math.min(1e6, Math.max(0, Number.isFinite(fraction) ? fraction : 1)) *
      radius
    );
  };
  const polygon = (r: number) =>
    radarSeriesPath(
      directions.map((_, i) => point(i, r)),
      "span",
    );
  const grid: ReactNode[] = [];
  if (!valueAxis.hidden) {
    if (valueAxis.gridColor)
      grid.push(
        <path
          key="rings"
          data-chart-radar-grid="rings"
          d={options.ticks
            .filter((v) => distance(v) > 0)
            .map((v) => polygon(distance(v)))
            .join(" ")}
          fill="none"
          stroke={valueAxis.gridColor}
          strokeWidth={valueAxis.gridWidth ?? 0.8}
        />,
      );
    grid.push(
      <line
        key="value-axis"
        x1={cx}
        y1={cy}
        x2={cx}
        y2={cy - radius}
        stroke={valueAxis.lineColor}
        strokeWidth={valueAxis.lineWidth}
      />,
    );
    if (valueAxis.labelPosition !== "none")
      for (const tick of options.ticks)
        grid.push(
          <text
            key={`tick-${tick}`}
            data-chart-value-tick={tick}
            x={cx - 7}
            y={cy - distance(tick)}
            dominantBaseline="central"
            textAnchor="end"
            fill={valueAxis.color}
            fontSize={valueAxis.fontSize}
            fontFamily={fontStack(valueAxis.fontFamily)}
          >
            {formatChartNumber(tick, valueAxis.format)}
          </text>,
        );
  }
  if (!categoryAxis.hidden) {
    if (categoryAxis.gridColor)
      grid.unshift(
        <path
          key="spokes"
          data-chart-radar-grid="spokes"
          d={directions
            .map((_, i) => {
              const p = point(i, radius);
              return `M${cx},${cy}L${p.x},${p.y}`;
            })
            .join(" ")}
          fill="none"
          stroke={categoryAxis.gridColor}
          strokeWidth={categoryAxis.gridWidth ?? 0.8}
        />,
      );
    if (categoryAxis.labelPosition !== "none") {
      const interval = Math.max(
        categoryAxis.labelSkip ?? 1,
        Math.ceil(count / 48),
      );
      for (let i = 0; i < count; i += interval) {
        const d = directions[i],
          p = point(i, radius + categoryAxis.fontSize * 0.8);
        const anchor = d.x > 0.2 ? "start" : d.x < -0.2 ? "end" : "middle";
        const available =
          anchor === "start"
            ? right - p.x
            : anchor === "end"
              ? p.x - left
              : 2 * Math.min(p.x - left, right - p.x);
        const emWidth = Math.max(1, available / categoryAxis.fontSize);
        const full = labels[i].slice(0, MAX_CHART_LABEL_TEXT);
        // CJK characters need roughly one em, Latin labels about 0.62 em.
        // Bound text before creating SVG nodes; keep the complete label in title.
        let used = 0,
          end = 0;
        for (const character of full) {
          const next = used + (/[^\u0000-\u024f]/u.test(character) ? 1 : 0.62);
          if (next > emWidth) break;
          used = next;
          end += character.length;
        }
        const shown =
          end < full.length ? full.slice(0, Math.max(0, end - 1)) + "…" : full;
        grid.push(
          <text
            key={`category-${i}`}
            data-chart-category-label={i}
            x={p.x}
            y={Math.max(
              top + categoryAxis.fontSize / 2,
              Math.min(bottom - categoryAxis.fontSize / 2, p.y),
            )}
            dominantBaseline="central"
            textAnchor={anchor}
            fill={categoryAxis.color}
            fontSize={categoryAxis.fontSize}
            fontFamily={fontStack(categoryAxis.fontFamily)}
          >
            {shown}
            <title>{full}</title>
          </text>,
        );
      }
    }
  }
  const contents: ReactNode[] = [];
  plot.series.forEach((series, seriesIndex) => {
    const id = `radar-${seriesIndex}`;
    const points = labels.map((_, i) => {
      const value = series.values[i] ?? null;
      return value === null && blankMode !== "zero"
        ? null
        : {
            ...point(i, distance(value ?? 0)),
            index: i,
            value: value ?? 0,
            color: series.pointColors[i] ?? series.color,
          };
    });
    const line = series.radarLine ?? {
      color: series.color,
      opacity: 1,
      width: series.width,
    };
    const fill = series.radarFill ?? { color: series.color, opacity: 1 };
    contents.push(
      <path
        key={id}
        data-chart-radar-series={seriesIndex}
        clipPath={`url(#${options.clipId})`}
        d={radarSeriesPath(points, blankMode)}
        fill={plot.radarStyle === "filled" ? fill.color : "none"}
        fillOpacity={fill.opacity}
        stroke={line.width ? line.color : "none"}
        strokeOpacity={line.opacity}
        strokeWidth={line.width}
        strokeDasharray={series.dash}
        strokeLinejoin="round"
      >
        <title>{series.name.slice(0, MAX_CHART_LABEL_TEXT)}</title>
      </path>,
    );
    if (series.marker)
      contents.push(
        <ChartMarkers
          key={id + "markers"}
          id={id}
          points={points.filter(
            (p): p is NonNullable<typeof p> =>
              !!p && p.value >= domain[0] && p.value <= domain[1],
          )}
          radius={series.markerSize * (2 / 3)}
          symbol={series.markerSymbol}
          seriesName={series.name}
          title={(p) =>
            `${series.name.slice(0, 160)} / ${labels[p.index].slice(0, 160)}: ${formatChartNumber(p.value, series.pointFormats[p.index] ?? series.numberFormat)}`
          }
          onHover={options.onHover}
          onLeave={options.onLeave}
        />,
      );
    points.forEach((p, i) => {
      if (
        p &&
        p.value >= domain[0] &&
        p.value <= domain[1] &&
        series.values[i] !== null &&
        series.values[i] !== undefined
      )
        options.appendLabel(series, i, p.value, p.x, p.y);
    });
  });
  return (
    <g
      key="radar"
      data-chart-radar={plot.radarStyle}
      data-chart-radar-radius={radius}
      data-chart-radar-cx={cx}
      data-chart-radar-cy={cy}
    >
      <defs>
        <clipPath id={options.clipId}>
          <path d={polygon(radius)} />
        </clipPath>
      </defs>
      {grid}
      {contents}
    </g>
  );
}
