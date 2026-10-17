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
  return `"${clean}"${substitute}, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
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
    paragraphAt: TextParagraph[] = [];
  for (const [i, p] of element.paragraphs.entries()) {
    if (i) {
      styles.push({ text: "\n" });
      paragraphAt.push(p);
    }
    for (const run of p.runs)
      for (let c = 0; c < run.text.length; c++) {
        styles.push(run);
        paragraphAt.push(p);
      }
  }
  const insertedStyle = styles[Math.max(0, start - 1)] ??
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
  let offset = 0;
  const paragraphs = text.split("\n").map((line) => {
    const p: TextParagraph = {
      ...(nextParagraphs[offset] ?? insertedParagraph),
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
    if (!p.runs.length) p.runs = [{ ...insertedStyle, text: "" }];
    offset += line.length + 1;
    return p;
  });
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
