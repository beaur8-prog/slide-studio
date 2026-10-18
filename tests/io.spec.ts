import { expect, test } from "@playwright/test";

// Runs against the Vite module, in Chromium's real DOMParser / XMLSerializer.
const origin = process.env.SLIDE_STUDIO_TEST_ORIGIN || "http://127.0.0.1:5190";
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfTYAAAAASUVORK5CYII=";
const fixture = {
  version: 1,
  id: "deck-test",
  name: "IO round trip — 한글",
  width: 1280,
  height: 720,
  theme: "test",
  slides: [
    {
      id: "slide-a",
      background: "#102030",
      notes: "발표 노트\nSecond line",
      transition: "fade",
      elements: [
        {
          id: "text-a",
          type: "text",
          x: 96,
          y: 48,
          width: 400,
          height: 150,
          rotation: 15,
          opacity: 0.7,
          text: "안녕하세요\nEditable text",
          fontFamily: "Arial",
          fontSize: 48,
          bold: true,
          italic: true,
          underline: true,
          color: "#ABCDEF",
          align: "center",
          verticalAlign: "middle",
          wrap: false,
        },
        {
          id: "shape-a",
          type: "shape",
          x: 550,
          y: 100,
          width: 200,
          height: 120,
          rotation: -20,
          opacity: 0.8,
          shape: "triangle",
          fill: "#3366CC",
          stroke: "#112233",
          strokeWidth: 4,
        },
        {
          id: "line-a",
          type: "shape",
          x: 100,
          y: 300,
          width: 400,
          height: 0,
          rotation: 0,
          opacity: 1,
          shape: "arrow",
          fill: "transparent",
          stroke: "#FF8800",
          strokeWidth: 3,
        },
        {
          id: "outline-a",
          type: "shape",
          x: 600,
          y: 400,
          width: 80,
          height: 80,
          rotation: 0,
          opacity: 1,
          shape: "ellipse",
          fill: "transparent",
          stroke: "#FFFFFF",
          strokeWidth: 2,
        },
        {
          id: "image-a",
          type: "image",
          x: 800,
          y: 200,
          width: 160,
          height: 160,
          rotation: 10,
          opacity: 0.5,
          src: png,
          alt: "Small raster image",
        },
      ],
    },
    {
      id: "slide-b",
      background: "#FFFFFF",
      notes: "",
      transition: "none",
      elements: [
        {
          id: "text-b",
          type: "text",
          x: 20,
          y: 40,
          width: 300,
          height: 100,
          rotation: 0,
          opacity: 1,
          text: "Second slide",
          fontSize: 32,
          color: "#112233",
        },
      ],
    },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.goto(origin);
});

test("PPTX exports editable objects and imports geometry, styles, notes, images and transitions", async ({
  page,
}) => {
  const result = await page.evaluate(async (deck) => {
    const io = await import("/src/io.ts");
    const bytes = await io.exportPptx(deck);
    const zipModule = await import("/node_modules/.vite/deps/jszip.js");
    const zip = await zipModule.default.loadAsync(bytes);
    const xml = await zip.file("ppt/slides/slide1.xml").async("string");
    return { bytes: bytes.length, xml, ...(await io.importPptx(bytes)) };
  }, fixture);
  expect(result.bytes).toBeGreaterThan(5000);
  expect(result.xml).toContain("<p:sp>");
  expect(result.xml).toContain("<a:t>안녕하세요</a:t>");
  expect(result.xml).toContain("<p:pic>");
  expect(result.deck.name).toBe(fixture.name);
  expect(result.deck.width).toBe(1280);
  expect(result.deck.height).toBe(720);
  expect(result.deck.slides).toHaveLength(2);
  const slide = result.deck.slides[0];
  expect(slide.background).toBe("#102030");
  expect(slide.transition).toBe("fade");
  expect(slide.notes).toBe("발표 노트\nSecond line");
  expect(slide.elements).toHaveLength(5);
  const text = slide.elements[0];
  expect(text).toMatchObject({
    type: "text",
    x: 96,
    y: 48,
    width: 400,
    height: 150,
    rotation: 15,
    text: "안녕하세요\nEditable text",
    fontSize: 48,
    bold: true,
    italic: true,
    underline: true,
    color: "#ABCDEF",
    align: "center",
    verticalAlign: "middle",
    fill: "transparent",
  });
  expect(text.opacity).toBeCloseTo(0.7);
  expect(text.wrap).toBe(false);
  expect(slide.elements[1]).toMatchObject({
    type: "shape",
    shape: "triangle",
    fill: "#3366CC",
    stroke: "#112233",
    strokeWidth: 4,
    width: 200,
    height: 120,
  });
  expect(slide.elements[1].opacity).toBeCloseTo(0.8);
  expect(slide.elements[2]).toMatchObject({
    shape: "arrow",
    stroke: "#FF8800",
    height: 1,
    strokeWidth: 3,
  });
  expect(slide.elements[3]).toMatchObject({
    shape: "ellipse",
    fill: "transparent",
    stroke: "#FFFFFF",
    opacity: 1,
  });
  expect(slide.elements[4]).toMatchObject({
    type: "image",
    src: png,
    alt: "Small raster image",
    rotation: 10,
    opacity: 0.5,
  });
  expect(result.warnings).toEqual([]);
});

test("PPTX relationship order takes priority over slide filenames", async ({
  page,
}) => {
  const firstText = await page.evaluate(async (deck) => {
    const io = await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const zip = await JSZip.loadAsync(await io.exportPptx(deck));
    const path = "ppt/presentation.xml";
    let xml = await zip.file(path).async("string");
    const match = xml.match(/<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/)!;
    const ids = match[1].match(/<p:sldId\b[^>]*\/>/g)!;
    xml = xml.replace(
      match[0],
      `<p:sldIdLst>${ids.reverse().join("")}</p:sldIdLst>`,
    );
    zip.file(path, xml);
    return (
      await io.importPptx(await zip.generateAsync({ type: "uint8array" }))
    ).deck.slides[0].elements[0].text;
  }, fixture);
  expect(firstText).toBe("Second slide");
});

test("layout placeholder geometry, theme font and scheme colors are inherited", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const io = await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const zip = new JSZip();
    const ns =
      'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const relations = (...items: string[]) =>
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.join("")}</Relationships>`;
    const rel = (id: string, type: string, target: string) =>
      `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
    zip.file(
      "_rels/.rels",
      relations(rel("r1", "officeDocument", "ppt/presentation.xml")),
    );
    zip.file(
      "ppt/presentation.xml",
      `<p:presentation ${ns}><p:sldIdLst><p:sldId id="1" r:id="r1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
    );
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      relations(rel("r1", "slide", "slides/slide1.xml")),
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<p:sld ${ns}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr><p:ph type="title" idx="7"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr lIns="0" rIns="0" tIns="0" bIns="0"/><a:lstStyle/><a:p><a:r><a:t>Inherited title</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      relations(rel("r1", "slideLayout", "../slideLayouts/slideLayout1.xml")),
    );
    zip.file(
      "ppt/slideLayouts/slideLayout1.xml",
      `<p:sldLayout ${ns}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title" idx="7"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="457200"/><a:ext cx="3810000" cy="762000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr anchor="ctr" wrap="none"/><a:p><a:pPr><a:defRPr sz="4800" b="1"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:pPr></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sldLayout>`,
    );
    zip.file(
      "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      relations(rel("r1", "slideMaster", "../slideMasters/slideMaster1.xml")),
    );
    zip.file(
      "ppt/slideMasters/slideMaster1.xml",
      `<p:sldMaster ${ns}><p:cSld><p:spTree/></p:cSld><p:clrMap tx1="dk1" bg1="lt1"/></p:sldMaster>`,
    );
    zip.file(
      "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      relations(rel("r1", "theme", "../theme/theme1.xml")),
    );
    zip.file(
      "ppt/theme/theme1.xml",
      `<a:theme ${ns}><a:themeElements><a:clrScheme name="Test"><a:accent1><a:srgbClr val="336699"/></a:accent1></a:clrScheme><a:fontScheme name="Test"><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`,
    );
    return io.importPptx(
      await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
    );
  });
  expect(result.deck.slides[0].elements[0]).toMatchObject({
    text: "Inherited title",
    x: 96,
    y: 48,
    width: 400,
    height: 80,
    fontSize: 64,
    bold: true,
    fontFamily: "Aptos Display",
    color: "#336699",
    verticalAlign: "middle",
    wrap: false,
  });
});

test("JSON rejects invalid geometry, unknown types, duplicate IDs, SVG and external images", async ({
  page,
}) => {
  const errors = await page.evaluate(async (deck) => {
    const { parseDeckJson } = await import("/src/io.ts");
    const cases = [
      (d: any) => {
        d.width = 0;
      },
      (d: any) => {
        d.slides[0].elements[0].x = Infinity;
      },
      (d: any) => {
        d.slides[0].elements[0].opacity = 2;
      },
      (d: any) => {
        d.slides[0].elements[0].type = "script";
      },
      (d: any) => {
        d.slides[1].id = d.slides[0].id;
      },
      (d: any) => {
        d.slides[0].elements[4].src = "data:image/svg+xml;base64,PHN2Zy8+";
      },
      (d: any) => {
        d.slides[0].elements[4].src = "https://example.com/image.png";
      },
      (d: any) => {
        d.slides[0].elements[4].src = "data:image/png;base64,PHN2Zy8+";
      },
    ];
    return cases.map((change) => {
      const copy = structuredClone(deck);
      change(copy);
      try {
        parseDeckJson(JSON.stringify(copy));
        return "";
      } catch (error) {
        return String(error);
      }
    });
  }, fixture);
  expect(errors).toHaveLength(8);
  for (const error of errors) expect(error.length).toBeGreaterThan(10);
});

test("PPTX rejects path traversal, hostile XML and oversized declared ZIP content", async ({
  page,
}) => {
  const errors = await page.evaluate(async (deck) => {
    const io = await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const original = await io.exportPptx(deck);
    const cases = [];
    const traversal = await JSZip.loadAsync(original);
    traversal.file("../outside.txt", "outside");
    cases.push(await traversal.generateAsync({ type: "uint8array" }));
    const hostile = await JSZip.loadAsync(original);
    const rootXml = await hostile.file("ppt/presentation.xml").async("string");
    hostile.file(
      "ppt/presentation.xml",
      rootXml.replace(
        /<p:presentation/,
        '<!DOCTYPE p:presentation [<!ENTITY malicious "injected">]><p:presentation',
      ),
    );
    cases.push(await hostile.generateAsync({ type: "uint8array" }));
    const oversized = original.slice();
    const view = new DataView(oversized.buffer);
    for (let i = 0; i < oversized.length - 46; i++) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, 25 * 1024 * 1024, true);
        break;
      }
    }
    cases.push(oversized);
    const errors = [];
    for (const bytes of cases) {
      try {
        await io.importPptx(bytes);
        errors.push("");
      } catch (error) {
        errors.push(String(error));
      }
    }
    return errors;
  }, fixture);
  expect(errors[0]).toContain("경로");
  expect(errors[1]).toContain("DTD/ENTITY");
  expect(errors[2]).toContain("크기");
});

test("unsupported objects and external relationships produce explicit warnings", async ({
  page,
}) => {
  const result = await page.evaluate(async (deck) => {
    const io = await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const zip = await JSZip.loadAsync(await io.exportPptx(deck));
    const slidePath = "ppt/slides/slide1.xml";
    let xml = await zip.file(slidePath).async("string");
    xml = xml.replace(
      "</p:spTree>",
      '<p:graphicFrame><a:graphic><a:graphicData><a:tbl/></a:graphicData></a:graphic></p:graphicFrame><p:graphicFrame><a:graphic><a:graphicData><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/></a:graphicData></a:graphic></p:graphicFrame></p:spTree>',
    );
    zip.file(slidePath, xml);
    const relPath = "ppt/slides/_rels/slide1.xml.rels";
    const rels = await zip.file(relPath).async("string");
    zip.file(
      relPath,
      rels.replace(
        "</Relationships>",
        '<Relationship Id="rExternal" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" TargetMode="External" Target="https://example.invalid/not-fetched.png"/></Relationships>',
      ),
    );
    return io.importPptx(await zip.generateAsync({ type: "uint8array" }));
  }, fixture);
  expect(result.warnings.some((w: string) => w.includes("차트"))).toBe(true);
  expect(result.warnings.some((w: string) => w.includes("표는"))).toBe(true);
  expect(result.warnings.some((w: string) => w.includes("외부 링크"))).toBe(
    true,
  );
  expect(result.deck.slides[0].elements).toHaveLength(5);
});

test("PPTX retains text placement, no-wrap, explicit font shrink and diagonal connectors", async ({
  page,
}) => {
  const result = await page.evaluate(async (deck) => {
    const io = await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const zip = await JSZip.loadAsync(await io.exportPptx(deck));
    const name = "ppt/slides/slide1.xml";
    let xml = await zip.file(name).async("string");
    // Replace the first text body's fit rule while retaining its source styles.
    const document = new DOMParser().parseFromString(xml, "application/xml");
    const bodyPr = document.getElementsByTagNameNS("*", "bodyPr")[0];
    const shrink = document.createElementNS(
      "http://schemas.openxmlformats.org/drawingml/2006/main",
      "a:normAutofit",
    );
    shrink.setAttribute("fontScale", "75000");
    bodyPr.replaceChildren(shrink);
    xml = new XMLSerializer().serializeToString(document);
    xml = xml.replace(
      "</p:spTree>",
      '<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="200" name="Diagonal"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="line"/><a:ln w="12700"><a:solidFill><a:srgbClr val="112233"/></a:solidFill></a:ln></p:spPr></p:cxnSp></p:spTree>',
    );
    zip.file(name, xml);
    return io.importPptx(await zip.generateAsync({ type: "uint8array" }));
  }, fixture);
  expect(result.deck.slides[0].elements[0]).toMatchObject({
    fontSize: 36,
    wrap: false,
    verticalAlign: "middle",
  });
  const line = result.deck.slides[0].elements.at(-1)!;
  expect(line.rotation).toBeCloseTo(45);
  expect(line.width).toBeCloseTo(Math.hypot(96, 96));
  expect(line.x + line.width / 2).toBeCloseTo(48);
  expect(line.y + line.height / 2).toBeCloseTo(48);
});
