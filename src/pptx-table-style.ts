import { resolveThemeStyleReference } from "./drawingml-style";
import type { TableCellFormat } from "./types";

/** Keep native cell overrides, while allowing the table's base style to change. */
export function inheritTableCellStyle(
  native: TableCellFormat,
  base: Required<
    Omit<
      TableCellFormat,
      "paragraphs" | "textInsets" | "borders" | "diagonalBorders"
    >
  >,
): TableCellFormat {
  const result = { ...native };
  const same = (a: unknown, b: unknown) =>
    typeof a === "number" && typeof b === "number"
      ? Math.abs(a - b) < 0.001
      : a === b;
  for (const key of [
    "fill",
    "color",
    "fillOpacity",
    "textOpacity",
    "strokeOpacity",
    "fontFamily",
    "fontSize",
    "bold",
    "italic",
    "underline",
    "align",
    "verticalAlign",
    "writingMode",
  ] as const)
    if (same(result[key], base[key])) delete result[key];
  if (result.textInsets?.every((n) => same(n, base.padding))) {
    delete result.textInsets;
    delete result.padding;
  }
  if (
    result.borders?.every(
      (border) =>
        same(border.width, base.borderWidth) &&
        (border.color === base.borderColor ||
          (!border.width && !base.borderWidth)) &&
        same(border.opacity ?? 1, base.strokeOpacity),
    )
  )
    delete result.borders;
  const cellDefaults = { ...base, ...result };
  if (result.paragraphs)
    result.paragraphs = result.paragraphs.map((paragraph) => {
      const runDefaults = {
        ...cellDefaults,
        fontSize: paragraph.fontSize ?? cellDefaults.fontSize,
      };
      const p = {
        ...paragraph,
        runs: paragraph.runs.map((run) => {
          const r = { ...run };
          for (const key of [
            "fontFamily",
            "fontSize",
            "bold",
            "italic",
            "underline",
            "color",
          ] as const)
            if (same(r[key], runDefaults[key])) delete r[key];
          return r;
        }),
      };
      if (same(p.fontSize, cellDefaults.fontSize)) delete p.fontSize;
      return p;
    });
  return result;
}

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const child = (node: Element | undefined, name: string) =>
  Array.from(node?.children ?? []).find((entry) => entry.localName === name);

/** Cell overrides take precedence over the table style, including explicit noFill. */
export function readTableDiagonalBorders(
  properties: Element,
  styles: Element[],
  readColor: (
    node: Element | undefined,
  ) => { color: string; opacity: number } | undefined,
  scale = 1,
): TableCellFormat["diagonalBorders"] {
  const result: NonNullable<TableCellFormat["diagonalBorders"]> = {};
  for (const [key, native, inherited] of [
    ["tlToBr", "lnTlToBr", "tl2br"],
    ["blToTr", "lnBlToTr", "tr2bl"],
  ] as const) {
    const line =
      child(properties, native) ??
      styles
        .map((style) =>
          child(
            child(child(child(style, "tcStyle"), "tcBdr"), inherited),
            "ln",
          ),
        )
        .find(Boolean);
    if (!line) continue;
    const fill = readColor(child(line, "solidFill"));
    const rawWidth = Number(line.getAttribute("w") ?? "12700");
    const visible = !child(line, "noFill") && !!fill;
    result[key] = {
      color: visible ? fill.color : "transparent",
      width:
        visible && Number.isFinite(rawWidth)
          ? Math.max(0, (rawWidth / 9525) * Math.abs(scale))
          : 0,
      opacity: fill?.opacity ?? 1,
    };
  }
  return Object.keys(result).length ? result : undefined;
}

/** Write native diagonal borders so edited tables remain editable in PowerPoint. */
export function writeTableDiagonalBorders(
  document: Document,
  properties: Element,
  borders: TableCellFormat["diagonalBorders"],
  opacity = 1,
  strokeOpacity = 1,
): void {
  for (const [key, native] of [
    ["tlToBr", "lnTlToBr"],
    ["blToTr", "lnBlToTr"],
  ] as const) {
    child(properties, native)?.remove();
    const border = borders?.[key];
    if (!border) continue;
    const line = document.createElementNS(A, "a:" + native);
    line.setAttribute("w", String(Math.round(border.width * 9525)));
    const visible = border.color !== "transparent" && border.width > 0;
    const fill = document.createElementNS(
      A,
      visible ? "a:solidFill" : "a:noFill",
    );
    if (visible) {
      const color = document.createElementNS(A, "a:srgbClr");
      color.setAttribute("val", border.color.slice(1));
      const alpha = Math.max(
        0,
        Math.min(1, opacity * (border.opacity ?? strokeOpacity)),
      );
      if (alpha !== 1) {
        const node = document.createElementNS(A, "a:alpha");
        node.setAttribute("val", String(Math.round(alpha * 100000)));
        color.append(node);
      }
      fill.append(color);
    }
    line.append(fill);
    properties.append(line);
  }
  // CT_TableCellProperties places all six line properties before fills/3D.
  const lines = ["lnL", "lnR", "lnT", "lnB", "lnTlToBr", "lnBlToTr"]
    .map((name) => child(properties, name))
    .filter((line): line is Element => !!line);
  for (const line of lines) line.remove();
  const following = properties.firstChild;
  for (const line of lines) properties.insertBefore(line, following);
}

/** Private Studio metadata must never mask a native edit made by PowerPoint. */
export function tableDiagonalBordersMatch(
  native: TableCellFormat["diagonalBorders"],
  metadata: TableCellFormat["diagonalBorders"],
  objectOpacity = 1,
  strokeOpacity = 1,
): boolean {
  return (["tlToBr", "blToTr"] as const).every((key) => {
    const a = native?.[key],
      b = metadata?.[key];
    const actualOpacity = a?.opacity ?? 1;
    const expectedOpacity = objectOpacity * (b?.opacity ?? strokeOpacity);
    const visibleA =
      !!a?.width && a.color !== "transparent" && actualOpacity > 0;
    const visibleB =
      !!b?.width && b.color !== "transparent" && expectedOpacity > 0;
    return (
      (!visibleA && !visibleB) ||
      (!!a &&
        !!b &&
        visibleA === visibleB &&
        a.color.toUpperCase() === b.color.toUpperCase() &&
        Math.abs(a.width - b.width) < 0.05 &&
        Math.abs(actualOpacity - expectedOpacity) < 0.00001)
    );
  });
}

/** Oversized/damaged tables still keep visible diagonals beside their fallback cells. */
export function fallbackTableDiagonalElements(
  cell: import("./types").SlideElement,
  borders: TableCellFormat["diagonalBorders"],
  createId: () => string,
): import("./types").SlideElement[] {
  return (["tlToBr", "blToTr"] as const).flatMap((key) => {
    const border = borders?.[key];
    if (
      !border?.width ||
      border.color === "transparent" ||
      border.opacity === 0
    )
      return [];
    return [
      {
        id: createId(),
        type: "shape" as const,
        shape: "custom" as const,
        x: cell.x,
        y: cell.y,
        width: cell.width,
        height: cell.height,
        rotation: cell.rotation,
        opacity: 1,
        fill: "transparent",
        stroke: border.color,
        strokeWidth: border.width,
        strokeOpacity: border.opacity ?? 1,
        paths: [
          {
            d:
              key === "tlToBr"
                ? `M 0 0 L ${cell.width} ${cell.height}`
                : `M 0 ${cell.height} L ${cell.width} 0`,
            width: cell.width,
            height: cell.height,
            fill: false,
            stroke: true,
          },
        ],
      },
    ];
  });
}

type TableColorReader = (
  node: Element | undefined,
) => { color: string; opacity: number } | undefined;

/** Expand table theme matrix references once per table, without changing source XML. */
export function resolveTableStyleReferences(
  style: Element,
  formatScheme: Element | undefined,
  readColor: TableColorReader,
): Element {
  const resolved = style.cloneNode(true) as Element;
  const document = resolved.ownerDocument;
  const references = [
    ...Array.from(resolved.getElementsByTagNameNS("*", "fillRef")),
    ...Array.from(resolved.getElementsByTagNameNS("*", "lnRef")),
  ];
  for (const reference of references) {
    const kind = reference.localName === "lnRef" ? "line" : "fill";
    const appearance = resolveThemeStyleReference(
      reference,
      formatScheme,
      readColor,
      kind,
    );
    if (!appearance) continue;
    if (kind === "line") reference.replaceWith(appearance);
    else {
      const fill = document.createElementNS(A, "a:fill");
      fill.append(appearance);
      reference.replaceWith(fill);
    }
  }
  return resolved;
}

/** PowerPoint's unstyled table grid, used only when no table style is assigned. */
export function defaultTableGridStyle(document: Document): Element {
  const style = document.createElementNS(A, "a:tblStyle");
  const whole = document.createElementNS(A, "a:wholeTbl");
  const properties = document.createElementNS(A, "a:tcStyle");
  const borders = document.createElementNS(A, "a:tcBdr");
  for (const side of ["left", "right", "top", "bottom", "insideH", "insideV"]) {
    const edge = document.createElementNS(A, "a:" + side);
    const line = document.createElementNS(A, "a:ln");
    line.setAttribute("w", "12700");
    const fill = document.createElementNS(A, "a:solidFill");
    const color = document.createElementNS(A, "a:schemeClr");
    color.setAttribute("val", "tx1");
    fill.append(color);
    line.append(fill);
    edge.append(line);
    borders.append(edge);
  }
  const fill = document.createElementNS(A, "a:fill");
  fill.append(document.createElementNS(A, "a:noFill"));
  properties.append(borders, fill);
  whole.append(properties);
  style.append(whole);
  return style;
}
