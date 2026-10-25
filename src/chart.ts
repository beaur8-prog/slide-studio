import type { ChartData } from "./types";
import { record, stringValue, colorValue } from "./validation";

export const CHART_NS =
  "http://schemas.openxmlformats.org/drawingml/2006/chart";
export const DRAWING_NS =
  "http://schemas.openxmlformats.org/drawingml/2006/main";
export const MAX_CHART_BYTES = 16 * 1024 * 1024;
export const child = (node: Element | Document | undefined, name: string) =>
  Array.from(node?.children ?? []).find((n) => n.localName === name);
export const all = (node: Element | Document | undefined, name: string) =>
  Array.from(node?.getElementsByTagNameNS("*", name) ?? []);
export const first = (node: Element | Document | undefined, name: string) =>
  all(node, name)[0];
export const val = (node: Element | undefined, fallback = "") =>
  node?.getAttribute("val") ?? fallback;
export const num = (node: Element | undefined, fallback = 0) => {
  const value = Number(val(node, String(fallback)));
  return Number.isFinite(value) ? value : fallback;
};
export function chartXml(source: string): Document {
  if (source.length > 8 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(source))
    throw Error("잘못된 차트 XML입니다.");
  const doc = new DOMParser().parseFromString(source, "application/xml");
  if (doc.getElementsByTagName("parsererror").length)
    throw Error("차트 XML을 읽을 수 없습니다.");
  return doc;
}
export function decodeChartPart(data: string): Uint8Array {
  return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
}
export const chartPartText = (data: string) =>
  new TextDecoder().decode(decodeChartPart(data));
export function chartBytes(chart: ChartData) {
  return chart.parts.reduce((sum, part) => sum + part.data.length * 0.75, 0);
}
function packagePath(input: unknown): string {
  const value = stringValue(input, "차트 파일 경로", 1000, false);
  if (
    !/^[A-Za-z0-9_./ -]+$/.test(value) ||
    value.startsWith("/") ||
    value.split("/").some((p) => !p || p === "." || p === "..")
  )
    throw Error("잘못된 차트 파일 경로입니다.");
  return value;
}
const CONTENT_TYPES =
  /^(?:application\/(?:vnd\.openxmlformats-officedocument\.(?:drawingml\.(?:chart|chartshapes)|themeOverride|theme)\+xml|vnd\.ms-office\.(?:chartstyle|chartcolorstyle)\+xml|vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet)|image\/(?:png|jpeg|gif|webp|tiff|svg\+xml|x-emf|x-wmf))$/i;
export const chartRelationshipAllowed = (type: string) =>
  /\/(?:package|chartStyle|chartColorStyle|themeOverride|chartUserShapes|image|hyperlink)$/.test(
    type,
  );
export function validateChart(input: unknown): ChartData {
  const source = record(input, "차트");
  if (
    !Array.isArray(source.parts) ||
    !source.parts.length ||
    source.parts.length > 128
  )
    throw Error("차트 파일 수가 지원 범위를 초과합니다.");
  let bytes = 0;
  const paths = new Set<string>();
  const parts = source.parts.map((input) => {
    const part = record(input, "차트 파일"),
      path = packagePath(part.path);
    if (paths.has(path)) throw Error("차트 파일 경로가 중복되었습니다.");
    paths.add(path);
    const contentType = stringValue(
      part.contentType,
      "차트 파일 형식",
      200,
      false,
    );
    if (!CONTENT_TYPES.test(contentType))
      throw Error("지원하지 않는 차트 첨부 파일입니다.");
    const data = stringValue(
      part.data,
      "차트 파일 데이터",
      Math.ceil((MAX_CHART_BYTES * 4) / 3) + 4,
      false,
    );
    bytes += data.length * 0.75;
    if (
      bytes > MAX_CHART_BYTES ||
      data.length % 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
    )
      throw Error("차트 첨부 파일은 합계 16 MiB까지 지원합니다.");
    if (contentType.endsWith("+xml")) chartXml(chartPartText(data));
    if (!Array.isArray(part.relationships) || part.relationships.length > 128)
      throw Error("잘못된 차트 관계입니다.");
    const ids = new Set<string>();
    const relationships = part.relationships.map((input) => {
      const rel = record(input, "차트 관계"),
        id = stringValue(rel.id, "차트 관계 ID", 160, false);
      if (!/^[\w.-]+$/.test(id) || ids.has(id))
        throw Error("잘못된 차트 관계 ID입니다.");
      ids.add(id);
      const type = stringValue(rel.type, "차트 관계 형식", 300, false);
      if (!/^https?:\/\//.test(type) || !chartRelationshipAllowed(type))
        throw Error("지원하지 않는 차트 관계입니다.");
      const external = rel.external === true;
      const target = external
        ? stringValue(rel.target, "차트 외부 참조", 4096, false)
        : packagePath(rel.target);
      if (/[\x00-\x1f]/.test(target))
        throw Error("잘못된 차트 외부 참조입니다.");
      if (
        external &&
        /^[a-z][a-z0-9+.-]*:/i.test(target) &&
        !/^(https?|mailto|file):/i.test(target)
      )
        throw Error("지원하지 않는 차트 외부 참조입니다.");
      return { id, type, target, ...(external ? { external: true } : {}) };
    });
    return { path, contentType, data, relationships };
  });
  for (const part of parts)
    for (const rel of part.relationships)
      if (!rel.external && !paths.has(rel.target))
        throw Error("차트 첨부 파일이 누락되었습니다.");
  const root = packagePath(source.root),
    rootPart = parts.find((p) => p.path === root);
  const rootDoc = rootPart ? chartXml(chartPartText(rootPart.data)) : undefined;
  if (
    !rootPart ||
    rootPart.contentType !==
      "application/vnd.openxmlformats-officedocument.drawingml.chart+xml" ||
    rootDoc?.documentElement.namespaceURI !== CHART_NS ||
    rootDoc.documentElement.localName !== "chartSpace"
  )
    throw Error("차트 본문이 누락되었습니다.");
  const colors: Record<string, string> = {};
  const scheme = record(source.colors, "차트 테마");
  if (Object.keys(scheme).length > 64)
    throw Error("차트 테마 색이 너무 많습니다.");
  for (const [name, color] of Object.entries(scheme)) {
    if (!/^[A-Za-z][\w-]{0,31}$/.test(name))
      throw Error("잘못된 차트 테마입니다.");
    colors[name] = colorValue(color, "차트 색상");
  }
  return {
    root,
    parts,
    colors,
    fontFamily: stringValue(source.fontFamily, "차트 글꼴", 200, false),
  };
}

export type ChartKind =
  | "line"
  | "bar"
  | "area"
  | "pie"
  | "doughnut"
  | "scatter"
  | "radar"
  | "unsupported";
export interface ChartAxis {
  title: string;
  min?: number;
  max?: number;
  unit?: number;
  log?: number;
  reverse: boolean;
  hidden: boolean;
  color: string;
  fontSize: number;
  format: string;
  gridColor?: string;
}
export interface ChartSeries {
  name: string;
  values: (number | null)[];
  labels: string[];
  xValues?: (number | null)[];
  color: string;
  width: number;
  dash?: string;
  marker: boolean;
  markerSize: number;
  pointColors: Record<number, string>;
}
export interface ChartPlot {
  kind: ChartKind;
  horizontal: boolean;
  grouping: string;
  series: ChartSeries[];
  hole: number;
  firstAngle: number;
}
export interface ChartModel {
  title: string;
  plots: ChartPlot[];
  xAxis: ChartAxis;
  yAxis: ChartAxis;
  legend?: string;
  fontFamily: string;
  fontSize: number;
  textColor: string;
  background: string;
  plotFill: string;
  approximate: boolean;
}
const PALETTE = [
  "#4472C4",
  "#ED7D31",
  "#A5A5A5",
  "#FFC000",
  "#5B9BD5",
  "#70AD47",
];
export function chartColor(
  node: Element | undefined,
  colors: Record<string, string>,
  fallback: string,
): string {
  if (!node || child(node, "noFill")) return fallback;
  const rgb = first(node, "srgbClr"),
    scheme = first(node, "schemeClr"),
    system = first(node, "sysClr");
  let color = rgb
    ? "#" + val(rgb)
    : scheme
      ? colors[val(scheme)]
      : system
        ? "#" + system.getAttribute("lastClr")
        : undefined;
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return fallback;
  const source = rgb ?? scheme ?? system;
  let channels = [1, 3, 5].map((i) => parseInt(color!.slice(i, i + 2), 16));
  for (const modifier of Array.from(source?.children ?? [])) {
    const amount = num(modifier) / 100000;
    if (modifier.localName === "tint" || modifier.localName === "lumOff")
      channels = channels.map((v) =>
        modifier.localName === "tint"
          ? v + (255 - v) * amount
          : v + 255 * amount,
      );
    if (modifier.localName === "shade" || modifier.localName === "lumMod")
      channels = channels.map((v) => v * amount);
  }
  return (
    "#" +
    channels
      .map((v) =>
        Math.round(Math.max(0, Math.min(255, v)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
function text(node: Element | undefined): string {
  const runs = all(node, "t");
  return (
    runs.length
      ? runs.map((n) => n.textContent ?? "").join("")
      : (first(node, "v")?.textContent ?? "")
  ).slice(0, 10000);
}
function points(node: Element | undefined): (string | null)[] {
  const cache =
    first(node, "numCache") ??
    first(node, "numLit") ??
    first(node, "strCache") ??
    first(node, "strLit") ??
    first(node, "lvl");
  if (!cache) return [];
  const entries = all(cache, "pt");
  const count = Math.max(
    num(child(cache, "ptCount")),
    ...entries.map((n) => Number(n.getAttribute("idx")) + 1),
    0,
  );
  if (!Number.isInteger(count) || count > 10000)
    throw Error("차트 데이터는 계열당 10,000개까지 표시합니다.");
  const result = Array<string | null>(count).fill(null);
  for (const entry of entries) {
    const index = Number(entry.getAttribute("idx"));
    if (Number.isInteger(index) && index >= 0 && index < count)
      result[index] = child(entry, "v")?.textContent ?? null;
  }
  return result;
}
const numbers = (node: Element | undefined) =>
  points(node).map((v) =>
    v === null || v.trim() === "" || !Number.isFinite(Number(v))
      ? null
      : Number(v),
  );
export function readChartModel(data: ChartData): ChartModel {
  const root = chartXml(
    chartPartText(data.parts.find((p) => p.path === data.root)!.data),
  ).documentElement;
  const chart = child(root, "chart"),
    plotArea = child(chart, "plotArea");
  const axis = (node: Element | undefined): ChartAxis => {
    const scale = child(node, "scaling"),
      tx = child(node, "txPr"),
      props = first(tx, "defRPr");
    return {
      title: text(child(node, "title")),
      ...(child(scale, "min") ? { min: num(child(scale, "min")) } : {}),
      ...(child(scale, "max") ? { max: num(child(scale, "max")) } : {}),
      ...(num(child(node, "majorUnit")) > 0
        ? { unit: num(child(node, "majorUnit")) }
        : {}),
      ...(num(child(scale, "logBase")) >= 2
        ? { log: num(child(scale, "logBase")) }
        : {}),
      reverse: val(child(scale, "orientation")) === "maxMin",
      hidden: val(child(node, "delete")) === "1",
      color: chartColor(child(props, "solidFill"), data.colors, "#596573"),
      fontSize: Number(props?.getAttribute("sz") ?? 1200) / 75,
      format: child(node, "numFmt")?.getAttribute("formatCode") ?? "General",
      ...(child(node, "majorGridlines")
        ? {
            gridColor: chartColor(
              first(child(node, "majorGridlines"), "solidFill"),
              data.colors,
              "#D7DCE2",
            ),
          }
        : {}),
    };
  };
  const axes = Array.from(plotArea?.children ?? []).filter((n) =>
    /^(cat|val|date)Ax$/.test(n.localName),
  );
  const x =
    axes.find((n) => ["b", "t"].includes(val(child(n, "axPos")))) ?? axes[0];
  const y =
    axes.find((n) => ["l", "r"].includes(val(child(n, "axPos")))) ?? axes[1];
  let seriesIndex = 0,
    pointCount = 0;
  const plots: ChartPlot[] = Array.from(plotArea?.children ?? [])
    .filter((n) => n.localName.endsWith("Chart"))
    .map((plot) => {
      const kind: ChartKind =
        (
          {
            lineChart: "line",
            line3DChart: "line",
            barChart: "bar",
            bar3DChart: "bar",
            areaChart: "area",
            area3DChart: "area",
            pieChart: "pie",
            pie3DChart: "pie",
            doughnutChart: "doughnut",
            scatterChart: "scatter",
            radarChart: "radar",
          } as Record<string, ChartKind>
        )[plot.localName] ?? "unsupported";
      const series = Array.from(plot.children)
        .filter((n) => n.localName === "ser")
        .map((ser) => {
          if (++seriesIndex > 64)
            throw Error("차트는 64개 계열까지 표시합니다.");
          const values = numbers(child(ser, "val") ?? child(ser, "yVal"));
          pointCount += values.length;
          if (pointCount > 100000)
            throw Error("차트 데이터는 합계 100,000개까지 표시합니다.");
          const labels = points(child(ser, "cat")).map((v) => v ?? "");
          const props = child(ser, "spPr"),
            line = child(props, "ln");
          const color = chartColor(
            kind === "line" || kind === "scatter"
              ? (child(line, "solidFill") ?? child(props, "solidFill"))
              : (child(props, "solidFill") ?? child(line, "solidFill")),
            data.colors,
            data.colors[`accent${((seriesIndex - 1) % 6) + 1}`] ??
              PALETTE[(seriesIndex - 1) % 6],
          );
          const pointColors: Record<number, string> = {};
          for (const point of Array.from(ser.children).filter(
            (n) => n.localName === "dPt",
          ))
            pointColors[num(child(point, "idx"))] = chartColor(
              child(child(point, "spPr"), "solidFill"),
              data.colors,
              color,
            );
          return {
            name: text(child(ser, "tx")) || `계열 ${seriesIndex}`,
            values,
            labels,
            color,
            ...(kind === "scatter"
              ? { xValues: numbers(child(ser, "xVal")) }
              : {}),
            width:
              kind === "scatter" &&
              val(child(plot, "scatterStyle")) === "marker"
                ? 0
                : Math.max(
                    0.5,
                    (Number(line?.getAttribute("w") ?? 23812) || 23812) / 9525,
                  ),
            dash: ["dash", "sysDash", "lgDash"].includes(
              val(child(line, "prstDash")),
            )
              ? "8 5"
              : val(child(line, "prstDash")) === "dot"
                ? "2 4"
                : undefined,
            marker:
              kind === "scatter" ||
              !["none", ""].includes(
                val(first(child(ser, "marker"), "symbol")),
              ),
            markerSize: num(first(child(ser, "marker"), "size"), 5),
            pointColors,
          };
        });
      return {
        kind,
        horizontal: val(child(plot, "barDir")) === "bar",
        grouping: val(child(plot, "grouping"), "standard"),
        series,
        hole: num(child(plot, "holeSize"), 50),
        firstAngle: num(child(plot, "firstSliceAng")),
      };
    });
  const tx = child(root, "txPr"),
    font = first(tx, "latin")?.getAttribute("typeface");
  return {
    title: text(child(chart, "title")),
    plots,
    xAxis: axis(x),
    yAxis: axis(y),
    legend: child(chart, "legend")
      ? val(child(child(chart, "legend"), "legendPos"), "b")
      : undefined,
    fontFamily: font && !font.startsWith("+") ? font : data.fontFamily,
    fontSize: Number(first(tx, "defRPr")?.getAttribute("sz") ?? 1200) / 75,
    textColor: chartColor(first(tx, "solidFill"), data.colors, "#263445"),
    background: chartColor(
      child(child(root, "spPr"), "solidFill"),
      data.colors,
      "transparent",
    ),
    plotFill: chartColor(
      child(child(plotArea, "spPr"), "solidFill"),
      data.colors,
      "transparent",
    ),
    approximate:
      plots.some((p) => ["unsupported", "radar"].includes(p.kind)) ||
      all(plotArea, "valAx").length >
        (plots.every((p) => p.kind === "scatter") ? 2 : 1) ||
      Array.from(plotArea?.children ?? []).some((p) =>
        p.localName.includes("3D"),
      ),
  };
}
