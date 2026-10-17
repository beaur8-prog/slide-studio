import { expect, test } from "@playwright/test";
import fs from "node:fs";

test.beforeEach(async ({ page }) => {
  await page.goto("http://127.0.0.1:5190");
});

test("numbering counts list items by level and respects explicit and inherited starts", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { readTextBody } = await import("/src/pptx-text.ts");
    const { blankDeck } = await import("/src/model.ts");
    const { exportPptx, importPptx, serializeDeck, parseDeckJson } =
      await import("/src/io.ts");
    const paragraph = (text: string, level = 0, properties = "") =>
      `<a:p><a:pPr lvl="${level}">${properties}</a:pPr><a:r><a:t>${text}</a:t></a:r></a:p>`;
    const xml = `<a:txBody xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:bodyPr/><a:lstStyle><a:lvl1pPr><a:buAutoNum type="arabicPeriod" startAt="3"/></a:lvl1pPr><a:lvl2pPr><a:buAutoNum type="arabicPeriod"/></a:lvl2pPr></a:lstStyle>${[
      paragraph("Heading", 0, "<a:buNone/>"),
      paragraph(""),
      paragraph("First"),
      paragraph("Nested", 1),
      paragraph(""),
      paragraph("Second"),
      paragraph("Nested again", 1),
      paragraph("Restart", 0, '<a:buAutoNum type="arabicPeriod" startAt="9"/>'),
      paragraph("Continued"),
    ].join("")}</a:txBody>`;
    const body = new DOMParser().parseFromString(
      xml,
      "text/xml",
    ).documentElement;
    const element = readTextBody(body, {
      nodes: [],
      font: (name: string) => name,
      defaultFont: "Arial",
      color: () => undefined,
      defaultColor: "#000000",
      sx: 1,
      sy: 1,
      geometry: { x: 0, y: 0, width: 600, height: 600, rotation: 0 },
    });
    const deck = blankDeck();
    deck.slides[0].elements = [element];
    return {
      text: element.text,
      json: parseDeckJson(serializeDeck(deck)).slides[0].elements[0].text,
      pptx: (await importPptx(await exportPptx(deck))).deck.slides[0]
        .elements[0].text,
    };
  });
  const expected =
    "Heading\n\n3. First\n1. Nested\n\n4. Second\n1. Nested again\n9. Restart\n10. Continued";
  expect(result).toEqual({ text: expected, json: expected, pptx: expected });
});

test("blank paragraphs and explicit blank lines retain their own full line advance", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { default: React } = await import(
      "/node_modules/.vite/deps/react.js"
    );
    const {
      default: { createRoot },
    } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { TextContent } = await import("/src/SlideCanvas.tsx");
    const run = (text: string, fontSize = 20) => ({
      text,
      fontSize,
      fontFamily: "Arial",
      fontFamilyEastAsian: "Malgun Gothic",
    });
    const paragraphs = [
      { runs: [run("A")] },
      { runs: [run("")] },
      { runs: [run("B\n\nC")] },
      { runs: [run("D"), run("\n\nE", 10)], lineHeight: 1.5 },
      { runs: [run("")], lineSpacing: 17 },
      { runs: [run("")], lineHeight: 1.8 },
    ];
    const host = document.createElement("div");
    host.style.cssText =
      "position:fixed;inset:0;font-family:Arial;background:white;z-index:9999";
    document.body.append(host);
    createRoot(host).render(
      React.createElement(TextContent, {
        element: { fontSize: 20, paragraphs },
      }),
    );
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r)),
    );
    await document.fonts.ready;
    return [...host.querySelectorAll("[data-text-paragraph]")].map((p) => ({
      text: p.textContent,
      height: p.getBoundingClientRect().height,
      lines: [...p.querySelectorAll("[data-text-line]")].map(
        (l) => l.getBoundingClientRect().height,
      ),
    }));
  });
  expect(result.map((p) => p.lines)).toEqual([
    [24],
    [24],
    [24, 24, 24],
    [30, 15, 15],
    [17],
    [36],
  ]);
  expect(result.map((p) => p.height)).toEqual([24, 24, 72, 60, 17, 36]);
  expect(result[1].text).toBe("");
  expect(result[4].text).toBe("");
});

test("default and percentage spacing honor autofit while fixed spacing survives export", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { readTextBody } = await import("/src/pptx-text.ts");
    const { blankDeck } = await import("/src/model.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const body = new DOMParser().parseFromString(
      `<a:txBody xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:bodyPr><a:normAutofit fontScale="80000" lnSpcReduction="10000"/></a:bodyPr>${["", '<a:lnSpc><a:spcPct val="150000"/></a:lnSpc>', '<a:lnSpc><a:spcPts val="1800"/></a:lnSpc>'].map((p) => `<a:p><a:pPr>${p}</a:pPr><a:endParaRPr sz="1500"/></a:p>`).join("")}</a:txBody>`,
      "text/xml",
    ).documentElement;
    const element = readTextBody(body, {
      nodes: [],
      font: (name: string) => name,
      defaultFont: "Arial",
      color: () => undefined,
      defaultColor: "#000000",
      sx: 1,
      sy: 1,
      geometry: { x: 0, y: 0, width: 300, height: 300, rotation: 0 },
    });
    const deck = blankDeck();
    deck.slides[0].elements = [element];
    return [
      element,
      (await importPptx(await exportPptx(deck))).deck.slides[0].elements[0],
    ].map((e) => e.paragraphs);
  });
  for (const paragraphs of result) {
    expect(paragraphs![0].lineHeight).toBeCloseTo(1.08);
    expect(paragraphs![1].lineHeight).toBeCloseTo(1.68);
    expect(paragraphs![2].lineSpacing).toBeCloseTo(19.2);
    expect(paragraphs![2].lineHeight).toBeUndefined();
    expect(paragraphs!.map((p) => p.runs[0].fontSize)).toEqual([16, 16, 16]);
  }
});

test("hanging list labels use the indent without adding a space and survive edits and round trips", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { default: React } = await import(
      "/node_modules/.vite/deps/react.js"
    );
    const {
      default: { createRoot },
    } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { ElementVisual } = await import("/src/SlideCanvas.tsx");
    const { blankDeck, element } = await import("/src/model.ts");
    const { paragraphBullet, editText } = await import("/src/text-layout.ts");
    const { exportPptx, importPptx, serializeDeck, parseDeckJson } =
      await import("/src/io.ts");
    const deck = blankDeck();
    const run = (text: string) => ({
      text,
      fontSize: 20,
      fontFamily: "Courier New",
    });
    deck.slides[0].elements = [
      element("text", {
        text: "1. Body\n2. Body",
        fontFamily: "Courier New",
        fontSize: 20,
        x: 0,
        y: 0,
        width: 500,
        height: 150,
        paragraphs: [18, 60].map((indent, index) => ({
          runs: [run(`${index + 1}. `), run("Body")],
          bulletPrefix: `${index + 1}. `,
          marginLeft: indent,
          indent: -indent,
          lineHeight: 1.2,
        })),
      }),
    ];
    const json = parseDeckJson(serializeDeck(deck));
    const roundTrip = (await importPptx(await exportPptx(json))).deck;
    const metrics = [];
    for (const el of [
      json.slides[0].elements[0],
      roundTrip.slides[0].elements[0],
    ]) {
      const host = document.createElement("div");
      host.style.cssText =
        "position:fixed;inset:0;z-index:9999;background:white;width:500px;height:150px";
      document.body.append(host);
      const root = createRoot(host);
      root.render(React.createElement(ElementVisual, { element: el }));
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      );
      await document.fonts.ready;
      metrics.push(
        [...host.querySelectorAll("[data-text-line]")].map((line) => {
          const marker = line.querySelector("[data-bullet]")!;
          const body = marker.nextElementSibling!;
          return {
            bodyOffset:
              body.getBoundingClientRect().x - marker.getBoundingClientRect().x,
            height: line.getBoundingClientRect().height,
          };
        }),
      );
      root.unmount();
      host.remove();
    }
    const edited = editText(json.slides[0].elements[0], "1. Changed\n2. Body");
    const removed = editText(json.slides[0].elements[0], "Body\n2. Body");
    const invalid = JSON.parse(serializeDeck(deck));
    invalid.slides[0].elements[0].paragraphs[0].bulletPrefix = 12;
    let rejected = false;
    try {
      parseDeckJson(JSON.stringify(invalid));
    } catch {
      rejected = true;
    }
    return {
      metrics,
      text: roundTrip.slides[0].elements[0].text,
      labels: roundTrip.slides[0].elements[0].paragraphs!.map(
        (p) => p.bulletPrefix,
      ),
      edited: paragraphBullet(edited.paragraphs![0])
        ?.runs.map((r) => r.text)
        .join(""),
      removed: paragraphBullet(removed.paragraphs![0]) ?? null,
      rejected,
    };
  });
  for (const metrics of result.metrics) {
    expect(metrics[0].bodyOffset).toBeCloseTo(24, 0);
    expect(metrics[1].bodyOffset).toBeCloseTo(60, 1);
    expect(metrics.map((m) => m.height)).toEqual([24, 24]);
  }
  expect(result.text).toBe("1. Body\n2. Body");
  expect(result.labels).toEqual(["1. ", "2. "]);
  expect(result.edited).toBe("Changed");
  expect(result.removed).toBeNull();
  expect(result.rejected).toBe(true);
});

test("public samples match measured PowerPoint paragraph advances", async ({
  page,
}) => {
  test.skip(
    !fs.existsSync("qa/samples/cmu-lecture-4.pptx") ||
      !fs.existsSync("qa/samples/dsu-korean.pptx"),
    "Download the documented public QA samples first",
  );
  test.setTimeout(90000);
  const results = await page.evaluate(async () => {
    const { importPptx } = await import("/src/io.ts");
    const { default: React } = await import(
      "/node_modules/.vite/deps/react.js"
    );
    const {
      default: { createRoot },
    } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { ElementVisual } = await import("/src/SlideCanvas.tsx");
    const results = [];
    for (const [filename, index, marker] of [
      ["cmu-lecture-4.pptx", 48, "Algorithm:"],
      ["dsu-korean.pptx", 6, "오리엔테이션"],
    ] as const) {
      const { deck } = await importPptx(
        await (await fetch(`/qa/samples/${filename}`)).arrayBuffer(),
      );
      const element = deck.slides[index].elements.find((e) =>
        e.text?.includes(marker),
      )!;
      const host = document.createElement("div");
      host.style.cssText = `position:fixed;left:0;top:0;width:${element.width}px;white-space:pre-wrap;z-index:9999;background:white`;
      document.body.append(host);
      const root = createRoot(host);
      root.render(React.createElement(ElementVisual, { element }));
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      );
      await document.fonts.ready;
      results.push(
        [...host.querySelectorAll("[data-text-paragraph]")].map((p) => ({
          text: p.textContent,
          y: p.getBoundingClientRect().y,
          height: p.getBoundingClientRect().height,
        })),
      );
      root.unmount();
      host.remove();
    }
    return results;
  });
  const numbered = results[0].filter((p) => /^\d+\./.test(p.text ?? ""));
  expect(numbered.map((p) => p.text!.match(/^\d+/)![0])).toEqual([
    "1",
    "2",
    "3",
    "4",
    "5",
  ]);
  // Native PDF: 67.2 pt = 89.6 CSS px; allow subpixel rounding only.
  for (let i = 1; i < 4; i++)
    expect(Math.abs(numbered[i].y - numbered[i - 1].y - 89.6)).toBeLessThan(
      0.1,
    );
  // DSU slide 7: native 16 pt Korean body advances 19.2 pt = 25.6 px.
  const orientation = results[1].findIndex((p) =>
    p.text?.includes("오리엔테이션"),
  );
  expect(orientation).toBeGreaterThanOrEqual(0);
  expect(Math.abs(results[1][orientation].height - 25.6)).toBeLessThan(0.1);
});
