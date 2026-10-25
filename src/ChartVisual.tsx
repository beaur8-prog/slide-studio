import { useId, useMemo, type ReactNode } from "react";
import type { SlideElement } from "./types";
import { readChartModel, type ChartAxis, type ChartSeries } from "./chart";
import { fontStack } from "./text-layout";

function range(
  values: number[],
  axis: ChartAxis,
  zero = false,
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
  if (zero && !axis.log) {
    if (axis.min === undefined) low = Math.min(0, low);
    if (axis.max === undefined) high = Math.max(0, high);
  }
  if (axis.log) {
    low =
      low > 0
        ? low
        : valid.reduce((min, v) => (v > 0 ? Math.min(min, v) : min), 1);
    high = high > low ? high : low * axis.log;
    return [low, high];
  }
  if (!(high > low)) {
    high = low + Math.max(1, Math.abs(low) * 0.1);
    if (axis.min === undefined) low -= Math.max(1, Math.abs(low) * 0.1);
  }
  const rough = (high - low) / 5,
    power = 10 ** Math.floor(Math.log10(rough));
  const unit =
    axis.unit ?? [1, 2, 2.5, 5, 10].find((v) => v * power >= rough)! * power;
  if (axis.min === undefined) low = Math.floor(low / unit) * unit;
  if (axis.max === undefined) high = Math.ceil(high / unit) * unit;
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
    distance = project(domain[1]) - low;
  return (v: number) => {
    let fraction = (project(v) - low) / distance;
    if (axis.reverse) fraction = 1 - fraction;
    return start + fraction * (end - start);
  };
}
function ticks(domain: [number, number], axis: ChartAxis): number[] {
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
  const rough = (domain[1] - domain[0]) / 5,
    power = 10 ** Math.floor(Math.log10(rough));
  const unit =
    axis.unit ?? [1, 2, 2.5, 5, 10].find((v) => v * power >= rough)! * power;
  const values: number[] = [];
  for (
    let v = Math.ceil(domain[0] / unit) * unit;
    v <= domain[1] + unit * 0.00001 && values.length < 100;
    v += unit
  )
    values.push(Math.abs(v) < unit * 1e-8 ? 0 : v);
  return values;
}
function format(value: number, code = "General") {
  if (code.includes("%"))
    return `${+(value * 100).toFixed(code.includes("0.0") ? 1 : 0)}%`;
  if (
    Math.abs(value) >= 1e7 ||
    (Math.abs(value) > 0 && Math.abs(value) < 0.0001)
  )
    return value.toExponential(1);
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: 4,
    useGrouping: code.includes(","),
  }).format(value);
}
const palette = [
  "#4472C4",
  "#ED7D31",
  "#A5A5A5",
  "#FFC000",
  "#5B9BD5",
  "#70AD47",
];

export function ChartVisual({ element }: { element: SlideElement }) {
  const clip = "chart-" + useId().replaceAll(":", "");
  const model = useMemo(() => {
    try {
      return element.chart ? readChartModel(element.chart) : null;
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
    Math.max(90, ...entries.map((e) => e.name.length * font * 0.62 + 38)),
  );
  const legendColumns = Math.max(1, Math.floor((width - 40) / legendItemWidth));
  const legendRows = Math.ceil(entries.length / legendColumns);
  const legendHeight =
    model.legend && !legendVertical ? legendRows * (font + 12) : 0;
  const titleHeight = model.title ? font * 2.3 : 0;
  const left = pie
    ? 18
    : 62 +
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
  );
  const valueScale = scale(
    valueRange,
    horizontal ? left : bottom,
    horizontal ? right : top,
    valueAxis,
  );
  const scatter = model.plots.every((p) => p.kind === "scatter");
  const xRange = range(
    series.flatMap(
      (s) => s.xValues?.filter((v): v is number => v !== null) ?? [],
    ),
    model.xAxis,
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
  const labelInterval = Math.max(
    1,
    Math.ceil(
      count /
        Math.max(
          1,
          (horizontal ? plotHeight : plotWidth) /
            (horizontal
              ? 24
              : font *
                Math.max(3, ...labels.map((l) => Math.min(12, l.length)))),
        ),
    ),
  );
  const bars = model.plots.some((p) => p.kind === "bar");
  const category = (i: number) => {
    let f = bars ? (i + 0.5) / count : count > 1 ? i / (count - 1) : 0.5;
    if ((horizontal ? model.yAxis : model.xAxis).reverse) f = 1 - f;
    return horizontal ? top + f * plotHeight : left + f * plotWidth;
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
  if (pie && pie.series[0]) {
    const s = pie.series[0],
      total = s.values.reduce<number>((sum, v) => sum + Math.abs(v ?? 0), 0);
    const cx = (left + right) / 2,
      cy = (top + bottom) / 2,
      radius = Math.max(10, Math.min(plotWidth, plotHeight) * 0.46);
    let angle = ((pie.firstAngle - 90) * Math.PI) / 180;
    s.values.forEach((value, i) => {
      if (!total || !value) return;
      const size = Math.min(
          Math.PI * 2 - 0.00001,
          (Math.abs(value) / total) * Math.PI * 2,
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
            const size =
              (((horizontal ? plotHeight : plotWidth) / count) * 0.72) /
              (stacked ? 1 : plot.series.length);
            const center =
              category(i) -
              (((horizontal ? plotHeight : plotWidth) / count) * 0.72) / 2 +
              (stacked ? 0 : seriesIndex * size);
            contents.push(
              <rect
                key={`${id}-${i}`}
                data-chart-bar={id}
                x={horizontal ? Math.min(a, b) : center}
                y={horizontal ? center : Math.min(a, b)}
                width={horizontal ? Math.abs(a - b) : size}
                height={horizontal ? size : Math.abs(a - b)}
                fill={s.pointColors[i] ?? s.color}
              >
                <title>{`${s.name}: ${value}`}</title>
              </rect>,
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
            shown.values.forEach((v, i) => {
              const x = scatter ? s.xValues?.[i] : i;
              if (v !== null && x !== null && x !== undefined)
                contents.push(
                  <circle
                    key={`${id}-point-${i}`}
                    data-chart-point={id}
                    cx={scatter ? xScale(x) : category(i)}
                    cy={valueScale(v)}
                    r={Math.max(2, s.markerSize * 0.6)}
                    fill={s.pointColors[i] ?? s.color}
                  >
                    <title>{`${s.name}: ${v}`}</title>
                  </circle>,
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
    (p) => p.kind === "unsupported" || p.kind === "radar",
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
      />
      {!pie && !unsupported && (
        <>
          {!valueAxis.hidden &&
            ticks(valueRange, valueAxis).map((v) => (
              <g key={v}>
                {valueAxis.gridColor && (
                  <line
                    x1={horizontal ? valueScale(v) : left}
                    y1={horizontal ? top : valueScale(v)}
                    x2={horizontal ? valueScale(v) : right}
                    y2={horizontal ? bottom : valueScale(v)}
                    stroke={valueAxis.gridColor}
                    strokeWidth=".8"
                  />
                )}
                <text
                  x={horizontal ? valueScale(v) : left - 10}
                  y={
                    horizontal
                      ? bottom + 23
                      : valueScale(v) + valueAxis.fontSize * 0.35
                  }
                  textAnchor={horizontal ? "middle" : "end"}
                  fill={valueAxis.color}
                  fontSize={valueAxis.fontSize}
                >
                  {format(v, valueAxis.format)}
                </text>
              </g>
            ))}
          {!scatter &&
            !(horizontal ? model.yAxis : model.xAxis).hidden &&
            labels.map((label, i) => {
              return i % labelInterval === 0 ? (
                <text
                  key={i}
                  x={horizontal ? left - 10 : category(i)}
                  y={horizontal ? category(i) + font * 0.35 : bottom + 23}
                  textAnchor={horizontal ? "end" : "middle"}
                  fill={model.xAxis.color}
                  fontSize={model.xAxis.fontSize}
                >
                  {label}
                </text>
              ) : null;
            })}
          {scatter &&
            !model.xAxis.hidden &&
            ticks(xRange, model.xAxis).map((v) => (
              <text
                key={v}
                x={xScale(v)}
                y={bottom + 23}
                fill={model.xAxis.color}
                textAnchor="middle"
                fontSize={model.xAxis.fontSize}
              >
                {format(v, model.xAxis.format)}
              </text>
            ))}
          <line x1={left} y1={bottom} x2={right} y2={bottom} stroke="#8C9399" />
          <line x1={left} y1={top} x2={left} y2={bottom} stroke="#8C9399" />
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
            ? top + i * (font + 12)
            : legendY + Math.floor(i / legendColumns) * (font + 12);
          return (
            <g key={i} data-chart-legend={entry.name}>
              <line
                x1={x}
                y1={y + font / 2}
                x2={x + 22}
                y2={y + font / 2}
                stroke={entry.color}
                strokeWidth="3"
              />
              <text x={x + 30} y={y + font * 0.82} fill={model.textColor}>
                {entry.name}
              </text>
            </g>
          );
        })}
    </svg>
  );
}
