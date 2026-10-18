import type { SlideElement, TextParagraph, TextRun } from "./types";
import { editableText } from "./text-layout";
export type InlineFormat = "bold" | "italic" | "underline";
type TextFormat = InlineFormat | "color";
type RunStyle = Pick<TextRun, TextFormat>;
export type TextFormatRange = { start: number; end: number; style: RunStyle };

// Keep reading every format touched in this edit session, including after
// native undo/redo and subsequent typing. Leave unrelated imported styles alone.
export function trackTextFormat(host: HTMLElement, inputType: string) {
  const format = (
    {
      formatBold: "bold",
      formatItalic: "italic",
      formatUnderline: "underline",
      formatFontColor: "color",
    } as Record<string, TextFormat>
  )[inputType];
  if (!format) return;
  const formats = new Set(
    (host.dataset.textFormats || "").split(" ").filter(Boolean),
  );
  formats.add(format);
  host.dataset.textFormats = [...formats].join(" ");
}

function readStyle(
  node: Node,
  host: HTMLElement,
  formats: Set<string>,
): RunStyle {
  const parent = node.parentElement!;
  const css = getComputedStyle(parent);
  const style: RunStyle = {};
  if (formats.has("color")) style.color = cssColorHex(css.color);
  if (formats.has("bold")) style.bold = Number(css.fontWeight) >= 600;
  if (formats.has("italic")) style.italic = css.fontStyle !== "normal";
  if (formats.has("underline")) {
    style.underline = false;
    // Text decorations propagate through ancestors, unlike font-style.
    for (
      let ancestor: HTMLElement | null = parent;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      if (getComputedStyle(ancestor).textDecorationLine.includes("underline")) {
        style.underline = true;
        break;
      }
      if (ancestor === host) break;
    }
  }
  return style;
}

export function cssColorHex(value: string): string | undefined {
  if (/^#[\da-f]{6}$/i.test(value)) return value.toUpperCase();
  const rgb = value.match(
    /^rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/,
  );
  if (!rgb || (rgb[4] !== undefined && Number(rgb[4]) !== 1)) return;
  return (
    "#" +
    rgb
      .slice(1, 4)
      .map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

// Read formatting without replacing the live editable DOM or disturbing IME/selection.
// Markers in one detached clone map text nodes onto the editor's logical text,
// including explicit lines, blank paragraphs and imported bullet separators.
export function editableTextFormatRanges(host: HTMLElement): TextFormatRange[] {
  const formats = new Set(
    (host.dataset.textFormats || "").split(" ").filter(Boolean),
  );
  if (!formats.size) return [];
  const clone = host.cloneNode(true) as HTMLElement;
  const originalWalker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const cloneWalker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  const entries: { text: string; style: RunStyle }[] = [];
  const prefix = "\uFDD0" + crypto.randomUUID() + ":";
  let node: Node | null;
  while ((node = originalWalker.nextNode())) {
    const copy = cloneWalker.nextNode()!;
    if (!node.textContent) continue;
    const index = entries.length;
    entries.push({
      text: node.textContent,
      style: readStyle(node, host, formats),
    });
    copy.textContent = prefix + index + "\uFDD1" + node.textContent;
  }
  const expression = new RegExp(prefix + "(\\d+)\uFDD1", "g");
  const serialized = editableText(clone);
  const starts: { start: number; index: number }[] = [];
  let removed = 0;
  const plain = serialized.replace(
    expression,
    (marker, index: string, offset: number) => {
      starts.push({ start: offset - removed, index: Number(index) });
      removed += marker.length;
      return "";
    },
  );
  if (plain !== editableText(host))
    throw new Error("텍스트 서식 범위를 확인하지 못했습니다.");
  const ranges: TextFormatRange[] = [];
  starts.forEach(({ start, index }, i) => {
    const { text, style } = entries[index];
    const end = Math.min(
      start + text.length,
      starts[i + 1]?.start ?? plain.length,
      plain.length,
    );
    if (end <= start) return;
    const previous = ranges.at(-1);
    if (
      previous &&
      previous.end === start &&
      JSON.stringify(previous.style) === JSON.stringify(style)
    )
      previous.end = end;
    else ranges.push({ start, end, style });
  });
  return ranges;
}

export function applyTextFormatRanges(
  element: SlideElement,
  ranges: TextFormatRange[],
): SlideElement {
  if (element.type !== "text" || !ranges.length) return element;
  const source: TextParagraph[] =
    element.paragraphs ??
    (element.text ?? "").split("\n").map((text) => ({ runs: [{ text }] }));
  let offset = 0,
    index = 0;
  const paragraphs = source.map((paragraph, paragraphIndex) => {
    if (paragraphIndex) offset++;
    const runs: TextRun[] = [];
    const append = (run: TextRun) => {
      const previous = runs.at(-1);
      if (
        previous &&
        JSON.stringify({ ...previous, text: undefined }) ===
          JSON.stringify({ ...run, text: undefined })
      )
        previous.text += run.text;
      else runs.push(run);
    };
    for (const run of paragraph.runs) {
      const end = offset + run.text.length;
      let at = offset;
      if (!run.text) append({ ...run });
      while (at < end) {
        while (index < ranges.length && ranges[index].end <= at) index++;
        const range = ranges[index];
        const covered = range && range.start <= at;
        const next = Math.min(end, covered ? range.end : (range?.start ?? end));
        const patch: RunStyle = {};
        if (covered) {
          for (const key of Object.keys(range.style) as TextFormat[]) {
            const value = range.style[key];
            const current =
              run[key] ?? element[key] ?? (key === "color" ? "#233D35" : false);
            // Preserve omitted (inherited) values and unrelated run metadata.
            if (value !== undefined && value !== current)
              Object.assign(patch, { [key]: value });
          }
        }
        append({
          ...run,
          text: run.text.slice(at - offset, next - offset),
          ...patch,
        });
        at = next;
      }
      offset = end;
    }
    return { ...paragraph, runs };
  });
  return { ...element, paragraphs };
}
