import { renderToStaticMarkup } from "react-dom/server";
import { TextContent } from "./TextContent";
import { textStyle } from "./text-geometry";
import { textDirectionStyle } from "./text-direction";
import {
  tableCellStyle,
  tableSizes,
  visibleTableCells,
  tableMerge,
} from "./table";
import type { SlideElement } from "./types";

function measureCellText(measure: HTMLElement, element: SlideElement): number {
  const vertical = !!element.writingMode && element.writingMode !== "horizontal";
  const model = {
    ...element,
    autoHeight: !vertical,
    wrap: true,
    verticalAlign: "top" as const,
  };
  const minimum = Math.max(1, (vertical ? 1 : (element.fontSize ?? 24) * 1.2) +
    (element.textInsets?.[0] ?? 0) + (element.textInsets?.[2] ?? 0));
  const render = (height: number) => {
    measure.innerHTML = renderToStaticMarkup(
      <div style={{
        ...textStyle(model),
        ...textDirectionStyle(model.writingMode),
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        width: Math.max(1, element.width),
        height: vertical ? height : "auto",
        lineHeight: 1.2,
      }}><TextContent element={model} /></div>,
    );
    return measure.firstElementChild as HTMLElement;
  };
  if (!vertical) return Math.max(1, render(0).getBoundingClientRect().height);

  // For rotated/stacked text, explicit line breaks create columns. Measuring
  // them as ordinary horizontal rows incorrectly makes the table very tall.
  // Keep the authored height when its columns fit, otherwise grow the inline
  // extent until wrapping fits the available physical cell width.
  let lower = Math.max(minimum, element.height), upper = lower;
  const largestFont = Math.max(element.fontSize ?? 24,
    ...(element.paragraphs ?? []).flatMap((p) => [p.fontSize ?? 0, ...p.runs.map((r) => r.fontSize ?? 0)]));
  const longestLine = (element.text ?? "").split("\n").reduce((n, line) => Math.max(n, line.length), 1);
  const limit = Math.max(lower, Math.min(100000, longestLine * largestFont * 2 + minimum));
  const fits = (height: number) => {
    const box = render(height);
    return box.scrollWidth <= box.clientWidth + 1 && box.scrollHeight <= box.clientHeight + 1;
  };
  if (fits(lower)) return lower;
  while (upper < limit && !fits(upper)) upper = Math.min(limit, upper * 2);
  // Too many explicit columns (or a cell narrower than one glyph) cannot be
  // repaired by making the row taller. Preserve its minimum in that case.
  if (!fits(upper)) return Math.max(minimum, element.height);
  for (let i = 0; i < 12 && upper - lower > 0.5; i++) {
    const middle = (lower + upper) / 2;
    if (fits(middle)) upper = middle; else lower = middle;
  }
  return upper;
}

/** Intrinsic cell heights at the imported widths, including wraps and insets. */
export async function measureTableText(
  elements: SlideElement[],
): Promise<number[]> {
  const measure = document.createElement("div");
  Object.assign(measure.style, {
    position: "absolute",
    left: "-200000px",
    top: "0",
    visibility: "hidden",
    pointerEvents: "none",
  });
  document.body.append(measure);
  const heights = () =>
    elements.map((element) => measureCellText(measure, element));
  try {
    let result = heights();
    // Laying out the cells requests their bundled/local font faces. Recheck
    // after loading, so a temporary fallback cannot give wrapped text short rows.
    if (document.fonts.status === "loading") {
      await document.fonts.ready;
      result = heights();
    }
    return result;
  } finally {
    measure.remove();
  }
}

/** Saved row sizes are minima; fit every cell before distributing frame space. */
export async function resolveTableRowHeights(
  saved: number[],
  frameHeight: number,
  cells: { el: SlideElement; row: number; span: number }[],
): Promise<{ rowHeights: number[]; height: number }> {
  const automatic = saved.flatMap((height, row) => (height === 0 ? [row] : []));
  const rowHeights = saved.map((height) => Math.max(1, height));
  const textHeights = await measureTableText(cells.map(({ el }) => el));
  cells.forEach(({ row, span }, i) => {
    if (span === 1) rowHeights[row] = Math.max(rowHeights[row], textHeights[i]);
  });
  cells.forEach(({ row, span }, i) => {
    if (span === 1) return;
    const current = rowHeights
      .slice(row, row + span)
      .reduce((a, b) => a + b, 0);
    const automaticTargets = automatic.filter(
      (r) => r >= row && r < row + span,
    );
    const targets = automaticTargets.length
      ? automaticTargets
      : Array.from({ length: span }, (_, i) => row + i);
    const extra = Math.max(0, textHeights[i] - current) / targets.length;
    for (const r of targets) rowHeights[r] += extra;
  });
  const minimum = rowHeights.reduce((a, b) => a + b, 0);
  const spare = Math.max(0, frameHeight - minimum);
  if (automatic.length) {
    for (const r of automatic) rowHeights[r] += spare / automatic.length;
  } else {
    const total = saved.reduce((a, b) => a + b, 0);
    rowHeights.forEach((_, r) => {
      rowHeights[r] += (spare * saved[r]) / total;
    });
  }
  return {
    rowHeights,
    height: Math.max(
      frameHeight,
      rowHeights.reduce((a, b) => a + b, 0),
    ),
  };
}

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
        width: Math.max(1, width - horizontalBorder),
        height: Math.max(1, heights.slice(row, row + span).reduce((a, b) => a + b, 0) - verticalBorder),
        textInsets: style.textInsets ?? [padding, padding, padding, padding],
      } as SlideElement;
      const need = Math.ceil(
          measureCellText(measure, model) + verticalBorder,
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
