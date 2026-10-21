import { expect, test } from "@playwright/test";
import sharp from "sharp";

test("zero-size native shapes retain their geometry, paths and outlines through PPTX saving", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { exportPptx, importPptx, serializeDeck } = await import(
      "/src/io.ts"
    );
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const deck = blankDeck();
    deck.slides[0].elements = [];
    const zip = await JSZip.loadAsync(await exportPptx(deck));
    const custom = (w: number, h: number, dimension: string) =>
      `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="l" t="t" r="r" b="b"/><a:pathLst><a:path ${dimension} fill="none"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="${w}" y="${h}"/></a:lnTo></a:path></a:pathLst></a:custGeom>`;
    const fixtures = [
      { w: 180, h: 0, geometry: custom(180 * 9525, 0, `w="${180 * 9525}"`) },
      {
        w: 0,
        h: 140,
        geometry: custom(0, 140 * 9525, `w="0" h="${140 * 9525}"`),
      },
      {
        w: 120,
        h: 0,
        geometry: '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>',
      },
      {
        w: 0,
        h: 0,
        geometry: '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>',
      },
      {
        w: 150,
        h: 100,
        geometry: '<a:prstGeom prst="triangle"><a:avLst/></a:prstGeom>',
      },
    ];
    const shapes = fixtures
      .map(
        (f, i) =>
          `<p:sp><p:nvSpPr><p:cNvPr id="${i + 2}" name="zero-${i}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm rot="900000"><a:off x="${(40 + i * 200) * 9525}" y="${80 * 9525}"/><a:ext cx="${f.w * 9525}" cy="${f.h * 9525}"/></a:xfrm>${f.geometry}<a:noFill/>${i === 2 ? '<a:ln w="0"><a:noFill/></a:ln>' : '<a:ln w="28575" cap="rnd"><a:solidFill><a:srgbClr val="EFB21D"/></a:solidFill><a:prstDash val="dash"/></a:ln>'}</p:spPr></p:sp>`,
      )
      .join("");
    const path = "ppt/slides/slide1.xml";
    zip.file(
      path,
      (await zip.file(path)!.async("string")).replace(
        "</p:spTree>",
        shapes + "</p:spTree>",
      ),
    );
    const first = await importPptx(
      await zip.generateAsync({ type: "uint8array" }),
    );
    const snapshot = (d: typeof first.deck) =>
      d.slides[0].elements.map(
        ({
          x,
          y,
          width,
          height,
          rotation,
          shape,
          paths,
          stroke,
          strokeWidth,
          strokeDash,
          strokeCap,
        }) => ({
          x,
          y,
          width,
          height,
          rotation,
          shape,
          paths,
          stroke,
          strokeWidth,
          strokeDash,
          strokeCap: strokeCap ?? "butt",
        }),
      );
    const rounds = [snapshot(first.deck)];
    let current = first.deck;
    for (let i = 0; i < 3; i++) {
      serializeDeck(current);
      current = (await importPptx(await exportPptx(current))).deck;
      rounds.push(snapshot(current));
    }
    return { rounds, warnings: first.warnings };
  });
  expect(result.warnings).not.toContain(
    "지원하지 않는 도형·자유형 경로는 사각형 또는 선으로 단순화됩니다.",
  );
  expect(result.rounds[0].map((e) => [e.width, e.height])).toEqual([
    [180, 0],
    [0, 140],
    [120, 0],
    [0, 0],
    [150, 100],
  ]);
  expect(result.rounds[0][0]).toMatchObject({
    shape: "custom",
    paths: [
      {
        width: 180 * 9525,
        height: 1,
        d: `M 0 0 L ${180 * 9525} 0`,
        fill: false,
        stroke: true,
      },
    ],
    stroke: "#EFB21D",
    strokeWidth: 3,
    strokeCap: "round",
  });
  expect(result.rounds[0][1].paths?.[0].width).toBe(1);
  expect(result.rounds[0][2]).toMatchObject({
    stroke: "transparent",
    strokeWidth: 0,
  });
  for (const round of result.rounds.slice(1))
    expect(round).toEqual(result.rounds[0]);
});

test("zero-size shapes can be stored without weakening other geometry validation", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { parseDeckJson, serializeDeck } = await import("/src/io.ts");
    const { trianglePoints, moveTrianglePoint } = await import(
      "/src/shape-points.ts"
    );
    const attempt = (item: any) => {
      const deck = blankDeck();
      deck.slides[0].elements = [item];
      try {
        parseDeckJson(JSON.stringify(deck));
        return "ok";
      } catch (error) {
        return (error as Error).message;
      }
    };
    const shape = element("shape", {
      shape: "triangle",
      width: 0,
      height: 100,
    });
    const deck = blankDeck();
    deck.slides[0].elements = [shape];
    return {
      stored: parseDeckJson(serializeDeck(deck)).slides[0].elements[0],
      handles: trianglePoints(shape),
      moved: moveTrianglePoint(shape, 0, 30, 20),
      negative: attempt({ ...shape, width: -1 }),
      text: attempt(
        element("text", { width: 100, height: 0, text: "유효성 검사" }),
      ),
      path: attempt({
        ...shape,
        shape: "custom",
        paths: [
          { d: "M 0 0 L 1 1", width: 0, height: 1, fill: false, stroke: true },
        ],
      }),
    };
  });
  expect(result.stored).toMatchObject({
    shape: "triangle",
    width: 0,
    height: 100,
  });
  expect(result.handles).toBeUndefined();
  expect(result.moved.width).toBe(0);
  expect(result.moved.paths).toBeUndefined();
  expect(result.negative).not.toBe("ok");
  expect(result.text).toContain("너비와 높이는 0보다 커야 합니다");
  expect(result.path).not.toBe("ok");
});

test("collapsed outlines render visibly while fill-only objects stay invisible", async ({
  page,
}, info) => {
  await page.goto("http://127.0.0.1:5190");
  await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { default: React } = await import(
      "/node_modules/.vite/deps/react.js"
    );
    const {
      default: { createRoot },
    } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { SlideVisual } = await import("/src/SlideCanvas.tsx");
    const deck = blankDeck();
    const slide = deck.slides[0];
    slide.background = "#FFFFFF";
    const line = {
      type: "triangle" as const,
      length: "med" as const,
      width: "med" as const,
    };
    slide.elements = [
      element("shape", {
        x: 30,
        y: 30,
        width: 180,
        height: 0,
        shape: "custom",
        fill: "transparent",
        stroke: "#EFB21D",
        strokeWidth: 4,
        paths: [
          {
            d: "M 0 0 L 180 0",
            width: 180,
            height: 1,
            fill: false,
            stroke: true,
          },
        ],
        lineEnd: line,
      }),
      element("shape", {
        x: 40,
        y: 70,
        width: 0,
        height: 140,
        fill: "transparent",
        stroke: "#1255AA",
        strokeWidth: 4,
        strokeDash: [8, 4],
        strokeCap: "round",
      }),
      element("shape", {
        x: 90,
        y: 100,
        width: 150,
        height: 0,
        fill: "#FF0000",
        stroke: "transparent",
        strokeWidth: 0,
      }),
      element("shape", {
        x: 90,
        y: 150,
        width: 0,
        height: 0,
        shape: "ellipse",
        strokeWidth: 0,
      }),
    ];
    const host = document.createElement("div");
    host.id = "zero-shape-fixture";
    Object.assign(host.style, {
      position: "fixed",
      inset: "0 auto auto 0",
      width: "300px",
      height: "250px",
      background: "white",
      zIndex: "9999",
    });
    document.body.append(host);
    createRoot(host).render(
      React.createElement(SlideVisual, { slide, width: 300, height: 250 }),
    );
  });
  const fixture = page.locator("#zero-shape-fixture");
  await expect(fixture.locator("svg")).toHaveCount(4);
  expect(await fixture.innerHTML()).not.toMatch(/NaN|Infinity/);
  for (const box of await fixture
    .locator("svg")
    .evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("viewBox")!.split(" ").map(Number)),
    )) {
    expect(box[2]).toBeGreaterThan(0);
    expect(box[3]).toBeGreaterThan(0);
  }
  const image = await fixture.screenshot({
    path: info.outputPath("collapsed-shapes.png"),
  });
  const { data, info: raw } = await sharp(image)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = (match: (r: number, g: number, b: number) => boolean) => {
    let count = 0;
    for (let i = 0; i < data.length; i += raw.channels)
      if (match(data[i], data[i + 1], data[i + 2])) count++;
    return count;
  };
  expect(
    pixels((r, g, b) => r > 220 && g > 140 && g < 200 && b < 80),
  ).toBeGreaterThan(500);
  expect(
    pixels((r, g, b) => r < 40 && g > 60 && g < 120 && b > 140),
  ).toBeGreaterThan(250);
  expect(pixels((r, g, b) => r > 200 && g < 50 && b < 50)).toBe(0);
});
