import type { TableCellFormat } from "./types";

/** Keep native cell overrides, while allowing the table's base style to change. */
export function inheritTableCellStyle(
  native: TableCellFormat,
  base: Required<Omit<TableCellFormat, "paragraphs" | "textInsets" | "borders">>,
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
  if (result.paragraphs)
    result.paragraphs = result.paragraphs.map((paragraph) => {
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
            if (same(r[key], base[key])) delete r[key];
          return r;
        }),
      };
      if (same(p.fontSize, base.fontSize)) delete p.fontSize;
      return p;
    });
  return result;
}
