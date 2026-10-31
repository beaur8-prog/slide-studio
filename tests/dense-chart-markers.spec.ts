import { test, expect, type Page } from "@playwright/test";
import PptxGenJS from "pptxgenjs";

async function fixture() {
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_WIDE";
  deck.addSlide().addChart(
    "scatter",
    [
      {
        name: "X",
        values: Array.from({ length: 2000 }, (_, i) => (i % 50) + 1),
      },
      {
        name: "Grid",
        values: Array.from({ length: 2000 }, (_, i) => Math.floor(i / 50) + 1),
      },
    ],
    {
      x: 1,
      y: 1,
      w: 10,
      h: 5,
      lineSize: 0,
      lineDataSymbol: "circle",
      lineDataSymbolSize: 5,
      catAxisMinVal: 0,
      catAxisMaxVal: 51,
      valAxisMinVal: 0,
      valAxisMaxVal: 41,
      showLegend: false,
      showTitle: false,
      showValue: false,
    },
  );
  return Buffer.from(
    (await deck.write({
      outputType: "uint8array",
      compression: true,
    })) as Uint8Array,
  );
}
async function open(page: Page, bytes: Buffer) {
  await page.goto("http://127.0.0.1:5190");
  await page
    .locator('input[accept*=".pptx"]')
    .setInputFiles({
      name: "dense-grid.pptx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      buffer: bytes,
    });
  await expect(
    page.locator('.editable-slide [data-chart-marker-count="2000"]'),
  ).toHaveCount(1);
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
async function moveToPoint(page: Page, index: number) {
  const position = await page
    .locator(".editable-slide [data-chart-marker-batch]")
    .evaluate((path, index) => {
      const matches = [
        ...path
          .getAttribute("d")!
          .matchAll(/M([-\d.e+]+) ([-\d.e+]+)a([-\d.e+]+)/g),
      ];
      const match = matches[index],
        point = new DOMPoint(
          Number(match[1]) + Number(match[3]),
          Number(match[2]),
        ).matrixTransform((path as SVGPathElement).getScreenCTM()!);
      return { x: point.x, y: point.y };
    }, index);
  await page.mouse.move(position.x, position.y);
  return position;
}

test("marker batching keeps source order and coordinates, preserves color runs, and refuses translucent or excessive style runs", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { markerBatches, markerHitIndex } = await import(
      "/src/ChartMarkers.tsx"
    );
    const points = Array.from({ length: 2000 }, (_, i) => ({
      x: i,
      y: i % 20,
      index: i,
      color: i < 1000 ? "#C00000" : "#008800",
      value: i,
    }));
    const before = JSON.stringify(points),
      batches = markerBatches(points, 3)!;
    const overlap = points.map((p) => ({ ...p, x: 20, y: 20 }));
    return {
      counts: batches.map((b) => b.count),
      colors: batches.map((b) => b.color),
      starts: batches.map((b) => b.d.slice(0, 30)),
      commands: batches.reduce((n, b) => n + (b.d.match(/M/g)?.length ?? 0), 0),
      unchanged: JSON.stringify(points) === before,
      hit: markerHitIndex(overlap, 3)(20, 20)?.index,
      miss: markerHitIndex(points, 3)(-100, -100),
      alpha: markerBatches(
        points.map((p) => ({ ...p, color: "#C0000080" })),
        3,
      ),
      alternating: markerBatches(
        points.map((p, i) => ({ ...p, color: i % 2 ? "#C00000" : "#008800" })),
        3,
      ),
    };
  });
  expect(result.counts).toEqual([1000, 1000]);
  expect(result.colors).toEqual(["#C00000", "#008800"]);
  expect(result.commands).toBe(2000);
  expect(result.starts[0]).toMatch(/^M-3 0a3 3/);
  expect(result.starts[1]).toMatch(/^M997 0a3 3/);
  expect(result.unchanged).toBe(true);
  expect(result.hit).toBe(1999);
  expect(result.miss).toBeUndefined();
  expect(result.alpha).toBeUndefined();
  expect(result.alternating).toBeUndefined();
});

test("dense original point tooltips work at first, middle and last points, with zoom and horizontal flip", async ({
  page,
}, info) => {
  await open(page, await fixture());
  await expect(page.locator(".editable-slide [data-chart-point]")).toHaveCount(
    0,
  );
  await expect(
    page.locator(".editable-slide [data-chart-marker-batch]"),
  ).toHaveCount(1);
  const tooltip = page.locator(".editable-slide [data-chart-point-tooltip]");
  for (const index of [0, 1000, 1999]) {
    await moveToPoint(page, index);
    await expect(tooltip).toHaveAttribute(
      "data-chart-point-index",
      String(index),
    );
    await expect(tooltip).toContainText(`Grid: ${Math.floor(index / 50) + 1}`);
  }
  await page.locator(".editable-slide .chart-visual").evaluate((svg) => {
    (svg as SVGElement).style.transform = "scale(-1,1)";
  });
  await moveToPoint(page, 1000);
  await expect(tooltip).toHaveAttribute("data-chart-point-index", "1000");
  await page.locator(".editable-slide .chart-visual").evaluate((svg) => {
    (svg as SVGElement).style.transform = "scale(.8)";
  });
  await moveToPoint(page, 500);
  await expect(tooltip).toHaveAttribute("data-chart-point-index", "500");
  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);
  await moveToPoint(page, 501);
  await expect(tooltip).toHaveCount(1);
  await page.mouse.move(5, 5);
  await expect(tooltip).toHaveCount(0);
  await page
    .locator(".editable-slide")
    .screenshot({ path: info.outputPath("dense-grid.png") });
});

test("hover leaves stored data, saved state and undo unchanged and all values/workbook bytes survive three saves", async ({
  page,
}) => {
  const bytes = await fixture();
  await open(page, bytes);
  const snapshot = () =>
    page.evaluate(async () => {
      const { loadAutosave } = await import("/src/storage.ts");
      return JSON.stringify(await loadAutosave());
    });
  const before = await snapshot();
  const undo = page.getByRole("button", { name: "실행 취소", exact: true });
  await expect(undo).toBeDisabled();
  await moveToPoint(page, 1000);
  await page.mouse.move(5, 5);
  expect(await snapshot()).toBe(before);
  await expect(undo).toBeDisabled();
  const saved = await page.evaluate(
    async (data) => {
      const { importPptx, exportPptx } = await import("/src/io.ts"),
        { readChartModel } = await import("/src/chart.ts");
      let deck = (await importPptx(new Uint8Array(data))).deck;
      const capture = () => {
        const c = deck.slides[0].elements.find(
          (e) => e.type === "chart",
        )!.chart!;
        return {
          model: readChartModel(c),
          workbooks: c.parts
            .filter((p) => p.path.endsWith(".xlsx"))
            .map((p) => p.data),
        };
      };
      const original = capture(),
        rounds = [];
      for (let i = 0; i < 3; i++) {
        deck = (await importPptx(await exportPptx(deck))).deck;
        rounds.push(capture());
      }
      return { original, rounds };
    },
    [...bytes],
  );
  expect(saved.original.model.plots[0].series[0].values).toHaveLength(2000);
  for (const round of saved.rounds) expect(round).toEqual(saved.original);
});
