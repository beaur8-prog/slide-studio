import type { SlideElement, TableCellFormat, TableData } from "./types";
import { validateParagraphs } from "./text-validation";
import { paragraphText, editText, patchText } from "./text-layout";

export const MAX_TABLE_ROWS = 100;
export const MAX_TABLE_COLUMNS = 50;
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
    autoRows: true,
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
    if (
      typeof color !== "string" ||
      (!/^#[\da-f]{6}$/i.test(color) &&
        !(key !== "color" && color === "transparent"))
    )
      throw new Error(`표 셀 ${key}: HEX 색상이 필요합니다.`);
    format[key] = color === "transparent" ? color : color.toUpperCase();
  }
  for (const [key, minimum, maximum] of [
    ["fillOpacity", 0, 1],
    ["textOpacity", 0, 1],
    ["strokeOpacity", 0, 1],
    ["fontSize", 1, 1000],
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
  for (const key of ["bold", "italic", "underline"] as const) {
    if (has(key)) {
      if (typeof source[key] !== "boolean")
        throw new Error(`표 셀 ${key}: 불리언 값이 필요합니다.`);
      format[key] = source[key];
    }
  }
  if (has("paragraphs"))
    format.paragraphs = validateParagraphs(source.paragraphs);
  if (has("textInsets")) {
    if (
      !Array.isArray(source.textInsets) ||
      source.textInsets.length !== 4 ||
      source.textInsets.some(
        (n) =>
          typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 10000,
      )
    )
      throw new Error("잘못된 셀 여백");
    format.textInsets = [...source.textInsets] as TableCellFormat["textInsets"];
  }
  if (has("borders")) {
    if (!Array.isArray(source.borders) || source.borders.length !== 4)
      throw new Error("잘못된 셀 테두리");
    format.borders = source.borders.map((b) => {
      if (
        !b ||
        typeof b !== "object" ||
        typeof b.color !== "string" ||
        !/^(?:#[\da-f]{6}|transparent)$/i.test(b.color) ||
        typeof b.width !== "number" ||
        !Number.isFinite(b.width) ||
        b.width < 0 ||
        b.width > 1000
      )
        throw new Error("잘못된 셀 테두리");
      return {
        color: b.color === "transparent" ? b.color : b.color.toUpperCase(),
        width: b.width,
        ...(b.opacity !== undefined
          ? {
              opacity:
                typeof b.opacity === "number" &&
                b.opacity >= 0 &&
                b.opacity <= 1
                  ? b.opacity
                  : (() => {
                      throw new Error("잘못된 테두리 불투명도");
                    })(),
            }
          : {}),
      };
    }) as TableCellFormat["borders"];
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
    cellStyles = source.cellStyles.map((row, r) => {
      if (!Array.isArray(row) || row.length !== columns)
        throw new Error("표 셀 서식의 열 수가 올바르지 않습니다.");
      return row.map((cell: unknown, c: number) => {
        if (cell === null) return null;
        const style = validateTableCellFormat(cell);
        if (
          style.paragraphs &&
          paragraphText(style.paragraphs) !== cells[r][c]
        ) {
          style.paragraphs = editText(
            {
              text: paragraphText(style.paragraphs),
              paragraphs: style.paragraphs,
            } as SlideElement,
            cells[r][c],
          ).paragraphs;
        }
        return style;
      });
    });
  }
  let merges: TableData["merges"];
  if (source.merges !== undefined) {
    if (!Array.isArray(source.merges) || source.merges.length > rows * columns)
      throw new Error("잘못된 표 병합 정보");
    const used = new Set<string>();
    merges = source.merges.map((m) => {
      if (
        !m ||
        typeof m !== "object" ||
        [m.row, m.column, m.rowSpan, m.columnSpan].some(
          (n) => !Number.isInteger(n),
        ) ||
        m.row < 0 ||
        m.column < 0 ||
        m.rowSpan < 1 ||
        m.columnSpan < 1 ||
        m.row + m.rowSpan > rows ||
        m.column + m.columnSpan > columns
      )
        throw new Error("병합 범위가 표를 벗어났습니다.");
      for (let r = m.row; r < m.row + m.rowSpan; r++)
        for (let c = m.column; c < m.column + m.columnSpan; c++) {
          const key = `${r}:${c}`;
          if (used.has(key)) throw new Error("병합 범위가 겹칩니다.");
          if ((r !== m.row || c !== m.column) && cells[r][c])
            throw new Error("병합된 가림 셀에 내용이 있습니다.");
          used.add(key);
        }
      return {
        row: m.row,
        column: m.column,
        rowSpan: m.rowSpan,
        columnSpan: m.columnSpan,
      };
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
    ...(merges ? { merges } : {}),
    ...(source.autoRows !== undefined ? { autoRows: bool("autoRows") } : {}),
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
    merges: table.merges
      ?.filter((m) => m.row < rows && m.column < columns)
      .map((m) => ({
        ...m,
        rowSpan: Math.min(m.rowSpan, rows - m.row),
        columnSpan: Math.min(m.columnSpan, columns - m.column),
      }))
      .filter((m) => m.rowSpan > 1 || m.columnSpan > 1),
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
  if (remove)
    for (const merge of table.merges ?? []) {
      const coordinate = axis === "row" ? merge.row : merge.column;
      const spanCount = axis === "row" ? merge.rowSpan : merge.columnSpan;
      if (coordinate === index && spanCount > 1) {
        const r = merge.row + (axis === "row" ? 1 : 0),
          c = merge.column + (axis === "column" ? 1 : 0);
        next.cells[r][c] = next.cells[merge.row][merge.column];
        if (next.cellStyles)
          next.cellStyles[r][c] = next.cellStyles[merge.row][merge.column];
      }
    }
  const start = axis === "row" ? "row" : "column",
    span = axis === "row" ? "rowSpan" : "columnSpan";
  next.merges = next.merges?.flatMap((m) => {
    const result = { ...m };
    if (remove) {
      if (index < m[start]) result[start]--;
      else if (index < m[start] + m[span]) result[span]--;
    } else {
      if (index <= m[start]) result[start]++;
      else if (index < m[start] + m[span]) result[span]++;
    }
    return result[span] > 0 && (result.rowSpan > 1 || result.columnSpan > 1)
      ? [result]
      : [];
  });
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

/** Move an internal divider by slide pixels, relative to the drag-start table. */
export function resizeTableBoundary(
  table: TableData,
  axis: "column" | "row",
  boundaryIndex: number,
  delta: number,
  total: number,
): TableData {
  if (
    (axis !== "column" && axis !== "row") ||
    !Number.isFinite(delta) ||
    !Number.isFinite(total) ||
    total <= 0 ||
    delta === 0
  )
    return table;
  const count =
    axis === "column" ? (table.cells[0]?.length ?? 0) : table.cells.length;
  if (
    count > (axis === "column" ? MAX_TABLE_COLUMNS : MAX_TABLE_ROWS) ||
    !Number.isInteger(boundaryIndex) ||
    boundaryIndex < 0 ||
    boundaryIndex >= count - 1
  )
    return table;
  const key = axis === "column" ? "columnWidths" : "rowHeights";
  const original = table[key] ?? Array.from({ length: count }, () => 1);
  if (
    !Array.isArray(original) ||
    original.length !== count ||
    original.some((n) => !Number.isFinite(n) || n < 0.001 || n > 100000)
  )
    return table;
  const sizes = tableSizes(original, count, total);
  if (sizes.some((n) => !Number.isFinite(n) || n <= 0)) return table;
  const before = sizes[boundaryIndex],
    after = sizes[boundaryIndex + 1];
  const minimum = Math.min(24, before, after);
  const requested = Math.max(
    minimum,
    Math.min(before + after - minimum, before + delta),
  );
  const tolerance = Number.EPSILON * 16 * Math.max(1, total);
  if (Math.abs(requested - before) <= tolerance) return table;

  sizes[boundaryIndex] = requested;
  sizes[boundaryIndex + 1] = before + after - requested;
  // Normalize the final sizes, so even a 24px cell in a very wide table can
  // stay above the weight minimum without changing any physical cell sizes.
  const low = 0.001 / Math.min(...sizes);
  const high = 100000 / Math.max(...sizes);
  if (low > high) return table; // The requested ratio cannot be represented.
  const factor = Math.max(low, Math.min(high, count / total));
  if (!Number.isFinite(factor) || factor <= 0) return table;
  // Clamp only floating-point spill at the exact validation limits.
  const weights = sizes.map((size) =>
    Math.max(0.001, Math.min(100000, size * factor)),
  );
  return { ...table, [key]: weights };
}

export function tableCellStyle(
  table: TableData,
  row: number,
  column = 0,
): Required<Omit<TableCellFormat, "paragraphs" | "textInsets" | "borders">> &
  Pick<TableCellFormat, "paragraphs" | "textInsets" | "borders"> {
  const heading = table.header && row === 0;
  const style = {
    fill: heading
      ? table.headerFill
      : table.striped && (row - (table.header ? 1 : 0)) % 2 === 1
        ? table.stripeFill
        : table.fill,
    color: heading ? table.headerColor : table.color,
    bold: heading,
    italic: false,
    underline: false,
    fillOpacity: 1,
    textOpacity: 1,
    strokeOpacity: 1,
    fontFamily: table.fontFamily,
    fontSize: table.fontSize,
    padding: table.padding,
    borderColor: table.borderColor,
    borderWidth: table.borderWidth,
    align: table.align,
    verticalAlign: table.verticalAlign,
    ...table.cellStyles?.[row]?.[column],
  };
  if (
    style.paragraphs &&
    paragraphText(style.paragraphs) !== table.cells[row][column]
  )
    style.paragraphs = editText(
      {
        text: paragraphText(style.paragraphs),
        paragraphs: style.paragraphs,
      } as SlideElement,
      table.cells[row][column],
    ).paragraphs;
  return style;
}

/** Text-only projections for layout measurement and accessibility/export tools. */
export function tableTextElements(element: SlideElement): SlideElement[] {
  const table = element.table;
  if (!table) return [];
  const widths = tableSizes(
      table.columnWidths,
      table.cells[0].length,
      element.width,
    ),
    heights = tableSizes(table.rowHeights, table.cells.length, element.height);
  return visibleTableCells(table).map(({ row, column }) => {
    const merge = tableMerge(table, row, column),
      style = tableCellStyle(table, row, column);
    const width = widths
        .slice(column, column + (merge?.columnSpan ?? 1))
        .reduce((a, b) => a + b, 0),
      height = heights
        .slice(row, row + (merge?.rowSpan ?? 1))
        .reduce((a, b) => a + b, 0);
    const x = widths.slice(0, column).reduce((a, b) => a + b, 0),
      y = heights.slice(0, row).reduce((a, b) => a + b, 0),
      angle = (element.rotation * Math.PI) / 180;
    const dx = x + width / 2 - element.width / 2,
      dy = y + height / 2 - element.height / 2;
    const borders =
      style.borders ??
      (Array.from({ length: 4 }, () => ({
        color: style.borderColor,
        width: style.borderWidth,
      })) as SlideElement["borders"]);
    return {
      ...element,
      ...style,
      id: `${element.id}-cell-${row}-${column}`,
      type: "text",
      table: undefined,
      text: table.cells[row][column],
      x:
        element.x +
        element.width / 2 +
        dx * Math.cos(angle) -
        dy * Math.sin(angle) -
        width / 2,
      y:
        element.y +
        element.height / 2 +
        dx * Math.sin(angle) +
        dy * Math.cos(angle) -
        height / 2,
      width,
      height,
      paragraphs: style.paragraphs,
      textInsets: style.textInsets ?? [
        style.padding,
        style.padding,
        style.padding,
        style.padding,
      ],
      borders,
      stroke: borders?.[0].color,
      strokeWidth: borders?.[0].width,
    };
  });
}

export interface TableCellRange {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}
export function tableMerge(table: TableData, row: number, column: number) {
  return table.merges?.find(
    (m) =>
      row >= m.row &&
      row < m.row + m.rowSpan &&
      column >= m.column &&
      column < m.column + m.columnSpan,
  );
}
export function visibleTableCells(table: TableData) {
  return table.cells.flatMap((row, r) =>
    row.flatMap((_, c) => {
      const m = tableMerge(table, r, c);
      return !m || (m.row === r && m.column === c)
        ? [{ row: r, column: c }]
        : [];
    }),
  );
}
export function mergeTableCells(
  table: TableData,
  range: TableCellRange,
  split = false,
): TableData {
  const next = structuredClone(table);
  const intersects = (m: NonNullable<TableData["merges"]>[number]) =>
    m.row <= range.endRow &&
    m.row + m.rowSpan > range.startRow &&
    m.column <= range.endColumn &&
    m.column + m.columnSpan > range.startColumn;
  if (split) {
    next.merges = next.merges?.filter((m) => !intersects(m));
    return next;
  }
  if (
    next.merges?.some(
      (m) =>
        intersects(m) &&
        (m.row < range.startRow ||
          m.column < range.startColumn ||
          m.row + m.rowSpan - 1 > range.endRow ||
          m.column + m.columnSpan - 1 > range.endColumn),
    )
  )
    throw new Error("병합된 셀 전체를 선택해 주세요.");
  const texts: string[] = [];
  const paragraphs: NonNullable<TableCellFormat["paragraphs"]> = [];
  for (let r = range.startRow; r <= range.endRow; r++)
    for (let c = range.startColumn; c <= range.endColumn; c++) {
      if (next.cells[r][c]) {
        texts.push(next.cells[r][c]);
        const style = tableCellStyle(table, r, c);
        for (const p of style.paragraphs ?? [
          { runs: [{ text: next.cells[r][c] }] },
        ])
          paragraphs.push({
            ...p,
            runs: p.runs.map((run) => ({
              fontFamily: style.fontFamily,
              fontSize: style.fontSize,
              color: style.color,
              bold: style.bold,
              italic: style.italic,
              underline: style.underline,
              ...run,
            })),
          });
      }
      next.cells[r][c] = "";
      if (next.cellStyles?.[r]?.[c]?.paragraphs)
        next.cellStyles[r][c] = {
          ...next.cellStyles[r][c],
          paragraphs: undefined,
        };
    }
  next.cells[range.startRow][range.startColumn] = texts.join("\n");
  next.cellStyles ??= next.cells.map((row) => row.map(() => null));
  next.cellStyles[range.startRow][range.startColumn] = {
    ...next.cellStyles[range.startRow][range.startColumn],
    paragraphs: paragraphs.length ? paragraphs : [{ runs: [{ text: "" }] }],
  };
  next.merges = [
    ...(next.merges?.filter((m) => !intersects(m)) ?? []),
    {
      row: range.startRow,
      column: range.startColumn,
      rowSpan: range.endRow - range.startRow + 1,
      columnSpan: range.endColumn - range.startColumn + 1,
    },
  ].filter((m) => m.rowSpan > 1 || m.columnSpan > 1);
  return validateTable(next);
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
          ? patchCellFormat(existing ?? {}, format)
          : existing;
      }),
    ),
  };
}
export function patchCellFormat(
  existing: TableCellFormat,
  patch: TableCellFormat,
): TableCellFormat {
  const next = { ...existing, ...patch };
  if (patch.padding !== undefined) next.textInsets = undefined;
  if (patch.borderColor !== undefined || patch.borderWidth !== undefined)
    next.borders = undefined;
  if (existing.paragraphs)
    next.paragraphs = patchText(
      { text: paragraphText(existing.paragraphs), ...existing } as SlideElement,
      patch,
    ).paragraphs;
  return next;
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
