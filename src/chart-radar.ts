import type { ChartAxis, ChartPlot } from "./chart";

/** Only verified, two-dimensional radial geometry. Unsupported source charts
 * still retain their complete native package for PowerPoint round trips. */
export function canPreviewRadar(
  plots: ChartPlot[],
  categoryAxis: ChartAxis,
  valueAxis: ChartAxis,
  blankMode: "gap" | "span" | "zero",
): boolean {
  if (plots.length !== 1 || plots[0].kind !== "radar") return false;
  const plot = plots[0];
  if (!["standard", "marker", "filled"].includes(plot.radarStyle ?? "standard"))
    return false;
  if (
    categoryAxis.reverse ||
    valueAxis.reverse ||
    valueAxis.log ||
    categoryAxis.log
  )
    return false;
  const count = Math.max(
    0,
    ...plot.series.map((s) => Math.max(s.labels.length, s.values.length)),
  );
  if (count < 3 || !plot.series.length) return false;
  if (valueAxis.min !== undefined && valueAxis.min < 0) return false;
  if (valueAxis.max !== undefined && valueAxis.max <= (valueAxis.min ?? 0))
    return false;
  for (const series of plot.series) {
    // Negative radial axes and filled polygons across gaps need an Office
    // reference before previewing; do not silently invent a different shape.
    if (
      series.values.some(
        (v) => v !== null && (v < 0 || v < (valueAxis.min ?? 0)),
      )
    )
      return false;
    if (
      plot.radarStyle === "filled" &&
      blankMode === "gap" &&
      (series.values.length < count || series.values.includes(null))
    )
      return false;
  }
  return true;
}

/** Preserve the circular category order, including the last-to-first edge.
 * A gap breaks only the edges that touch the missing point. */
export function radarSeriesPath(
  points: ({ x: number; y: number } | null)[],
  blankMode: "gap" | "span" | "zero",
): string {
  const available = points.filter((p): p is { x: number; y: number } => !!p);
  if (!available.length) return "";
  if (blankMode !== "gap" || available.length === points.length)
    return (
      available.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ") +
      (available.length > 2 ? " Z" : "")
    );
  const missing = points.indexOf(null);
  let drawing = false;
  const commands: string[] = [];
  for (let offset = 1; offset <= points.length; offset++) {
    const point = points[(missing + offset) % points.length];
    if (!point) {
      drawing = false;
      continue;
    }
    commands.push(`${drawing ? "L" : "M"}${point.x},${point.y}`);
    drawing = true;
  }
  return commands.join(" ");
}
