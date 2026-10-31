import { expect, test, type Page } from "@playwright/test";
import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import fs from "node:fs/promises";

const symbols = [
  "circle",
  "dash",
  "diamond",
  "dot",
  "plus",
  "square",
  "star",
  "triangle",
  "x",
  "none",
];
async function fixture(
  options: {
    legend?: string;
    kind?: "line" | "scatter";
    symbols?: string[];
    sizes?: number[];
  } = {},
) {
  const names = options.symbols ?? symbols,
    deck = new PptxGenJS();
  deck.layout = "LAYOUT_WIDE";
  const series =
    options.kind === "scatter"
      ? [
          { name: "X", values: [1, 2, 3] },
          ...names.map((name, i) => ({ name, values: [i + 1, i + 2, i + 1] })),
        ]
      : names.map((name, i) => ({
          name,
          labels: ["A", "B", "C"],
          values: [i + 1, i + 2, i + 1],
        }));
  deck.addSlide().addChart(options.kind ?? "line", series, {
    x: 1,
    y: 1,
    w: 10,
    h: 5,
    showTitle: false,
    showLegend: true,
    legendPos: options.legend ?? "r",
    showValue: false,
    lineDataSymbol: "circle",
    lineDataSymbolSize: 6,
  });
  const zip = await JSZip.loadAsync(
    (await deck.write({
      outputType: "uint8array",
      compression: true,
    })) as Uint8Array,
  );
  const part = Object.keys(zip.files).find((p) =>
    /^ppt\/charts\/chart\d+\.xml$/.test(p),
  )!;
  let index = 0;
  zip.file(
    part,
    (await zip.file(part)!.async("string")).replace(
      /<c:ser>[\s\S]*?<\/c:ser>/g,
      (xml) => {
        const marker = `<c:marker><c:symbol val="${names[index]}"/><c:size val="${options.sizes?.[index] ?? 6}"/></c:marker>`;
        index++;
        return xml.replace(/<c:marker>[\s\S]*?<\/c:marker>/, marker);
      },
    ),
  );
  return zip.generateAsync({ type: "nodebuffer" });
}
async function open(page: Page, bytes: Buffer) {
  await page.goto("http://127.0.0.1:5190");
  await page.locator('input[accept*=".pptx"]').setInputFiles({
    name: "marker-styles.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: bytes,
  });
  await expect(page.locator('.editable-slide [data-type="chart"]')).toHaveCount(
    1,
  );
  await expect(page.locator(".busy-backdrop")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { loadAutosave } = await import("/src/storage.ts");
        return (await loadAutosave())?.slides[0].elements.some(
          (e) => e.type === "chart",
        );
      }),
    )
    .toBe(true);
}

test("nine explicit marker symbols render separately, native none stays hidden, and sizes use points", async ({
  page,
}, info) => {
  const bytes = await fixture();
  await open(page, bytes);
  const chart = page.locator(".editable-slide .chart-visual");
  for (const symbol of symbols.filter((s) => s !== "none"))
    await expect(
      chart.locator(
        `[data-chart-marker-symbol="${symbol}"] [data-chart-point]`,
      ),
    ).toHaveCount(3);
  await expect(chart.locator("[data-chart-point]")).toHaveCount(27);
  await expect(chart.locator("[data-chart-legend-marker]")).toHaveCount(9);
  const circle = chart
    .locator('[data-chart-marker-symbol="circle"] circle')
    .first();
  expect(
    await circle.evaluate((n) => (n as SVGCircleElement).getBBox().width),
  ).toBeCloseTo(8, 5);
  for (const symbol of ["square", "diamond", "triangle", "plus", "star", "x"]) {
    const box = await chart
      .locator(`[data-chart-marker-symbol="${symbol}"] [data-chart-point]`)
      .nth(1)
      .evaluate((node) => {
        const box = (node as SVGGraphicsElement).getBBox();
        return { width: box.width, height: box.height };
      });
    expect(box.width).toBeCloseTo(8, 4);
    expect(box.height).toBeCloseTo(8, 4);
  }
  const model = await page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts");
    const { readChartModel } = await import("/src/chart.ts");
    return readChartModel(
      (await loadAutosave())!.slides[0].elements.find(
        (e) => e.type === "chart",
      )!.chart!,
    );
  });
  expect(model.plots[0].series.map((s) => s.markerSymbol)).toEqual([
    ...symbols.slice(0, -1),
    "circle",
  ]);
  expect(model.plots[0].series.map((s) => s.marker)).toEqual([
    ...symbols.slice(0, -1).map(() => true),
    false,
  ]);
  await fs.writeFile(info.outputPath("explicit-marker-reference.pptx"), bytes);
  await chart.screenshot({ path: info.outputPath("explicit-markers.png") });
});

test("explicit none suppresses scatter markers rather than being overridden by the plot type", async ({
  page,
}) => {
  await open(page, await fixture({ kind: "scatter", symbols: ["none"] }));
  await expect(
    page.locator(".editable-slide [data-chart-marker-layer]"),
  ).toHaveCount(0);
  const model = await page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts");
    const { readChartModel } = await import("/src/chart.ts");
    return readChartModel(
      (await loadAutosave())!.slides[0].elements.find(
        (e) => e.type === "chart",
      )!.chart!,
    );
  });
  expect(model.plots[0].series[0].marker).toBe(false);
});

for (const legend of ["r", "l", "tr"]) {
  test(`${legend} legend uses the requested vertical alignment and stays on the specified side`, async ({
    page,
  }, info) => {
    await open(
      page,
      await fixture({ legend, symbols: ["circle", "diamond", "square"] }),
    );
    const result = await page
      .locator(".editable-slide .chart-visual")
      .evaluate((svg) => {
        const plot = svg.querySelector("clipPath rect")!;
        const top = Number(plot.getAttribute("y")),
          height = Number(plot.getAttribute("height")),
          left = Number(plot.getAttribute("x")),
          width = Number(plot.getAttribute("width"));
        const boxes = [...svg.querySelectorAll("[data-chart-legend]")].map(
          (n) => (n as SVGGElement).getBBox(),
        );
        return {
          top,
          height,
          left,
          width,
          minY: Math.min(...boxes.map((b) => b.y)),
          maxY: Math.max(...boxes.map((b) => b.y + b.height)),
          minX: Math.min(...boxes.map((b) => b.x)),
          maxX: Math.max(...boxes.map((b) => b.x + b.width)),
        };
      });
    if (legend === "tr") expect(result.minY - result.top).toBeLessThan(15);
    else
      expect(
        Math.abs(
          (result.minY + result.maxY) / 2 - (result.top + result.height / 2),
        ),
      ).toBeLessThan(4);
    if (legend === "l") expect(result.maxX).toBeLessThan(result.left);
    else expect(result.minX).toBeGreaterThan(result.left + result.width);
    await page
      .locator(".editable-slide .chart-visual")
      .screenshot({ path: info.outputPath(`legend-${legend}.png`) });
  });
}

test("dense marker batching preserves every symbol, source order and shape-aware pointer hits", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { CHART_MARKER_SYMBOLS } = await import("/src/chart.ts");
    const { markerBatches, markerHitIndex } = await import(
      "/src/ChartMarkers.tsx"
    );
    const points = Array.from({ length: 2000 }, (_, i) => ({
      x: i * 25,
      y: 20,
      index: i,
      value: i,
      color: i < 1000 ? "#C00000" : "#008800",
    }));
    const before = JSON.stringify(points);
    const runs = CHART_MARKER_SYMBOLS.map((symbol) => {
      const batches = markerBatches(points, 10, symbol)!;
      const hit = markerHitIndex(points, 10, symbol);
      return {
        symbol,
        count: batches.reduce((n, p) => n + p.count, 0),
        colors: batches.map((p) => p.color),
        first: hit(0, 20)?.index,
        middle: hit(25000, 20)?.index,
        last: hit(49975, 20)?.index,
        alpha: !!markerBatches(
          points.map((p) => ({ ...p, color: "rgba(0,0,0,.5)" })),
          10,
          symbol,
        ),
      };
    });
    const one = [{ x: 0, y: 0, index: 5, value: 1, color: "#C00000" }];
    return {
      runs,
      unchanged: JSON.stringify(points) === before,
      square: markerHitIndex(one, 10, "square")(9, 9)?.index,
      diamond: markerHitIndex(one, 10, "diamond")(9, 9)?.index,
      diamondInside: markerHitIndex(one, 10, "diamond")(5, 2)?.index,
      triangle: markerHitIndex(one, 10, "triangle")(9, -9)?.index,
      triangleInside: markerHitIndex(one, 10, "triangle")(9, 9)?.index,
      plus: markerHitIndex(one, 10, "plus")(5, 5)?.index,
    };
  });
  expect(result.unchanged).toBe(true);
  for (const run of result.runs) {
    expect(run).toMatchObject({
      count: 2000,
      colors: ["#C00000", "#008800"],
      first: 0,
      middle: 1000,
      last: 1999,
      alpha: false,
    });
  }
  expect(result.square).toBe(5);
  expect(result.diamond).toBeUndefined();
  expect(result.diamondInside).toBe(5);
  expect(result.triangle).toBeUndefined();
  expect(result.triangleInside).toBe(5);
  expect(result.plus).toBeUndefined();
});

test("marker styles, exact values, native marker XML and workbook survive mixed-deck copy and three saves", async ({
  page,
}) => {
  const bytes = await fixture();
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(
    async (data) => {
      const { importPptx, exportPptx } = await import("/src/io.ts");
      const { readChartModel, chartPartText } = await import("/src/chart.ts");
      const { blankDeck, newSlide } = await import("/src/model.ts");
      const { copyElements } = await import("/src/object-groups.ts");
      const original = (await importPptx(new Uint8Array(data))).deck;
      const chart = original.slides[0].elements.find(
        (e) => e.type === "chart",
      )!;
      let deck = blankDeck();
      deck.pptxSources = original.pptxSources;
      deck.slides = [
        { ...newSlide("blank"), elements: copyElements([chart], 0, 0) },
        original.slides[0],
      ];
      const snapshot = () =>
        deck.slides.map((s) => {
          const data = s.elements.find((e) => e.type === "chart")!.chart!;
          const xml = chartPartText(
            data.parts.find((p) => p.path === data.root)!.data,
          );
          return {
            model: readChartModel(data),
            markers: xml.match(/<c:marker>[\s\S]*?<\/c:marker>/g),
            workbooks: data.parts
              .filter((p) => p.contentType.includes("spreadsheetml"))
              .map((p) => p.data),
          };
        });
      const rounds = [snapshot()];
      for (let i = 0; i < 3; i++) {
        deck = (await importPptx(await exportPptx(deck))).deck;
        rounds.push(snapshot());
      }
      return rounds;
    },
    [...bytes],
  );
  const initial = result[0][0];
  expect(initial.workbooks).toHaveLength(1);
  for (const round of result)
    for (const chart of round) expect(chart).toEqual(initial);
});

test("malformed marker sizes remain bounded and unsupported picture symbols are disclosed without changing native data", async ({
  page,
}) => {
  const bytes = await fixture({
    symbols: ["circle", "diamond", "picture", "auto"],
    sizes: [0, 100000, 6, -50],
  });
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(
    async (data) => {
      const { importPptx, exportPptx } = await import("/src/io.ts");
      const { readChartModel, chartPartText } = await import("/src/chart.ts");
      let { deck, warnings } = await importPptx(new Uint8Array(data));
      const read = () => {
        const data = deck.slides[0].elements.find(
          (e) => e.type === "chart",
        )!.chart!;
        return {
          model: readChartModel(data),
          native: chartPartText(
            data.parts.find((p) => p.path === data.root)!.data,
          ).match(/<c:marker>[\s\S]*?<\/c:marker>/g),
        };
      };
      const before = read();
      deck = (await importPptx(await exportPptx(deck))).deck;
      return { before, after: read(), warnings };
    },
    [...bytes],
  );
  expect(result.before.model.plots[0].series.map((s) => s.markerSize)).toEqual([
    2, 72, 6, 2,
  ]);
  expect(result.before.model.approximate).toBe(true);
  expect(
    result.warnings.some((w) => w.includes("차트") && w.includes("제한")),
  ).toBe(true);
  expect(result.after).toEqual(result.before);
});

test("smallest and largest native marker sizes render at 96 CSS pixels per inch", async ({
  page,
}) => {
  await open(
    page,
    await fixture({ symbols: ["circle", "circle"], sizes: [2, 72] }),
  );
  const widths = await page
    .locator(".editable-slide circle[data-chart-point]")
    .evaluateAll((nodes) =>
      nodes.map((node) => (node as SVGCircleElement).getBBox().width),
    );
  expect(widths).toHaveLength(6);
  for (const width of widths.slice(0, 3))
    expect(width).toBeCloseTo((2 * 96) / 72, 4);
  for (const width of widths.slice(3))
    expect(width).toBeCloseTo((72 * 96) / 72, 4);
});
