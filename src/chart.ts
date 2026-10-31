import type { ChartData } from "./types";
import { canPreviewRadar } from "./chart-radar";
import { record, stringValue, colorValue } from "./validation";
import { applyDrawingmlColorTransforms } from "./drawingml-color";
import {
  readChartImageFill,
  unsupportedDrawingmlImageEffects,
  type ChartImageFill,
} from "./chart-image";

export const CHART_NS =
  "http://schemas.openxmlformats.org/drawingml/2006/chart";
export const DRAWING_NS =
  "http://schemas.openxmlformats.org/drawingml/2006/main";
export const MAX_CHART_BYTES = 16 * 1024 * 1024;
export const MAX_CHART_LABELS = 1000;
export const MAX_CHART_LABEL_TEXT = 512;
const MAX_NUMBER_FORMAT_LENGTH = 512;
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
  gridWidth?: number;
  fontFamily: string;
  labelSkip?: number;
  labelPosition: string;
  lineColor: string;
  lineWidth: number;
  crosses: string;
  crossValue?: number;
}
export interface ChartDataLabel {
  deleted: boolean;
  value: boolean;
  category: boolean;
  series: boolean;
  percent: boolean;
  position: string;
  format: string;
  sourceLinked: boolean;
  separator: string;
  color: string;
  fontSize: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  text?: string;
}
export const CHART_MARKER_SYMBOLS = [
  "circle",
  "dash",
  "diamond",
  "dot",
  "plus",
  "square",
  "star",
  "triangle",
  "x",
] as const;
export type ChartMarkerSymbol = (typeof CHART_MARKER_SYMBOLS)[number];
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
  markerSymbol: ChartMarkerSymbol;
  pointColors: Record<number, string>;
  numberFormat: string;
  pointFormats: Record<number, string>;
  dataLabel: ChartDataLabel;
  pointLabels: Record<number, ChartDataLabel>;
  border?: { color: string; width: number };
  radarFill?: { color: string; opacity: number };
  radarLine?: { color: string; opacity: number; width: number };
}
export interface ChartPlot {
  kind: ChartKind;
  horizontal: boolean;
  grouping: string;
  series: ChartSeries[];
  hole: number;
  firstAngle: number;
  gapWidth: number;
  radarStyle?: string;
}
export interface ChartAnnotation {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  bold: boolean;
  italic: boolean;
  align: string;
}
export interface ChartModel {
  title: string;
  plots: ChartPlot[];
  xAxis: ChartAxis;
  yAxis: ChartAxis;
  legend?: string;
  legendFontSize: number;
  legendFontFamily: string;
  legendTextColor: string;
  fontFamily: string;
  fontSize: number;
  textColor: string;
  background: string;
  plotFill: string;
  backgroundImage?: ChartImageFill;
  plotImage?: ChartImageFill;
  approximate: boolean;
  blankMode: "gap" | "span" | "zero";
  plotLineColor: string;
  plotLineWidth: number;
  annotations: ChartAnnotation[];
}
const PALETTE = [
  "#4472C4",
  "#ED7D31",
  "#A5A5A5",
  "#FFC000",
  "#5B9BD5",
  "#70AD47",
];
function chartColorValue(
  node: Element | undefined,
  colors: Record<string, string>,
): { color: string; opacity: number } | undefined {
  if (!node || child(node, "noFill")) return;
  const rgb = node.localName === "srgbClr" ? node : first(node, "srgbClr"),
    scheme = node.localName === "schemeClr" ? node : first(node, "schemeClr"),
    system = node.localName === "sysClr" ? node : first(node, "sysClr");
  const color = rgb
    ? "#" + val(rgb)
    : scheme
      ? colors[val(scheme)]
      : system
        ? "#" + system.getAttribute("lastClr")
        : undefined;
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return;
  return applyDrawingmlColorTransforms(
    color,
    Array.from((rgb ?? scheme ?? system)?.children ?? []),
  );
}
export function chartColor(
  node: Element | undefined,
  colors: Record<string, string>,
  fallback: string,
): string {
  return chartColorValue(node, colors)?.color ?? fallback;
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
const generalNumberFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 10,
  useGrouping: false,
});
const numberFormats = new Map<string, Intl.NumberFormat>();
function numberFormat(
  integer: number,
  minimum: number,
  maximum: number,
  grouping: boolean,
) {
  const key = `${integer}/${minimum}/${maximum}/${grouping}`;
  let formatter = numberFormats.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      minimumIntegerDigits: integer,
      minimumFractionDigits: minimum,
      maximumFractionDigits: maximum,
      useGrouping: grouping,
    });
    if (numberFormats.size >= 64)
      numberFormats.delete(numberFormats.keys().next().value!);
    numberFormats.set(key, formatter);
  }
  return formatter;
}

/** Common OOXML/Excel number formats used by chart axes and data labels.
 * Quoted/escaped text is kept separate from numeric placeholders so a literal
 * percent, semicolon or comma cannot accidentally alter the number's value.
 */
export function formatChartNumber(value: number, code = "General"): string {
  if (!Number.isFinite(value)) return "";
  const general = () =>
    Math.abs(value) >= 1e11 || (Math.abs(value) > 0 && Math.abs(value) < 1e-6)
      ? value.toExponential(5).replace(/\.?0+e/, "e")
      : generalNumberFormat.format(value);
  if (code.length > MAX_NUMBER_FORMAT_LENGTH) return general();
  const sections: string[] = [""];
  let quoted = false,
    conditional = false;
  for (let index = 0; index < code.length; index++) {
    const c = code[index];
    if (c === "\\") {
      sections[sections.length - 1] += c + (code[++index] ?? "");
      continue;
    }
    if (c === '"') quoted = !quoted;
    if (!quoted && c === "[" && /[<>=]/.test(code[index + 1] ?? ""))
      conditional = true;
    if (c === ";" && !quoted) sections.push("");
    else sections[sections.length - 1] += c;
  }
  // Conditional and date formats need a spreadsheet evaluator. Display the
  // original numeric value rather than selecting a misleading sign section.
  if (conditional) return general();
  const explicitNegative = value < 0 && sections.length > 1;
  const section =
    value < 0 && sections.length > 1
      ? sections[1]
      : value === 0 && sections.length > 2
        ? sections[2]
        : sections[0];
  if (!section.trim()) return "";
  if (/^General$/i.test(section.trim())) return general();
  type Token = { text: string; numeric: boolean };
  const tokens: Token[] = [];
  for (let index = 0; index < section.length; index++) {
    const c = section[index];
    if (c === '"') {
      let literal = "";
      while (++index < section.length && section[index] !== '"')
        literal += section[index];
      tokens.push({ text: literal, numeric: false });
    } else if (c === "\\")
      tokens.push({ text: section[++index] ?? "", numeric: false });
    else if (c === "_" || c === "*") index++;
    else if (c === "[") {
      const end = section.indexOf("]", index + 1);
      if (end < 0) return general();
      const bracket = section.slice(index + 1, end);
      // Locale-qualified currencies, e.g. [$€-407]. Color directives affect
      // styling and are not emitted as label text.
      if (bracket.startsWith("$"))
        tokens.push({ text: bracket.slice(1).split("-")[0], numeric: false });
      index = end;
    } else if (/[a-df-z]/i.test(c)) return general();
    else tokens.push({ text: c, numeric: /[0#?.,%Ee+\-]/.test(c) });
  }
  const firstNumber = tokens.findIndex(
    (t) => t.numeric && /[0#?]/.test(t.text),
  );
  let lastNumber = -1;
  tokens.forEach((t, i) => {
    if (t.numeric && /[0#?]/.test(t.text)) lastNumber = i;
  });
  const literal = (items: Token[]) =>
    items
      .filter((t) => !t.numeric || !/[#?]/.test(t.text))
      .map((t) => t.text)
      .join("");
  if (firstNumber < 0) return literal(tokens).trim();
  const numberTokens = tokens.slice(firstNumber, lastNumber + 1);
  if (numberTokens.some((t) => !t.numeric)) return general();
  const pattern = numberTokens.map((t) => t.text).join("");
  if (value === 0 && !pattern.includes("0")) return literal(tokens).trim();
  if (!/^[0#?,]+(?:\.[0#?]+)?(?:[Ee][+\-]?[0#?]+)?$/.test(pattern))
    return general();
  const exponent = pattern.match(/[Ee]([+\-]?)([0#?]+)$/);
  const mantissa = pattern.replace(/[Ee].*$/, "");
  const fraction = mantissa.split(".")[1] ?? "";
  const minFraction = Math.min(20, (fraction.match(/0/g) ?? []).length);
  const maxFraction = Math.min(20, fraction.length);
  const percents = tokens.filter((t) => t.numeric && t.text === "%").length;
  let scalingCommas = 0;
  for (
    let i = lastNumber + 1;
    tokens[i]?.numeric && tokens[i].text === ",";
    i++
  )
    scalingCommas++;
  const scaled = (Math.abs(value) * 100 ** percents) / 1000 ** scalingCommas;
  if (!Number.isFinite(scaled)) return general();
  let shown: string;
  if (exponent) {
    const [base, rawExponent] = scaled.toExponential(maxFraction).split("e");
    const exp = Number(rawExponent);
    shown =
      base +
      "E" +
      (exp < 0 ? "-" : exponent[1] === "+" ? "+" : "") +
      String(Math.abs(exp)).padStart(exponent[2].length, "0");
  } else
    shown = numberFormat(
      Math.max(
        1,
        Math.min(21, (mantissa.split(".")[0].match(/0/g) ?? []).length),
      ),
      minFraction,
      maxFraction,
      mantissa.split(".")[0].includes(","),
    ).format(scaled);
  const prefix = literal(tokens.slice(0, firstNumber));
  const suffix = literal(tokens.slice(lastNumber + 1 + scalingCommas));
  return (
    (value < 0 && !explicitNegative ? "-" : "") +
    prefix +
    shown +
    suffix
  ).trim();
}

export const CHART_COLOR_MAPPING: Record<string, string> = {
  bg1: "lt1",
  tx1: "dk1",
  bg2: "lt2",
  tx2: "dk2",
  accent1: "accent1",
  accent2: "accent2",
  accent3: "accent3",
  accent4: "accent4",
  accent5: "accent5",
  accent6: "accent6",
  hlink: "hlink",
  folHlink: "folHlink",
};
const DEFAULT_SCHEME: Record<string, string> = {
  dk1: "#000000",
  lt1: "#FFFFFF",
  dk2: "#44546A",
  lt2: "#E7E6E6",
  ...Object.fromEntries(
    PALETTE.map((color, index) => [`accent${index + 1}`, color]),
  ),
  hlink: "#0563C1",
  folHlink: "#954F72",
};
export function readChartTheme(data: ChartData, root?: Element) {
  const rootPart = data.parts.find((part) => part.path === data.root)!;
  root ??= chartXml(chartPartText(rootPart.data)).documentElement;
  const colors = { ...DEFAULT_SCHEME, ...data.colors },
    mapping = { ...CHART_COLOR_MAPPING };
  // A chart can inherit a slide's color mapping without carrying a map itself.
  // Capture that active mapping before applying a chart-local theme override.
  const ownMapping = child(root, "clrMapOvr");
  for (const [alias, fallback] of Object.entries(mapping)) {
    const explicit = ownMapping?.getAttribute(alias);
    mapping[alias] =
      explicit && Object.hasOwn(DEFAULT_SCHEME, explicit)
        ? explicit
        : data.colors[alias] && data.colors[alias] !== data.colors[fallback]
          ? (Object.keys(DEFAULT_SCHEME).find(
              (key) => data.colors[key] === data.colors[alias],
            ) ?? fallback)
          : fallback;
  }
  const overridePath = rootPart.relationships.find(
      (rel) => rel.type.endsWith("/themeOverride") && !rel.external,
    )?.target,
    overridePart = data.parts.find((part) => part.path === overridePath),
    override = overridePart
      ? chartXml(chartPartText(overridePart.data)).documentElement
      : undefined;
  for (const entry of Array.from(
    child(override, "clrScheme")?.children ?? [],
  )) {
    if (!Object.hasOwn(DEFAULT_SCHEME, entry.localName)) continue;
    colors[entry.localName] = chartColor(
      entry,
      colors,
      colors[entry.localName],
    );
  }
  for (const [alias, name] of Object.entries(mapping))
    colors[alias] = colors[name];
  const fonts = child(override, "fontScheme");
  return {
    colors,
    mapping,
    majorFont: (
      first(child(fonts, "majorFont"), "latin")?.getAttribute("typeface") ||
      data.fontFamily
    ).slice(0, 200),
    minorFont: (
      first(child(fonts, "minorFont"), "latin")?.getAttribute("typeface") ||
      data.fontFamily
    ).slice(0, 200),
  };
}

export function readChartModel(data: ChartData): ChartModel {
  const root = chartXml(
    chartPartText(data.parts.find((p) => p.path === data.root)!.data),
  ).documentElement;
  const theme = readChartTheme(data, root),
    colors = theme.colors;
  const chart = child(root, "chart"),
    plotArea = child(chart, "plotArea");
  const textSize = (raw: string | null | undefined, fallback: number) => {
    const size =
      raw === undefined || raw === null ? fallback : Number(raw) / 75;
    return Number.isFinite(size) ? Math.min(400, Math.max(1, size)) : fallback;
  };
  const tx = child(root, "txPr"),
    defaultText = first(tx, "defRPr"),
    rootFont = first(tx, "latin")?.getAttribute("typeface"),
    fontFamily =
      rootFont && !rootFont.startsWith("+")
        ? rootFont.slice(0, 200)
        : rootFont?.startsWith("+mn")
          ? theme.minorFont
          : theme.majorFont,
    fontSize = textSize(defaultText?.getAttribute("sz"), 16),
    textColor = chartColor(child(defaultText, "solidFill"), colors, "#263445");
  const family = (node: Element | undefined, fallback = fontFamily) => {
    const face = first(node, "latin")?.getAttribute("typeface");
    return face?.startsWith("+mj")
      ? theme.majorFont
      : face?.startsWith("+mn")
        ? theme.minorFont
        : face && !face.startsWith("+")
          ? face.slice(0, 200)
          : fallback;
  };
  const flag = (node: Element | undefined, name: string, fallback: boolean) => {
    const setting = child(node, name);
    return setting ? !["0", "false"].includes(val(setting, "1")) : fallback;
  };
  const length = (raw: string | null | undefined, fallback: number) => {
    const value = raw == null ? fallback : Number(raw) / 9525;
    return Number.isFinite(value)
      ? Math.max(0, Math.min(400, value))
      : fallback;
  };
  const lineStyle = (
    node: Element | undefined,
    fallback: string,
    width = 1,
  ) => ({
    lineColor: child(node, "noFill")
      ? "transparent"
      : chartColor(child(node, "solidFill"), colors, fallback),
    lineWidth: length(node?.getAttribute("w"), width),
  });
  const label = (
    node: Element | undefined,
    inherited?: ChartDataLabel,
    sourceFormat = "General",
  ): ChartDataLabel => {
    const props =
        first(child(node, "txPr"), "defRPr") ??
        first(child(node, "txPr"), "rPr"),
      format = child(node, "numFmt"),
      explicitText = child(node, "tx");
    return {
      deleted: flag(node, "delete", inherited?.deleted ?? false),
      value: flag(node, "showVal", inherited?.value ?? false),
      category: flag(node, "showCatName", inherited?.category ?? false),
      series: flag(node, "showSerName", inherited?.series ?? false),
      percent: flag(node, "showPercent", inherited?.percent ?? false),
      position: val(child(node, "dLblPos"), inherited?.position ?? ""),
      format: format
        ? format.getAttribute("sourceLinked") === "1"
          ? sourceFormat
          : (format.getAttribute("formatCode") ?? sourceFormat)
        : (inherited?.format ?? sourceFormat),
      sourceLinked: format
        ? format.getAttribute("sourceLinked") === "1"
        : (inherited?.sourceLinked ?? true),
      separator: (
        child(node, "separator")?.textContent ??
        inherited?.separator ??
        ", "
      ).slice(0, MAX_CHART_LABEL_TEXT),
      color: chartColor(
        child(props, "solidFill"),
        colors,
        inherited?.color ?? textColor,
      ),
      fontSize: textSize(
        props?.getAttribute("sz"),
        inherited?.fontSize ?? fontSize,
      ),
      fontFamily: family(props, inherited?.fontFamily ?? fontFamily),
      bold: props?.hasAttribute("b")
        ? props.getAttribute("b") === "1"
        : (inherited?.bold ?? false),
      italic: props?.hasAttribute("i")
        ? props.getAttribute("i") === "1"
        : (inherited?.italic ?? false),
      ...(explicitText
        ? { text: text(explicitText) }
        : inherited?.text !== undefined
          ? { text: inherited.text }
          : {}),
    };
  };
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
      color: chartColor(child(props, "solidFill"), colors, textColor),
      fontSize: textSize(props?.getAttribute("sz"), 16),
      fontFamily: family(props),
      format: child(node, "numFmt")?.getAttribute("formatCode") ?? "General",
      ...(num(child(node, "tickLblSkip")) > 0
        ? { labelSkip: Math.max(1, num(child(node, "tickLblSkip"))) }
        : {}),
      labelPosition: val(child(node, "tickLblPos"), "nextTo"),
      ...lineStyle(child(child(node, "spPr"), "ln"), "#8C9399"),
      crosses: val(child(node, "crosses"), "autoZero"),
      ...(child(node, "crossesAt")
        ? { crossValue: num(child(node, "crossesAt")) }
        : {}),
      ...(child(node, "majorGridlines")
        ? {
            gridColor: chartColor(
              first(child(node, "majorGridlines"), "solidFill"),
              colors,
              "#D7DCE2",
            ),
            gridWidth: length(
              child(
                child(child(node, "majorGridlines"), "spPr"),
                "ln",
              )?.getAttribute("w"),
              0.8,
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
          const xNode = child(ser, "xVal"),
            stringX =
              kind === "scatter" &&
              !!(first(xNode, "strCache") ?? first(xNode, "strLit"));
          const labels = points(
            child(ser, "cat") ?? (stringX ? xNode : undefined),
          ).map((v) => v ?? "");
          const props = child(ser, "spPr"),
            line = child(props, "ln");
          // idx identifies a series across reordering; order is only its draw
          // order. Office uses idx for the default accent color.
          const sourceIndex = Math.max(
            0,
            Math.floor(num(child(ser, "idx"), seriesIndex - 1)),
          );
          const color = chartColor(
            kind === "line" ||
              kind === "scatter" ||
              (kind === "radar" &&
                val(child(plot, "radarStyle"), "standard") !== "filled")
              ? (child(line, "solidFill") ?? child(props, "solidFill"))
              : (child(props, "solidFill") ?? child(line, "solidFill")),
            colors,
            colors[`accent${(sourceIndex % 6) + 1}`] ??
              PALETTE[sourceIndex % 6],
          );
          const pointColors: Record<number, string> = {};
          for (const point of Array.from(ser.children).filter(
            (n) => n.localName === "dPt",
          ))
            pointColors[num(child(point, "idx"))] = chartColor(
              child(child(point, "spPr"), "solidFill"),
              colors,
              color,
            );
          const cache =
              first(child(ser, "val") ?? child(ser, "yVal"), "numCache") ??
              first(child(ser, "val") ?? child(ser, "yVal"), "numLit"),
            numberFormat = child(cache, "formatCode")?.textContent ?? "General",
            pointFormats: Record<number, string> = {};
          for (const point of all(cache, "pt"))
            if (point.hasAttribute("formatCode"))
              pointFormats[Number(point.getAttribute("idx"))] =
                point.getAttribute("formatCode")!;
          const plotLabelNode = child(plot, "dLbls"),
            seriesLabelNode = child(ser, "dLbls"),
            dataLabel = label(
              seriesLabelNode,
              label(plotLabelNode, undefined, numberFormat),
              numberFormat,
            ),
            pointLabels: Record<number, ChartDataLabel> = {};
          for (const parent of [plotLabelNode, seriesLabelNode])
            for (const point of Array.from(parent?.children ?? []).filter(
              (n) => n.localName === "dLbl",
            )) {
              const index = num(child(point, "idx"), -1);
              if (
                Number.isInteger(index) &&
                index >= 0 &&
                index < values.length
              )
                pointLabels[index] = label(
                  point,
                  pointLabels[index] ?? dataLabel,
                  pointFormats[index] ?? numberFormat,
                );
            }
          return {
            name: text(child(ser, "tx")) || `계열 ${seriesIndex}`,
            values,
            labels,
            color,
            ...(kind === "scatter"
              ? {
                  xValues: stringX
                    ? points(xNode).map((value, index) =>
                        value === null ? null : index + 1,
                      )
                    : numbers(xNode),
                }
              : {}),
            width:
              child(line, "noFill") ||
              (kind === "scatter" &&
                val(child(plot, "scatterStyle")) === "marker")
                ? 0
                : Math.max(
                    kind === "radar" ? 0 : 0.5,
                    length(line?.getAttribute("w"), 2.5),
                  ),
            dash: ["dash", "sysDash", "lgDash"].includes(
              val(child(line, "prstDash")),
            )
              ? "8 5"
              : val(child(line, "prstDash")) === "dot"
                ? "2 4"
                : undefined,
            marker:
              val(first(child(ser, "marker"), "symbol")) !== "none" &&
              (kind === "scatter"
                ? !["line", "smooth", "none"].includes(
                    val(child(plot, "scatterStyle")),
                  )
                : !!val(first(child(ser, "marker"), "symbol")) ||
                  (kind === "radar" &&
                    val(child(plot, "radarStyle"), "standard") === "marker") ||
                  flag(plot, "marker", false)),
            markerSymbol: CHART_MARKER_SYMBOLS.includes(
              val(first(child(ser, "marker"), "symbol")) as ChartMarkerSymbol,
            )
              ? (val(
                  first(child(ser, "marker"), "symbol"),
                ) as ChartMarkerSymbol)
              : "circle",
            // OOXML marker size is an integer diameter in points (2..72).
            markerSize: Math.max(
              2,
              Math.min(72, num(first(child(ser, "marker"), "size"), 5)),
            ),
            ...(kind === "radar"
              ? {
                  radarFill: child(props, "noFill")
                    ? { color, opacity: 0 }
                    : (chartColorValue(child(props, "solidFill"), colors) ?? {
                        color,
                        opacity: 1,
                      }),
                  radarLine: {
                    ...(chartColorValue(child(line, "solidFill"), colors) ?? {
                      color,
                      opacity: 1,
                    }),
                    width: child(line, "noFill")
                      ? 0
                      : Math.max(0, length(line?.getAttribute("w"), 2.5)),
                  },
                }
              : {}),
            pointColors,
            numberFormat,
            pointFormats,
            dataLabel,
            pointLabels,
            ...(line
              ? {
                  border: {
                    color: child(line, "noFill")
                      ? "transparent"
                      : chartColor(child(line, "solidFill"), colors, color),
                    width: length(line.getAttribute("w"), 1),
                  },
                }
              : {}),
          };
        });
      return {
        kind,
        horizontal: val(child(plot, "barDir")) === "bar",
        grouping: val(child(plot, "grouping"), "standard"),
        series,
        hole: num(child(plot, "holeSize"), 50),
        firstAngle: num(child(plot, "firstSliceAng")) % 360,
        gapWidth: Math.max(0, Math.min(500, num(child(plot, "gapWidth"), 150))),
        ...(kind === "radar"
          ? { radarStyle: val(child(plot, "radarStyle"), "standard") }
          : {}),
      };
    });
  const annotations: ChartAnnotation[] = [];
  const userShapes = child(root, "userShapes") ?? child(chart, "userShapes"),
    relationshipId = userShapes?.getAttributeNS(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "id",
    ),
    rootPart = data.parts.find((p) => p.path === data.root),
    drawingPath = rootPart?.relationships.find(
      (r) => r.id === relationshipId && !r.external,
    )?.target,
    drawing = data.parts.find((p) => p.path === drawingPath);
  if (drawing) {
    const document = chartXml(chartPartText(drawing.data));
    for (const anchor of all(document, "relSizeAnchor")) {
      if (annotations.length >= 200) break;
      const shape = child(anchor, "sp"),
        body = child(shape, "txBody"),
        content = text(body),
        from = child(anchor, "from"),
        to = child(anchor, "to"),
        x = Number(child(from, "x")?.textContent),
        y = Number(child(from, "y")?.textContent),
        right = Number(child(to, "x")?.textContent),
        bottom = Number(child(to, "y")?.textContent),
        props = first(body, "rPr") ?? first(body, "defRPr");
      if (
        !content.trim() ||
        ![x, y, right, bottom].every(
          (value) => Number.isFinite(value) && Math.abs(value) <= 10,
        ) ||
        right < x ||
        bottom < y
      )
        continue;
      annotations.push({
        x,
        y,
        width: right - x,
        height: bottom - y,
        text: content,
        fontSize: textSize(props?.getAttribute("sz"), 1100 / 75),
        fontFamily: family(props),
        color: chartColor(child(props, "solidFill"), colors, textColor),
        bold: props?.getAttribute("b") === "1",
        italic: props?.getAttribute("i") === "1",
        align: first(body, "pPr")?.getAttribute("algn") ?? "l",
      });
    }
  }
  const legendProps = first(child(child(chart, "legend"), "txPr"), "defRPr");
  const imageNodes = [
    child(child(root, "spPr"), "blipFill"),
    child(child(plotArea, "spPr"), "blipFill"),
  ];
  const imageFills = imageNodes.map((node) =>
    readChartImageFill(node, data, (node) => chartColorValue(node, colors)),
  );
  const approximateImages = imageNodes.some(
    (node, index) =>
      unsupportedDrawingmlImageEffects(node) ||
      (!!child(child(node, "blip"), "duotone") && !imageFills[index]?.duotone),
  );
  const xAxis = axis(x),
    yAxis = axis(y);
  const rawBlankMode = val(child(chart, "dispBlanksAs"), "gap");
  const blankMode =
    rawBlankMode === "span" || rawBlankMode === "zero" ? rawBlankMode : "gap";
  return {
    blankMode,
    title:
      text(child(chart, "title")) ||
      (child(chart, "title") &&
      !flag(chart, "autoTitleDeleted", false) &&
      plots.flatMap((plot) => plot.series).length === 1
        ? (plots[0]?.series[0]?.name ?? "")
        : ""),
    plots,
    xAxis,
    yAxis,
    legend: child(chart, "legend")
      ? val(child(child(chart, "legend"), "legendPos"), "b")
      : undefined,
    legendFontSize: textSize(legendProps?.getAttribute("sz"), fontSize),
    legendFontFamily: family(legendProps),
    legendTextColor: chartColor(
      child(legendProps, "solidFill"),
      colors,
      textColor,
    ),
    fontFamily,
    fontSize,
    textColor,
    background: chartColor(
      child(child(root, "spPr"), "solidFill"),
      colors,
      "transparent",
    ),
    plotFill: chartColor(
      child(child(plotArea, "spPr"), "solidFill"),
      colors,
      "transparent",
    ),
    backgroundImage: imageFills[0],
    plotImage: imageFills[1],
    ...(() => {
      const style = lineStyle(
        child(child(plotArea, "spPr"), "ln"),
        "transparent",
      );
      return { plotLineColor: style.lineColor, plotLineWidth: style.lineWidth };
    })(),
    annotations,
    approximate:
      approximateImages ||
      all(plotArea, "symbol").some(
        (node) =>
          val(node) !== "auto" &&
          val(node) !== "none" &&
          !CHART_MARKER_SYMBOLS.includes(val(node) as ChartMarkerSymbol),
      ) ||
      plots.some((p) => p.kind === "unsupported") ||
      (plots.some((p) => p.kind === "radar") &&
        !canPreviewRadar(plots, xAxis, yAxis, blankMode)) ||
      all(plotArea, "valAx").length >
        (plots.every((p) => p.kind === "scatter") ? 2 : 1) ||
      Array.from(plotArea?.children ?? []).some((p) =>
        p.localName.includes("3D"),
      ),
  };
}

type PreviewEntry = {
  root: string;
  fontFamily: string;
  colors: [string, string][];
  parts: { path: string; data: string }[];
  relationships: ChartData["parts"][number]["relationships"];
  model: ChartModel;
};
const previewModels = new WeakMap<ChartData, PreviewEntry>();
function freezePreview(value: object): void {
  for (const item of Object.values(value))
    if (item && typeof item === "object") freezePreview(item);
  Object.freeze(value);
}

/** Share immutable parsed artwork between thumbnail/editor/presenter views.
 * Weak keys release it with its source chart. Snapshot comparisons deliberately
 * also invalidate in-place source/theme mutations, rather than assuming every
 * importer and clipboard caller will always allocate a new ChartData object.
 */
export function readChartPreview(data: ChartData): ChartModel {
  const previous = previewModels.get(data),
    relationships =
      data.parts.find((part) => part.path === data.root)?.relationships ?? [];
  if (
    previous &&
    previous.root === data.root &&
    previous.fontFamily === data.fontFamily &&
    previous.colors.length === Object.keys(data.colors).length &&
    previous.colors.every(([key, value]) => data.colors[key] === value) &&
    previous.parts.length === data.parts.length &&
    previous.parts.every(
      (part, index) =>
        part.path === data.parts[index].path &&
        part.data === data.parts[index].data,
    ) &&
    previous.relationships.length === relationships.length &&
    previous.relationships.every(
      (rel, index) =>
        rel.id === relationships[index].id &&
        rel.type === relationships[index].type &&
        rel.target === relationships[index].target &&
        rel.external === relationships[index].external,
    )
  )
    return previous.model;
  const model = readChartModel(data);
  freezePreview(model);
  previewModels.set(data, {
    root: data.root,
    fontFamily: data.fontFamily,
    colors: Object.entries(data.colors),
    parts: data.parts.map(({ path, data }) => ({ path, data })),
    relationships: relationships.map((relationship) => ({ ...relationship })),
    model,
  });
  return model;
}
