import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";

test("all 187 DrawingML presets retain geometry at three aspect ratios and through three PPTX round trips", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { importPptx, exportPptx, serializeDeck } = await import(
      "/src/io.ts"
    );
    const { presetNames } = await import("/src/drawing-presets.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const names = presetNames();
    const cases = [
      [150, 150],
      [180, 70],
      [70, 180],
    ].flatMap(([width, height]) =>
      names.map((name) => ({ name, width, height })),
    );
    const deck = blankDeck();
    deck.width = 1280;
    deck.height = 960;
    deck.slides = Array.from(
      { length: Math.ceil(cases.length / 24) },
      (_, i) => ({
        ...deck.slides[0],
        id: `s${i}`,
        elements: [],
        background: "#FFFFFF",
      }),
    );
    const zip = await JSZip.loadAsync(await exportPptx(deck));
    for (let slide = 0; slide < deck.slides.length; slide++) {
      const shapes = cases
        .slice(slide * 24, (slide + 1) * 24)
        .map(
          ({ name, width, height }, i) =>
            `<p:sp><p:nvSpPr><p:cNvPr id="${i + 2}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${(20 + (i % 6) * 210) * 9525}" y="${(25 + Math.floor(i / 6) * 235) * 9525}"/><a:ext cx="${width * 9525}" cy="${height * 9525}"/></a:xfrm><a:prstGeom prst="${name}"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="4080C0"/></a:solidFill><a:ln w="19050"><a:solidFill><a:srgbClr val="15283A"/></a:solidFill></a:ln></p:spPr></p:sp>`,
        )
        .join("");
      const path = `ppt/slides/slide${slide + 1}.xml`;
      zip.file(
        path,
        (await zip.file(path)!.async("string")).replace(
          "</p:spTree>",
          shapes + "</p:spTree>",
        ),
      );
    }
    const source = await zip.generateAsync({ type: "uint8array" });
    const first = await importPptx(source);
    const firstJson = serializeDeck(first.deck);
    // Compare rasterized curves rather than arc-length samples: disjoint
    // subpaths can switch at a boundary after harmless EMU rounding.
    const sample = (el: any) =>
      (el.paths ?? []).map((path: any) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 256;
        const context = canvas.getContext("2d")!;
        context.scale(256 / path.width, 256 / path.height);
        const curve = new Path2D(path.d);
        if (path.fill) context.fill(curve);
        if (path.stroke) {
          context.lineWidth = path.width / 128;
          context.stroke(curve);
        }
        return {
          pixels: context.getImageData(0, 0, 256, 256).data,
          fill: path.fill,
          stroke: path.stroke,
          fillMode: path.fillMode,
        };
      });
    const baseline = first.deck.slides.flatMap((s) => s.elements).map(sample);
    let current = first.deck;
    const warnings = [...first.warnings];
    const failures: string[] = [];
    for (let round = 0; round < 3; round++) {
      const next = await importPptx(await exportPptx(current));
      current = next.deck;
      warnings.push(...next.warnings);
      const elements = current.slides.flatMap((s) => s.elements);
      if (elements.length !== cases.length)
        failures.push(`count ${round}: ${elements.length}`);
      elements.forEach((el, i) => {
        const actual = sample(el),
          expected = baseline[i];
        if (actual.length !== expected.length)
          failures.push(`${i} ${cases[i].name} path count`);
        actual.forEach((p: any, j: number) => {
          if (
            !expected[j] ||
            p.fill !== expected[j].fill ||
            p.stroke !== expected[j].stroke ||
            p.fillMode !== expected[j].fillMode
          )
            failures.push(`${i} ${cases[i].name} path style`);
          let changed = 0;
          for (let k = 3; k < p.pixels.length; k += 4)
            if (Math.abs(p.pixels[k] - expected[j].pixels[k]) > 64) changed++;
          if (changed / 65536 > 0.001)
            failures.push(
              `${i} ${cases[i].name} round ${round} changed pixels ${changed}`,
            );
        });
      });
    }
    return {
      count: names.length,
      elements: cases.length,
      warnings: [...new Set(warnings)],
      failures,
      source: Array.from(source),
      firstJson,
      native: first.deck.slides
        .flatMap((s) => s.elements)
        .filter((e) => e.shape !== "custom")
        .map((e) => e.shape),
    };
  });
  await fs.mkdir("qa/results/shapes-media", { recursive: true });
  await fs.writeFile(
    "qa/results/shapes-media/shape-catalog.pptx",
    Buffer.from(result.source),
  );
  await fs.writeFile(
    "qa/results/shapes-media/shape-catalog.slide",
    result.firstJson,
  );
  await info.attach("geometry-audit", {
    body: JSON.stringify(
      { ...result, source: undefined, firstJson: undefined },
      null,
      2,
    ),
    contentType: "application/json",
  });
  expect(result.count).toBe(187);
  expect(result.elements).toBe(561);
  expect(result.warnings).toEqual([]);
  expect(result.failures).toEqual([]);
  expect(result.native.filter((n) => n === "ellipse")).toHaveLength(3);
});

test("native circle identity, adjusted block arrows and triangles, curved connectors and noncircular arcs", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const { drawingPaths } = await import("/src/drawing-path.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const deck = blankDeck();
    deck.slides[0].elements = [];
    const zip = await JSZip.loadAsync(await exportPptx(deck));
    const variants = [
      ["ellipse", ""],
      [
        "rightArrow",
        '<a:gd name="adj1" fmla="val 80000"/><a:gd name="adj2" fmla="val 25000"/>',
      ],
      ["triangle", '<a:gd name="adj" fmla="val 20000"/>'],
      ["curvedConnector3", ""],
    ];
    const shapes = variants
      .map(
        ([name, adj], i) =>
          `<p:sp><p:nvSpPr><p:cNvPr id="${i + 2}" name="formerly-triangle-${i}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3048000" cy="1143000"/></a:xfrm><a:prstGeom prst="${name}"><a:avLst>${adj}</a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="4080C0"/></a:solidFill><a:ln w="28575"><a:solidFill><a:srgbClr val="15283A"/></a:solidFill>${i === 3 ? '<a:tailEnd type="triangle" w="lg" len="lg"/>' : ""}</a:ln></p:spPr></p:sp>`,
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
    const imported = await importPptx(
      await zip.generateAsync({ type: "uint8array" }),
    );
    const elements = imported.deck.slides[0].elements;
    // For a 200x100 ellipse, a 45-degree radius meets the ellipse at
    // (44.72135955, 44.72135955), not (70.710678,35.355339).
    const geometry = new DOMParser().parseFromString(
      '<custGeom><pathLst><path w="200" h="100"><moveTo><pt x="144.72135955" y="94.72135955"/></moveTo><arcTo wR="100" hR="50" stAng="2700000" swAng="5400000"/></path></pathLst></custGeom>',
      "text/xml",
    ).documentElement;
    const arc = drawingPaths(geometry)![0].d;
    return {
      elements,
      roundTrip: (await importPptx(await exportPptx(imported.deck))).deck
        .slides[0].elements,
      arc,
    };
  });
  for (const elements of [result.elements, result.roundTrip]) {
    expect(elements[0].shape).toBe("ellipse");
    expect(elements[1].shape).toBe("custom");
    const arrow = elements[1].paths![0];
    const n = arrow.d.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi)!.map(Number);
    expect(n[1] / arrow.height).toBeCloseTo(0.1, 5); // 80% shaft, not a thin line.
    expect(n[2] / arrow.width).toBeCloseTo(0.90625, 5); // head length 25% of shortest side.
    const triangle = elements[2].paths![0];
    expect(Number(triangle.d.split(" ")[4]) / triangle.width).toBeCloseTo(
      0.2,
      5,
    );
    expect(elements[3].lineEnd).toEqual({
      type: "triangle",
      width: "lg",
      length: "lg",
    });
  }
  const endpoint = result.arc.split(" ").slice(-2).map(Number);
  expect(endpoint[0]).toBeCloseTo(55.27864045, 6);
  expect(endpoint[1]).toBeCloseTo(94.72135955, 6);
});

test("every preset also resolves its authored adjustment guides at 75% and 125%", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { presetNames, presetGeometry } = await import(
      "/src/drawing-presets.ts"
    );
    const { drawingPaths } = await import("/src/drawing-path.ts");
    const failures: string[] = [];
    let count = 0;
    for (const name of presetNames()) {
      const geometry = presetGeometry(name)!;
      const list = Array.from(geometry.children).find(
        (n) => n.localName === "avLst",
      );
      if (!list?.children.length) continue;
      for (const factor of [0.75, 1.25]) {
        const adjustments = list.cloneNode(true) as Element;
        for (const guide of Array.from(adjustments.children)) {
          const n = Number(guide.getAttribute("fmla")?.split(/\s+/).at(-1));
          guide.setAttribute("fmla", `val ${Math.round(n * factor)}`);
        }
        for (const [width, height] of [
          [200, 200],
          [320, 120],
          [120, 320],
        ]) {
          count++;
          const paths = drawingPaths(presetGeometry(name, adjustments), {
            width: width * 9525,
            height: height * 9525,
          });
          if (
            !paths?.length ||
            paths.some((p) => !/^[MLCQAZ0-9eE+.,\s-]+$/.test(p.d))
          )
            failures.push(`${name} x${factor} ${width}x${height}`);
        }
      }
    }
    return { count, failures };
  });
  expect(result.count).toBeGreaterThan(500);
  expect(result.failures).toEqual([]);
});

test("DrawingML lexical false suppresses seam strokes", async ({ page }) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { drawingPaths } = await import("/src/drawing-path.ts");
    const geometry = new DOMParser().parseFromString(
      '<custGeom><pathLst><path w="100" h="100" stroke="false"><moveTo><pt x="0" y="0"/></moveTo><lnTo><pt x="100" y="100"/></lnTo></path></pathLst></custGeom>',
      "text/xml",
    ).documentElement;
    const { presetGeometry } = await import("/src/drawing-presets.ts");
    const paths = drawingPaths(presetGeometry("cube"), {
      width: 952500,
      height: 952500,
    })!;
    return {
      custom: drawingPaths(geometry)![0].stroke,
      cube: paths.map((p) => p.stroke),
    };
  });
  expect(result.custom).toBe(false);
  expect(result.cube).toContain(false);
});
