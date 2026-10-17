import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

test("script fonts, tracking, kerning, language and paragraph breaks survive editing and round trips", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { exportPptx, importPptx, serializeDeck, parseDeckJson } =
      await import("/src/io.ts");
    const { scriptRuns, patchText, scaleElement } = await import(
      "/src/text-layout.ts"
    );
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const deck = blankDeck();
    deck.slides[0].elements = [];
    const zip = await JSZip.loadAsync(await exportPptx(deck));
    const shape = `<p:sp><p:nvSpPr><p:cNvPr id="77" name="Mixed fonts"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="952500" y="952500"/><a:ext cx="5715000" cy="1905000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr lIns="0" rIns="0" tIns="0" bIns="0"/><a:lstStyle><a:lvl1pPr><a:defRPr><a:ea typeface="나눔바른고딕"/></a:defRPr></a:lvl1pPr></a:lstStyle><a:p><a:pPr defTabSz="457200" latinLnBrk="0" eaLnBrk="1"/><a:r><a:rPr sz="2400" spc="-100" kern="1200" lang="ko-KR"><a:latin typeface="Arial"/></a:rPr><a:t>Hello 한글 123</a:t></a:r><a:br/><a:r><a:rPr sz="2400"/><a:t>둘째 줄</a:t></a:r></a:p></p:txBody></p:sp>`;
    const file = "ppt/slides/slide1.xml";
    zip.file(
      file,
      (await zip.file(file).async("string")).replace(
        "</p:spTree>",
        shape + "</p:spTree>",
      ),
    );
    const imported = (
      await importPptx(await zip.generateAsync({ type: "uint8array" }))
    ).deck;
    const el = imported.slides[0].elements[0];
    const roundTrip = (await importPptx(await exportPptx(imported))).deck
      .slides[0].elements[0];
    const saved = parseDeckJson(serializeDeck(imported)).slides[0].elements[0];
    return {
      el,
      roundTrip,
      saved,
      segments: scriptRuns(el.paragraphs[0].runs[0]),
      changed: patchText(el, { fontFamily: "Georgia" }),
      scaled: scaleElement(el, 2, 2),
    };
  });
  const run = result.el.paragraphs[0].runs[0];
  expect(run).toMatchObject({
    text: "Hello 한글 123",
    fontFamily: "Arial",
    fontFamilyEastAsian: "나눔바른고딕",
    fontSize: 32,
    language: "ko-KR",
    kerning: 16,
  });
  expect(run.letterSpacing).toBeCloseTo(-4 / 3);
  expect(result.el.paragraphs[0]).toMatchObject({
    tabSize: 48,
    latinLineBreak: false,
    eastAsianLineBreak: true,
  });
  expect(result.segments.map((r: any) => [r.text, r.fontFamily])).toEqual([
    ["Hello ", "Arial"],
    ["한글", "나눔바른고딕"],
    [" 123", "Arial"],
  ]);
  expect(result.saved.paragraphs).toEqual(result.el.paragraphs);
  expect(result.roundTrip.paragraphs[0].runs[0]).toMatchObject(run);
  expect(result.roundTrip.text).toBe(result.el.text);
  expect(result.changed.paragraphs[0].runs[0].fontFamilyEastAsian).toBe(
    "Georgia",
  );
  expect(result.scaled.paragraphs[0].runs[0].letterSpacing).toBeCloseTo(-8 / 3);
  expect(result.scaled.paragraphs[0].runs[0].kerning).toBe(32);
  expect(result.scaled.paragraphs[0].tabSize).toBe(96);
});

test("mixed-script DOM uses the bundled Korean face and respects character spacing and kerning", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { default: React } = await import(
      "/node_modules/.vite/deps/react.js"
    );
    const {
      default: { createRoot },
    } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { ElementVisual } = await import("/src/SlideCanvas.tsx");
    const { element } = await import("/src/model.ts");
    const root = document.createElement("div");
    root.id = "font-render";
    document.body.append(root);
    const mixed = element("text", {
      text: "Hello 한글",
      fontFamily: "Arial",
      fontSize: 32,
      width: 400,
      height: 80,
      paragraphs: [
        {
          runs: [
            {
              text: "Hello 한글",
              fontFamily: "Arial",
              fontFamilyEastAsian: "나눔바른고딕",
              fontSize: 32,
              letterSpacing: -1,
              kerning: 16,
              language: "ko-KR",
            },
          ],
        },
      ],
    });
    createRoot(root).render(
      React.createElement(ElementVisual, { element: mixed }),
    );
    await new Promise((r) => setTimeout(r, 100));
    await document.fonts.ready;
    return [...root.querySelectorAll("span")].map((n) => ({
      text: n.textContent,
      font: getComputedStyle(n).fontFamily,
      tracking: getComputedStyle(n).letterSpacing,
      kerning: getComputedStyle(n).fontKerning,
    }));
  });
  expect(result[0]).toMatchObject({
    text: "Hello ",
    tracking: "-1px",
    kerning: "normal",
  });
  expect(result[0].font).toContain("Arial");
  expect(result[1].font).toContain("Slide Studio Nanum Barun Gothic");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument");
  const { nodeId } = await cdp.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: "#font-render span:last-child",
  });
  const actual = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
  expect(
    actual.fonts.some((f: any) => /NanumBarunGothic/.test(f.postScriptName)),
  ).toBeTruthy();
});

test("Calibri Light fallback keeps the original algorithm line and measured width", async ({
  page,
}, testInfo) => {
  const file = path.resolve("qa/samples/cmu-lecture-3.pptx");
  test.skip(!fs.existsSync(file), "Public QA corpus not downloaded");
  await page.goto("http://127.0.0.1:5190");
  const metrics = await page.evaluate(async () => {
    const { default: React } = await import(
      "/node_modules/.vite/deps/react.js"
    );
    const {
      default: { createRoot },
    } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { SlideVisual } = await import("/src/SlideCanvas.tsx");
    const { importPptx } = await import("/src/io.ts");
    const { deck } = await importPptx(
      await (await fetch("/qa/samples/cmu-lecture-3.pptx")).arrayBuffer(),
    );
    const root = document.createElement("div");
    root.id = "font-regression";
    root.style.cssText =
      "position:fixed;inset:0;z-index:9999;background:white;";
    document.body.append(root);
    createRoot(root).render(
      React.createElement(SlideVisual, {
        slide: deck.slides[33],
        width: deck.width,
        height: deck.height,
      }),
    );
    await new Promise((r) => setTimeout(r, 100));
    await document.fonts.ready;
    const span = [...root.querySelectorAll("span")].find(
      (n) => n.textContent === "until min resolution reached",
    );
    const range = document.createRange();
    range.selectNodeContents(span);
    const rects = [...range.getClientRects()];
    return {
      labelSizes: deck.slides[33].elements.filter(e => e.text === "filter" || e.text === "sample").map(e => e.fontSize),
      lines: rects.length,
      width: rects[0].width,
      box: span.closest(".element-text").getBoundingClientRect().width,
    };
  });
  expect(metrics.lines).toBe(1);
  expect(metrics.labelSizes).toHaveLength(6);
  for (const size of metrics.labelSizes) expect(size).toBeCloseTo(20 / 0.75);
  // Original PDF: (303.89208 - 77.4) points, at 96 CSS px per inch.
  expect(Math.abs(metrics.width - (303.89208 - 77.4) / 0.75)).toBeLessThan(1.5);
  expect(metrics.width).toBeLessThanOrEqual(metrics.box);
  await page
    .locator("#font-regression .slide-visual")
    .screenshot({ path: testInfo.outputPath("font-cmu3-slide34.png") });
});

test("font measurements reject malformed project values", async ({ page }) => {
  await page.goto("http://127.0.0.1:5190");
  const rejected = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { parseDeckJson } = await import("/src/io.ts");
    return [
      { letterSpacing: 1e9 },
      { kerning: -1 },
      { fontFamilyEastAsian: 42 },
      { language: 42 },
    ].map((patch) => {
      const deck = blankDeck();
      deck.slides[0].elements = [
        element("text", {
          text: "한글",
          paragraphs: [{ runs: [{ text: "한글", ...patch }] }],
        }),
      ];
      try {
        parseDeckJson(JSON.stringify(deck));
        return false;
      } catch {
        return true;
      }
    });
  });
  expect(rejected).toEqual([true, true, true, true]);
});

test("Latin word-break setting does not disable wrapping long Korean words", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const lines = await page.evaluate(async () => {
    const { default: React } = await import(
      "/node_modules/.vite/deps/react.js"
    );
    const {
      default: { createRoot },
    } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { ElementVisual } = await import("/src/SlideCanvas.tsx");
    const { element } = await import("/src/model.ts");
    const results = [];
    for (const [text, latinLineBreak] of [
      ["ABCDEFGHIJK", false],
      ["ABCDEFGHIJK", true],
      ["한글입력줄바꿈검증", false],
    ] as const) {
      const root = document.createElement("div");
      root.style.width = "80px";
      document.body.append(root);
      createRoot(root).render(
        React.createElement(ElementVisual, {
          element: element("text", {
            text,
            fontFamily: "Arial",
            fontSize: 24,
            paragraphs: [
              {
                latinLineBreak,
                runs: [
                  {
                    text,
                    fontFamily: "Arial",
                    fontFamilyEastAsian: "나눔바른고딕",
                    fontSize: 24,
                  },
                ],
              },
            ],
          }),
        }),
      );
      await new Promise((r) => setTimeout(r, 30));
      await document.fonts.ready;
      const range = document.createRange();
      range.selectNodeContents(root.querySelector("span"));
      results.push(range.getClientRects().length);
    }
    return results;
  });
  expect(lines[0]).toBe(1);
  expect(lines[1]).toBeGreaterThan(1);
  expect(lines[2]).toBeGreaterThan(1);
});
