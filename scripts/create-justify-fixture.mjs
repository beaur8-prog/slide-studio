import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";

// Public synthetic content only. This is a layout diagnostic, not a customer deck.
const directory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../tests/fixtures/justify",
);
await fs.mkdir(directory, { recursive: true });
const english =
  "Alpha teams compare the spacing between words when a paragraph wraps across several lines. The final line stays short.";
const korean =
  "한글 문단과 English words 123을 함께 넣어 자동 줄바꿈과 단어 사이 간격을 비교합니다. 같은 글꼴과 너비를 사용하며 마지막 줄은 짧게 남깁니다.";
const softBefore = "Alpha Beta Gamma Delta";
const softAfter = "Epsilon Zeta Eta Theta Iota Kappa Lambda. Short end.";
const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_WIDE";
pptx.author = "Slide Studio layout QA";
pptx.subject = "Synthetic OOXML paragraph justification regression fixture";
pptx.title = "Paragraph justification: source comparison";
pptx.company = "Slide Studio";
pptx.lang = "ko-KR";

const title = (slide, text) => {
  slide.background = { color: "FFFFFF" };
  slide.addText(text, {
    x: 0.55,
    y: 0.35,
    w: 12.2,
    h: 0.6,
    fontFace: "Arial",
    fontSize: 24,
    bold: true,
    color: "243746",
    margin: 0,
  });
};
const box = (slide, name, text, x, y, align, extra = {}) => {
  slide.addText(text, {
    objectName: name,
    x,
    y,
    w: 5.6,
    h: 3.7,
    fontFace: "Arial",
    fontSize: 24,
    color: "202020",
    margin: 0,
    valign: "top",
    breakLine: false,
    align,
    lang: "en-US",
    ...extra,
  });
};
const label = (slide, text, x) =>
  slide.addText(text, {
    x,
    y: 1.15,
    w: 5.6,
    h: 0.4,
    fontFace: "Arial",
    fontSize: 14,
    color: "526674",
    margin: 0,
  });

let slide = pptx.addSlide();
title(slide, "1. English — left and justified");
label(slide, "Left alignment", 0.65);
label(slide, "Justified; final line remains left", 7.05);
box(slide, "english-left", english, 0.65, 1.8, "left");
box(slide, "english-justify", english, 7.05, 1.8, "justify");

slide = pptx.addSlide();
title(slide, "2. 한글 · English · 123 — 동일한 문단 비교");
label(slide, "왼쪽 맞춤", 0.65);
label(slide, "양쪽 맞춤 · 마지막 줄은 왼쪽", 7.05);
box(slide, "korean-left", korean, 0.65, 1.8, "left", {
  fontFace: "Malgun Gothic",
  lang: "ko-KR",
});
box(slide, "korean-justify", korean, 7.05, 1.8, "justify", {
  fontFace: "Malgun Gothic",
  lang: "ko-KR",
});

slide = pptx.addSlide();
title(slide, "3. Soft break — one paragraph, two line segments");
label(slide, "Left alignment / Shift+Enter", 0.65);
label(slide, "Justified / Shift+Enter", 7.05);
const softToken = `${softBefore} SOFT_BREAK_TOKEN ${softAfter}`;
box(slide, "soft-left", softToken, 0.65, 1.8, "left");
box(slide, "soft-justify", softToken, 7.05, 1.8, "justify");

slide = pptx.addSlide();
title(slide, "4. Inheritance — list style, layout, direct override");
box(
  slide,
  "list-style-justify",
  "List inherited. " + english,
  0.65,
  1.4,
  "left",
  { w: 3.7, h: 5.3, fontSize: 20 },
);
box(
  slide,
  "layout-justify",
  "Layout inherited. " + english,
  4.85,
  1.4,
  "left",
  { w: 3.7, h: 5.3, fontSize: 20 },
);
box(
  slide,
  "override-left",
  "Explicit left override. " + english,
  9.05,
  1.4,
  "left",
  { w: 3.7, h: 5.3, fontSize: 20 },
);

slide = pptx.addSlide();
title(slide, "5. Table cells — mixed alignment");
slide.addTable(
  [
    [
      { text: "Left cell. " + english, options: { align: "left" } },
      { text: "Justified cell. " + english, options: { align: "justify" } },
    ],
    [
      { text: "한글 왼쪽. " + korean, options: { align: "left" } },
      { text: "한글 양쪽. " + korean, options: { align: "justify" } },
    ],
  ],
  {
    x: 0.65,
    y: 1.5,
    w: 12.05,
    h: 5.3,
    colW: [6.025, 6.025],
    rowH: 2.65,
    fontFace: "Arial",
    fontSize: 18,
    color: "202020",
    border: { type: "solid", color: "8A969F", pt: 1 },
    margin: 10,
    valign: "top",
    fill: "FFFFFF",
  },
);

const zip = await JSZip.loadAsync(
  await pptx.write({ outputType: "nodebuffer" }),
);
const rewrite = async (part, transform) => {
  const entry = zip.file(part);
  if (!entry) throw new Error(`Fixture part missing: ${part}`);
  zip.file(part, transform(await entry.async("string")));
};
await rewrite("ppt/slides/slide3.xml", (xml) =>
  xml.replaceAll(
    " SOFT_BREAK_TOKEN ",
    '</a:t></a:r><a:br/><a:r><a:rPr lang="en-US" sz="2400"><a:latin typeface="Arial"/></a:rPr><a:t>',
  ),
);

let layoutShape;
await rewrite("ppt/slides/slide4.xml", (xml) =>
  xml.replace(/<p:sp>.*?<\/p:sp>/gs, (shape) => {
    if (shape.includes('name="list-style-justify"'))
      return shape
        .replace(/ algn="l"/g, "")
        .replace(
          "<a:lstStyle/>",
          '<a:lstStyle><a:lvl1pPr algn="just"/></a:lstStyle>',
        );
    if (shape.includes('name="override-left"'))
      return shape.replace(
        "<a:lstStyle/>",
        '<a:lstStyle><a:lvl1pPr algn="just"/></a:lstStyle>',
      );
    if (!shape.includes('name="layout-justify"')) return shape;
    const placeholder = shape.replace(
      "<p:nvPr></p:nvPr>",
      '<p:nvPr><p:ph type="body" idx="4"/></p:nvPr>',
    );
    layoutShape = placeholder
      .replace(/ algn="l"/g, ' algn="just"')
      .replace(/<a:t>.*?<\/a:t>/gs, "<a:t></a:t>");
    return placeholder.replace(/ algn="l"/g, "");
  }),
);
if (!layoutShape) throw new Error("Layout fixture placeholder missing");
const rels = await zip.file("ppt/slides/_rels/slide4.xml.rels").async("string");
const layoutTarget = /Type="[^"]*\/slideLayout"[^>]*Target="([^"]+)"/.exec(
  rels,
)?.[1];
if (!layoutTarget) throw new Error("Layout fixture relationship missing");
const layoutPart = path.posix.normalize(
  path.posix.join("ppt/slides", layoutTarget),
);
await rewrite(layoutPart, (xml) =>
  xml.replace("</p:spTree>", `${layoutShape}</p:spTree>`),
);

const filename = path.join(directory, "paragraph-justify-source.pptx");
await fs.writeFile(
  filename,
  await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
);
await fs.writeFile(
  path.join(directory, "manifest.json"),
  JSON.stringify(
    {
      generatedBy: "scripts/create-justify-fixture.mjs",
      publicSyntheticContent: true,
      referenceNotes:
        "Compare the original in PowerPoint with Slide Studio and three edited round trips. Arial/Malgun Gothic availability must be reported separately from paragraph alignment.",
      slides: [
        "English left/just",
        "Korean mixed left/just",
        "soft line breaks",
        "list/layout inherited just and explicit left override",
        "table cell mixed alignment",
      ],
      english,
      korean,
      softBefore,
      softAfter,
    },
    null,
    2,
  ) + "\n",
);
console.log(filename);
