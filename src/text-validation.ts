import { validateElementLink } from "./insert-fields";
import type { SlideElement, TextParagraph, TextRun } from "./types";
import { paragraphText } from "./text-layout";
import {
  fail,
  record,
  stringValue,
  numberValue,
  booleanValue,
  enumValue,
  colorValue,
} from "./validation";
export function validateParagraphs(
  value: unknown,
  text: string | undefined = undefined,
  elLabel = "텍스트",
): TextParagraph[] {
  const source = { paragraphs: value };
  const el = { text } as SlideElement;
  if (!Array.isArray(source.paragraphs) || source.paragraphs.length > 2000)
    fail(`${elLabel}: 문단 수가 너무 많습니다.`);
  let runCount = 0;
  el.paragraphs = source.paragraphs.map((value: unknown) => {
    const p = record(value, elLabel);
    if (!Array.isArray(p.runs) || (runCount += p.runs.length) > 10000)
      fail(`${elLabel}: 글자 서식 수가 너무 많습니다.`);
    const paragraph: TextParagraph = {
      runs: p.runs.map((raw: unknown) => {
        const r = record(raw, elLabel);
        const run: TextRun = { text: stringValue(r.text, elLabel) };
        if (r.fontFamily !== undefined)
          run.fontFamily = stringValue(r.fontFamily, elLabel, 200, false);
        if (r.fontSize !== undefined)
          run.fontSize = numberValue(r.fontSize, elLabel, 1, 1000);
        if (r.fontFamilyEastAsian !== undefined)
          run.fontFamilyEastAsian = stringValue(
            r.fontFamilyEastAsian,
            elLabel,
            200,
            false,
          );
        if (r.language !== undefined)
          run.language = stringValue(r.language, elLabel, 80, false);
        if (r.letterSpacing !== undefined)
          run.letterSpacing = numberValue(
            r.letterSpacing,
            elLabel,
            -1000,
            1000,
          );
        if (r.kerning !== undefined)
          run.kerning = numberValue(r.kerning, elLabel, 0, 10000);
        for (const key of ["bold", "italic", "underline"] as const)
          if (r[key] !== undefined) run[key] = booleanValue(r[key], elLabel);
        if (r.caps !== undefined)
          run.caps = enumValue(
            r.caps,
            ["none", "small", "all"] as const,
            elLabel,
          );
        if (r.hyperlink !== undefined)
          run.hyperlink = validateElementLink(r.hyperlink);
        if (r.opacity !== undefined)
          run.opacity = numberValue(r.opacity, elLabel, 0, 1);
        if (r.color !== undefined) run.color = colorValue(r.color, elLabel);
        if (r.baseline !== undefined)
          run.baseline = numberValue(r.baseline, elLabel, -100000, 100000);
        return run;
      }),
    };
    if (p.level !== undefined) {
      paragraph.level = numberValue(p.level, elLabel, 0, 8);
      if (!Number.isInteger(paragraph.level))
        fail("목록 수준은 정수여야 합니다.");
    }
    if (p.numbering !== undefined) {
      const n = record(p.numbering, elLabel),
        type = stringValue(n.type, elLabel, 80, false);
      if (!/^[a-zA-Z0-9]+$/.test(type)) fail("잘못된 번호 형식");
      paragraph.numbering = {
        type,
        value: numberValue(n.value, elLabel, 1, 32767),
      };
    }
    if (paragraph.numbering && !Number.isInteger(paragraph.numbering.value))
      fail("목록 번호는 정수여야 합니다.");
    if (p.align !== undefined)
      paragraph.align = enumValue(
        p.align,
        ["left", "center", "right"] as const,
        elLabel,
      );
    if (p.bulletPrefix !== undefined)
      paragraph.bulletPrefix = stringValue(p.bulletPrefix, elLabel, 200, false);
    for (const key of [
      "fontSize",
      "lineHeight",
      "lineSpacing",
      "spaceBefore",
      "spaceAfter",
      "marginLeft",
      "marginRight",
      "indent",
      "tabSize",
    ] as const)
      if (p[key] !== undefined)
        paragraph[key] = numberValue(
          p[key],
          elLabel,
          key === "indent" ? -10000 : 0,
          key === "lineHeight" ? 20 : 10000,
        );
    for (const key of [
      "latinLineBreak",
      "eastAsianLineBreak",
      "hangingPunctuation",
    ] as const)
      if (p[key] !== undefined) paragraph[key] = booleanValue(p[key], elLabel);
    return paragraph;
  });
  if (text !== undefined && paragraphText(el.paragraphs) !== el.text)
    fail(`${elLabel}: 문단과 텍스트가 일치하지 않습니다.`);

  return el.paragraphs!;
}
