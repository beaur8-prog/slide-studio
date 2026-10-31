import { useId, useMemo, useRef, type ReactNode } from "react";
import type { SlideElement } from "./types";
import {
  readChartPreview,
  formatChartNumber,
  MAX_CHART_LABELS,
  MAX_CHART_LABEL_TEXT,
  type ChartAxis,
  type ChartSeries,
} from "./chart";
import { fontStack } from "./text-layout";
import { ChartImageFill } from "./ChartImageFill";
import { canPreviewRadar } from "./chart-radar";
import { radarArtwork } from "./RadarPlot";
import {
  ChartMarkers,
  markerPath,
  ChartPointTooltip,
  type ChartPointTooltipHandle,
} from "./ChartMarkers";

function tickUnit(low: number, high: number, intervals: number): number {
  // Dividing before subtracting also handles finite values near Number.MAX_VALUE.
  const rough = high / intervals - low / intervals;
  if (!(rough > 0) || !Number.isFinite(rough)) return Number.MIN_VALUE;
  const power = Math.max(Number.MIN_VALUE, 10 ** Math.floor(Math.log10(rough)));
  return (
    [1, 2, 2.5, 5, 10]
      .map((v) => v * power)
      .find((v) => v >= rough && Number.isFinite(v)) ?? rough
  );
}

function range(
  values: number[],
  axis: ChartAxis,
  zero = false,
  intervals = 10,
  padMaximum = false,
): [number, number] {
  const valid = values.filter(
    (v) => Number.isFinite(v) && (!axis.log || v > 0),
  );
  let low =
    axis.min ??
    valid.reduce((min, v) => Math.min(min, v), valid.length ? Infinity : 0);
  let high =
    axis.max ??
    valid.reduce((max, v) => Math.max(max, v), valid.length ? -Infinity : 1);
  if ((zero || (low >= 0 && low <= (high * 5) / 6)) && !axis.log) {
    if (axis.min === undefined) low = Math.min(0, low);
    if (axis.max === undefined) high = Math.max(0, high);
  }
  if (axis.log) {
    low =
      low > 0
        ? low
        : valid.reduce((min, v) => (v > 0 ? Math.min(min, v) : min), 1);
    high = high > low ? high : Math.min(Number.MAX_VALUE, low * axis.log);
    if (!(high > low)) low /= axis.log;
    return [low, high];
  }
  if (!(high > low)) {
    const padding = Math.max(
      Number.MIN_VALUE,
      Math.abs(low) * 0.1,
      low === 0 ? 1 : 0,
    );
    const upper = low + padding;
    if (Number.isFinite(upper) && upper > low) high = upper;
    else {
      high = low;
      low -= padding;
    }
    if (axis.min === undefined && Number.isFinite(low - padding))
      low -= padding;
  }
  const unit = axis.unit ?? tickUnit(low, high, intervals);
  const roundedLow = Math.floor(low / unit) * unit,
    roundedHigh = Math.ceil(high / unit) * unit;
  if (axis.min === undefined && Number.isFinite(roundedLow)) low = roundedLow;
  if (
    axis.min === undefined &&
    low < 0 &&
    low === roundedLow &&
    valid.includes(low) &&
    Number.isFinite(low - unit)
  )
    low -= unit;
  if (axis.max === undefined && Number.isFinite(roundedHigh))
    high = roundedHigh;
  if (
    padMaximum &&
    axis.max === undefined &&
    high > 0 &&
    high === roundedHigh &&
    valid.includes(high) &&
    Number.isFinite(high + unit)
  )
    high += unit;
  return [low, high];
}
function scale(
  domain: [number, number],
  start: number,
  end: number,
  axis: ChartAxis,
) {
  const project = axis.log
    ? (v: number) => Math.log(Math.max(v, domain[0]))
    : (v: number) => v;
  const low = project(domain[0]),
    high = project(domain[1]),
    normalizer = Math.max(Number.MIN_VALUE, Math.abs(low), Math.abs(high)),
    distance = high / normalizer - low / normalizer;
  return (v: number) => {
    let fraction = (project(v) / normalizer - low / normalizer) / distance;
    if (!Number.isFinite(fraction)) fraction = v <= domain[0] ? 0 : 1;
    fraction = Math.max(-1e6, Math.min(1e6, fraction));
    if (axis.reverse) fraction = 1 - fraction;
    return start + fraction * (end - start);
  };
}
function ticks(
  domain: [number, number],
  axis: ChartAxis,
  length: number,
  desiredIntervals?: number,
): number[] {
  if (axis.log) {
    const values: number[] = [];
    for (
      let exponent = Math.ceil(Math.log(domain[0]) / Math.log(axis.log));
      exponent <= Math.log(domain[1]) / Math.log(axis.log) &&
      values.length < 40;
      exponent++
    )
      values.push(axis.log ** exponent);
    return values;
  }
  const intervals = Math.max(
      2,
      Math.min(
        desiredIntervals ?? 10,
        Math.floor(length / Math.max(24, axis.fontSize * 2)),
      ),
    ),
    unit = axis.unit ?? tickUnit(domain[0], domain[1], intervals);
  const values: number[] = [];
  for (
    let v = Math.ceil(domain[0] / unit) * unit;
    Number.isFinite(v) &&
    v <= domain[1] + unit * 0.00001 &&
    values.length < 100;
    v = v + unit > v ? v + unit : Infinity
  )
    values.push(Math.abs(v) < unit * 1e-8 ? 0 : v);
  return values;
}
const palette = [
  "#4472C4",
  "#ED7D31",
  "#A5A5A5",
  "#FFC000",
  "#5B9BD5",
  "#70AD47",
];

export function ChartVisual({
  element,
  playing = false,
}: {
  element: SlideElement;
  playing?: boolean;
}) {
  const clip = "chart-" + useId().replaceAll(":", "");
  const tooltip = useRef<ChartPointTooltipHandle>(null);
  const model = useMemo(() => {
    try {
      return element.chart ? readChartPreview(element.chart) : null;
    } catch {
      return null;
    }
  }, [element.chart]);
  if (!model)
    return (
      <div role="img" aria-label="차트 미리보기를 읽을 수 없습니다">
        차트 미리보기를 읽을 수 없습니다.
      </div>
    );
  const width = Math.max(200, element.width),
    height = Math.max(150, element.height);
  const font = Math.max(10, Math.min(32, model.fontSize));
  const pie = model.plots.find(
    (p) => p.kind === "pie" || p.kind === "doughnut",
  );
  const radar = canPreviewRadar(
    model.plots,
    model.xAxis,
    model.yAxis,
    model.blankMode,
  )
    ? model.plots[0]
    : undefined;
  const series = model.plots.flatMap((p) => p.series);
  const entries = pie
    ? (pie.series[0]?.labels.length
        ? pie.series[0].labels
        : (pie.series[0]?.values.map((_, i) => String(i + 1)) ?? [])
      ).map((name, i) => ({
        name,
        color:
          pie.series[0].pointColors[i] ??
          element.chart!.colors[`accent${(i % 6) + 1}`] ??
          palette[i % 6],
      }))
    : series;
  const legendVertical =
    model.legend === "r" || model.legend === "l" || model.legend === "tr";
  const legendItemWidth = Math.min(
    width - 24,
    Math.max(
      90,
      ...entries.map((e) => e.name.length * model.legendFontSize * 0.62 + 30),
    ),
  );
  const legendColumns = Math.max(1, Math.floor((width - 40) / legendItemWidth));
  const legendRows = Math.ceil(entries.length / legendColumns);
  const legendHeight =
    model.legend && !legendVertical
      ? legendRows * (model.legendFontSize + 12)
      : 0;
  const titleHeight = model.title ? font * 2.3 : 0;
  const left = pie
    ? 18
    : (radar ? 20 : 62) +
      (model.yAxis.title ? 26 : 0) +
      (model.legend === "l" ? legendItemWidth : 0);
  const right =
    width -
    22 -
    (model.legend && legendVertical && model.legend !== "l"
      ? legendItemWidth
      : 0);
  const top = 15 + titleHeight + (model.legend === "t" ? legendHeight : 0);
  const bottom =
    height -
    (pie ? 12 : 35 + (model.xAxis.title ? 28 : 0)) -
    (model.legend && !legendVertical && model.legend !== "t"
      ? legendHeight
      : 0);
  const plotWidth = Math.max(20, right - left),
    plotHeight = Math.max(20, bottom - top);
  const horizontal = model.plots.some((p) => p.kind === "bar" && p.horizontal);
  const allValues = series.flatMap((s) =>
    s.values.filter((v): v is number => v !== null),
  );
  for (const plot of model.plots)
    if (["stacked", "percentStacked"].includes(plot.grouping)) {
      for (
        let index = 0;
        index < Math.max(0, ...plot.series.map((s) => s.values.length));
        index++
      ) {
        const numbers = plot.series.map((s) => s.values[index] ?? 0);
        allValues.push(
          plot.grouping === "percentStacked"
            ? 1
            : numbers.filter((v) => v > 0).reduce((s, v) => s + v, 0),
        );
        allValues.push(
          plot.grouping === "percentStacked"
            ? numbers.some((v) => v < 0)
              ? -1
              : 0
            : numbers.filter((v) => v < 0).reduce((s, v) => s + v, 0),
        );
      }
    }
  const valueAxis = horizontal ? model.xAxis : model.yAxis;
  const valueRange = range(
    allValues,
    valueAxis,
    !model.plots.every((p) => p.kind === "scatter"),
    radar ? 5 : 10,
  );
  if (
    radar &&
    allValues.every((v) => v === 0) &&
    valueAxis.min === undefined &&
    valueAxis.max === undefined
  ) {
    valueRange[0] = 0;
    valueRange[1] = 1;
  }
  const valueScale = scale(
    valueRange,
    horizontal ? left : bottom,
    horizontal ? right : top,
    valueAxis,
  );
  const crossing = (axis: ChartAxis) =>
    valueScale(
      Math.max(
        valueRange[0],
        Math.min(
          valueRange[1],
          axis.crossValue ??
            (axis.crosses === "max"
              ? valueRange[1]
              : axis.crosses === "min"
                ? valueRange[0]
                : 0),
        ),
      ),
    );
  const horizontalAxisY = horizontal ? bottom : crossing(model.yAxis);
  const verticalAxisX = horizontal ? crossing(model.xAxis) : left;
  const scatter = model.plots.every((p) => p.kind === "scatter");
  const xRange = range(
    series.flatMap(
      (s) => s.xValues?.filter((v): v is number => v !== null) ?? [],
    ),
    model.xAxis,
    false,
    5,
    true,
  );
  const xScale = scale(xRange, left, right, model.xAxis);
  const count = Math.max(
    1,
    ...series.map((s) => Math.max(s.values.length, s.labels.length)),
  );
  const labels = Array.from(
    { length: count },
    (_, i) => series.find((s) => s.labels[i])?.labels[i] ?? String(i + 1),
  );
  const categoryAxis = horizontal ? model.yAxis : model.xAxis;
  const labelInterval =
    categoryAxis.labelSkip ??
    Math.max(
      1,
      Math.ceil(
        count /
          Math.max(
            1,
            (horizontal ? plotHeight : plotWidth) /
              (horizontal
                ? 24
                : categoryAxis.fontSize *
                  0.6 *
                  Math.max(3, ...labels.map((l) => Math.min(12, l.length)))),
          ),
      ),
    );
  const bars = model.plots.some((p) => p.kind === "bar");
  const category = (i: number) => {
    let f = bars ? (i + 0.5) / count : count > 1 ? i / (count - 1) : 0.5;
    if ((horizontal ? model.yAxis : model.xAxis).reverse) f = 1 - f;
    return horizontal ? bottom - f * plotHeight : left + f * plotWidth;
  };
  const linePath = (s: ChartSeries) => {
    let drawing = false;
    return s.values
      .map((v, i) => {
        const x = scatter ? s.xValues?.[i] : i;
        if (
          v === null ||
          x === null ||
          x === undefined ||
          (model.yAxis.log && v <= 0) ||
          (scatter && model.xAxis.log && x <= 0)
        ) {
          drawing = false;
          return "";
        }
        const point = `${scatter ? xScale(x) : category(i)},${valueScale(v)}`;
        const prefix = drawing ? "L" : "M";
        drawing = true;
        return prefix + point;
      })
      .join(" ");
  };
  const contents: ReactNode[] = [];
  const dataLabels: ReactNode[] = [];
  const appendLabel = (
    s: ChartSeries,
    index: number,
    value: number,
    x: number,
    y: number,
    options: {
      position?: string;
      dx?: number;
      dy?: number;
      percent?: number;
      anchor?: "start" | "middle" | "end";
    } = {},
  ) => {
    // Dense labels stop being readable long before the source data's 100k
    // point limit. Bound only the preview; native parts remain unchanged.
    if (dataLabels.length >= MAX_CHART_LABELS) return;
    const setting = s.pointLabels[index] ?? s.dataLabel;
    if (setting.deleted) return;
    const parts = [
      setting.series ? s.name : "",
      setting.category ? (s.labels[index] ?? labels[index]) : "",
      setting.value
        ? formatChartNumber(
            value,
            setting.sourceLinked
              ? (s.pointFormats[index] ?? setting.format)
              : setting.format,
          )
        : "",
      setting.percent && options.percent !== undefined
        ? formatChartNumber(
            options.percent,
            setting.format.includes("%") ? setting.format : "0%",
          )
        : "",
    ].filter(Boolean);
    const text = (setting.text ?? parts.join(setting.separator)).slice(
      0,
      MAX_CHART_LABEL_TEXT,
    );
    if (!text) return;
    const position = setting.position || options.position || "t";
    let dx = 0,
      dy = 0,
      anchor: "start" | "middle" | "end" = "middle";
    if (
      position === "outEnd" ||
      position === "t" ||
      position === "b" ||
      position === "l" ||
      position === "r"
    ) {
      dx = options.dx ?? (position === "l" ? -8 : position === "r" ? 8 : 0);
      dy =
        options.dy ??
        (position === "b" ? setting.fontSize : -setting.fontSize * 0.7);
      anchor =
        options.anchor ??
        (position === "l" ? "end" : position === "r" ? "start" : "middle");
    }
    dataLabels.push(
      <text
        key={`label-${dataLabels.length}`}
        data-chart-data-label={`${s.name}-${index}`}
        x={x + dx}
        y={y + dy}
        dominantBaseline="central"
        textAnchor={anchor}
        fill={setting.color}
        fontSize={setting.fontSize}
        fontFamily={fontStack(setting.fontFamily)}
        fontWeight={setting.bold ? "bold" : undefined}
        fontStyle={setting.italic ? "italic" : undefined}
      >
        {text}
      </text>,
    );
  };
  if (radar) {
    contents.push(
      radarArtwork({
        plot: radar,
        categoryAxis: model.xAxis,
        valueAxis,
        labels,
        blankMode: model.blankMode,
        left,
        right,
        top,
        bottom,
        domain: valueRange,
        ticks: ticks(
          valueRange,
          valueAxis,
          Math.max(10 * valueAxis.fontSize, plotHeight),
          5,
        ),
        clipId: clip + "-radar",
        appendLabel,
        onHover: (point) => tooltip.current?.show(point),
        onLeave: () => tooltip.current?.hide(),
      }),
    );
  } else if (pie && pie.series[0]) {
    const s = pie.series[0],
      normalizer = Math.max(0, ...s.values.map((v) => Math.abs(v ?? 0))) || 1,
      total = s.values.reduce<number>(
        (sum, v) => sum + Math.abs(v ?? 0) / normalizer,
        0,
      );
    const cx = (left + right) / 2,
      cy = (top + bottom) / 2,
      radius = Math.max(10, Math.min(plotWidth, plotHeight) * 0.46);
    let angle = ((pie.firstAngle - 90) * Math.PI) / 180;
    s.values.forEach((value, i) => {
      if (!total || !value) return;
      const size = Math.min(
          Math.PI * 2 - 0.00001,
          (Math.abs(value) / normalizer / total) * Math.PI * 2,
        ),
        end = angle + size;
      const point = (a: number, r: number) =>
        `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
      const inner = radius * Math.max(0.1, Math.min(0.9, pie.hole / 100));
      const path =
        pie.kind === "doughnut"
          ? `M${point(angle, radius)} A${radius},${radius} 0 ${size > Math.PI ? 1 : 0} 1 ${point(end, radius)} L${point(end, inner)} A${inner},${inner} 0 ${size > Math.PI ? 1 : 0} 0 ${point(angle, inner)} Z`
          : `M${cx},${cy} L${point(angle, radius)} A${radius},${radius} 0 ${size > Math.PI ? 1 : 0} 1 ${point(end, radius)} Z`;
      contents.push(
        <path
          key={`slice-${i}`}
          data-chart-slice={i}
          d={path}
          fill={entries[i]?.color ?? palette[i % 6]}
          stroke="white"
          strokeWidth="1"
        >
          <title>{`${labels[i]}: ${value}`}</title>
        </path>,
      );
      const mid = angle + size / 2;
      const setting = s.pointLabels[i] ?? s.dataLabel;
      const outside = ["outEnd", "bestFit"].includes(setting.position);
      const labelRadius = outside
        ? radius * 1.13
        : pie.kind === "doughnut"
          ? (radius + inner) / 2
          : radius * 0.65;
      appendLabel(
        s,
        i,
        value,
        cx + labelRadius * Math.cos(mid),
        cy + labelRadius * Math.sin(mid),
        {
          position: "ctr",
          percent: Math.abs(value) / normalizer / total,
          dx: 0,
          dy: 0,
        },
      );
      angle = end;
    });
  } else {
    for (const [plotIndex, plot] of model.plots.entries()) {
      const stacked = ["stacked", "percentStacked"].includes(plot.grouping);
      plot.series.forEach((s, seriesIndex) => {
        const id = `${plotIndex}-${seriesIndex}`;
        if (plot.kind === "bar")
          s.values.forEach((value, i) => {
            if (value === null) return;
            const divisor =
              plot.grouping === "percentStacked"
                ? plot.series.reduce(
                    (sum, item) => sum + Math.abs(item.values[i] ?? 0),
                    0,
                  ) || 1
                : 1;
            const prior = stacked
              ? plot.series
                  .slice(0, seriesIndex)
                  .reduce(
                    (sum, item) =>
                      sum +
                      ((item.values[i] ?? 0) * value > 0
                        ? item.values[i]! / divisor
                        : 0),
                    0,
                  )
              : 0;
            const a = valueScale(
                Math.max(valueRange[0], Math.min(valueRange[1], prior)),
              ),
              b = valueScale(prior + value / divisor);
            const clusterWidth =
              (horizontal ? plotHeight : plotWidth) /
              count /
              (1 + plot.gapWidth / 100);
            const size = clusterWidth / (stacked ? 1 : plot.series.length);
            const center =
              category(i) -
              clusterWidth / 2 +
              (stacked
                ? 0
                : (horizontal && !categoryAxis.reverse
                    ? plot.series.length - 1 - seriesIndex
                    : seriesIndex) * size);
            contents.push(
              <rect
                key={`${id}-${i}`}
                data-chart-bar={id}
                x={horizontal ? Math.min(a, b) : center}
                y={horizontal ? center : Math.min(a, b)}
                width={horizontal ? Math.abs(a - b) : size}
                height={horizontal ? size : Math.abs(a - b)}
                fill={s.pointColors[i] ?? s.color}
                stroke={s.border?.color}
                strokeWidth={s.border?.width}
              >
                <title>{`${s.name}: ${value}`}</title>
              </rect>,
            );
            const setting = s.pointLabels[i] ?? s.dataLabel;
            const position = setting.position || (stacked ? "ctr" : "outEnd");
            const centerLabel = position === "ctr" || position === "bestFit";
            const labelValue = centerLabel
              ? (a + b) / 2
              : position === "inBase"
                ? a + Math.sign(b - a) * setting.fontSize * 0.7
                : position === "inEnd"
                  ? b - Math.sign(b - a) * setting.fontSize * 0.7
                  : b;
            appendLabel(
              s,
              i,
              value,
              horizontal ? labelValue : center + size / 2,
              horizontal ? center + size / 2 : labelValue,
              {
                position,
                dx:
                  horizontal && position === "outEnd"
                    ? value >= 0
                      ? 8
                      : -8
                    : 0,
                dy:
                  !horizontal && position === "outEnd"
                    ? value >= 0
                      ? -setting.fontSize * 0.7
                      : setting.fontSize * 0.7
                    : 0,
                anchor:
                  horizontal && position === "outEnd"
                    ? value >= 0
                      ? "start"
                      : "end"
                    : "middle",
              },
            );
          });
        else if (
          plot.kind === "line" ||
          plot.kind === "scatter" ||
          plot.kind === "area"
        ) {
          let shown = s;
          const baseline = s.values.map((value, i) =>
            stacked
              ? plot.series
                  .slice(0, seriesIndex)
                  .reduce((sum, item) => sum + (item.values[i] ?? 0), 0)
              : 0,
          );
          if (stacked)
            shown = {
              ...s,
              values: s.values.map((v, i) =>
                v === null
                  ? null
                  : (v + baseline[i]) /
                    (plot.grouping === "percentStacked"
                      ? plot.series.reduce(
                          (sum, item) => sum + Math.abs(item.values[i] ?? 0),
                          0,
                        ) || 1
                      : 1),
              ),
            };
          const d = linePath(shown);
          if (
            plot.kind === "area" &&
            !shown.values.includes(null) &&
            shown.values.length
          ) {
            const base = [...baseline]
              .map((v, i) => `L${category(i)},${valueScale(v)}`)
              .reverse()
              .join(" ");
            contents.push(
              <path
                key={id + "fill"}
                data-chart-area={id}
                d={d + " " + base + " Z"}
                fill={s.color}
                fillOpacity=".65"
              />,
            );
          }
          if (s.width > 0)
            contents.push(
              <path
                key={id}
                data-chart-line={id}
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth={s.width}
                strokeDasharray={s.dash}
                strokeLinejoin="round"
              />,
            );
          if (s.marker)
            contents.push(
              <ChartMarkers
                key={id + "markers"}
                id={id}
                points={shown.values.flatMap((v, i) => {
                  const x = scatter ? s.xValues?.[i] : i;
                  return v !== null && x !== null && x !== undefined
                    ? [
                        {
                          x: scatter ? xScale(x) : category(i),
                          y: valueScale(v),
                          index: i,
                          color: s.pointColors[i] ?? s.color,
                          value: v,
                        },
                      ]
                    : [];
                })}
                radius={s.markerSize * (2 / 3)}
                symbol={s.markerSymbol}
                seriesName={s.name}
                title={(point) =>
                  `${s.name.slice(0, 160)}${s.labels[point.index] ? " / " + s.labels[point.index].slice(0, 160) : ""}: ${formatChartNumber(point.value, s.pointFormats[point.index] ?? s.numberFormat)}`
                }
                onHover={(point) => tooltip.current?.show(point)}
                onLeave={() => tooltip.current?.hide()}
              />,
            );
          shown.values.forEach((v, i) => {
            const x = scatter ? s.xValues?.[i] : i;
            if (
              v !== null &&
              x !== null &&
              x !== undefined &&
              s.values[i] !== null
            )
              appendLabel(
                s,
                i,
                s.values[i]!,
                scatter ? xScale(x) : category(i),
                valueScale(v),
              );
          });
        }
      });
    }
  }
  const legendY =
    model.legend === "t"
      ? 15 + titleHeight
      : bottom + (pie ? 8 : 30 + (model.xAxis.title ? 28 : 0));
  const unsupported = model.plots.some(
    (p) => p.kind === "unsupported" || (p.kind === "radar" && !radar),
  );
  return (
    <svg
      className="chart-visual"
      role="img"
      aria-label={model.title || element.alt || "PowerPoint 차트"}
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height="100%"
      style={{
        overflow: "hidden",
        fontFamily: fontStack(model.fontFamily),
        fontSize: font,
        transform: `scale(${element.flipH ? -1 : 1},${element.flipV ? -1 : 1})`,
      }}
    >
      <defs>
        <clipPath id={clip}>
          <rect x={left} y={top} width={plotWidth} height={plotHeight} />
        </clipPath>
      </defs>
      <rect width={width} height={height} fill={model.background} />
      {model.backgroundImage && (
        <ChartImageFill
          fill={model.backgroundImage}
          width={width}
          height={height}
          playing={playing}
        />
      )}
      {!!model.title && (
        <text
          x={width / 2}
          y={font * 1.6}
          textAnchor="middle"
          fill={model.textColor}
          fontSize={font * 1.25}
        >
          {model.title}
        </text>
      )}
      <rect
        x={left}
        y={top}
        width={plotWidth}
        height={plotHeight}
        fill={model.plotFill}
        stroke={model.plotLineColor}
        strokeWidth={model.plotLineWidth}
      />
      {model.plotImage && (
        <ChartImageFill
          fill={model.plotImage}
          x={left}
          y={top}
          width={plotWidth}
          height={plotHeight}
          playing={playing}
        />
      )}
      {!pie && !radar && !unsupported && (
        <>
          {!valueAxis.hidden &&
            ticks(
              valueRange,
              valueAxis,
              horizontal ? plotWidth : plotHeight,
            ).map((v) => (
              <g key={v}>
                {valueAxis.gridColor && (
                  <line
                    data-chart-grid={v}
                    x1={horizontal ? valueScale(v) : left}
                    y1={horizontal ? top : valueScale(v)}
                    x2={horizontal ? valueScale(v) : right}
                    y2={horizontal ? bottom : valueScale(v)}
                    stroke={valueAxis.gridColor}
                    strokeWidth={valueAxis.gridWidth ?? 0.8}
                  />
                )}
                {valueAxis.labelPosition !== "none" && (
                  <text
                    data-chart-value-tick={v}
                    x={horizontal ? valueScale(v) : left - 10}
                    y={
                      horizontal
                        ? bottom + 23
                        : valueScale(v) + valueAxis.fontSize * 0.35
                    }
                    textAnchor={horizontal ? "middle" : "end"}
                    fill={valueAxis.color}
                    fontSize={valueAxis.fontSize}
                    fontFamily={fontStack(valueAxis.fontFamily)}
                  >
                    {formatChartNumber(v, valueAxis.format)}
                  </text>
                )}
              </g>
            ))}
          {!scatter &&
            !(horizontal ? model.yAxis : model.xAxis).hidden &&
            categoryAxis.labelPosition !== "none" &&
            labels.map((label, i) => {
              const available =
                (horizontal ? left - 15 : plotWidth / count) /
                (categoryAxis.fontSize * 0.56);
              const lines =
                label.length > available && label.includes(" ")
                  ? label.split(/\s+(?=\()/)
                  : [label];
              return i % labelInterval === 0 ? (
                <text
                  key={i}
                  data-chart-category-label={i}
                  x={horizontal ? left - 10 : category(i)}
                  y={horizontal ? category(i) + font * 0.35 : bottom + 23}
                  textAnchor={horizontal ? "end" : "middle"}
                  fill={categoryAxis.color}
                  fontSize={categoryAxis.fontSize}
                  fontFamily={fontStack(categoryAxis.fontFamily)}
                >
                  {lines.map((line, index) => (
                    <tspan
                      key={index}
                      x={horizontal ? left - 10 : category(i)}
                      dy={index ? categoryAxis.fontSize * 1.12 : 0}
                    >
                      {line}
                    </tspan>
                  ))}
                </text>
              ) : null;
            })}
          {scatter &&
            !model.xAxis.hidden &&
            model.xAxis.labelPosition !== "none" &&
            ticks(xRange, model.xAxis, plotWidth, 5).map((v) => (
              <text
                key={v}
                x={xScale(v)}
                y={bottom + 23}
                fill={model.xAxis.color}
                textAnchor="middle"
                fontSize={model.xAxis.fontSize}
              >
                {formatChartNumber(v, model.xAxis.format)}
              </text>
            ))}
          {!model.xAxis.hidden && (
            <line
              x1={left}
              y1={horizontalAxisY}
              x2={right}
              y2={horizontalAxisY}
              stroke={model.xAxis.lineColor}
              strokeWidth={model.xAxis.lineWidth}
            />
          )}
          {!model.yAxis.hidden && (
            <line
              x1={verticalAxisX}
              y1={top}
              x2={verticalAxisX}
              y2={bottom}
              stroke={model.yAxis.lineColor}
              strokeWidth={model.yAxis.lineWidth}
            />
          )}
          {model.xAxis.title && (
            <text
              x={(left + right) / 2}
              y={bottom + 52}
              textAnchor="middle"
              fill={model.textColor}
            >
              {model.xAxis.title}
            </text>
          )}
          {model.yAxis.title && (
            <text
              transform={`translate(20 ${(top + bottom) / 2}) rotate(-90)`}
              textAnchor="middle"
              fill={model.textColor}
            >
              {model.yAxis.title}
            </text>
          )}
        </>
      )}
      <g clipPath={`url(#${clip})`}>{contents}</g>
      <g data-chart-data-labels="true">{dataLabels}</g>
      {model.annotations.map((annotation, index) => (
        <text
          key={index}
          data-chart-annotation={index}
          x={
            annotation.x * width +
            (annotation.align === "ctr"
              ? (annotation.width * width) / 2
              : annotation.align === "r"
                ? annotation.width * width - 9.6
                : 9.6)
          }
          y={annotation.y * height + 4.8 + annotation.fontSize * 0.8}
          textAnchor={
            annotation.align === "ctr"
              ? "middle"
              : annotation.align === "r"
                ? "end"
                : "start"
          }
          fill={annotation.color}
          fontFamily={fontStack(annotation.fontFamily)}
          fontSize={annotation.fontSize}
          fontWeight={annotation.bold ? "bold" : undefined}
          fontStyle={annotation.italic ? "italic" : undefined}
        >
          {annotation.text.slice(0, MAX_CHART_LABEL_TEXT)}
        </text>
      ))}
      {unsupported && (
        <g fill={model.textColor} textAnchor="middle">
          <text x={width / 2} y={height / 2}>
            이 차트 유형의 미리보기는 아직 지원하지 않습니다.
          </text>
          <text x={width / 2} y={height / 2 + font * 1.6}>
            원본 차트와 데이터는 PPTX 저장 시 유지됩니다.
          </text>
        </g>
      )}
      {model.legend &&
        entries.map((entry, i) => {
          const x = legendVertical
            ? model.legend === "l"
              ? 15
              : right + 15
            : 20 + (i % legendColumns) * legendItemWidth;
          const y = legendVertical
            ? top +
              (model.legend === "tr"
                ? 0
                : Math.max(
                    0,
                    (plotHeight -
                      (entries.length * (model.legendFontSize + 12) - 12)) /
                      2,
                  )) +
              i * (model.legendFontSize + 12)
            : legendY +
              Math.floor(i / legendColumns) * (model.legendFontSize + 12);
          const marker = pie ? undefined : series[i];
          return (
            <g key={i} data-chart-legend={entry.name}>
              {bars || pie || radar?.radarStyle === "filled" ? (
                <rect
                  x={x}
                  y={y + model.legendFontSize * 0.2}
                  width={8}
                  height={8}
                  fill={entry.color}
                />
              ) : (
                <>
                  {!marker || marker.width > 0 ? (
                    <line
                      x1={x}
                      y1={y + model.legendFontSize / 2}
                      x2={x + 22}
                      y2={y + model.legendFontSize / 2}
                      stroke={entry.color}
                      strokeWidth={marker?.width ?? 3}
                    />
                  ) : null}
                  {marker?.marker && (
                    <path
                      data-chart-legend-marker={marker.markerSymbol}
                      d={markerPath(
                        x + 11,
                        y + model.legendFontSize / 2,
                        Math.min(
                          8,
                          model.legendFontSize / 2,
                          (marker.markerSize * 2) / 3,
                        ),
                        marker.markerSymbol,
                      )}
                      fill={entry.color}
                    />
                  )}
                </>
              )}
              <text
                x={
                  x + (bars || pie || radar?.radarStyle === "filled" ? 12 : 30)
                }
                y={y + model.legendFontSize * 0.82}
                fill={model.legendTextColor}
                fontSize={model.legendFontSize}
                fontFamily={fontStack(model.legendFontFamily)}
              >
                {entry.name}
              </text>
            </g>
          );
        })}
      <ChartPointTooltip
        ref={tooltip}
        width={width}
        height={height}
        source={model}
      />
    </svg>
  );
}
