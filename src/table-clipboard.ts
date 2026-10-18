import type { TableData } from "./types";
import {
  MAX_TABLE_ROWS,
  MAX_TABLE_COLUMNS,
  resizeTable,
  validateTable,
} from "./table";

/** Excel/Sheets TSV, including quoted tabs, newlines and escaped quotes. */
export function parseTableClipboard(text: string): string[][] {
  const rows: string[][] = [[]];
  let value = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && (!value || quoted)) {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === "\t" || c === "\n" || c === "\r")) {
      rows[rows.length - 1].push(value);
      value = "";
      if (c !== "\t") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        rows.push([]);
      }
    } else value += c;
    if (
      rows.length > MAX_TABLE_ROWS + 1 ||
      rows[rows.length - 1].length > MAX_TABLE_COLUMNS
    )
      throw new Error("붙여넣을 표 데이터가 너무 큽니다.");
  }
  if (quoted) throw new Error("따옴표가 닫히지 않은 표 데이터입니다.");
  if (value || rows.at(-1)!.length || !/[\r\n]$/.test(text))
    rows.at(-1)!.push(value);
  else rows.pop();
  const width = Math.max(1, ...rows.map((r) => r.length));
  return rows.map((r) => Array.from({ length: width }, (_, c) => r[c] ?? ""));
}

export function pasteTableClipboard(
  table: TableData,
  row: number,
  column: number,
  source: string[][],
  grow = true,
): TableData {
  const rows = row + source.length,
    columns = column + source[0].length;
  if (rows > MAX_TABLE_ROWS || columns > MAX_TABLE_COLUMNS)
    throw new Error(
      `표는 ${MAX_TABLE_ROWS}행·${MAX_TABLE_COLUMNS}열까지 지원합니다.`,
    );
  const data = grow
    ? resizeTable(
        table,
        Math.max(table.cells.length, rows),
        Math.max(table.cells[0].length, columns),
      )
    : table;
  return validateTable({
    ...data,
    cells: data.cells.map((r, ri) =>
      r.map((text, ci) =>
        ri >= row && ri < rows && ci >= column && ci < columns
          ? source[ri - row][ci - column]
          : text,
      ),
    ),
  });
}
