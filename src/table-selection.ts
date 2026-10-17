import type { TableCellRange } from "./table";

export type TableCellSelection = {
  elementId: string;
  anchor: { row: number; column: number };
  focus: { row: number; column: number };
};

export function selectionRange(selection: TableCellSelection): TableCellRange {
  return {
    startRow: Math.min(selection.anchor.row, selection.focus.row),
    endRow: Math.max(selection.anchor.row, selection.focus.row),
    startColumn: Math.min(selection.anchor.column, selection.focus.column),
    endColumn: Math.max(selection.anchor.column, selection.focus.column),
  };
}

export function cellInRange(
  range: TableCellRange,
  row: number,
  column: number,
): boolean {
  return (
    row >= range.startRow &&
    row <= range.endRow &&
    column >= range.startColumn &&
    column <= range.endColumn
  );
}
