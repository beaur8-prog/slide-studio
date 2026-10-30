import type { SlideElement, TableCellFormat } from "./types";
import {
  applyTableCellFormat,
  tableCellStyle,
  type TableCellRange,
} from "./table";
import { fitTableRows } from "./table-layout";
import { patchText } from "./text-layout";
import { applyTextFormatRanges, cssColorHex } from "./text-formatting";
import { sameValue } from "./document-changes";
import type { TextMenuSelection } from "./text-selection";

export interface FormatSample {
  text?: Required<
    Pick<
      SlideElement,
      | "fontFamily"
      | "fontSize"
      | "bold"
      | "italic"
      | "underline"
      | "color"
      | "align"
      | "verticalAlign"
    >
  > &
    Pick<SlideElement, "fontFamilyEastAsian" | "textOpacity">;
  appearance?: Pick<
    SlideElement,
    | "fill"
    | "fillOpacity"
    | "stroke"
    | "strokeOpacity"
    | "strokeWidth"
    | "strokeDash"
    | "strokeCap"
    | "gradient"
    | "borders"
    | "lineStart"
    | "lineEnd"
  >;
  effects: Pick<SlideElement, "opacity" | "shadow">;
  cell?: TableCellFormat;
}

export function captureObjectFormat(
  element: SlideElement,
  cell?: { row: number; column: number },
): FormatSample {
  const format: FormatSample = {
    effects: {
      opacity: element.opacity,
      shadow: structuredClone(element.shadow),
    },
  };
  const style = element.table
    ? tableCellStyle(element.table, cell?.row ?? 0, cell?.column ?? 0)
    : element;
  const paragraph = style.paragraphs?.[0],
    run = paragraph?.runs.find((r) => r.text.length) ?? paragraph?.runs[0];
  if (["text", "shape", "table"].includes(element.type)) {
    format.text = {
      fontFamily: run?.fontFamily ?? style.fontFamily ?? "Arial",
      fontFamilyEastAsian:
        run?.fontFamilyEastAsian ??
        ("fontFamilyEastAsian" in style
          ? style.fontFamilyEastAsian
          : undefined),
      fontSize: run?.fontSize ?? paragraph?.fontSize ?? style.fontSize ?? 32,
      bold: run?.bold ?? style.bold ?? false,
      italic: run?.italic ?? style.italic ?? false,
      underline: run?.underline ?? style.underline ?? false,
      color: run?.color ?? style.color ?? "#233D35",
      align: paragraph?.align ?? style.align ?? "left",
      verticalAlign: style.verticalAlign ?? "top",
      textOpacity: style.textOpacity ?? 1,
    };
    format.appearance = element.table
      ? {
          fill: style.fill ?? "transparent",
          fillOpacity: style.fillOpacity ?? 1,
          stroke: (style as TableCellFormat).borderColor ?? "transparent",
          strokeWidth: (style as TableCellFormat).borderWidth ?? 0,
          strokeOpacity: style.strokeOpacity ?? 1,
          borders: structuredClone(style.borders),
        }
      : {
          fill: element.fill ?? "transparent",
          fillOpacity: element.fillOpacity ?? 1,
          stroke: element.stroke ?? "transparent",
          strokeWidth: element.strokeWidth ?? 0,
          strokeOpacity: element.strokeOpacity ?? 1,
          strokeDash: structuredClone(element.strokeDash),
          strokeCap: element.strokeCap,
          gradient: structuredClone(element.gradient),
          borders: structuredClone(element.borders),
          lineStart: structuredClone(element.lineStart),
          lineEnd: structuredClone(element.lineEnd),
        };
    format.cell = {
      ...format.text,
      fill: format.appearance.fill,
      fillOpacity: format.appearance.fillOpacity,
      borderColor: format.appearance.stroke,
      borderWidth: Math.min(12, format.appearance.strokeWidth ?? 0),
      strokeOpacity: format.appearance.strokeOpacity,
      borders: structuredClone(format.appearance.borders),
      ...(element.table
        ? {
            padding: (style as TableCellFormat).padding,
            textInsets: structuredClone(style.textInsets),
          }
        : {}),
    };
  }
  return format;
}

// Copy the first selected character's visible style, without changing the live
// selection or importing its text, links, language or paragraph/list structure.
export function captureInlineFormat(
  selection: TextMenuSelection,
  base: FormatSample,
): FormatSample {
  const { host, range } = selection;
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  let node: Node | null,
    anchor = range.startContainer;
  while ((node = walker.nextNode())) {
    if (!node.textContent || !range.intersectsNode(node)) continue;
    if (
      node === range.startContainer &&
      range.startOffset >= node.textContent.length
    )
      continue;
    if (
      node === range.endContainer &&
      range.endOffset === 0 &&
      !range.collapsed
    )
      continue;
    anchor = node;
    break;
  }
  let parent =
    anchor instanceof Element ? anchor : (anchor.parentElement ?? host);
  while (parent !== host && getComputedStyle(parent).fontSize === "0px")
    parent = parent.parentElement ?? host;
  const css = getComputedStyle(parent);
  let underline = false;
  for (let node: Element | null = parent; node; node = node.parentElement) {
    underline ||=
      getComputedStyle(node).textDecorationLine.includes("underline");
    if (node === host) break;
  }
  const family = css.fontFamily
    .split(",")[0]
    .replace(/^["']|["']$/g, "")
    .trim();
  const text: FormatSample["text"] = {
    fontFamily: family,
    fontFamilyEastAsian: family,
    fontSize: parseFloat(css.fontSize),
    bold: Number(css.fontWeight) >= 600,
    italic: css.fontStyle !== "normal",
    underline,
    color: cssColorHex(css.color) ?? base.text?.color ?? "#233D35",
    align:
      ({ center: "center", right: "right" } as const)[
        css.textAlign as "center" | "right"
      ] ?? "left",
    verticalAlign: base.text?.verticalAlign ?? "top",
    textOpacity: base.text?.textOpacity ?? 1,
  };
  return {
    ...base,
    text,
    cell: base.cell ? { ...base.cell, ...text } : undefined,
  };
}

export function paintTextRange(
  element: SlideElement,
  sample: FormatSample,
  start: number,
  end: number,
) {
  if (!sample.text || end <= start || element.locked) return element;
  const { fontFamily, fontSize, bold, italic, underline, color } = sample.text;
  const next = applyTextFormatRanges({ ...element, type: "text" }, [
    {
      start,
      end,
      style: { fontFamily, fontSize, bold, italic, underline, color },
    },
  ]);
  const original =
    element.paragraphs ??
    (element.text ?? "").split("\n").map((text) => ({ runs: [{ text }] }));
  return sameValue(next.paragraphs, original)
    ? element
    : { ...element, paragraphs: next.paragraphs };
}

function uniformText(element: SlideElement, sample: FormatSample) {
  if (!sample.text) return true;
  const defaults = {
    fontFamily: "Arial",
    fontSize: 32,
    bold: false,
    italic: false,
    underline: false,
    color: "#233D35",
  };
  const paragraphs = element.paragraphs ?? [
    { runs: [{ text: element.text ?? "" }] },
  ];
  return paragraphs.every(
    (paragraph) =>
      (paragraph.align ?? element.align ?? "left") === sample.text!.align &&
      paragraph.runs.every(
        (run) =>
          (Object.keys(defaults) as (keyof typeof defaults)[]).every(
            (key) =>
              (run[key] ??
                (key === "fontSize" ? paragraph.fontSize : undefined) ??
                element[key] ??
                defaults[key]) === sample.text![key],
          ) &&
          (run.fontFamilyEastAsian ??
            element.fontFamilyEastAsian ??
            run.fontFamily ??
            element.fontFamily ??
            "Arial") ===
            (sample.text!.fontFamilyEastAsian ?? sample.text!.fontFamily),
      ),
  );
}

export function applyObjectFormat(
  element: SlideElement,
  sample: FormatSample,
  range?: TableCellRange,
): SlideElement {
  if (element.locked) return element;
  if (
    !element.table &&
    sameValue(captureObjectFormat(element), sample) &&
    uniformText(element, sample)
  )
    return element;
  if (element.table) {
    if (!sample.cell) return element;
    const format = structuredClone(sample.cell);
    // These legacy scalar controls deliberately clear imported edge/inset
    // overrides. Omit them when copying the exact four source edges/insets.
    if (format.borders) {
      delete format.borderColor;
      delete format.borderWidth;
    }
    if (format.textInsets) delete format.padding;
    const next = fitTableRows({
      ...element,
      table: applyTableCellFormat(
        element.table,
        range ?? {
          startRow: 0,
          endRow: element.table.cells.length - 1,
          startColumn: 0,
          endColumn: element.table.cells[0].length - 1,
        },
        format,
      ),
    });
    return sameValue(element, next) ? element : next;
  }
  let next = { ...element, ...structuredClone(sample.effects) };
  if (["text", "shape"].includes(element.type)) {
    if (sample.appearance)
      Object.assign(next, structuredClone(sample.appearance));
    if (sample.text) {
      next = patchText(next, sample.text);
      if (next.paragraphs)
        next.paragraphs = next.paragraphs.map((paragraph) => ({
          ...paragraph,
          runs: paragraph.runs.map((run) => ({
            ...run,
            fontFamilyEastAsian:
              sample.text!.fontFamilyEastAsian ?? sample.text!.fontFamily,
          })),
        }));
    }
  }
  return sameValue(element, next) ? element : next;
}

export const PAINT_TEXT_EVENT = "slide-studio:paint-format";
export interface PaintTextDetail {
  sample: FormatSample;
  applied: boolean;
}
