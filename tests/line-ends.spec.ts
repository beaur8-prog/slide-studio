import { test, expect } from "@playwright/test";

test("DrawingML line decorations keep both endpoints, sizes and flipped direction", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { exportPptx, importPptx, serializeDeck, parseDeckJson } =
      await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const deck = blankDeck();
    deck.slides[0].elements = [];
    const zip = await JSZip.loadAsync(await exportPptx(deck));
    const pairs = [
      ["oval", "oval"],
      ["triangle", "none"],
      ["diamond", "stealth"],
      ["arrow", "triangle"],
    ];
    const shapes = pairs
      .map(
        ([start, end], i) =>
          `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${10 + i}" name="line-${i}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm ${i === 1 ? 'flipH="1"' : ""}><a:off x="952500" y="${(100 + i * 90) * 9525}"/><a:ext cx="2857500" cy="0"/></a:xfrm><a:prstGeom prst="line"/><a:ln w="12700"><a:solidFill><a:srgbClr val="334455"/></a:solidFill><a:headEnd type="${start}" w="sm" len="lg"/><a:tailEnd type="${end}"/></a:ln></p:spPr></p:cxnSp>`,
      )
      .join("");
    const name = "ppt/slides/slide1.xml";
    zip.file(
      name,
      (await zip.file(name)!.async("string")).replace(
        "</p:spTree>",
        shapes + "</p:spTree>",
      ),
    );
    const imported = await importPptx(
      await zip.generateAsync({ type: "uint8array" }),
    );
    const restored = parseDeckJson(serializeDeck(imported.deck));
    const roundTrip = (await importPptx(await exportPptx(restored))).deck;
    const markers = (d: typeof deck) =>
      d.slides[0].elements.map((e) => ({
        start: e.lineStart,
        end: e.lineEnd,
        rotation: e.rotation,
      }));
    return {
      markers: markers(restored),
      roundTrip: markers(roundTrip),
      warnings: imported.warnings,
    };
  });
  expect(result.markers).toEqual(result.roundTrip);
  expect(result.markers[0]).toMatchObject({
    start: { type: "oval", width: "sm", length: "lg" },
    end: { type: "oval", width: "med", length: "med" },
  });
  expect(result.markers[1]).toMatchObject({
    rotation: 180,
    start: { type: "triangle" },
    end: { type: "none" },
  });
  expect(result.markers[2]).toMatchObject({
    start: { type: "diamond" },
    end: { type: "stealth" },
  });
  expect(result.warnings.some((w) => w.includes("시작점 화살표"))).toBe(false);
});

test("line renderer draws centered ovals at both ends and validates marker input", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const {
      default: { createElement },
    } = await import("/node_modules/.vite/deps/react.js");
    const {
      default: { createRoot },
    } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { LineShape } = await import("/src/LineShape.tsx");
    const { blankDeck, element } = await import("/src/model.ts");
    const { parseDeckJson } = await import("/src/io.ts");
    const marker = { type: "oval", width: "med", length: "med" } as const;
    const line = element("shape", {
      shape: "arrow",
      width: 300,
      height: 1,
      strokeWidth: 1,
      lineStart: marker,
      lineEnd: marker,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    root.render(createElement(LineShape, { element: line }));
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const ellipses = Array.from(host.querySelectorAll("ellipse")).map((n) => ({
      rx: n.getAttribute("rx"),
      ry: n.getAttribute("ry"),
      transform: n.parentElement!.getAttribute("transform"),
    }));
    const deck = blankDeck();
    const invalid = [
      null,
      {},
      { type: "script", width: "med", length: "med" },
      { ...marker, width: 4 },
    ].map((value) => {
      deck.slides[0].elements = [{ ...line, lineStart: value } as any];
      try {
        parseDeckJson(JSON.stringify(deck));
        return false;
      } catch {
        return true;
      }
    });
    root.unmount();
    host.remove();
    return { ellipses, invalid };
  });
  expect(result.ellipses).toEqual([
    { rx: "4", ry: "4", transform: "translate(0,0.5) rotate(180)" },
    { rx: "4", ry: "4", transform: "translate(300,0.5) rotate(0)" },
  ]);
  expect(result.invalid).toEqual([true, true, true, true]);
});
