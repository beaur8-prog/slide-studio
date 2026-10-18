import { localFontAlias } from "./local-fonts";
import type { SlideElement, TextParagraph, TextRun } from "./types";

export function fontStack(name = "Arial", bold = false): string {
  const clean = name
    .replace(/\s*\((?:Headings|Body)\)\s*$/i, "")
    .replace(/["\\\n\r]/g, "");
  const substitute = /^Calibri Light$/i.test(clean)
    ? ', "Slide Studio Calibri Light", Carlito'
    : /^Calibri$/i.test(clean)
      ? ', "Slide Studio Calibri", Carlito'
      : /^Helvetica Light$/i.test(clean)
        ? bold
          ? ', "Helvetica Neue", Helvetica'
          : ', "Helvetica Neue", "Slide Studio Office Arial Nova Light", Helvetica'
        : /^(?:나눔바른고딕|Nanum\s*Barun\s*Gothic)$/i.test(clean)
          ? ', "Slide Studio Nanum Barun Gothic"'
          : "";
  const office = /^Calibri(?: Light)?$/i.test(clean)
    ? `, "Slide Studio Office ${clean}"`
    : "";
  return `"${clean}", "${localFontAlias(clean)}"${office}${substitute}, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
}

// Keep the source run and its two font faces in the model; split only for
// painting, so edits and PPTX export retain the original script choices.
export function scriptRuns(run: TextRun): TextRun[] {
  if (!run.fontFamilyEastAsian) return [run];
  const eastAsian =
    /([\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303f\uff00-\uffef]+)/u;
  return run.text
    .split(eastAsian)
    .filter(Boolean)
    .map((text) => ({
      ...run,
      text,
      fontFamily: eastAsian.test(text)
        ? run.fontFamilyEastAsian
        : run.fontFamily,
    }));
}

export function paragraphText(paragraphs: TextParagraph[]): string {
  return paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join("\n");
}

// innerText drops empty block lines and derives extra breaks from block layout.
// Read the editable structure instead so imported blank paragraphs remain text.
// Inline wrappers do not decide whether a trailing break is a caret placeholder;
// its position within the complete block/line does.
export function editableText(root: HTMLElement): string {
  const isBlock = (node: Node) =>
    node instanceof HTMLElement && /^(DIV|P|LI)$/.test(node.tagName);
  const inlineNodes = (node: Node): Node[] =>
    Array.from(node.childNodes).flatMap((child) =>
      child instanceof HTMLElement &&
      !isBlock(child) &&
      !(child instanceof HTMLBRElement)
        ? inlineNodes(child)
        : [child],
    );
  const read = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof HTMLElement)) return "";
    const children = inlineNodes(node);
    let text = "",
      previousBlock = false,
      hasContent = false;
    for (const [index, child] of children.entries()) {
      const block = isBlock(child);
      if (child instanceof HTMLBRElement) {
        if (index < children.length - 1) text += "\n";
        continue;
      }
      let value = read(child);
      // A rendered source line never contains a newline character. Chromium
      // adds one terminal caret newline when Shift+Enter edits that line.
      if (
        node.hasAttribute("data-text-line") &&
        index === children.length - 1 &&
        child.nodeType === Node.TEXT_NODE &&
        value.endsWith("\n")
      )
        value = value.slice(0, -1);
      if (!block && !value) continue;
      if ((block || previousBlock) && hasContent) text += "\n";
      text += value;
      previousBlock = block;
      hasContent ||= block || value.length > 0;
    }
    return text;
  };
  return read(root);
}

// A user can edit or delete a generated label. Only treat it as a bullet while
// the editable text still has that exact prefix, including across styled runs.
export function paragraphBullet(paragraph: TextParagraph) {
  const prefix = paragraph.bulletPrefix;
  if (
    !prefix ||
    !prefix.trim() ||
    (paragraph.indent ?? 0) >= 0 ||
    !paragraph.runs
      .map((r) => r.text)
      .join("")
      .startsWith(prefix)
  )
    return undefined;
  let remaining = prefix.length;
  const runs = paragraph.runs.flatMap((run) => {
    const skip = Math.min(remaining, run.text.length);
    remaining -= skip;
    return skip === run.text.length
      ? []
      : [{ ...run, text: run.text.slice(skip) }];
  });
  return { label: prefix.trimEnd(), runs };
}

// Each explicit line break carries its own font metrics. A large first run
// must not impose its minimum line height on later, smaller blank lines.
export function paragraphLines(paragraph: TextParagraph): TextRun[][] {
  const lines: TextRun[][] = [[]];
  for (const run of paragraph.runs) {
    const parts = run.text.split("\n");
    parts.forEach((text, i) => {
      let line = lines.at(-1)!;
      if (line.every((r) => !r.text)) line = lines[lines.length - 1] = [];
      if (text || !line.length) line.push({ ...run, text });
      if (i < parts.length - 1) lines.push([{ ...run, text: "" }]);
    });
  }
  return lines;
}

// Preserve surrounding character styles when an edit inserts/deletes text.
// The editable DOM stays untouched during IME composition; only the model changes.
export function editText(element: SlideElement, text: string): SlideElement {
  if (!element.paragraphs || text === element.text) return { ...element, text };
  const old = element.text ?? "";
  let start = 0,
    end = 0;
  while (
    start < old.length &&
    start < text.length &&
    old[start] === text[start]
  )
    start++;
  while (
    end < old.length - start &&
    end < text.length - start &&
    old[old.length - 1 - end] === text[text.length - 1 - end]
  )
    end++;
  const styles: TextRun[] = [],
    paragraphAt: TextParagraph[] = [],
    paragraphBreaks: boolean[] = [];
  const paragraphStarts = new Map<TextParagraph, number>();
  for (const [i, p] of element.paragraphs.entries()) {
    if (i) {
      styles.push(p.runs[0] ?? { text: "" });
      paragraphAt.push(p);
      paragraphBreaks.push(true);
    }
    paragraphStarts.set(p, styles.length);
    for (const run of p.runs)
      for (let c = 0; c < run.text.length; c++) {
        styles.push(run);
        paragraphAt.push(p);
        paragraphBreaks.push(false);
      }
  }
  const paragraph = paragraphAt[start];
  const prefix = paragraph?.bulletPrefix;
  const atListBodyStart =
    prefix &&
    start === paragraphStarts.get(paragraph)! + prefix.length &&
    old.slice(start - prefix.length, start) === prefix &&
    !paragraphBreaks[start];
  // The editable marker can have its own smaller font/color. Typing at the
  // start of the body must inherit the body run, not the marker's separator.
  const insertedStyle = (atListBodyStart ? styles[start] : undefined) ??
    styles[Math.max(0, start - 1)] ??
    styles[start] ?? { text: "" };
  const insertedParagraph =
    paragraphAt[Math.max(0, start - 1)] ?? element.paragraphs[0];
  const nextStyles = [
    ...styles.slice(0, start),
    ...Array(text.length - start - end).fill(insertedStyle),
    ...styles.slice(old.length - end),
  ];
  const nextParagraphs = [
    ...paragraphAt.slice(0, start),
    ...Array(text.length - start - end).fill(insertedParagraph),
    ...paragraphAt.slice(old.length - end),
  ];
  // Both DrawingML <a:br> and paragraph boundaries appear as newlines in the
  // editor's plain text. Keep unchanged soft breaks inside their original
  // paragraph so typing cannot duplicate paragraph spacing or hanging indents.
  // Newly inserted newlines retain the editor's existing paragraph semantics.
  const nextBreaks = [
    ...paragraphBreaks.slice(0, start),
    ...Array(text.length - start - end).fill(true),
    ...paragraphBreaks.slice(old.length - end),
  ];
  const paragraphs: TextParagraph[] = [];
  let offset = 0;
  for (let boundary = 0; boundary <= text.length; boundary++) {
    if (
      boundary < text.length &&
      (text[boundary] !== "\n" || !nextBreaks[boundary])
    )
      continue;
    const line = text.slice(offset, boundary);
    const sourceParagraph =
      (offset > 0 && nextBreaks[offset - 1]
        ? nextParagraphs[offset - 1]
        : nextParagraphs[offset]) ?? insertedParagraph;
    const p: TextParagraph = {
      ...sourceParagraph,
      runs: [],
    };
    let previous: TextRun | undefined;
    for (let i = 0; i < line.length; i++) {
      const style = nextStyles[offset + i] ?? insertedStyle;
      if (style === previous) p.runs[p.runs.length - 1].text += line[i];
      else {
        p.runs.push({ ...style, text: line[i] });
        previous = style;
      }
    }
    if (!p.runs.length)
      p.runs = [{ ...(sourceParagraph.runs[0] ?? insertedStyle), text: "" }];
    paragraphs.push(p);
    offset = boundary + 1;
  }
  return { ...element, text, paragraphs };
}

export function patchText(
  element: SlideElement,
  patch: Partial<SlideElement>,
): SlideElement {
  if (typeof patch.text === "string" && patch.text !== element.text)
    element = editText(element, patch.text);
  if (!element.paragraphs) return { ...element, ...patch };
  const styles: (keyof TextRun)[] = [
    "fontFamily",
    "fontSize",
    "bold",
    "italic",
    "underline",
    "color",
  ];
  const runPatch = Object.fromEntries(
    styles
      .filter((k) => k in patch)
      .map((k) => [k, patch[k as keyof SlideElement]]),
  );
  if (patch.fontFamily) runPatch.fontFamilyEastAsian = patch.fontFamily;
  return {
    ...element,
    ...patch,
    ...(patch.fontFamily ? { fontFamilyEastAsian: patch.fontFamily } : {}),
    paragraphs: element.paragraphs.map((p) => ({
      ...p,
      ...(patch.align ? { align: patch.align } : {}),
      ...(patch.fontSize ? { fontSize: patch.fontSize } : {}),
      runs: p.runs.map((r) => ({ ...r, ...runPatch })),
    })),
  };
}

export function scaleElement(
  element: SlideElement,
  sx: number,
  sy: number,
): SlideElement {
  const scale = Math.min(sx, sy),
    scaled = (n: number | undefined, s = scale) =>
      n === undefined ? undefined : n * s;
  return {
    ...element,
    x: element.x * sx,
    y: element.y * sy,
    width: element.width * sx,
    height: element.height * sy,
    fontSize: scaled(element.fontSize),
    letterSpacing: scaled(element.letterSpacing, sx),
    kerning: scaled(element.kerning),
    strokeWidth: scaled(element.strokeWidth),
    cornerRadius: scaled(element.cornerRadius),
    ...(element.table
      ? {
          table: {
            ...element.table,
            // Ratio changes must still produce valid, reopenable table data.
            fontSize: Math.max(
              6,
              Math.min(144, element.table.fontSize * scale),
            ),
            padding: Math.max(0, Math.min(60, element.table.padding * scale)),
            borderWidth: Math.max(
              0,
              Math.min(12, element.table.borderWidth * scale),
            ),
            ...(element.table.cellStyles
              ? {
                  cellStyles: element.table.cellStyles.map((row) =>
                    row.map((style) =>
                      style === null
                        ? null
                        : {
                            ...style,
                            ...(style.fontSize === undefined
                              ? {}
                              : {
                                  fontSize: Math.max(
                                    6,
                                    Math.min(144, style.fontSize * scale),
                                  ),
                                }),
                            ...(style.padding === undefined
                              ? {}
                              : {
                                  padding: Math.max(
                                    0,
                                    Math.min(60, style.padding * scale),
                                  ),
                                }),
                            ...(style.borderWidth === undefined
                              ? {}
                              : {
                                  borderWidth: Math.max(
                                    0,
                                    Math.min(12, style.borderWidth * scale),
                                  ),
                                }),
                          },
                    ),
                  ),
                }
              : {}),
          },
        }
      : {}),
    ...(element.textInsets
      ? {
          textInsets: element.textInsets.map(
            (n, i) => n * (i % 2 ? sx : sy),
          ) as [number, number, number, number],
        }
      : {}),
    ...(element.borders
      ? {
          borders: element.borders.map((b) => ({
            ...b,
            width: b.width * scale,
          })) as NonNullable<SlideElement["borders"]>,
        }
      : {}),
    ...(element.paragraphs
      ? {
          paragraphs: element.paragraphs.map((p) => ({
            ...p,
            fontSize: scaled(p.fontSize),
            lineSpacing: scaled(p.lineSpacing, sy),
            spaceBefore: scaled(p.spaceBefore, sy),
            spaceAfter: scaled(p.spaceAfter, sy),
            marginLeft: scaled(p.marginLeft, sx),
            marginRight: scaled(p.marginRight, sx),
            indent: scaled(p.indent, sx),
            tabSize: scaled(p.tabSize, sx),
            runs: p.runs.map((r) => ({
              ...r,
              fontSize: scaled(r.fontSize),
              letterSpacing: scaled(r.letterSpacing, sx),
              kerning: scaled(r.kerning),
            })),
          })),
        }
      : {}),
  };
}
