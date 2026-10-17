import { element } from "./model";
import type { SlideElement } from "./types";

export type InsertContentKind =
  | "chart"
  | "diagram"
  | "icons"
  | "wordart"
  | "equation"
  | "symbol";
export type ChartKind = "column" | "bar" | "line" | "pie";
export type DiagramKind = "process" | "cycle" | "organization" | "pyramid";
export interface InsertCanvas {
  width: number;
  height: number;
  color: string;
  textColor?: string;
}
export interface ChartDatum {
  label: string;
  value: number;
}

const ink = (canvas: InsertCanvas) => canvas.textColor || "#243247";
const numberLabel = (value: number) =>
  value !== 0 && (Math.abs(value) < 0.001 || Math.abs(value) >= 1e7)
    ? value.toExponential(2)
    : new Intl.NumberFormat("ko-KR", { maximumSignificantDigits: 6 }).format(
        value,
      );
const rounded = (value: number) => Math.round(value * 1000) / 1000;
const textUnits = (value: string) =>
  [...value].reduce(
    (n, char) => n + (/[^\u0000-\u007F]/.test(char) ? 1 : 0.58),
    0,
  );
const fittingFont = (
  value: string,
  width: number,
  height: number,
  maximum: number,
) =>
  Math.min(
    maximum,
    Math.sqrt((width * height) / Math.max(1, textUnits(value) * 1.5)),
  );
function checkColor(color: string) {
  if (!/^#[\da-f]{6}$/i.test(color))
    throw Error("색상은 6자리 HEX 값으로 입력하세요.");
  return color;
}
function text(
  value: string,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  size = 24,
  extra: Partial<SlideElement> = {},
) {
  return element("text", {
    text: value,
    x,
    y,
    width,
    height,
    color,
    fontFamily: "Arial",
    fontSize: size,
    align: "center",
    verticalAlign: "middle",
    textInsets: [0, 0, 0, 0],
    ...extra,
  });
}
function rect(
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  extra: Partial<SlideElement> = {},
) {
  return element("shape", {
    shape: "rect",
    x,
    y,
    width,
    height,
    fill,
    ...extra,
  });
}
function custom(
  d: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  stroke = "transparent",
  strokeWidth = 0,
  units = { width, height },
) {
  return rect(x, y, width, height, fill, {
    shape: "custom",
    stroke,
    strokeWidth,
    paths: [
      { d, ...units, fill: fill !== "transparent", stroke: strokeWidth > 0 },
    ],
  });
}
function connector(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  arrow = false,
) {
  const x = Math.min(x1, x2),
    y = Math.min(y1, y2);
  const width = Math.max(1, Math.abs(x2 - x1)),
    height = Math.max(1, Math.abs(y2 - y1));
  const parts = [
    `M ${rounded(x1 - x)} ${rounded(y1 - y)} L ${rounded(x2 - x)} ${rounded(y2 - y)}`,
  ];
  if (arrow) {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    for (const offset of [-0.5, 0.5])
      parts.push(
        `M ${rounded(x2 - x - 12 * Math.cos(angle + offset))} ${rounded(y2 - y - 12 * Math.sin(angle + offset))} L ${rounded(x2 - x)} ${rounded(y2 - y)}`,
      );
  }
  return custom(
    parts.join(" "),
    x,
    y,
    width,
    height,
    "transparent",
    color,
    2.5,
  );
}
function fit(elements: SlideElement[], canvas: InsertCanvas) {
  if (
    !Number.isFinite(canvas.width) ||
    !Number.isFinite(canvas.height) ||
    canvas.width <= 0 ||
    canvas.height <= 0
  )
    throw Error("슬라이드 크기를 확인하세요.");
  checkColor(canvas.color);
  const scale = Math.min(canvas.width / 1280, canvas.height / 720);
  const left = (canvas.width - 1280 * scale) / 2,
    top = (canvas.height - 720 * scale) / 2;
  return elements.map((e) => ({
    ...e,
    x: e.x * scale + left,
    y: e.y * scale + top,
    width: e.width * scale,
    height: e.height * scale,
    ...(e.fontSize === undefined ? {} : { fontSize: e.fontSize * scale }),
    ...(e.strokeWidth === undefined
      ? {}
      : { strokeWidth: e.strokeWidth * scale }),
    ...(e.cornerRadius === undefined
      ? {}
      : { cornerRadius: e.cornerRadius * scale }),
  }));
}
function tint(color: string, amount: number) {
  checkColor(color);
  return (
    "#" +
    [1, 3, 5]
      .map((start) => {
        const value = parseInt(color.slice(start, start + 2), 16);
        return Math.round(value + (amount >= 0 ? 255 - value : value) * amount)
          .toString(16)
          .padStart(2, "0");
      })
      .join("")
  );
}
function contrast(color: string) {
  const rgb = [1, 3, 5].map(
    (start) => parseInt(color.slice(start, start + 2), 16) / 255,
  );
  const light = rgb.map((v) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );
  return light[0] * 0.2126 + light[1] * 0.7152 + light[2] * 0.0722 > 0.179
    ? "#172334"
    : "#FFFFFF";
}
function categoryColor(color: string, index: number) {
  return tint(
    color,
    [0, 0.27, -0.24, 0.48, -0.42, 0.12, 0.38, -0.12, 0.58, -0.32, 0.2, 0.43][
      index % 12
    ],
  );
}

// CSV quoting is handled explicitly so a category such as "서울, 경기" stays intact.
function cells(line: string, separator: string): string[] {
  const result: string[] = [];
  let value = "",
    quoted = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (line[i] === separator && !quoted) {
      result.push(value.trim());
      value = "";
    } else value += line[i];
  }
  if (quoted) throw Error("CSV의 큰따옴표가 닫히지 않았습니다.");
  result.push(value.trim());
  return result;
}
export function parseChartData(input: string): ChartDatum[] {
  if (input.length > 10000)
    throw Error("차트 데이터는 10,000자 이내로 입력하세요.");
  const lines = input
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!lines.length) throw Error("차트에 표시할 값을 입력하세요.");
  const data: ChartDatum[] = [];
  lines.forEach((line, row) => {
    let values = line.includes("\t")
      ? cells(line, "\t")
      : line.includes(",")
        ? cells(line, ",")
        : [line];
    if (
      values.length === 1 &&
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(values[0])
    ) {
      const match = line.match(
        /^(.*?)\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)$/i,
      );
      if (match) values = [match[1], match[2]];
    }
    if (values.length > 2)
      throw Error(`${row + 1}행: 항목과 값, 두 열만 입력하세요.`);
    if (
      row === 0 &&
      values.length === 2 &&
      /^(값|value|수치|실적|매출|판매량|비율|데이터)$/i.test(values[1])
    )
      return;
    const raw = values.at(-1)!;
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw))
      throw Error(`${row + 1}행: 유효한 숫자를 입력하세요.`);
    const value = Number(raw);
    if (!Number.isFinite(value) || Math.abs(value) > 1e9)
      throw Error(`${row + 1}행: 값은 -10억부터 10억 사이여야 합니다.`);
    const label = values.length === 2 ? values[0] : `항목 ${data.length + 1}`;
    if (!label || label.length > 30)
      throw Error(`${row + 1}행: 항목 이름은 1~30자로 입력하세요.`);
    data.push({ label, value });
  });
  if (!data.length || data.length > 12)
    throw Error("차트에는 1~12개의 항목을 입력하세요.");
  return data;
}

export function createChart(
  kind: ChartKind,
  data: ChartDatum[],
  title: string,
  canvas: InsertCanvas,
): SlideElement[] {
  if (
    !data.length ||
    data.length > 12 ||
    data.some(
      (d) =>
        !d.label.trim() || !Number.isFinite(d.value) || Math.abs(d.value) > 1e9,
    )
  )
    throw Error("차트 데이터를 확인하세요.");
  const color = checkColor(canvas.color),
    labelColor = ink(canvas),
    out: SlideElement[] = [];
  if (title.trim())
    out.push(
      text(title.trim().slice(0, 80), 160, 88, 960, 54, labelColor, 34, {
        bold: true,
      }),
    );
  if (kind === "pie") {
    const total = data.reduce((sum, d) => sum + d.value, 0);
    if (data.some((d) => d.value < 0) || total <= 0)
      throw Error("원형 차트는 음수 없이, 합계가 0보다 커야 합니다.");
    const positive = data.filter((d) => d.value > 0).length;
    let angle = -Math.PI / 2;
    data.forEach((datum, i) => {
      const fill = categoryColor(color, i),
        delta = (datum.value / total) * Math.PI * 2;
      if (datum.value > 0) {
        if (positive === 1)
          out.push(rect(238, 202, 340, 340, fill, { shape: "ellipse" }));
        else {
          const start = [
            170 + 170 * Math.cos(angle),
            170 + 170 * Math.sin(angle),
          ];
          const end = [
            170 + 170 * Math.cos(angle + delta),
            170 + 170 * Math.sin(angle + delta),
          ];
          out.push(
            custom(
              `M 170 170 L ${start.map(rounded).join(" ")} A 170 170 0 ${delta > Math.PI ? 1 : 0} 1 ${end.map(rounded).join(" ")} Z`,
              238,
              202,
              340,
              340,
              fill,
              "#FFFFFF",
              1,
            ),
          );
        }
      }
      angle += delta;
      const top = 185 + i * Math.min(38, 370 / data.length);
      out.push(rect(690, top + 8, 16, 16, fill));
      const legend = `${datum.label}  ${numberLabel(datum.value)} (${numberLabel((datum.value / total) * 100)}%)`;
      out.push(
        text(
          legend,
          720,
          top,
          385,
          32,
          labelColor,
          Math.min(20, 385 / textUnits(legend)),
          { align: "left", wrap: false },
        ),
      );
    });
    return fit(out, canvas);
  }
  let low = Math.min(0, ...data.map((d) => d.value)),
    high = Math.max(0, ...data.map((d) => d.value));
  if (low === high) high = 1;
  const range = high - low,
    left = kind === "bar" ? 325 : 230,
    right = 1080,
    top = 195,
    bottom = 535;
  const gridColor = tint(color, 0.76);
  if (kind === "bar") {
    const xValue = (value: number) =>
      left + ((value - low) / range) * (right - left);
    for (let i = 0; i <= 4; i++) {
      const value = low + (range * i) / 4,
        x = xValue(value);
      out.push(connector(x, top, x, bottom, gridColor));
      out.push(
        text(numberLabel(value), x - 50, bottom + 12, 100, 30, labelColor, 17),
      );
    }
    out.push(connector(xValue(0), top, xValue(0), bottom, labelColor));
    const step = (bottom - top) / data.length;
    data.forEach((datum, i) => {
      const y = top + step * i + step * 0.18,
        zero = xValue(0),
        value = xValue(datum.value);
      out.push(
        rect(
          Math.min(zero, value),
          y,
          Math.max(1, Math.abs(value - zero)),
          step * 0.64,
          color,
        ),
      );
      out.push(
        text(
          datum.label,
          130,
          y,
          180,
          step * 0.64,
          labelColor,
          fittingFont(datum.label, 180, step * 0.64, Math.min(22, step * 0.55)),
          { align: "right" },
        ),
      );
      out.push(
        text(
          numberLabel(datum.value),
          1092,
          y,
          90,
          step * 0.64,
          labelColor,
          Math.min(20, step * 0.55),
          { align: "left" },
        ),
      );
    });
  } else {
    const yValue = (value: number) =>
      bottom - ((value - low) / range) * (bottom - top);
    for (let i = 0; i <= 4; i++) {
      const value = low + (range * i) / 4,
        y = yValue(value);
      out.push(connector(left, y, right, y, gridColor));
      out.push(
        text(numberLabel(value), 120, y - 16, 95, 32, labelColor, 18, {
          align: "right",
        }),
      );
    }
    out.push(connector(left, yValue(0), right, yValue(0), labelColor));
    const step = (right - left) / data.length;
    const points = data.map((datum, i) => ({
      x: left + step * (i + 0.5),
      y: yValue(datum.value),
    }));
    if (kind === "line" && points.length > 1)
      out.push(
        custom(
          points
            .map(
              (p, i) =>
                `${i ? "L" : "M"} ${rounded(p.x - left)} ${rounded(p.y - top)}`,
            )
            .join(" "),
          left,
          top,
          right - left,
          bottom - top,
          "transparent",
          color,
          4,
        ),
      );
    data.forEach((datum, i) => {
      const p = points[i],
        zero = yValue(0);
      if (kind === "column")
        out.push(
          rect(
            p.x - step * 0.3,
            Math.min(p.y, zero),
            step * 0.6,
            Math.max(1, Math.abs(p.y - zero)),
            color,
          ),
        );
      else
        out.push(rect(p.x - 6, p.y - 6, 12, 12, color, { shape: "ellipse" }));
      out.push(
        text(
          numberLabel(datum.value),
          p.x - step * 0.48,
          p.y + (datum.value < 0 ? 4 : -34),
          step * 0.96,
          30,
          labelColor,
          Math.min(21, step * 0.29),
        ),
      );
      out.push(
        text(
          datum.label,
          p.x - step * 0.48,
          bottom + 44,
          step * 0.96,
          52,
          labelColor,
          fittingFont(datum.label, step * 0.96, 52, Math.min(22, step * 0.27)),
        ),
      );
    });
  }
  return fit(out, canvas);
}

export function parseDiagramLabels(input: string, kind: DiagramKind) {
  const labels = input
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const max = kind === "organization" ? 7 : kind === "cycle" ? 8 : 6;
  if (labels.length < 2 || labels.length > max)
    throw Error(`단계 이름을 줄마다 하나씩, 2~${max}개 입력하세요.`);
  if (labels.some((label) => label.length > 40))
    throw Error("단계 이름은 40자 이내로 입력하세요.");
  return labels;
}
export function createDiagram(
  kind: DiagramKind,
  labels: string[],
  canvas: InsertCanvas,
) {
  parseDiagramLabels(labels.join("\n"), kind);
  const color = checkColor(canvas.color),
    out: SlideElement[] = [];
  const node = (
    label: string,
    x: number,
    y: number,
    width: number,
    height: number,
    i: number,
    ellipse = false,
  ) => {
    const fill = categoryColor(color, i);
    out.push(
      rect(x, y, width, height, fill, {
        shape: ellipse ? "ellipse" : "roundRect",
        cornerRadius: 14,
      }),
    );
    out.push(
      text(
        label,
        x + 12,
        y + 12,
        width - 24,
        height - 24,
        contrast(fill),
        fittingFont(label, width - 24, height - 24, Math.min(26, width / 6)),
        { bold: true },
      ),
    );
  };
  if (kind === "process") {
    const gap = 30,
      width = (1040 - gap * (labels.length - 1)) / labels.length;
    labels.forEach((label, i) => {
      if (i)
        out.push(
          connector(
            120 + (width + gap) * i - gap + 4,
            360,
            120 + (width + gap) * i - 5,
            360,
            color,
            true,
          ),
        );
      node(label, 120 + (width + gap) * i, 280, width, 160, i);
    });
  } else if (kind === "cycle") {
    const centers = labels.map((_, i) => ({
      x: 640 + 340 * Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / labels.length),
      y: 360 + 220 * Math.sin(-Math.PI / 2 + (i * 2 * Math.PI) / labels.length),
    }));
    centers.forEach((p, i) => {
      const next = centers[(i + 1) % centers.length],
        dx = next.x - p.x,
        dy = next.y - p.y;
      const distance = Math.hypot(dx, dy),
        inset = Math.min(105, distance * 0.38);
      out.push(
        connector(
          p.x + (dx / distance) * inset,
          p.y + (dy / distance) * inset,
          next.x - (dx / distance) * inset,
          next.y - (dy / distance) * inset,
          color,
          true,
        ),
      );
    });
    labels.forEach((label, i) =>
      node(label, centers[i].x - 95, centers[i].y - 55, 190, 110, i, true),
    );
  } else if (kind === "organization") {
    const count = labels.length - 1,
      width = Math.min(230, (1040 - (count - 1) * 24) / count);
    const total = width * count + 24 * (count - 1),
      left = (1280 - total) / 2;
    out.push(connector(640, 250, 640, 330, color));
    if (count > 1)
      out.push(
        connector(left + width / 2, 330, left + total - width / 2, 330, color),
      );
    for (let i = 0; i < count; i++)
      out.push(
        connector(
          left + i * (width + 24) + width / 2,
          330,
          left + i * (width + 24) + width / 2,
          410,
          color,
        ),
      );
    node(labels[0], 510, 145, 260, 105, 0);
    labels
      .slice(1)
      .forEach((label, i) =>
        node(label, left + i * (width + 24), 410, width, 125, i + 1),
      );
  } else {
    const height = 440 / labels.length;
    labels.forEach((label, i) => {
      const upper = 150 + (700 * i) / labels.length,
        lower = 150 + (700 * (i + 1)) / labels.length;
      const fill = categoryColor(color, i),
        x = 640 - lower / 2,
        y = 140 + i * height;
      out.push(
        custom(
          `M ${rounded((lower - upper) / 2)} 0 L ${rounded((lower + upper) / 2)} 0 L ${rounded(lower)} ${rounded(height - 7)} L 0 ${rounded(height - 7)} Z`,
          x,
          y,
          lower,
          height - 7,
          fill,
        ),
      );
      out.push(
        text(
          label,
          640 - upper / 2 + 8,
          y + 8,
          upper - 16,
          height - 23,
          contrast(fill),
          fittingFont(label, upper - 16, height - 23, Math.min(26, upper / 7)),
          { bold: true },
        ),
      );
    });
  }
  return fit(out, canvas);
}

export const INSERT_ICONS = [
  {
    id: "star",
    name: "별",
    path: "M 12 2 L 15 8.5 L 22 9.5 L 17 14.5 L 18.2 22 L 12 18.5 L 5.8 22 L 7 14.5 L 2 9.5 L 9 8.5 Z",
    filled: true,
  },
  {
    id: "heart",
    name: "하트",
    path: "M 12 21 L 3 12 C -2 5 6 -1 12 6 C 18 -1 26 5 21 12 Z",
    filled: true,
  },
  { id: "check", name: "확인", path: "M 3 12 L 9 18 L 21 5", filled: false },
  {
    id: "home",
    name: "집",
    path: "M 2 11 L 12 2 L 22 11 M 5 9 L 5 22 L 10 22 L 10 15 L 14 15 L 14 22 L 19 22 L 19 9",
    filled: false,
  },
  {
    id: "person",
    name: "사람",
    path: "M 16 6 A 4 4 0 1 1 8 6 A 4 4 0 1 1 16 6 Z M 3 22 C 3 10 21 10 21 22",
    filled: false,
  },
  {
    id: "lightbulb",
    name: "아이디어",
    path: "M 8 17 C 8 13 4 12 4 8 A 8 8 0 0 1 20 8 C 20 12 16 13 16 17 Z M 8 20 L 16 20 M 10 23 L 14 23",
    filled: false,
  },
  {
    id: "flag",
    name: "목표",
    path: "M 4 23 L 4 2 L 20 2 L 17 7 L 20 12 L 4 12",
    filled: false,
  },
  {
    id: "search",
    name: "검색",
    path: "M 17 9 A 8 8 0 1 1 1 9 A 8 8 0 1 1 17 9 Z M 15 15 L 23 23",
    filled: false,
  },
  {
    id: "mail",
    name: "편지",
    path: "M 2 4 L 22 4 L 22 20 L 2 20 Z M 2 5 L 12 13 L 22 5",
    filled: false,
  },
  {
    id: "calendar",
    name: "달력",
    path: "M 3 5 L 21 5 L 21 22 L 3 22 Z M 3 10 L 21 10 M 7 1 L 7 7 M 17 1 L 17 7 M 7 14 L 10 14 M 14 14 L 17 14 M 7 18 L 10 18",
    filled: false,
  },
  {
    id: "clock",
    name: "시간",
    path: "M 22 12 A 10 10 0 1 1 2 12 A 10 10 0 1 1 22 12 Z M 12 5 L 12 12 L 17 15",
    filled: false,
  },
  {
    id: "cloud",
    name: "클라우드",
    path: "M 7 19 C -1 19 -1 9 6 9 C 6 0 19 0 19 10 C 26 10 26 19 19 19 Z",
    filled: false,
  },
  {
    id: "shield",
    name: "보안",
    path: "M 12 1 L 22 5 L 21 13 C 20 18 16 21 12 23 C 8 21 4 18 3 13 L 2 5 Z M 7 11 L 11 15 L 17 8",
    filled: false,
  },
  {
    id: "book",
    name: "책",
    path: "M 12 5 C 8 2 4 2 1 3 L 1 21 C 5 20 9 20 12 23 C 15 20 19 20 23 21 L 23 3 C 20 2 16 2 12 5 Z M 12 5 L 12 23",
    filled: false,
  },
  {
    id: "bolt",
    name: "번개",
    path: "M 14 1 L 3 14 L 10 14 L 8 23 L 21 9 L 13 9 Z",
    filled: true,
  },
  {
    id: "growth",
    name: "성장",
    path: "M 2 21 L 2 2 M 2 21 L 23 21 M 5 16 L 11 10 L 15 13 L 22 4 M 16 4 L 22 4 L 22 10",
    filled: false,
  },
] as const;
export function createIcon(id: string, canvas: InsertCanvas) {
  const icon = INSERT_ICONS.find((icon) => icon.id === id);
  if (!icon) throw Error("삽입할 아이콘을 선택하세요.");
  return fit(
    [
      custom(
        icon.path,
        550,
        270,
        180,
        180,
        icon.filled ? canvas.color : "transparent",
        canvas.color,
        icon.filled ? 0 : 12,
        { width: 24, height: 24 },
      ),
    ],
    canvas,
  );
}

export type WordArtStyle = "bold" | "italic" | "underline" | "badge";
export function createWordArt(
  value: string,
  style: WordArtStyle,
  canvas: InsertCanvas,
) {
  const content = value.trim();
  if (!content || content.length > 80)
    throw Error("WordArt 문구는 1~80자로 입력하세요.");
  const units = textUnits(content);
  const fontSize = Math.min(84, 870 / Math.max(1, units));
  return fit(
    [
      text(
        content,
        170,
        265,
        940,
        190,
        style === "badge" ? contrast(canvas.color) : canvas.color,
        fontSize,
        {
          bold: true,
          italic: style === "italic",
          underline: style === "underline",
          wrap: false,
          ...(style === "badge"
            ? {
                fill: canvas.color,
                textInsets: [20, 24, 20, 24] as [
                  number,
                  number,
                  number,
                  number,
                ],
              }
            : {}),
        },
      ),
    ],
    canvas,
  );
}
export const EQUATION_PRESETS = [
  "E = mc²",
  "a² + b² = c²",
  "x = (−b ± √(b² − 4ac)) / 2a",
  "∫₀¹ x² dx = ⅓",
  "f(x) = sin(x) + cos(x)",
  "∑ᵢ₌₁ⁿ i = n(n + 1) / 2",
];
export const INSERT_SYMBOLS = [
  "α",
  "β",
  "γ",
  "δ",
  "θ",
  "λ",
  "μ",
  "π",
  "Σ",
  "Ω",
  "∞",
  "≈",
  "≠",
  "≤",
  "≥",
  "±",
  "×",
  "÷",
  "√",
  "∑",
  "∫",
  "∆",
  "°",
  "©",
  "®",
  "™",
  "←",
  "→",
  "↑",
  "↓",
  "✓",
  "★",
  "♥",
  "•",
  "²",
  "³",
  "₀",
  "₁",
  "₂",
  "ₙ",
];
export function createEquation(
  value: string,
  canvas: InsertCanvas,
  fraction?: { numerator: string; denominator: string },
) {
  if (fraction) {
    const numerator = fraction.numerator.trim(),
      denominator = fraction.denominator.trim();
    if (
      !numerator ||
      !denominator ||
      numerator.length > 40 ||
      denominator.length > 40
    )
      throw Error("분자와 분모는 각각 1~40자로 입력하세요.");
    const fontSize = Math.min(
      56,
      700 / Math.max(numerator.length, denominator.length),
    );
    return fit(
      [
        text(numerator, 240, 240, 800, 100, canvas.color, fontSize, {
          fontFamily: "Cambria Math",
          wrap: false,
        }),
        connector(250, 350, 1030, 350, canvas.color),
        text(denominator, 240, 365, 800, 100, canvas.color, fontSize, {
          fontFamily: "Cambria Math",
          wrap: false,
        }),
      ],
      canvas,
    );
  }
  if (!value.trim() || value.length > 160)
    throw Error("수식은 1~160자로 입력하세요.");
  return fit(
    [
      text(
        value,
        140,
        270,
        1000,
        180,
        canvas.color,
        Math.min(64, 1600 / value.length),
        { fontFamily: "Cambria Math", wrap: true },
      ),
    ],
    canvas,
  );
}
export function createSymbol(value: string, canvas: InsertCanvas) {
  if (!value.trim() || [...value].length > 16)
    throw Error("삽입할 기호를 1~16자 입력하세요.");
  return fit(
    [
      text(
        value,
        300,
        250,
        680,
        220,
        canvas.color,
        Math.min(120, 600 / [...value].length),
        { fontFamily: "Cambria Math", wrap: false },
      ),
    ],
    canvas,
  );
}
