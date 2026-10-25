import { test, expect, type Page } from "@playwright/test";
import PptxGenJS from "pptxgenjs";
import fs from "node:fs/promises";
import path from "node:path";

async function fixture(kind: string, options: Record<string, unknown> = {}) {
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_WIDE";
  const slide = deck.addSlide();
  slide.addChart(
    kind as any,
    [
      {
        name: "한글 계열 A",
        labels: ["One", "Two", "Three", "Four"],
        values: [58.94, 51.427, 43.915, 36.402],
      },
      ...(["pie", "doughnut"].includes(kind)
        ? []
        : [
            {
              name: "Series B",
              labels: ["One", "Two", "Three", "Four"],
              values: [8.603, 21.429, 34.256, 47.082],
            },
          ]),
    ],
    {
      x: 1,
      y: 1,
      w: 10,
      h: 5,
      chartColors: ["E95F50", "168F9F"],
      showLegend: true,
      legendPos: "t",
      showTitle: true,
      title: "원본 차트",
      valAxisMinVal: 0,
      valAxisMaxVal: 65,
      valAxisMajorUnit: 10,
      catAxisTitle: "Category",
      valAxisTitle: "Value",
      ...options,
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
      name: "chart.pptx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      buffer: bytes,
    });
  await expect(page.locator('.editable-slide [data-type="chart"]')).toHaveCount(
    1,
  );
  await expect(page.locator(".busy-backdrop")).toHaveCount(0);
}

test("native line chart renders its series, axes and legend and survives PPTX save without private metadata", async ({
  page,
}, info) => {
  const bytes = await fixture("line");
  await fs.writeFile(info.outputPath("input.pptx"), bytes);
  await open(page, bytes);
  await expect(page.locator(".editable-slide [data-chart-line]")).toHaveCount(
    2,
  );
  await expect(page.locator(".editable-slide .chart-visual")).toContainText(
    "한글 계열 A",
  );
  await expect(page.locator(".editable-slide .chart-visual")).toContainText(
    "원본 차트",
  );
  await expect(page.locator(".editable-slide .chart-visual")).toContainText(
    "60",
  );
  await page
    .locator('.editable-slide [data-type="chart"]')
    .screenshot({ path: info.outputPath("line.png") });
  const result = await page.evaluate(
    async (data) => {
      const { importPptx, exportPptx, parseDeckJson } = await import(
        "/src/io.ts"
      );
      const { readChartModel, chartPartText } = await import("/src/chart.ts");
      const { default: JSZip } = await import(
        "/node_modules/.vite/deps/jszip.js"
      );
      let deck = (await importPptx(new Uint8Array(data))).deck;
      const original = readChartModel(deck.slides[0].elements[0].chart!);
      const workbook = deck.slides[0].elements[0].chart!.parts.find((p) =>
        p.path.endsWith(".xlsx"),
      )!.data;
      deck = parseDeckJson(JSON.stringify(deck));
      const native: unknown[] = [];
      let output: Uint8Array;
      for (let round = 0; round < 3; round++) {
        output = await exportPptx(deck);
        const zip = await JSZip.loadAsync(output);
        const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
        const workbooks = Object.keys(zip.files).filter((p) =>
          p.endsWith(".xlsx"),
        );
        native.push({
          frames: (xml.match(/<p:graphicFrame>/g) ?? []).length,
          charts: (xml.match(/<c:chart /g) ?? []).length,
          workbooks: workbooks.length,
        });
        deck = (await importPptx(output)).deck;
      }
      const chart = deck.slides[0].elements[0].chart!;
      return {
        original,
        final: readChartModel(chart),
        native,
        geometry: deck.slides[0].elements[0],
        output: [...output!],
        rootXml: chartPartText(
          chart.parts.find((p) => p.path === chart.root)!.data,
        ),
        workbookPreserved:
          chart.parts.find((p) => p.path.endsWith(".xlsx"))!.data === workbook,
      };
    },
    [...bytes],
  );
  expect(result.final.plots[0].series.map((s) => s.values)).toEqual(
    result.original.plots[0].series.map((s) => s.values),
  );
  expect(result.final.plots[0].series.map((s) => s.labels)).toEqual(
    result.original.plots[0].series.map((s) => s.labels),
  );
  expect(result.final.yAxis).toMatchObject({ min: 0, max: 65, unit: 10 });
  expect(result.native).toEqual(
    Array(3).fill({ frames: 1, charts: 1, workbooks: 1 }),
  );
  expect(result.workbookPreserved).toBe(true);
  expect(result.geometry).toMatchObject({
    x: 96,
    y: 96,
    width: 960,
    height: 480,
  });
  await fs.writeFile(
    info.outputPath("roundtrip.pptx"),
    Buffer.from(result.output),
  );
});

for (const [kind, selector, options] of [
  ["bar", "[data-chart-bar]", { barDir: "col" }],
  ["bar", "[data-chart-bar]", { barDir: "bar", catAxisLabelPos: "low" }],
  ["area", "[data-chart-area]", {}],
  ["pie", "[data-chart-slice]", {}],
  ["doughnut", "[data-chart-slice]", {}],
  ["scatter", "[data-chart-point]", {}],
] as const)
  test(`${kind} ${JSON.stringify(options)} imports as a chart and draws data`, async ({
    page,
  }, info) => {
    await open(page, await fixture(kind, options));
    expect(
      await page.locator(".editable-slide " + selector).count(),
    ).toBeGreaterThan(0);
    await page
      .locator('.editable-slide [data-type="chart"]')
      .screenshot({ path: info.outputPath("chart.png") });
  });

test("duplicate charts keep independent native parts and resizing/grouping survive reopening", async ({
  page,
}) => {
  const bytes = await fixture("line");
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(
    async (data) => {
      const { importPptx, exportPptx } = await import("/src/io.ts"),
        { copyElements } = await import("/src/object-groups.ts");
      const { default: JSZip } = await import(
        "/node_modules/.vite/deps/jszip.js"
      );
      const deck = (await importPptx(new Uint8Array(data))).deck;
      const first = deck.slides[0].elements[0];
      first.width = 400;
      first.height = 250;
      first.x = 40;
      first.y = 50;
      first.rotation = 15;
      first.groups = ["chart-group"];
      first.locked = true;
      const copy = copyElements([first], 500, 0)[0];
      copy.groups = first.groups;
      deck.slides[0].elements.push(copy);
      const output = await exportPptx(deck),
        zip = await JSZip.loadAsync(output);
      const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
      return {
        elements: (await importPptx(output)).deck.slides[0].elements,
        workbooks: Object.keys(zip.files).filter((p) => p.endsWith(".xlsx"))
          .length,
        grouped: xml.includes("<p:grpSp>"),
      };
    },
    [...bytes],
  );
  expect(result.grouped).toBe(true);
  expect(result.workbooks).toBe(2);
  expect(result.elements).toHaveLength(2);
  expect(result.elements[0]).toMatchObject({
    type: "chart",
    width: 400,
    height: 250,
    x: 40,
    y: 50,
    rotation: 15,
    locked: true,
  });
  expect(result.elements[1].chart!.root).not.toBe(
    result.elements[0].chart!.root,
  );
});

test("chart packages reject escaping paths, executable attachments, malformed XML and missing parts", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(
    async (data) => {
      const { importPptx, parseDeckJson } = await import("/src/io.ts");
      const deck = (await importPptx(new Uint8Array(data))).deck;
      return [
        (d: any) => {
          d.slides[0].elements[0].chart.parts[0].path = "../slide1.xml";
        },
        (d: any) => {
          d.slides[0].elements[0].chart.parts[0].contentType =
            "application/x-msdownload";
        },
        (d: any) => {
          d.slides[0].elements[0].chart.parts[0].data = btoa(
            '<!DOCTYPE x [<!ENTITY a "xx">]><x/>',
          );
        },
        (d: any) => {
          d.slides[0].elements[0].chart.parts[0].relationships.push({
            id: "bad",
            type: "http://example.com/package",
            target: "missing.xlsx",
          });
        },
      ].map((change) => {
        const copy = structuredClone(deck);
        change(copy);
        try {
          parseDeckJson(JSON.stringify(copy));
          return false;
        } catch {
          return true;
        }
      });
    },
    [...(await fixture("line"))],
  );
  expect(result).toEqual([true, true, true, true]);
});

const realFile = process.env.SLIDE_CHART_SAMPLE;
test("the reported document shows all three 16-point lines on slide ten", async ({
  page,
}, info) => {
  test.skip(
    !realFile,
    "Set SLIDE_CHART_SAMPLE for the local reported document.",
  );
  const bytes = await fs.readFile(realFile!);
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(
    async (data) => {
      const { importPptx, exportPptx } = await import("/src/io.ts"),
        { readChartModel } = await import("/src/chart.ts");
      const loaded = await importPptx(new Uint8Array(data));
      const chart = loaded.deck.slides[9].elements.find(
        (e) => e.type === "chart",
      )!;
      const model = chart && readChartModel(chart.chart!);
      const output = await exportPptx(loaded.deck),
        reopened = await importPptx(output);
      return {
        warnings: loaded.warnings,
        model,
        output: [...output],
        reopened: readChartModel(
          reopened.deck.slides[9].elements.find((e) => e.type === "chart")!
            .chart!,
        ),
      };
    },
    [...bytes],
  );
  expect(result.model!.plots[0].series.map((s) => s.values.length)).toEqual([
    16, 16, 16,
  ]);
  expect(result.reopened.plots[0].series.map((s) => s.values)).toEqual(
    result.model!.plots[0].series.map((s) => s.values),
  );
  expect(result.warnings).not.toContain(
    "차트는 이 버전에서 가져오지 않습니다.",
  );
  await page
    .locator('input[accept*=".pptx"]')
    .setInputFiles({
      name: "reported.pptx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      buffer: bytes,
    });
  await page.getByRole("button", { name: /^슬라이드 10:/ }).click();
  await expect(page.locator(".editable-slide [data-chart-line]")).toHaveCount(
    3,
  );
  await page
    .locator(".editable-slide")
    .screenshot({ path: info.outputPath("reported-slide-10.png") });
  await fs.writeFile(
    info.outputPath("reported-roundtrip.pptx"),
    Buffer.from(result.output),
  );
});
