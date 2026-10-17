import { expect, test } from "@playwright/test";
import fs from "node:fs";

test.beforeEach(async ({ page }) => {
  await page.goto("http://127.0.0.1:5190");
});

test("bullet size, font, and color inherit independently without changing body metrics", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { readTextBody } = await import("/src/pptx-text.ts");
    const { blankDeck } = await import("/src/model.ts");
    const { exportPptx, importPptx, serializeDeck, parseDeckJson } =
      await import("/src/io.ts");
    const { default: React } = await import(
      "/node_modules/.vite/deps/react.js"
    );
    const {
      default: { createRoot },
    } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { ElementVisual } = await import("/src/SlideCanvas.tsx");
    const body = new DOMParser().parseFromString(
      `<a:txBody xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:bodyPr/><a:lstStyle><a:lvl1pPr marL="228600" indent="-228600"><a:buClr><a:srgbClr val="CC0000"/></a:buClr><a:buSzPct val="75000"/><a:buFont typeface="Courier New"/><a:buChar char="•"/><a:defRPr sz="2400"><a:latin typeface="Arial"/></a:defRPr></a:lvl1pPr></a:lstStyle>${["", '<a:buSzPts val="900"/>', "<a:buClrTx/><a:buSzTx/><a:buFontTx/>"].map((props, i) => `<a:p><a:pPr>${props}</a:pPr><a:r><a:t>Body ${i}</a:t></a:r></a:p>`).join("")}</a:txBody>`,
      "text/xml",
    ).documentElement;
    const element = readTextBody(body, {
      nodes: [],
      font: (name: string) => name,
      defaultFont: "Arial",
      color: (node: Element | undefined) => {
        const color = node
          ?.getElementsByTagNameNS("*", "srgbClr")[0]
          ?.getAttribute("val");
        return color ? { color: `#${color}`, opacity: 1 } : undefined;
      },
      defaultColor: "#000000",
      sx: 1,
      sy: 1,
      geometry: { x: 0, y: 0, width: 500, height: 200, rotation: 0 },
    });
    const deck = blankDeck();
    deck.slides[0].elements = [element];
    const json = parseDeckJson(serializeDeck(deck));
    const roundTrip = (await importPptx(await exportPptx(json))).deck;
    const models = [
      element,
      json.slides[0].elements[0],
      roundTrip.slides[0].elements[0],
    ];
    const metrics = [];
    for (const el of [models[0], models[2]]) {
      const host = document.createElement("div");
      host.style.cssText =
        "position:fixed;inset:0;width:500px;height:200px;background:white;z-index:9999";
      document.body.append(host);
      const root = createRoot(host);
      root.render(React.createElement(ElementVisual, { element: el }));
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      );
      await document.fonts.ready;
      metrics.push(
        [...host.querySelectorAll("[data-text-line]")].map((line) => ({
          height: line.getBoundingClientRect().height,
          markerSize: getComputedStyle(line.querySelector("[data-bullet]")!)
            .fontSize,
          bodySize: getComputedStyle(
            line.querySelector("[data-bullet]")!.nextElementSibling!,
          ).fontSize,
        })),
      );
      root.unmount();
      host.remove();
    }
    return {
      metrics,
      models: models.map((e) => ({
        fontSize: e.fontSize,
        fontFamily: e.fontFamily,
        paragraphs: e.paragraphs!.map((p) => ({
          fontSize: p.fontSize,
          marker: p.runs[0],
          body: p.runs[1],
        })),
      })),
    };
  });
  for (const model of result.models) {
    expect(model.fontSize).toBe(32);
    expect(model.fontFamily).toBe("Arial");
    expect(model.paragraphs.map((p) => p.fontSize)).toEqual([32, 32, 32]);
    expect(model.paragraphs.map((p) => p.marker.fontSize)).toEqual([
      24, 12, 32,
    ]);
    expect(model.paragraphs.map((p) => p.marker.fontFamily)).toEqual([
      "Courier New",
      "Courier New",
      "Arial",
    ]);
    expect(model.paragraphs.map((p) => p.marker.color)).toEqual([
      "#CC0000",
      "#CC0000",
      "#000000",
    ]);
    expect(model.paragraphs.map((p) => p.body.fontSize)).toEqual([32, 32, 32]);
  }
  for (const metrics of result.metrics) {
    expect(metrics.map((m) => m.markerSize)).toEqual(["24px", "12px", "32px"]);
    expect(metrics.map((m) => m.bodySize)).toEqual(["32px", "32px", "32px"]);
    // Different marker faces can contribute a slightly different baseline;
    // the body still determines the 32px single-line advance.
    for (const m of metrics) {
      expect(m.height).toBeGreaterThanOrEqual(38.3);
      expect(m.height).toBeLessThan(39.5);
    }
  }
  expect(result.metrics[1]).toEqual(result.metrics[0]);
});

test("CMU lecture 1 slide 55 keeps the native 27pt bullet and 36pt body", async ({
  page,
}) => {
  const path = "qa/samples/cmu-lecture-1.pptx";
  test.skip(!fs.existsSync(path), "Optional public corpus not downloaded");
  test.setTimeout(90000);
  const result = await page.evaluate(async () => {
    const { importPptx, exportPptx } = await import("/src/io.ts");
    const { deck } = await importPptx(
      await (await fetch("/qa/samples/cmu-lecture-1.pptx")).arrayBuffer(),
    );
    deck.slides = [deck.slides[54]];
    const collect = (d: typeof deck) =>
      d.slides[0].elements.flatMap(
        (e) =>
          e.paragraphs
            ?.filter((p) => p.bulletPrefix)
            .map((p) => ({
              marker: p.runs[0].fontSize,
              body: p.runs[1]?.fontSize,
              paragraph: p.fontSize,
            })) ?? [],
      );
    return [
      collect(deck),
      collect((await importPptx(await exportPptx(deck))).deck),
    ];
  });
  expect(result[0].length).toBeGreaterThan(0);
  for (const paragraphs of result)
    for (const p of paragraphs)
      expect(p).toEqual({ marker: 36, body: 48, paragraph: 48 });
});
