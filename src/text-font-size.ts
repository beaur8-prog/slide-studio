import type { SlideElement, TextParagraph } from "./types";
import {
  pixelsToPoints,
  pointsToPixels,
  nextFontPointSize,
} from "./font-units";
import { tableCellStyle } from "./table";
import { fitTableRows } from "./table-layout";
import type { TableCellRange } from "./table";

export const stepFontPixels = (pixels: number, direction: 1 | -1) =>
  pointsToPixels(nextFontPointSize(pixelsToPoints(pixels), direction));

function stepParagraphs(
  paragraphs: TextParagraph[] | undefined,
  direction: 1 | -1,
) {
  return paragraphs?.map((p) => ({
    ...p,
    ...(p.fontSize === undefined
      ? {}
      : { fontSize: stepFontPixels(p.fontSize, direction) }),
    runs: p.runs.map((run) => ({
      ...run,
      ...(run.fontSize === undefined
        ? {}
        : { fontSize: stepFontPixels(run.fontSize, direction) }),
    })),
  }));
}

/** Increase/decrease each authored size independently, keeping title/body
 * hierarchy, explicit run styles, links and cell ranges instead of flattening
 * mixed selections to the first object's font size. */
export function stepTextFontSizes(
  element: SlideElement,
  direction: 1 | -1,
  range?: TableCellRange,
): SlideElement {
  if (element.locked || !["text", "shape", "table"].includes(element.type))
    return element;
  if (!element.table)
    return {
      ...element,
      fontSize: stepFontPixels(element.fontSize ?? 32, direction),
      ...(element.paragraphs
        ? { paragraphs: stepParagraphs(element.paragraphs, direction) }
        : {}),
    };
  const table = element.table;
  return fitTableRows({
    ...element,
    table: {
      ...table,
      cellStyles: table.cells.map((row, r) =>
        row.map((_, c) => {
          const old = table.cellStyles?.[r]?.[c] ?? null;
          if (
            range &&
            (r < range.startRow ||
              r > range.endRow ||
              c < range.startColumn ||
              c > range.endColumn)
          )
            return old;
          const effective = tableCellStyle(table, r, c);
          return {
            ...old,
            fontSize: stepFontPixels(effective.fontSize, direction),
            ...(old?.paragraphs
              ? { paragraphs: stepParagraphs(old.paragraphs, direction) }
              : {}),
          };
        }),
      ),
    },
  });
}
