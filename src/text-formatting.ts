import type { SlideElement, TextParagraph, TextRun } from "./types";
import { editableText } from "./text-layout";
export type InlineFormat = "bold" | "italic" | "underline";
type TextFormat = InlineFormat | "color" | "fontFamily" | "fontSize";
type RunStyle = Pick<TextRun, TextFormat | "fontFamilyEastAsian">;
export type TextFormatRange = {
  start: number;
  end: number;
  style: RunStyle;
  align?: TextParagraph["align"];
};

// Keep reading every format touched in this edit session, including after
// native undo/redo and subsequent typing. Leave unrelated imported styles alone.
export function trackTextFormat(host: HTMLElement, inputType: string) {
  const format = (
    {
      formatBold: "bold",
      formatItalic: "italic",
      formatUnderline: "underline",
      formatFontColor: "color",
      formatFontName: "fontFamily",
      formatFontSize: "fontSize",
      formatJustifyLeft: "align",
      formatJustifyCenter: "align",
      formatJustifyRight: "align",
    } as Record<string, string>
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
  const measured = getComputedStyle(parent);
  const marker = parent.closest<HTMLElement>("[data-bullet]");
  const css =
    measured.fontSize === "0px" && marker ? getComputedStyle(marker) : measured;
  const style: RunStyle = {};
  if (formats.has("color")) style.color = cssColorHex(css.color);
  if (formats.has("fontFamily"))
    style.fontFamily = css.fontFamily
      .split(",")[0]
      .replace(/^["']|["']$/g, "")
      .trim();
  if (formats.has("fontSize")) style.fontSize = parseFloat(css.fontSize);
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
  const entries: {
    text: string;
    style: RunStyle;
    align?: TextParagraph["align"];
  }[] = [];
  const prefix = "\uFDD0" + crypto.randomUUID() + ":";
  let node: Node | null;
  while ((node = originalWalker.nextNode())) {
    const copy = cloneWalker.nextNode()!;
    if (!node.textContent) continue;
    const index = entries.length;
    entries.push({
      text: node.textContent,
      style: readStyle(node, host, formats),
      ...(formats.has("align")
        ? {
            align:
              (
                { center: "center", right: "right" } as Record<
                  string,
                  TextParagraph["align"]
                >
              )[getComputedStyle(node.parentElement!).textAlign] ?? "left",
          }
        : {}),
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
    const { text, style, align } = entries[index];
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
      previous.align === align &&
      JSON.stringify(previous.style) === JSON.stringify(style)
    )
      previous.end = end;
    else ranges.push({ start, end, style, ...(align ? { align } : {}) });
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
    const align = ranges.find(
      (range) => range.start <= offset && range.end > offset,
    )?.align;
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
            // A painted East Asian run uses its separate font face. Compare
            // against that face, not the Latin face that can already match the
            // requested name, and keep the original Latin metadata intact.
            if (
              key === "fontFamily" &&
              run.fontFamilyEastAsian &&
              /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303f\uff00-\uffef]/u.test(
                run.text.slice(at - offset, next - offset),
              )
            ) {
              if (
                typeof value === "string" &&
                value !== run.fontFamilyEastAsian
              )
                patch.fontFamilyEastAsian = value;
              continue;
            }
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
          ...(patch.fontFamily
            ? { fontFamilyEastAsian: patch.fontFamily }
            : {}),
        });
        at = next;
      }
      offset = end;
    }
    return { ...paragraph, ...(align ? { align } : {}), runs };
  });
  return { ...element, paragraphs };
}

// insertHTML is one native undoable edit. Wrapping the selected fragment leaves
// its existing inline styles in place and accepts arbitrary pixel sizes.
export function setSelectedFontSize(host: HTMLElement, size: number) {
  const selection = getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (range.collapsed) {
    host.dataset.pendingFontSize = String(size);
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand("fontSize", false, "7");
    applyPendingFontSize(host);
    return;
  }
  const span = document.createElement("span"),
    marker = crypto.randomUUID();
  const length = range.toString().length;
  span.dataset.textSize = marker;
  span.style.fontSize = `${size}px`;
  span.appendChild(range.cloneContents());
  document.execCommand("insertHTML", false, span.outerHTML);
  const inserted = host.querySelectorAll(`[data-text-size="${marker}"]`);
  if (inserted.length) {
    const next = document.createRange();
    next.setStartBefore(inserted[0]);
    next.setEndAfter(inserted[inserted.length - 1]);
    selection.removeAllRanges();
    selection.addRange(next);
  } else if (length && selection.rangeCount) {
    // Chromium may merge away the wrapper while keeping its style. Recover
    // the selected text from the insertion endpoint without changing the DOM.
    const next = selection.getRangeAt(0).cloneRange(),
      walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode()))
      if (next.comparePoint(node, 0) <= 0) nodes.push(node as Text);
    let remaining = length;
    for (const text of nodes.reverse()) {
      const available =
        text === next.endContainer
          ? next.endOffset
          : next.comparePoint(text, text.length) <= 0
            ? text.length
            : 0;
      if (remaining <= available) {
        next.setStart(text, available - remaining);
        selection.removeAllRanges();
        selection.addRange(next);
        break;
      }
      remaining -= available;
    }
  }
}

export function applyPendingFontSize(host: HTMLElement) {
  const size = Number(host.dataset.pendingFontSize);
  if (!Number.isFinite(size) || size < 1) return;
  for (const font of host.querySelectorAll<HTMLElement>('font[size="7"]')) {
    font.style.fontSize = `${size}px`;
    font.removeAttribute("size");
  }
}
