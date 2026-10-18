import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

test("merged table cells retain grid positions, text, fill and borders", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { tableTextElements } = await import("/src/table.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const deck = blankDeck();
    deck.slides[0].elements = [];
    const zip = await JSZip.loadAsync(await exportPptx(deck));
    const cell = (text: string, attrs = "") =>
      `<a:tc ${attrs}><a:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1500"/><a:t>${text}</a:t></a:r></a:p></a:txBody><a:tcPr marT="0" marR="0" marB="0" marL="0"><a:lnL w="9525"><a:solidFill><a:srgbClr val="112233"/></a:solidFill></a:lnL><a:lnR w="9525"><a:solidFill><a:srgbClr val="112233"/></a:solidFill></a:lnR><a:lnT w="9525"><a:solidFill><a:srgbClr val="112233"/></a:solidFill></a:lnT><a:lnB w="9525"><a:solidFill><a:srgbClr val="112233"/></a:solidFill></a:lnB><a:solidFill><a:srgbClr val="FFEEDD"/></a:solidFill></a:tcPr></a:tc>`;
    const table = `<p:graphicFrame><p:xfrm><a:off x="95250" y="190500"/><a:ext cx="2857500" cy="952500"/></p:xfrm><a:graphic><a:graphicData><a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="952500"/><a:gridCol w="952500"/><a:gridCol w="952500"/></a:tblGrid><a:tr h="476250">${cell("merged", 'gridSpan="2"')}${cell("", 'hMerge="1"')}${cell("B")}</a:tr><a:tr h="476250">${cell("C")}${cell("D")}${cell("E")}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
    const name = "ppt/slides/slide1.xml";
    zip.file(
      name,
      (await zip.file(name).async("string")).replace(
        "</p:spTree>",
        table + "</p:spTree>",
      ),
    );
    const imported = (
      await importPptx(await zip.generateAsync({ type: "uint8array" }))
    ).deck;
    return {
      native: imported.slides[0].elements.map((e) => e.type),
      merges: imported.slides[0].elements[0].table?.merges,
      elements: tableTextElements(imported.slides[0].elements[0]),
      roundTrip: tableTextElements(
        (await importPptx(await exportPptx(imported))).deck.slides[0]
          .elements[0],
      ),
    };
  });
  expect(result.native).toEqual(["table"]);
  expect(result.merges).toEqual([
    { row: 0, column: 0, rowSpan: 1, columnSpan: 2 },
  ]);
  expect(result.elements.map((e: any) => e.text)).toEqual([
    "merged",
    "B",
    "C",
    "D",
    "E",
  ]);
  expect(result.elements[0]).toMatchObject({
    x: 10,
    y: 20,
    width: 200,
    height: 50,
    fill: "#FFEEDD",
  });
  expect(result.elements[1]).toMatchObject({
    x: 210,
    y: 20,
    width: 100,
    height: 50,
  });
  expect(result.elements[2]).toMatchObject({
    x: 10,
    y: 70,
    width: 100,
    height: 50,
  });
  expect(result.elements[0].borders[0]).toEqual({ color: "#112233", width: 1 });
  expect(result.roundTrip[0]).toMatchObject({
    text: "merged",
    x: 10,
    y: 20,
    width: 200,
    height: 50,
    stroke: "#112233",
    strokeWidth: 1,
  });
});

test("master and layout artwork use their own image relationships and visibility flags", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const deck = blankDeck();
    deck.slides[0].elements = [];
    const zip = await JSZip.loadAsync(await exportPptx(deck));
    const shape = (color: string) =>
      `<p:sp><p:nvSpPr><p:cNvPr id="70" name="Decoration"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="952500"/></a:xfrm><a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></p:spPr></p:sp>`;
    const picture =
      '<p:pic><p:nvPicPr><p:cNvPr id="71" name="Master image"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rMasterPicture"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="952500" y="0"/><a:ext cx="952500" cy="952500"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr></p:pic>';
    const master = "ppt/slideMasters/slideMaster1.xml",
      layout = "ppt/slideLayouts/slideLayout1.xml";
    zip.file(
      master,
      (await zip.file(master).async("string")).replace(
        "</p:spTree>",
        shape("FF0000") + picture + "</p:spTree>",
      ),
    );
    zip.file(
      layout,
      (await zip.file(layout).async("string")).replace(
        "</p:spTree>",
        shape("00FF00") + "</p:spTree>",
      ),
    );
    const rels = "ppt/slideMasters/_rels/slideMaster1.xml.rels";
    zip.file(
      rels,
      (await zip.file(rels).async("string")).replace(
        "</Relationships>",
        '<Relationship Id="rMasterPicture" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/master-only.png"/></Relationships>',
      ),
    );
    zip.file(
      "ppt/media/master-only.png",
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfTYAAAAASUVORK5CYII=",
      { base64: true },
    );
    const visible = (
      await importPptx(await zip.generateAsync({ type: "uint8array" }))
    ).deck.slides[0].elements;
    const name = "ppt/slides/slide1.xml";
    zip.file(
      name,
      (await zip.file(name).async("string")).replace(
        "<p:sld ",
        '<p:sld showMasterSp="0" ',
      ),
    );
    const hidden = (
      await importPptx(await zip.generateAsync({ type: "uint8array" }))
    ).deck.slides[0].elements;
    return { visible, hidden };
  });
  expect(result.visible.map((e: any) => e.type)).toEqual([
    "shape",
    "image",
    "shape",
  ]);
  expect(result.visible[0].fill).toBe("#FF0000");
  expect(result.visible[2].fill).toBe("#00FF00");
  expect(result.visible[1].src).toContain("data:image/png;base64,");
  expect(result.hidden).toHaveLength(0);
});

test("rich paragraphs, cell geometry, custom paths and image crops survive project/PPTX round trips", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { exportPptx, importPptx, serializeDeck, parseDeckJson } =
      await import("/src/io.ts");
    const deck = blankDeck();
    const border = { color: "#334455", width: 2 };
    deck.slides[0].elements = [
      element("text", {
        text: "한글 Bold\n두 번째",
        x: 100,
        y: 100,
        width: 400,
        height: 150,
        fill: "#FFEEDD",
        textInsets: [8, 12, 8, 12],
        borders: [border, border, border, border],
        textOverflow: "visible",
        paragraphs: [
          {
            runs: [
              { text: "한글 ", fontSize: 28, color: "#112233" },
              { text: "Bold", fontSize: 32, bold: true, color: "#884422" },
            ],
            align: "left",
            lineHeight: 1.3,
            spaceAfter: 12,
          },
          {
            runs: [{ text: "두 번째", fontSize: 24, italic: true }],
            align: "right",
            spaceBefore: 4,
          },
        ],
      }),
      element("text", {
        text: "세로쓰기",
        x: 550,
        y: 100,
        width: 50,
        height: 200,
        writingMode: "stacked",
        wrap: false,
      }),
      element("shape", {
        shape: "custom",
        x: 700,
        y: 100,
        width: 100,
        height: 100,
        fill: "#00AA55",
        stroke: "#112233",
        strokeWidth: 2,
        flipH: true,
        paths: [
          {
            d: "M 100 50 A 50 50 0 0 1 0 50 A 50 50 0 0 1 100 50 Z",
            width: 100,
            height: 100,
            fill: true,
            stroke: true,
          },
        ],
      }),
      element("image", {
        x: 100,
        y: 300,
        width: 100,
        height: 100,
        src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfTYAAAAASUVORK5CYII=",
        crop: [0.1, 0.2, 0.1, 0.2],
        flipH: true,
      }),
    ];
    const project = parseDeckJson(serializeDeck(deck));
    const imported = await importPptx(await exportPptx(project));
    return {
      project: project.slides[0].elements,
      imported: imported.deck.slides[0].elements,
      warnings: imported.warnings,
    };
  });
  expect(result.imported).toHaveLength(4);
  const text = result.imported[0];
  expect(text).toMatchObject({
    text: "한글 Bold\n두 번째",
    x: 100,
    y: 100,
    width: 400,
    height: 150,
    textInsets: [8, 12, 8, 12],
    fill: "#FFEEDD",
  });
  expect(text.paragraphs[0].runs[1]).toMatchObject({
    text: "Bold",
    bold: true,
    fontSize: 32,
    color: "#884422",
  });
  expect(text.paragraphs[0].lineHeight).toBeCloseTo(1.3, 4);
  expect(text.paragraphs[1].align).toBe("right");
  expect(result.imported[1]).toMatchObject({
    writingMode: "stacked",
    wrap: false,
  });
  expect(result.imported[2]).toMatchObject({ shape: "custom", flipH: true });
  expect(result.imported[2].paths[0].d).toContain("A 50 50");
  expect(result.imported[3]).toMatchObject({
    crop: [0.1, 0.2, 0.1, 0.2],
    flipH: true,
  });
});

test("paragraph style edits and IME text edits preserve unaffected runs", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const output = await page.evaluate(async () => {
    const { element } = await import("/src/model.ts");
    const { editText, patchText, paragraphText } = await import(
      "/src/text-layout.ts"
    );
    const input = element("text", {
      text: "한글 red\n둘째",
      paragraphs: [
        {
          runs: [
            { text: "한글 ", bold: true },
            { text: "red", color: "#FF0000" },
          ],
        },
        { runs: [{ text: "둘째", italic: true }], align: "right" },
      ],
    });
    const changed = editText(input, "한글 red!\n둘째");
    const styled = patchText(changed, { fontSize: 40, align: "center" });
    return { text: paragraphText(changed.paragraphs), changed, styled };
  });
  expect(output.text).toBe("한글 red!\n둘째");
  expect(output.changed.paragraphs[0].runs.at(-1)).toMatchObject({
    color: "#FF0000",
  });
  expect(output.changed.paragraphs[1].runs[0]).toMatchObject({ italic: true });
  expect(
    output.styled.paragraphs.every(
      (p: any) =>
        p.align === "center" && p.runs.every((r: any) => r.fontSize === 40),
    ),
  ).toBe(true);
});

test("new layout fields reject malformed geometry and inconsistent rich text", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const errors = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { parseDeckJson } = await import("/src/io.ts");
    const cases = [
      { text: "a", paragraphs: [{ runs: [{ text: "b" }] }] },
      { text: "a", paragraphs: [{ runs: [{ text: "a", fontSize: -1 }] }] },
      {
        text: "a",
        paths: [
          {
            d: "M 0 0 <script>",
            width: 1,
            height: 1,
            fill: true,
            stroke: false,
          },
        ],
      },
      { text: "a", crop: [0, 0.6, 0, 0.6] },
      { text: "a", textInsets: [0, 0, -1, 0] },
    ];
    return cases.map((patch) => {
      const d = blankDeck();
      d.slides[0].elements = [element("text", patch)];
      try {
        parseDeckJson(JSON.stringify(d));
        return false;
      } catch {
        return true;
      }
    });
  });
  expect(errors).toEqual([true, true, true, true, true]);
});

for (const item of [
  { file: "cmu-lecture-1.pptx", slide: 1, kind: "footer" },
  { file: "cmu-lecture-2.pptx", slide: 28, kind: "table" },
  { file: "cmu-lecture-3.pptx", slide: 34, kind: "text" },
  { file: "cmu-lecture-4.pptx", slide: 1, kind: "footer" },
  { file: "dsu-korean.pptx", slide: 8, kind: "vertical" },
  { file: "cmu-lecture-1.pptx", slide: 70, kind: "mixed-lines" },
  { file: "dsu-korean.pptx", slide: 12, kind: "cell-height" },
  { file: "dsu-korean.pptx", slide: 6, kind: "diagram" },
  { file: "cmu-lecture-3.pptx", slide: 117, kind: "edge-spacing" },
  { file: "cmu-lecture-3.pptx", slide: 118, kind: "edge-spacing" },
])
  test(`public regression: ${item.file} slide ${item.slide}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000);
    const sample = path.resolve("qa/samples", item.file);
    test.skip(!fs.existsSync(sample), "Download the public QA corpus first.");
    await page.goto("http://127.0.0.1:5190");
    await page
      .locator('input[type=file][accept*=".pptx"]')
      .setInputFiles(sample);
    await page
      .getByRole("button", { name: "편집 시작하기", exact: true })
      .click();
    await page
      .locator(".thumbnail-button")
      .nth(item.slide - 1)
      .click();
    await page.evaluate(() => document.fonts.ready);
    const canvas = page.getByTestId("canvas-frame");
    const details = await page.evaluate(({ kind }) => {
      const root = document.querySelector(".editable-slide")!;
      const texts = Array.from(
        root.querySelectorAll(".element-text, .table-cell-text"),
      );
      const rangeBounds = (el: Element) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        return r.getBoundingClientRect();
      };
      const slide = root.getBoundingClientRect();
      const plain = (s: string) =>
        texts.find((t) => t.textContent?.includes(s));
      if (kind === "edge-spacing") {
        const captions = texts.filter((t) =>
          /^(original|amplitude|phase)$|phase with/.test(t.textContent ?? ""),
        );
        return {
          inside:
            captions.length >= 2 &&
            captions.every((t) => rangeBounds(t).bottom <= slide.bottom + 1),
        };
      }
      if (kind === "mixed-lines") {
        const el = plain("Please take the course survey")!,
          rect = rangeBounds(el);
        return {
          inside: rect.top >= slide.top - 1 && rect.bottom <= slide.bottom + 1,
        };
      }
      if (kind === "cell-height") {
        const el = plain("사회복무요원")!,
          text = rangeBounds(el),
          box = (
            el.classList.contains("table-cell-text") ? el.parentElement! : el
          ).getBoundingClientRect();
        return {
          inside: text.top >= box.top - 1 && text.bottom <= box.bottom + 1,
          cells: root.querySelectorAll(
            ".text-borders, .inserted-table [role=cell]",
          ).length,
        };
      }
      if (kind === "diagram") {
        const labels = [
          "관장",
          "과장",
          "운영지원팀",
          "복지사업팀",
          "사례관리팀",
          "운영위원회",
          "고충처리위원회",
          "인사위원회",
        ];
        return {
          labels: labels.every((s) => texts.some((t) => t.textContent === s)),
          paths: root.querySelectorAll("path").length,
        };
      }
      if (kind === "footer") {
        const glyphs = (el: Element) => {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT),
            rects: DOMRect[] = [];
          let n;
          while ((n = walker.nextNode())) {
            const text = n.textContent ?? "";
            if (!text.trim()) continue;
            const r = document.createRange();
            r.setStart(n, text.search(/\S/));
            r.setEnd(n, text.trimEnd().length);
            rects.push(...r.getClientRects());
          }
          return rects;
        };
        const a = glyphs(plain("http://www.cs.cmu.edu")!),
          b = glyphs(plain("Spring 2020")!);
        return {
          overlap: a.some((x) =>
            b.some(
              (y) =>
                Math.min(x.right, y.right) - Math.max(x.left, y.left) > 1 &&
                Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 1,
            ),
          ),
          images: root.querySelectorAll("img").length,
        };
      }
      if (kind === "table")
        return {
          cells: root.querySelectorAll(
            ".text-borders, .inserted-table [role=cell]",
          ).length,
          zeroes: texts.filter((t) => t.textContent === "0").length,
          images: root.querySelectorAll("img").length,
        };
      if (kind === "text") {
        const a = rangeBounds(plain("until min resolution reached")!),
          b = rangeBounds(plain("Question:")!);
        return {
          inside:
            a.bottom <= slide.bottom + 2 &&
            b.right <= slide.right + 2 &&
            b.bottom <= slide.bottom + 2,
          visible:
            getComputedStyle(plain("until min resolution reached")!)
              .overflow === "visible",
        };
      }
      const vertical = texts.filter(
        (t) => getComputedStyle(t).writingMode === "vertical-rl",
      );
      return {
        count: vertical.length,
        inside: vertical.every((t) => {
          const r = rangeBounds(t);
          return (
            r.left >= slide.left - 1 &&
            r.right <= slide.right + 1 &&
            r.bottom <= slide.bottom + 1
          );
        }),
        singleColumn: vertical.every(
          (t) => rangeBounds(t).width < 40 * (slide.width / 960),
        ),
      };
    }, item);
    if (item.kind === "footer") {
      expect(details.overlap).toBe(false);
      expect(details.images).toBeGreaterThan(0);
    }
    if (item.kind === "table") {
      expect(details.cells).toBeGreaterThanOrEqual(200);
      expect(details.zeroes).toBeGreaterThan(50);
      expect(details.images).toBeGreaterThanOrEqual(5);
    }
    if (item.kind === "text") {
      expect(details.inside).toBe(true);
      expect(details.visible).toBe(true);
    }
    if (item.kind === "vertical") {
      expect(details.count).toBe(4);
      expect(details.inside).toBe(true);
      expect(details.singleColumn).toBe(true);
    }
    if (
      item.kind === "mixed-lines" ||
      item.kind === "cell-height" ||
      item.kind === "edge-spacing"
    )
      expect(details.inside).toBe(true);
    if (item.kind === "cell-height") expect(details.cells).toBe(4);
    if (item.kind === "diagram") {
      expect(details.labels).toBe(true);
      expect(details.paths).toBeGreaterThan(5);
    }
    await canvas.screenshot({ path: testInfo.outputPath(`${item.kind}.png`) });
  });
