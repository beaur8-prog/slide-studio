import { renderToStaticMarkup } from "react-dom/server";
import { TextContent } from "./TextContent";
import { textStyle } from "./text-geometry";
import {
  tableCellStyle,
  tableSizes,
  visibleTableCells,
  tableMerge,
} from "./table";
import type { SlideElement } from "./types";
/** Grow rows in slide pixels using the actual browser/font layout, in the same undo transaction as the text edit. */
export function fitTableRows(
  element: SlideElement,
  changedRow?: number,
): SlideElement {
  const table = element.table;
  if (!table?.autoRows || element.locked || typeof document === "undefined")
    return element;
  const heights = tableSizes(
      table.rowHeights,
      table.cells.length,
      element.height,
    ),
    widths = tableSizes(
      table.columnWidths,
      table.cells[0].length,
      element.width,
    );
  const measure = document.createElement("div");
  Object.assign(measure.style, {
    position: "absolute",
    left: "-200000px",
    top: "0",
    visibility: "hidden",
    pointerEvents: "none",
  });
  document.body.append(measure);
  try {
    for (const { row, column } of visibleTableCells(table)) {
      const merge = tableMerge(table, row, column),
        span = merge?.rowSpan ?? 1;
      if (
        changedRow !== undefined &&
        (changedRow < row || changedRow >= row + span)
      )
        continue;
      const style = tableCellStyle(table, row, column),
        width = widths
          .slice(column, column + (merge?.columnSpan ?? 1))
          .reduce((a, b) => a + b, 0);
      const override = table.cellStyles?.[row]?.[column],
        hasBorderOverride =
          !!override &&
          (override.borderWidth !== undefined ||
            override.borderColor !== undefined);
      const border = style.borders || hasBorderOverride ? 0 : style.borderWidth;
      const horizontalBorder = border * (column === 0 ? 2 : 1),
        verticalBorder = border * (row === 0 ? 2 : 1);
      const padding =
        style.padding +
        (hasBorderOverride && !style.borders ? style.borderWidth : 0);
      const model = {
        ...element,
        ...style,
        type: "text" as const,
        text: table.cells[row][column],
        paragraphs: style.paragraphs,
        autoHeight: true,
        wrap: true,
        textColumns: 1,
        fill: "transparent",
        strokeWidth: 0,
        textInsets: style.textInsets ?? [padding, padding, padding, padding],
      } as SlideElement;
      measure.innerHTML = renderToStaticMarkup(
        <div
          style={{
            ...textStyle(model),
            display: "flex",
            flexDirection: "column",
            boxSizing: "border-box",
            width: Math.max(1, width - horizontalBorder),
            height: "auto",
            lineHeight: 1.2,
          }}
        >
          <TextContent element={model} />
        </div>,
      );
      const need = Math.ceil(
          measure.getBoundingClientRect().height + verticalBorder,
        ),
        current = heights.slice(row, row + span).reduce((a, b) => a + b, 0);
      if (need > current + 0.5)
        for (let r = row; r < row + span; r++)
          heights[r] += (need - current) / span;
    }
  } finally {
    measure.remove();
  }
  const height = heights.reduce((a, b) => a + b, 0);
  if (height <= element.height + 0.5) return element;
  if (height > 100000) return element;
  return { ...element, height, table: { ...table, rowHeights: heights } };
}
