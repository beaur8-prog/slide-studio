import type { SlideElement, TextBorder } from "./types";
import {
  tableCellStyle,
  tableMerge,
  tableSizes,
  visibleTableCells,
} from "./table";

export type TableBorderSegment = TextBorder & {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

/** One full stroke per shared grid edge, independent of cell text clipping. */
export function tableBorderSegments(
  element: SlideElement,
): TableBorderSegment[] {
  const table = element.table;
  if (!table) return [];
  const rows = table.cells.length,
    columns = table.cells[0].length;
  const offsets = (sizes: number[]) => {
    const result = [0];
    for (const size of sizes) result.push(result.at(-1)! + size);
    return result;
  };
  const x = offsets(tableSizes(table.columnWidths, columns, element.width));
  const y = offsets(tableSizes(table.rowHeights, rows, element.height));
  const edges = new Map<string, TableBorderSegment>();
  const add = (
    horizontal: boolean,
    boundary: number,
    index: number,
    border: TextBorder,
  ) => {
    if (!border.width || border.color === "transparent" || border.opacity === 0)
      return;
    const key = `${horizontal ? "h" : "v"}-${boundary}-${index}`;
    const width = Math.min(
      border.width,
      horizontal ? element.height : element.width,
    );
    // Collapse the two sides of a shared edge. Wider visible borders win;
    // equal widths use the later (lower/right) cell's authored appearance.
    if ((edges.get(key)?.width ?? 0) > width) return;
    const position = horizontal
      ? boundary === 0
        ? width / 2
        : boundary === rows
          ? element.height - width / 2
          : y[boundary]
      : boundary === 0
        ? width / 2
        : boundary === columns
          ? element.width - width / 2
          : x[boundary];
    edges.set(key, {
      ...border,
      width,
      key,
      x1: horizontal ? x[index] : position,
      y1: horizontal ? position : y[index],
      x2: horizontal ? x[index + 1] : position,
      y2: horizontal ? position : y[index + 1],
    });
  };
  for (const { row, column } of visibleTableCells(table)) {
    const style = tableCellStyle(table, row, column);
    const merge = tableMerge(table, row, column);
    const rowEnd = row + (merge?.rowSpan ?? 1),
      columnEnd = column + (merge?.columnSpan ?? 1);
    const borders = [0, 1, 2, 3].map((side) => {
      const edge = style.borders?.[side] ?? {
        color: style.borderColor,
        width: style.borderWidth,
      };
      return { ...edge, opacity: edge.opacity ?? style.strokeOpacity };
    });
    for (let c = column; c < columnEnd; c++) {
      add(true, row, c, borders[0]);
      add(true, rowEnd, c, borders[2]);
    }
    for (let r = row; r < rowEnd; r++) {
      add(false, column, r, borders[3]);
      add(false, columnEnd, r, borders[1]);
    }
    for (const key of ["tlToBr", "blToTr"] as const) {
      const border = style.diagonalBorders?.[key];
      if (
        !border?.width ||
        border.color === "transparent" ||
        border.opacity === 0
      )
        continue;
      const segmentKey = `d-${row}-${column}-${key}`;
      edges.set(segmentKey, {
        ...border,
        opacity: border.opacity ?? style.strokeOpacity,
        key: segmentKey,
        x1: x[column],
        y1: key === "tlToBr" ? y[row] : y[rowEnd],
        x2: x[columnEnd],
        y2: key === "tlToBr" ? y[rowEnd] : y[row],
      });
    }
  }
  return [...edges.values()];
}
