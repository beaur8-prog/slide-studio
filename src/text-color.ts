import type { SlideElement, TextParagraph, TextRun } from "./types";
import { editableText } from "./text-layout";
export type TextColorRange = { start: number; end: number; color: string };

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

// Read colors without replacing the live editable DOM or disturbing IME/selection.
// Markers in one detached clone map text nodes onto the editor's logical text,
// including explicit lines, blank paragraphs and imported bullet separators.
export function editableColorRanges(host: HTMLElement): TextColorRange[] {
  const clone = host.cloneNode(true) as HTMLElement;
  const originalWalker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const cloneWalker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  const entries: { text: string; color?: string }[] = [];
  const prefix = "\uFDD0" + crypto.randomUUID() + ":";
  let node: Node | null;
  while ((node = originalWalker.nextNode())) {
    const copy = cloneWalker.nextNode()!;
    if (!node.textContent) continue;
    const index = entries.length;
    entries.push({
      text: node.textContent,
      color: cssColorHex(getComputedStyle(node.parentElement!).color),
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
    throw new Error("텍스트 색상 범위를 확인하지 못했습니다.");
  const ranges: TextColorRange[] = [];
  starts.forEach(({ start, index }, i) => {
    const { text, color } = entries[index];
    const end = Math.min(
      start + text.length,
      starts[i + 1]?.start ?? plain.length,
      plain.length,
    );
    if (!color || end <= start) return;
    const previous = ranges.at(-1);
    if (previous && previous.end === start && previous.color === color)
      previous.end = end;
    else ranges.push({ start, end, color });
  });
  return ranges;
}

export function applyTextColorRanges(
  element: SlideElement,
  ranges: TextColorRange[],
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
        append({
          ...run,
          text: run.text.slice(at - offset, next - offset),
          ...(covered ? { color: range.color } : {}),
        });
        at = next;
      }
      offset = end;
    }
    return { ...paragraph, runs };
  });
  return { ...element, paragraphs };
}
