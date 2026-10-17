import type { SlideElement, TableCellFormat, TableData } from "./types";

export const MAX_TABLE_ROWS = 20;
export const MAX_TABLE_COLUMNS = 12;
export const MAX_CELL_TEXT = 2000;
const MAX_TABLE_TEXT = 50000;

function count(value: number, maximum: number): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum)
    throw new Error(`표 크기는 1–${maximum} 범위의 정수여야 합니다.`);
  return value;
}

export function createTable(rows = 4, columns = 3): TableData {
  count(rows, MAX_TABLE_ROWS);
  count(columns, MAX_TABLE_COLUMNS);
  return {
    cells: Array.from({ length: rows }, (_, r) =>
      Array.from({ length: columns }, (_, c) =>
        r === 0 ? `제목 ${c + 1}` : "",
      ),
    ),
    header: true,
    striped: true,
    headerFill: "#233D35",
    headerColor: "#FFFFFF",
    fill: "#FFFFFF",
    stripeFill: "#EDF2EF",
    color: "#233D35",
    borderColor: "#AABCB3",
    borderWidth: 1,
    fontFamily: "Arial",
    fontSize: 24,
    padding: 10,
    align: "left",
    verticalAlign: "middle",
  };
}

/** Validate partial overrides without copying unknown or prototype properties. */
export function validateTableCellFormat(value: unknown): TableCellFormat {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("표 셀 서식이 올바르지 않습니다.");
  const source = value as Record<string, unknown>;
  const format: TableCellFormat = {};
  const has = (key: string) =>
    Object.hasOwn(source, key) && source[key] !== undefined;
  for (const key of ["fill", "color", "borderColor"] as const) {
    if (!has(key)) continue;
    const color = source[key];
    if (typeof color !== "string" || !/^#[\da-f]{6}$/i.test(color))
      throw new Error(`표 셀 ${key}: HEX 색상이 필요합니다.`);
    format[key] = color.toUpperCase();
  }
  for (const [key, minimum, maximum] of [
    ["fontSize", 6, 144],
    ["padding", 0, 60],
    ["borderWidth", 0, 12],
  ] as const) {
    if (!has(key)) continue;
    const number = source[key];
    if (
      typeof number !== "number" ||
      !Number.isFinite(number) ||
      number < minimum ||
      number > maximum
    )
      throw new Error(
        `표 셀 ${key}: ${minimum}–${maximum} 범위의 숫자가 필요합니다.`,
      );
    format[key] = number;
  }
  if (has("bold")) {
    if (typeof source.bold !== "boolean")
      throw new Error("표 셀 bold: 불리언 값이 필요합니다.");
    format.bold = source.bold;
  }
  if (has("fontFamily")) {
    if (
      typeof source.fontFamily !== "string" ||
      !source.fontFamily.trim() ||
      source.fontFamily.length > 200 ||
      /[\u0000-\u001f]/u.test(source.fontFamily)
    )
      throw new Error("표 셀 글꼴이 올바르지 않습니다.");
    format.fontFamily = source.fontFamily;
  }
  if (has("align")) {
    if (!["left", "center", "right"].includes(source.align as string))
      throw new Error("표 셀 가로 정렬이 올바르지 않습니다.");
    format.align = source.align as TableCellFormat["align"];
  }
  if (has("verticalAlign")) {
    if (!["top", "middle", "bottom"].includes(source.verticalAlign as string))
      throw new Error("표 셀 세로 정렬이 올바르지 않습니다.");
    format.verticalAlign =
      source.verticalAlign as TableCellFormat["verticalAlign"];
  }
  return format;
}

/** Copy only known data. Project JSON and PPTX extensions are untrusted. */
export function validateTable(value: unknown): TableData {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("표 데이터가 올바르지 않습니다.");
  const source = value as Record<string, unknown>;
  if (!Array.isArray(source.cells)) throw new Error("표 셀 데이터가 없습니다.");
  const rows = count(source.cells.length, MAX_TABLE_ROWS);
  const columns = count(
    Array.isArray(source.cells[0]) ? source.cells[0].length : 0,
    MAX_TABLE_COLUMNS,
  );
  let length = 0;
  const cells = source.cells.map((row) => {
    if (!Array.isArray(row) || row.length !== columns)
      throw new Error("표의 열 수가 일정하지 않습니다.");
    return row.map((text: unknown) => {
      if (
        typeof text !== "string" ||
        text.length > MAX_CELL_TEXT ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text)
      )
        throw new Error(`셀 텍스트는 ${MAX_CELL_TEXT}자 이하여야 합니다.`);
      if ((length += text.length) > MAX_TABLE_TEXT)
        throw new Error("표 텍스트가 너무 깁니다.");
      return text;
    });
  });
  const color = (key: string) => {
    const value = source[key];
    if (typeof value !== "string" || !/^#[\da-f]{6}$/i.test(value))
      throw new Error(`표 ${key}: HEX 색상이 필요합니다.`);
    return value.toUpperCase();
  };
  const number = (key: string, minimum: number, maximum: number) => {
    const value = source[key];
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < minimum ||
      value > maximum
    )
      throw new Error(
        `표 ${key}: ${minimum}–${maximum} 범위의 숫자가 필요합니다.`,
      );
    return value;
  };
  const bool = (key: string) => {
    if (typeof source[key] !== "boolean")
      throw new Error(`표 ${key}: 불리언 값이 필요합니다.`);
    return source[key] as boolean;
  };
  if (
    typeof source.fontFamily !== "string" ||
    !source.fontFamily.trim() ||
    source.fontFamily.length > 200 ||
    /[\u0000-\u001f]/u.test(source.fontFamily)
  )
    throw new Error("표 글꼴이 올바르지 않습니다.");
  if (
    !["left", "center", "right"].includes(source.align as string) ||
    !["top", "middle", "bottom"].includes(source.verticalAlign as string)
  )
    throw new Error("표 정렬이 올바르지 않습니다.");
  const sizes = (key: string, size: number) => {
    const value = source[key];
    if (value === undefined) return undefined;
    if (
      !Array.isArray(value) ||
      value.length !== size ||
      value.some(
        (n) =>
          typeof n !== "number" ||
          !Number.isFinite(n) ||
          n < 0.001 ||
          n > 100000,
      )
    )
      throw new Error("표 행·열 크기가 올바르지 않습니다.");
    return [...value] as number[];
  };
  const columnWidths = sizes("columnWidths", columns),
    rowHeights = sizes("rowHeights", rows);
  let cellStyles: TableData["cellStyles"];
  if (source.cellStyles !== undefined) {
    if (!Array.isArray(source.cellStyles) || source.cellStyles.length !== rows)
      throw new Error("표 셀 서식의 행 수가 올바르지 않습니다.");
    cellStyles = source.cellStyles.map((row) => {
      if (!Array.isArray(row) || row.length !== columns)
        throw new Error("표 셀 서식의 열 수가 올바르지 않습니다.");
      return row.map((cell: unknown) =>
        cell === null ? null : validateTableCellFormat(cell),
      );
    });
  }
  return {
    cells,
    ...(cellStyles ? { cellStyles } : {}),
    header: bool("header"),
    striped: bool("striped"),
    headerFill: color("headerFill"),
    headerColor: color("headerColor"),
    fill: color("fill"),
    stripeFill: color("stripeFill"),
    color: color("color"),
    borderColor: color("borderColor"),
    borderWidth: number("borderWidth", 0, 12),
    fontSize: number("fontSize", 6, 144),
    padding: number("padding", 0, 60),
    fontFamily: source.fontFamily,
    align: source.align as TableData["align"],
    verticalAlign: source.verticalAlign as TableData["verticalAlign"],
    ...(columnWidths ? { columnWidths } : {}),
    ...(rowHeights ? { rowHeights } : {}),
  };
}

export function resizeTable(
  table: TableData,
  rows: number,
  columns: number,
): TableData {
  count(rows, MAX_TABLE_ROWS);
  count(columns, MAX_TABLE_COLUMNS);
  return {
    ...table,
    cells: Array.from({ length: rows }, (_, r) =>
      Array.from({ length: columns }, (_, c) => table.cells[r]?.[c] ?? ""),
    ),
    ...(table.cellStyles
      ? {
          cellStyles: Array.from({ length: rows }, (_, r) =>
            Array.from({ length: columns }, (_, c) => {
              const style = table.cellStyles?.[r]?.[c];
              return style ? { ...style } : null;
            }),
          ),
        }
      : {}),
    columnWidths: table.columnWidths
      ? Array.from({ length: columns }, (_, i) => table.columnWidths?.[i] ?? 1)
      : undefined,
    rowHeights: table.rowHeights
      ? Array.from({ length: rows }, (_, i) => table.rowHeights?.[i] ?? 1)
      : undefined,
  };
}

export function changeTableAxis(
  table: TableData,
  axis: "row" | "column",
  index: number,
  remove = false,
): TableData {
  const size = axis === "row" ? table.cells.length : table.cells[0].length;
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index > size ||
    (remove && index === size)
  )
    throw new Error("표 위치가 올바르지 않습니다.");
  count(
    size + (remove ? -1 : 1),
    axis === "row" ? MAX_TABLE_ROWS : MAX_TABLE_COLUMNS,
  );
  const next = structuredClone(table);
  const sizes = axis === "row" ? next.rowHeights : next.columnWidths;
  if (sizes)
    sizes.splice(
      index,
      remove ? 1 : 0,
      ...(remove ? [] : [sizes[Math.min(index, size - 1)] ?? 1]),
    );
  if (axis === "row")
    next.cells.splice(
      index,
      remove ? 1 : 0,
      ...(remove
        ? []
        : [Array.from({ length: table.cells[0].length }, () => "")]),
    );
  else
    next.cells.forEach((row) =>
      row.splice(index, remove ? 1 : 0, ...(remove ? [] : [""])),
    );
  if (next.cellStyles) {
    if (axis === "row")
      next.cellStyles.splice(
        index,
        remove ? 1 : 0,
        ...(remove
          ? []
          : [Array.from({ length: table.cells[0].length }, () => null)]),
      );
    else
      next.cellStyles.forEach((row) =>
        row.splice(index, remove ? 1 : 0, ...(remove ? [] : [null])),
      );
  }
  return next;
}

export function tableSizes(
  weights: number[] | undefined,
  count: number,
  total: number,
): number[] {
  const values = weights ?? Array.from({ length: count }, () => 1);
  const sum = values.reduce((a, b) => a + b, 0);
  return values.map((value) => (total * value) / sum);
}

export function tableCellStyle(
  table: TableData,
  row: number,
  column = 0,
): Required<TableCellFormat> {
  const heading = table.header && row === 0;
  return {
    fill: heading
      ? table.headerFill
      : table.striped && (row - (table.header ? 1 : 0)) % 2 === 1
        ? table.stripeFill
        : table.fill,
    color: heading ? table.headerColor : table.color,
    bold: heading,
    fontFamily: table.fontFamily,
    fontSize: table.fontSize,
    padding: table.padding,
    borderColor: table.borderColor,
    borderWidth: table.borderWidth,
    align: table.align,
    verticalAlign: table.verticalAlign,
    ...table.cellStyles?.[row]?.[column],
  };
}

export interface TableCellRange {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

export function applyTableCellFormat(
  table: TableData,
  range: TableCellRange,
  patch: TableCellFormat,
): TableData {
  const data = validateTable(table);
  const format = validateTableCellFormat(patch);
  const coordinates = [
    range.startRow,
    range.endRow,
    range.startColumn,
    range.endColumn,
  ];
  if (
    coordinates.some((n) => !Number.isInteger(n) || n < 0) ||
    Math.max(range.startRow, range.endRow) >= data.cells.length ||
    Math.max(range.startColumn, range.endColumn) >= data.cells[0].length
  )
    throw new Error("표 선택 범위가 올바르지 않습니다.");
  if (Object.keys(format).length === 0) return data;
  const top = Math.min(range.startRow, range.endRow),
    bottom = Math.max(range.startRow, range.endRow);
  const left = Math.min(range.startColumn, range.endColumn),
    right = Math.max(range.startColumn, range.endColumn);
  return {
    ...data,
    cellStyles: data.cells.map((row, r) =>
      row.map((_, c) => {
        const existing = data.cellStyles?.[r]?.[c] ?? null;
        return r >= top && r <= bottom && c >= left && c <= right
          ? { ...existing, ...format }
          : existing;
      }),
    ),
  };
}

export function tableElementSize(
  rows: number,
  deckWidth = 1280,
  deckHeight = 720,
) {
  return {
    width: Math.min(960, deckWidth * 0.8),
    height: Math.min(deckHeight * 0.72, rows * 58),
  };
}

/** Keep one line and a short heading visible when starting a dense table. */
export function fitTableText(
  table: TableData,
  width: number,
  height: number,
): TableData {
  const widths = tableSizes(table.columnWidths, table.cells[0].length, width);
  const heights = tableSizes(table.rowHeights, table.cells.length, height);
  const fit = (
    style: Pick<TableData, "fontSize" | "padding" | "borderWidth">,
    cellWidth: number,
    cellHeight: number,
  ) => {
    if (
      style.fontSize * 1.2 + style.padding * 2 + style.borderWidth * 2 <=
        cellHeight &&
      style.fontSize * 4 + style.padding * 2 + style.borderWidth * 2 <=
        cellWidth
    )
      return { fontSize: style.fontSize, padding: style.padding };
    const padding = Math.max(
      0,
      Math.min(
        style.padding,
        Math.floor((cellHeight - style.borderWidth * 2) / 10),
        Math.floor((cellWidth - style.borderWidth * 2) / 10),
      ),
    );
    const fontSize = Math.max(
      6,
      Math.min(
        style.fontSize,
        Math.floor((cellHeight - padding * 2 - style.borderWidth * 2) / 1.2),
        Math.floor((cellWidth - padding * 2 - style.borderWidth * 2) / 4),
      ),
    );
    return { fontSize, padding };
  };
  const base = fit(table, Math.min(...widths), Math.min(...heights));
  const result =
    base.fontSize === table.fontSize && base.padding === table.padding
      ? table
      : { ...table, ...base };
  if (!table.cellStyles) return result;
  let changed = false;
  const cellStyles = table.cellStyles.map((row, r) =>
    row.map((override, c) => {
      if (override === null) return null;
      const effective = tableCellStyle(result, r, c);
      const adjusted = fit(effective, widths[c], heights[r]);
      if (
        adjusted.fontSize === effective.fontSize &&
        adjusted.padding === effective.padding
      )
        return override;
      changed = true;
      return {
        ...override,
        ...(adjusted.fontSize === effective.fontSize
          ? {}
          : { fontSize: adjusted.fontSize }),
        ...(adjusted.padding === effective.padding
          ? {}
          : { padding: adjusted.padding }),
      };
    }),
  );
  return changed ? { ...result, cellStyles } : result;
}

export function createTableElement(
  table: TableData,
  deckWidth = 1280,
  deckHeight = 720,
): SlideElement {
  const data = validateTable(table);
  const { width, height } = tableElementSize(
    data.cells.length,
    deckWidth,
    deckHeight,
  );
  return {
    id: crypto.randomUUID(),
    type: "table",
    table: data,
    x: (deckWidth - width) / 2,
    y: (deckHeight - height) / 2,
    width,
    height,
    rotation: 0,
    opacity: 1,
  };
}
