import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";

test("each of 300 preset adjustment values survives the actual PPTX importer and round trip at three aspect ratios", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { importPptx, exportPptx, parseDeckJson, serializeDeck } =
      await import("/src/io.ts");
    const { presetNames, presetGeometry } = await import(
      "/src/drawing-presets.ts"
    );
    const { drawingPaths } = await import("/src/drawing-path.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const child = (node: Element, name: string) =>
      Array.from(node.children).find((n) => n.localName === name);
    const cases: {
      name: string;
      guide: string;
      value: number;
      original: number;
      width: number;
      height: number;
    }[] = [];
    let guides = 0,
      shapes = 0;
    for (const name of presetNames()) {
      const list = child(presetGeometry(name)!, "avLst");
      if (!list?.children.length) continue;
      shapes++;
      for (const guide of Array.from(list.children)) {
        guides++;
        const original = Number(
          guide.getAttribute("fmla")!.split(/\s+/).at(-1),
        );
        // Change one guide at a time; changing them together can hide a dropped
        // value or let a dependent clamp cancel out the intended change.
        for (const value of original === 0
          ? [-10000, 10000]
          : [Math.round(original * 0.75), Math.round(original * 1.25)]) {
          for (const [width, height] of [
            [200, 200],
            [320, 120],
            [120, 320],
          ])
            cases.push({
              name,
              guide: guide.getAttribute("name")!,
              value,
              original,
              width,
              height,
            });
        }
      }
    }
    const guideXml = (item: (typeof cases)[number], baseline = false) =>
      // The division symbol's default dot radius/line width pin its dot gap
      // to zero. Reduce the radius so changing adj2 actually moves the dots.
      (item.name === "mathDivide" && item.guide === "adj2"
        ? '<a:gd name="adj3" fmla="val 5000"/>'
        : "") +
      `<a:gd name="${item.guide}" fmla="val ${baseline ? item.original : item.value}"/>`;
    const adjustments = (item: (typeof cases)[number], baseline = false) =>
      new DOMParser().parseFromString(
        `<a:avLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${guideXml(item, baseline)}</a:avLst>`,
        "application/xml",
      ).documentElement;
    const deck = blankDeck();
    deck.slides = Array.from(
      { length: Math.ceil(cases.length / 30) },
      (_, i) => ({
        ...deck.slides[0],
        id: `adjustment-${i}`,
        elements: [],
      }),
    );
    const zip = await JSZip.loadAsync(await exportPptx(deck));
    for (let i = 0; i < deck.slides.length; i++) {
      const filename = `ppt/slides/slide${i + 1}.xml`;
      const xml = cases
        .slice(i * 30, (i + 1) * 30)
        .map(
          (item, index) =>
            `<p:sp><p:nvSpPr><p:cNvPr id="${index + 2}" name="${item.name}-${item.guide}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${item.width * 9525}" cy="${item.height * 9525}"/></a:xfrm><a:prstGeom prst="${item.name}"><a:avLst>${guideXml(item)}</a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="4080C0"/></a:solidFill><a:ln w="19050"><a:solidFill><a:srgbClr val="15283A"/></a:solidFill></a:ln></p:spPr></p:sp>`,
        )
        .join("");
      zip.file(
        filename,
        (await zip.file(filename)!.async("string")).replace(
          "</p:spTree>",
          xml + "</p:spTree>",
        ),
      );
    }
    const imported = await importPptx(
      await zip.generateAsync({ type: "uint8array" }),
    );
    const restored = parseDeckJson(serializeDeck(imported.deck));
    const roundTrip = await importPptx(await exportPptx(restored));
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const context = canvas.getContext("2d")!;
    const mask = (
      paths: ReturnType<typeof drawingPaths>,
      native?: (typeof restored.slides)[number]["elements"][number],
    ) => {
      context.resetTransform();
      context.clearRect(0, 0, 128, 128);
      context.fillStyle = context.strokeStyle = "black";
      if (native && !paths && native.shape === "roundRect") {
        context.save();
        context.scale(128 / native.width, 128 / native.height);
        context.beginPath();
        context.roundRect(
          0,
          0,
          native.width,
          native.height,
          native.cornerRadius ?? 0,
        );
        context.lineWidth = 2;
        context.fill();
        context.stroke();
        context.restore();
      } else
        for (const path of paths ?? []) {
          context.save();
          context.scale(128 / path.width, 128 / path.height);
          const curve = new Path2D(path.d);
          if (path.fill) context.fill(curve);
          if (path.stroke) {
            // All source paths use EMU coordinates and a 2 px outline.
            context.lineWidth = 19050;
            context.stroke(curve);
          }
          context.restore();
        }
      return context.getImageData(0, 0, 128, 128).data;
    };
    const difference = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
      let changed = 0;
      for (let i = 3; i < a.length; i += 4)
        if (Math.abs(a[i] - b[i]) > 64) changed++;
      return changed / (128 * 128);
    };
    const failures: string[] = [];
    const effective = new Set<string>();
    const signature = (paths: ReturnType<typeof drawingPaths>) =>
      JSON.stringify(paths);
    const importedElements = imported.deck.slides.flatMap((s) => s.elements);
    const restoredElements = restored.slides.flatMap((s) => s.elements);
    const roundTripElements = roundTrip.deck.slides.flatMap((s) => s.elements);
    if (
      [importedElements, restoredElements, roundTripElements].some(
        (elements) => elements.length !== cases.length,
      )
    )
      failures.push("Imported element count changed");
    cases.forEach((item, index) => {
      const extent = { width: item.width * 9525, height: item.height * 9525 };
      const paths = drawingPaths(
        presetGeometry(item.name, adjustments(item)),
        extent,
      );
      if (!paths?.length) {
        failures.push(
          `${item.name}/${item.guide}: unresolved authored geometry`,
        );
        return;
      }
      const expected = mask(paths);
      const baseline = drawingPaths(
        presetGeometry(item.name, adjustments(item, true)),
        extent,
      );
      if (signature(paths) !== signature(baseline))
        effective.add(`${item.name}/${item.guide}`);
      for (const [phase, elements] of [
        ["import", importedElements],
        ["project", restoredElements],
        ["pptx", roundTripElements],
      ] as const) {
        const element = elements[index];
        if (!element) continue;
        // Callout tips and connector bends can be outside the shape box, so a
        // clipped raster alone cannot detect their lost adjustment values.
        if (!["donut", "roundRect"].includes(item.name)) {
          if (element.paths?.length !== paths.length)
            failures.push(`${phase} ${item.name}/${item.guide}: missing path`);
          else
            paths.forEach((path, i) => {
              const actual = element.paths![i];
              const commands = (d: string) => d.match(/[MLCQAZ]/gi)?.join("");
              const numbers = (d: string) =>
                (d.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
              const a = numbers(actual.d),
                b = numbers(path.d);
              const tolerance = Math.max(extent.width, extent.height) / 100000;
              if (
                commands(actual.d) !== commands(path.d) ||
                a.length !== b.length ||
                a.some((n, k) => Math.abs(n - b[k]) > tolerance)
              )
                failures.push(
                  `${phase} ${item.name}/${item.guide}: changed path coordinates`,
                );
            });
        }
        const error = difference(expected, mask(element.paths, element));
        if (error > 0.003)
          failures.push(
            `${phase} ${item.name}/${item.guide}=${item.value} ${item.width}x${item.height}: ${(error * 100).toFixed(3)}%`,
          );
      }
    });
    return {
      shapes,
      guides,
      cases: cases.length,
      effectiveGuides: effective.size,
      unchangedGuides: [
        ...new Set(cases.map((item) => `${item.name}/${item.guide}`)),
      ].filter((name) => !effective.has(name)),
      failures,
      warnings: [...imported.warnings, ...roundTrip.warnings],
    };
  });
  await info.attach("individual-adjustment-audit", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });
  await fs.mkdir("qa/results/shape-adjustments", { recursive: true });
  await fs.writeFile(
    "qa/results/shape-adjustments/audit.json",
    JSON.stringify(result, null, 2),
  );
  expect(result.shapes).toBe(123);
  expect(result.guides).toBe(300);
  expect(result.cases).toBe(1800);
  expect(result.effectiveGuides).toBe(300);
  expect(result.unchangedGuides).toEqual([]);
  expect(result.warnings).toEqual([]);
  expect(result.failures).toEqual([]);
});

test("triangle apex positions and edited points appear in the editor and slideshow and survive saving", async ({
  page,
}, info) => {
  await page.goto("http://127.0.0.1:5190");
  const fixture = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { importPptx, exportPptx, parseDeckJson, serializeDeck } =
      await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const values = [0, 10000, 20000, 50000, 80000, 90000, 100000];
    const deck = blankDeck();
    deck.name = "삼각형 꼭짓점 조절 검증";
    deck.slides[0].elements = [];
    deck.slides[0].background = "#FFFFFF";
    const zip = await JSZip.loadAsync(await exportPptx(deck));
    const shapes = [...values, undefined]
      .map((value, index) => {
        const geometry =
          value === undefined
            ? '<a:custGeom><a:avLst><a:gd name="tipX" fmla="val 40"/></a:avLst><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="220" b="160"/><a:pathLst><a:path w="220" h="160"><a:moveTo><a:pt x="0" y="160"/></a:moveTo><a:lnTo><a:pt x="tipX" y="32"/></a:lnTo><a:lnTo><a:pt x="220" y="160"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>'
            : `<a:prstGeom prst="triangle"><a:avLst><a:gd name="adj" fmla="val ${value}"/></a:avLst></a:prstGeom>`;
        return `<p:sp><p:nvSpPr><p:cNvPr id="${index + 2}" name="apex-${value ?? "edited"}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${(40 + (index % 4) * 300) * 9525}" y="${(130 + Math.floor(index / 4) * 300) * 9525}"/><a:ext cx="2095500" cy="1524000"/></a:xfrm>${geometry}<a:solidFill><a:srgbClr val="4080C0"/></a:solidFill><a:ln w="19050"><a:solidFill><a:srgbClr val="15283A"/></a:solidFill></a:ln></p:spPr></p:sp>`;
      })
      .join("");
    const filename = "ppt/slides/slide1.xml";
    zip.file(
      filename,
      (await zip.file(filename)!.async("string")).replace(
        "</p:spTree>",
        shapes + "</p:spTree>",
      ),
    );
    const source = await zip.generateAsync({ type: "uint8array" });
    const first = await importPptx(source);
    const project = parseDeckJson(serializeDeck(first.deck));
    const again = await importPptx(await exportPptx(project));
    const apex = (
      element: (typeof project.slides)[number]["elements"][number],
    ) => {
      const path = element.paths?.[0];
      if (!path) return null;
      const n = path.d.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi)!.map(Number);
      return [n[2] / path.width, n[3] / path.height];
    };
    return {
      source: Array.from(source),
      stages: [first.deck, project, again.deck].map((d) =>
        d.slides[0].elements.map(apex),
      ),
      warnings: [...first.warnings, ...again.warnings],
      expected: [
        ...values.map((value) => [value / 100000, 0]),
        [40 / 220, 32 / 160],
      ],
    };
  });
  for (const stage of fixture.stages)
    for (const [index, point] of stage.entries()) {
      expect(point).not.toBeNull();
      expect(point![0]).toBeCloseTo(fixture.expected[index][0], 5);
      expect(point![1]).toBeCloseTo(fixture.expected[index][1], 5);
    }
  expect(fixture.warnings).toEqual([]);
  const buffer = Buffer.from(fixture.source);
  await fs.mkdir("qa/results/shape-adjustments", { recursive: true });
  await fs.writeFile("qa/results/shape-adjustments/triangle-apex.pptx", buffer);
  await page.locator('input[type=file][accept*=".pptx"]').setInputFiles({
    name: "triangle-apex.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer,
  });
  await expect(page.locator('.editable-slide [data-type="shape"]')).toHaveCount(
    8,
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const editorPaths = await page
    .locator('.editable-slide [data-type="shape"] .element-svg path')
    .evaluateAll((paths) => paths.map((path) => path.getAttribute("d")));
  expect(editorPaths).toHaveLength(8);
  await page
    .getByTestId("canvas-frame")
    .screenshot({ path: info.outputPath("triangle-editor.png") });
  await page.keyboard.press("F5");
  await expect(page.getByTestId("presentation-view")).toBeVisible();
  const showPaths = await page
    .locator(".presentation-view .slide-visual .element-svg path")
    .evaluateAll((paths) => paths.map((path) => path.getAttribute("d")));
  expect(showPaths).toEqual(editorPaths);
  await page
    .getByTestId("presentation-view")
    .screenshot({ path: info.outputPath("triangle-presentation.png") });
  await page.keyboard.press("Escape");
});
