import type { SlideElement, TableData } from "./types";

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
  return {
    cells,
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

export function tableCellStyle(table: TableData, row: number) {
  const heading = table.header && row === 0;
  return {
    fill: heading
      ? table.headerFill
      : table.striped && (row - (table.header ? 1 : 0)) % 2 === 1
        ? table.stripeFill
        : table.fill,
    color: heading ? table.headerColor : table.color,
    bold: heading,
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
  const cellWidth = Math.min(
    ...tableSizes(table.columnWidths, table.cells[0].length, width),
  );
  const cellHeight = Math.min(
    ...tableSizes(table.rowHeights, table.cells.length, height),
  );
  if (
    table.fontSize * 1.2 + table.padding * 2 + table.borderWidth * 2 <=
      cellHeight &&
    table.fontSize * 4 + table.padding * 2 + table.borderWidth * 2 <= cellWidth
  )
    return table;
  const padding = Math.max(
    0,
    Math.min(
      table.padding,
      Math.floor((cellHeight - table.borderWidth * 2) / 10),
      Math.floor((cellWidth - table.borderWidth * 2) / 10),
    ),
  );
  const fontSize = Math.max(
    6,
    Math.min(
      table.fontSize,
      Math.floor((cellHeight - padding * 2 - table.borderWidth * 2) / 1.2),
      Math.floor((cellWidth - padding * 2 - table.borderWidth * 2) / 4),
    ),
  );
  return { ...table, padding, fontSize };
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
