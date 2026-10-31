import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";

const sample = "qa/samples/dickinson-workplace.pptx";
async function open(page: Page, bytes: Buffer, slide = 0) {
  await page.goto("http://127.0.0.1:5190");
  await page.locator('input[accept*=".pptx"]').setInputFiles({
    name: "chart-layout.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: bytes,
  });
  await expect(page.locator(".busy-backdrop")).toHaveCount(0);
  if (slide)
    await page
      .getByRole("button", { name: new RegExp(`^슬라이드 ${slide + 1}:`) })
      .click();
  await expect(page.locator('.editable-slide [data-type="chart"]')).toHaveCount(
    1,
  );
}

test("Dickinson stacked chart keeps original series index colors, currency labels and year ticks", async ({
  page,
}, info) => {
  test.skip(
    !existsSync(sample),
    "Download the public Dickinson comparison sample to qa/samples first.",
  );
  const bytes = await fs.readFile(sample);
  await open(page, bytes, 3);
  const chart = page.locator(".editable-slide .chart-visual");
  const red = chart.locator('[data-chart-bar="0-1"]').first();
  await expect(red).toHaveAttribute("fill", /#c00000/i);
  await expect(chart.locator("[data-chart-data-label]")).toHaveCount(15);
  await expect(chart.locator("[data-chart-data-label]")).toContainText([
    "$0.5",
    "$0.5",
    "$1.5",
    "$2.2",
    "-$1.0",
    "$1.4",
  ]);
  await expect(chart.locator("[data-chart-category-label]")).toHaveCount(11);
  await expect(chart.locator("[data-chart-annotation]")).toHaveCount(4);
  await expect(chart.locator("[data-chart-annotation]")).toContainText([
    "$6.3",
    "$7.4",
    "$7.0",
    "$5.7",
  ]);
  await expect(chart.locator("[data-chart-value-tick]")).toContainText([
    "($2.0)",
    "($1.0)",
    "$0.0",
    "$1.0",
    "$2.0",
    "$3.0",
    "$4.0",
    "$5.0",
    "$6.0",
    "$7.0",
    "$8.0",
  ]);
  await chart.screenshot({ path: info.outputPath("dickinson-chart.png") });
});

test("numeric chart labels follow quoted currencies, decimal places, percentages and negative sections", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const values = await page.evaluate(async () => {
    const { formatChartNumber } = await import("/src/chart.ts");
    return [
      [1234.5, '"$"#,##0.00'],
      [-1234.5, "\\$#,##0.0_);\\(\\$#,##0.0\\)"],
      [-1, '"$"#,##0.0'],
      [0.1234, "0.00%"],
      [0.5, "0.0%"],
      [1200000, '0.0,,"M"'],
      [1.2, '0.00;[Red](0.00);"-"'],
      [0, '0.00;[Red](0.00);"-"'],
      [-2.4, '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)'],
      [0, '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)'],
      [2, '0"; items"'],
      [2, '0"% literal"'],
      [2.45, "General"],
      [0.000001, "0.000000"],
    ].map(([value, code]) =>
      formatChartNumber(value as number, code as string),
    );
  });
  expect(values).toEqual([
    "$1,234.50",
    "($1,234.5)",
    "-$1.0",
    "12.34%",
    "50.0%",
    "1.2M",
    "1.20",
    "-",
    "(2.40)",
    "-",
    "2; items",
    "2% literal",
    "2.45",
    "0.000001",
  ]);
});

async function labelledFixture(kind = "bar") {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx
    .addSlide()
    .addChart(
      kind as any,
      [{ name: "Values", labels: ["A", "B", "C"], values: [1.25, -2.5, 3.75] }],
      {
        x: 1,
        y: 1,
        w: 10,
        h: 5,
        chartColors: ["C00000"],
        showValue: true,
        dataLabelFormatCode: '"₩"0.00',
        dataLabelPosition: "ctr",
        showLegend: false,
      },
    );
  return Buffer.from(
    (await pptx.write({
      outputType: "uint8array",
      compression: true,
    })) as Uint8Array,
  );
}

test("plot and series label inheritance respects per-point deletion, overrides, and source linked format", async ({
  page,
}, info) => {
  const zip = await JSZip.loadAsync(await labelledFixture());
  const chartPath = Object.keys(zip.files).find((name) =>
    /^ppt\/charts\/chart\d+\.xml$/.test(name),
  )!;
  let xml = await zip.file(chartPath)!.async("string");
  xml = xml.replace(
    /<c:dLbls>.*?<\/c:dLbls>/s,
    `<c:dLbls><c:dLbl><c:idx val="1"/><c:delete val="1"/></c:dLbl><c:dLbl><c:idx val="2"/><c:numFmt formatCode="0.0%" sourceLinked="0"/><c:dLblPos val="outEnd"/></c:dLbl><c:numFmt formatCode="&quot;₩&quot;0.00" sourceLinked="0"/><c:dLblPos val="ctr"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/></c:dLbls>`,
  );
  zip.file(chartPath, xml);
  await open(page, await zip.generateAsync({ type: "nodebuffer" }));
  const chart = page.locator(".editable-slide .chart-visual");
  await expect(chart.locator("[data-chart-data-label]")).toHaveCount(2);
  await expect(chart.locator("[data-chart-data-label]")).toContainText([
    "₩1.25",
    "375.0%",
  ]);
  await chart.screenshot({
    path: info.outputPath("point-label-overrides.png"),
  });
});

test("Dickinson chart data, number formats, annotations and workbook survive three PPTX saves", async ({
  page,
}, info) => {
  test.skip(
    !existsSync(sample),
    "Download the public Dickinson comparison sample to qa/samples first.",
  );
  await page.goto("http://127.0.0.1:5190");
  const bytes = await fs.readFile(sample);
  const result = await page.evaluate(
    async (data) => {
      const { importPptx, exportPptx, parseDeckJson } = await import(
        "/src/io.ts"
      );
      const { readChartModel } = await import("/src/chart.ts");
      let deck = (await importPptx(new Uint8Array(data))).deck;
      const chart = () =>
        deck.slides[3].elements.find((element) => element.type === "chart")!
          .chart!;
      const before = readChartModel(chart());
      const originalWorkbook = chart().parts.find((part) =>
        part.path.endsWith(".xlsx"),
      )!.data;
      const rounds = [];
      let saved = new Uint8Array();
      for (let round = 0; round < 3; round++) {
        deck = parseDeckJson(JSON.stringify(deck));
        saved = await exportPptx(deck);
        deck = (await importPptx(saved)).deck;
        rounds.push({
          model: readChartModel(chart()),
          workbookIdentical:
            chart().parts.find((part) => part.path.endsWith(".xlsx"))!.data ===
            originalWorkbook,
        });
      }
      return { before, rounds, saved: [...saved] };
    },
    [...bytes],
  );
  for (const round of result.rounds) {
    expect(round.workbookIdentical).toBe(true);
    expect(round.model).toEqual(result.before);
  }
  expect(result.before.plots[0].series[1].values).toEqual([
    -1, 1.4, 1.6, 2.5, 3.3, 4.1, 5.1, 6.478000000000002, 5.833,
    5.830999999999999, 3.4999999999999987,
  ]);
  await fs.writeFile(
    info.outputPath("dickinson-roundtrip.pptx"),
    Buffer.from(result.saved),
  );
});

test("source linked labels use the number-cache format instead of stale display formatting", async ({
  page,
}) => {
  const zip = await JSZip.loadAsync(await labelledFixture());
  const chartPath = Object.keys(zip.files).find((name) =>
    /^ppt\/charts\/chart\d+\.xml$/.test(name),
  )!;
  let xml = await zip.file(chartPath)!.async("string");
  xml = xml.replace(
    /<c:dLbls>.*?<\/c:dLbls>/s,
    `<c:dLbls><c:numFmt formatCode="0%" sourceLinked="1"/><c:dLblPos val="ctr"/><c:showVal val="1"/></c:dLbls>`,
  );
  xml = xml.replace(
    /(<c:numCache>\s*<c:formatCode>).*?(<\/c:formatCode>)/s,
    "$1&quot;€&quot;0.0$2",
  );
  xml = xml.replace(
    '<c:pt idx="1"><c:v>-2.5</c:v>',
    '<c:pt idx="1" formatCode="0.00%"><c:v>-2.5</c:v>',
  );
  zip.file(chartPath, xml);
  await open(page, await zip.generateAsync({ type: "nodebuffer" }));
  await expect(
    page.locator(".editable-slide [data-chart-data-label]"),
  ).toContainText(["€1.3", "-250.00%", "€3.8"]);
});

for (const kind of ["pie", "doughnut", "line", "scatter", "bar"])
  test(`${kind} chart renders requested data labels without changing the underlying values`, async ({
    page,
  }, info) => {
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    pptx
      .addSlide()
      .addChart(
        kind as any,
        [
          ...(kind === "scatter"
            ? [{ name: "X", labels: ["A", "B", "C"], values: [1, 2, 3] }]
            : []),
          { name: "Values", labels: ["A", "B", "C"], values: [10, 20, 30] },
        ],
        {
          x: 1,
          y: 1,
          w: 10,
          h: 5,
          chartColors: ["C00000", "008800", "0000CC"],
          showValue: true,
          dataLabelFormatCode: "0.0",
          dataLabelPosition: kind === "bar" ? "ctr" : undefined,
          showLegend: true,
        },
      );
    const bytes = Buffer.from(
      (await pptx.write({
        outputType: "uint8array",
        compression: true,
      })) as Uint8Array,
    );
    await open(page, bytes);
    await expect(
      page.locator(".editable-slide [data-chart-data-label]"),
    ).toContainText(["10.0", "20.0", "30.0"]);
    await page
      .locator(".editable-slide .chart-visual")
      .screenshot({ path: info.outputPath(`${kind}-data-labels.png`) });
  });

test("untrusted numeric format sizes and scale directives are bounded", async ({
  page,
}, info) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { formatChartNumber } = await import("/src/chart.ts");
    const started = performance.now();
    const formats = [
      "0".repeat(2_000_000),
      ";".repeat(2_000_000),
      "0" + "%".repeat(500),
      "0," + ",".repeat(500),
      "0." + "0".repeat(450),
      "0E+" + "0".repeat(450),
    ];
    const output = formats.map((format) => formatChartNumber(-123.45, format));
    const duration = performance.now() - started;
    return {
      output,
      duration,
      leadingZeros: formatChartNumber(3, "0000"),
      finitePercent: formatChartNumber(1e308, "0.0%"),
    };
  });
  expect(
    result.output.every(
      (value) =>
        typeof value === "string" &&
        value.length <= 512 &&
        !/NaN|Infinity|∞/.test(value),
    ),
  ).toBe(true);
  expect(result.output.slice(0, 2)).toEqual(["-123.45", "-123.45"]);
  expect(result.leadingZeros).toBe("0003");
  expect(result.finitePercent).toBe("1e+308");
  expect(result.duration).toBeLessThan(3000);
  await fs.writeFile(
    info.outputPath("number-format-budget.json"),
    JSON.stringify(result, null, 2),
  );
});

test("100k source points cannot multiply into 100k data-label elements", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await page.goto("http://127.0.0.1:5190");
  const fixture = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const points = Array.from(
      { length: 10000 },
      (_, i) => `<c:pt idx="${i}"><c:v>${i % 20}</c:v></c:pt>`,
    ).join("");
    const series = Array.from(
      { length: 10 },
      (_, i) =>
        `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>Series ${i}</c:v></c:tx><c:val><c:numLit><c:formatCode>0.0</c:formatCode><c:ptCount val="10000"/>${points}</c:numLit></c:val></c:ser>`,
    ).join("");
    const xml = `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:lineChart>${series}<c:dLbls><c:showVal val="1"/></c:dLbls></c:lineChart></c:plotArea></c:chart></c:chartSpace>`;
    const chart = {
      root: "ppt/charts/chart1.xml",
      colors: {},
      fontFamily: "Arial",
      parts: [
        {
          path: "ppt/charts/chart1.xml",
          contentType:
            "application/vnd.openxmlformats-officedocument.drawingml.chart+xml",
          data: btoa(xml),
          relationships: [],
        },
      ],
    };
    const deck = blankDeck();
    deck.slides[0].elements = [
      element("chart", { x: 20, y: 20, width: 1200, height: 640, chart }),
    ];
    return { deck, xmlBytes: xml.length };
  });
  const started = Date.now();
  await page.locator('input[accept*=".pptx"]').setInputFiles({
    name: "dense-line.slide",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(fixture.deck)),
  });
  await expect(page.locator(".editable-slide [data-chart-line]")).toHaveCount(
    10,
    { timeout: 30000 },
  );
  await expect(
    page.locator(".editable-slide [data-chart-data-label]"),
  ).toHaveCount(1000);
  const renderMs = Date.now() - started;
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { loadAutosave } = await import("/src/storage.ts");
        return (
          (await loadAutosave())?.slides[0].elements.some(
            (element) => element.type === "chart",
          ) ?? false
        );
      }),
    )
    .toBe(true);
  const result = await page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts"),
      { readChartModel, readChartPreview, chartPartText } = await import(
        "/src/chart.ts"
      );
    const deck = (await loadAutosave())!;
    const source = deck.slides[0].elements[0].chart!;
    const parseMs = Array.from({ length: 3 }, () => {
      const started = performance.now();
      readChartModel(source);
      return performance.now() - started;
    });
    const previewMs = Array.from({ length: 4 }, () => {
      const started = performance.now();
      readChartPreview(source);
      return performance.now() - started;
    });
    return {
      parseMs,
      previewMs,
      count: readChartModel(source).plots[0].series.reduce(
        (sum, series) => sum + series.values.length,
        0,
      ),
      sourceBytes: chartPartText(source.parts[0].data).length,
      invalidGeometry: [
        ...document.querySelectorAll(".editable-slide .chart-visual path"),
      ].some((path) => /NaN|Infinity/.test(path.getAttribute("d") ?? "")),
    };
  });
  expect(result.count).toBe(100000);
  expect(result.sourceBytes).toBe(fixture.xmlBytes);
  expect(result.invalidGeometry).toBe(false);
  await fs.writeFile(
    info.outputPath("dense-label-budget.json"),
    JSON.stringify(
      { ...result, renderMs, totalMs: Date.now() - started },
      null,
      2,
    ),
  );
});

for (const kind of ["bar", "line", "scatter"])
  test(`${kind} keeps null gaps, zero and mixed-sign series without invalid geometry`, async ({
    page,
  }) => {
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    const data = [
      ...(kind === "scatter"
        ? [{ name: "X", labels: ["A", "B", "C", "D"], values: [1, 2, 3, 4] }]
        : []),
      { name: "Mixed A", labels: ["A", "B", "C", "D"], values: [0, 2, -4, 3] },
      { name: "Mixed B", labels: ["A", "B", "C", "D"], values: [-2, 1, 0, 4] },
    ];
    pptx.addSlide().addChart(kind as any, data, {
      x: 1,
      y: 1,
      w: 10,
      h: 5,
      catName: false,
      showValue: true,
      dataLabelFormatCode: "0.0;(0.0)",
      showLegend: true,
      grouping: kind === "bar" ? "stacked" : undefined,
    });
    const zip = await JSZip.loadAsync(
      (await pptx.write({
        outputType: "uint8array",
        compression: true,
      })) as Uint8Array,
    );
    const filename = Object.keys(zip.files).find((name) =>
      /^ppt\/charts\/chart\d+\.xml$/.test(name),
    )!;
    let xml = await zip.file(filename)!.async("string");
    xml = xml.replace(/<c:(val|yVal)>.*?<\/c:\1>/gs, (cache) =>
      cache.replace(/<c:pt idx="1">.*?<\/c:pt>/s, ""),
    );
    zip.file(filename, xml);
    await open(page, await zip.generateAsync({ type: "nodebuffer" }));
    const labels = page.locator(".editable-slide [data-chart-data-label]");
    await expect(labels).toHaveCount(6);
    await expect(labels).toContainText([
      "0.0",
      "(4.0)",
      "3.0",
      "(2.0)",
      "0.0",
      "4.0",
    ]);
    const result = await page
      .locator(".editable-slide .chart-visual")
      .evaluate((svg) => ({
        invalid: [...svg.querySelectorAll("path,rect,circle,text,line")].some(
          (node) =>
            [...node.attributes].some((attribute) =>
              /NaN|Infinity/.test(attribute.value),
            ),
        ),
        gaps: [...svg.querySelectorAll("[data-chart-line]")].map(
          (node) => (node.getAttribute("d")?.match(/M/g) ?? []).length,
        ),
      }));
    expect(result.invalid).toBe(false);
    if (kind !== "bar") expect(result.gaps).toEqual([2, 2]);
  });

test("chart annotation and label previews remain bounded and render untrusted text as text", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const deck = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const escaped =
      "&lt;script&gt;window.chartInjection=true&lt;/script&gt;" +
      "A".repeat(2000);
    const xml = `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:chart><c:plotArea><c:barChart><c:ser><c:idx val="0"/><c:val><c:numLit><c:ptCount val="1"/><c:pt idx="0"><c:v>1</c:v></c:pt></c:numLit></c:val><c:dLbls><c:dLbl><c:idx val="0"/><c:tx><c:rich><a:p><a:r><a:t>${escaped}</a:t></a:r></a:p></c:rich></c:tx></c:dLbl></c:dLbls></c:ser></c:barChart></c:plotArea></c:chart><c:userShapes r:id="drawing"/></c:chartSpace>`;
    const drawing = `<c:userShapes xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:cdr="http://schemas.openxmlformats.org/drawingml/2006/chartDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${Array.from({ length: 250 }, (_, i) => `<cdr:relSizeAnchor><cdr:from><cdr:x>${i === 0 ? "1e308" : ".1"}</cdr:x><cdr:y>.1</cdr:y></cdr:from><cdr:to><cdr:x>.5</cdr:x><cdr:y>.2</cdr:y></cdr:to><cdr:sp><cdr:txBody><a:p><a:r><a:rPr sz="9000000"/><a:t>${escaped}</a:t></a:r></a:p></cdr:txBody></cdr:sp></cdr:relSizeAnchor>`).join("")}</c:userShapes>`;
    const root = "ppt/charts/chart1.xml",
      drawingPath = "ppt/drawings/drawing1.xml";
    const chart = {
      root,
      colors: {},
      fontFamily: "Arial",
      parts: [
        {
          path: root,
          contentType:
            "application/vnd.openxmlformats-officedocument.drawingml.chart+xml",
          data: btoa(xml),
          relationships: [
            {
              id: "drawing",
              type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartUserShapes",
              target: drawingPath,
            },
          ],
        },
        {
          path: drawingPath,
          contentType:
            "application/vnd.openxmlformats-officedocument.drawingml.chartshapes+xml",
          data: btoa(drawing),
          relationships: [],
        },
      ],
    };
    const deck = blankDeck();
    deck.slides[0].elements = [
      element("chart", { x: 20, y: 20, width: 1200, height: 640, chart }),
    ];
    return deck;
  });
  await page.locator('input[accept*=".pptx"]').setInputFiles({
    name: "annotations.slide",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(deck)),
  });
  await expect(
    page.locator(".editable-slide [data-chart-annotation]"),
  ).toHaveCount(200);
  const result = await page
    .locator(".editable-slide .chart-visual")
    .evaluate((svg) => ({
      scripts: svg.querySelectorAll("script").length,
      injected: (window as any).chartInjection === true,
      maxText: Math.max(
        ...[
          ...svg.querySelectorAll(
            "[data-chart-annotation],[data-chart-data-label]",
          ),
        ].map((node) => node.textContent?.length ?? 0),
      ),
      maxFont: Math.max(
        ...[...svg.querySelectorAll("[data-chart-annotation]")].map((node) =>
          Number(node.getAttribute("font-size")),
        ),
      ),
      invalid: /NaN|Infinity/.test(svg.innerHTML),
    }));
  expect(result).toEqual({
    scripts: 0,
    injected: false,
    maxText: 512,
    maxFont: 400,
    invalid: false,
  });
});

test("preview cache shares immutable models and invalidates source, theme, font and drawing changes", async ({
  page,
}) => {
  test.skip(
    !existsSync(sample),
    "Download the public Dickinson comparison sample to qa/samples first.",
  );
  await page.goto("http://127.0.0.1:5190");
  const bytes = await fs.readFile(sample);
  const result = await page.evaluate(
    async (data) => {
      const { importPptx } = await import("/src/io.ts");
      const { readChartPreview, chartPartText } = await import("/src/chart.ts");
      const chart = (
        await importPptx(new Uint8Array(data))
      ).deck.slides[3].elements.find(
        (element) => element.type === "chart",
      )!.chart!;
      const original = readChartPreview(chart),
        shared = readChartPreview(chart);
      const frozen =
        Object.isFrozen(original) &&
        Object.isFrozen(original.plots) &&
        Object.isFrozen(original.plots[0].series[0].values);
      const mutationBlocked = !Reflect.set(
        original.plots[0].series[0].values,
        "7",
        888,
      );
      const root = chart.parts.find((part) => part.path === chart.root)!;
      const xml = new DOMParser().parseFromString(
        chartPartText(root.data),
        "application/xml",
      );
      xml
        .getElementsByTagNameNS("*", "numCache")[0]
        .getElementsByTagNameNS("*", "v")[0].textContent = "99";
      root.data = btoa(new XMLSerializer().serializeToString(xml));
      const edited = readChartPreview(chart);
      chart.colors.accent1 = "#001122";
      const recolored = readChartPreview(chart);
      chart.fontFamily = "Courier New";
      const refonted = readChartPreview(chart);
      const userShapes = root.relationships.find((relationship) =>
        relationship.type.endsWith("/chartUserShapes"),
      )!;
      userShapes.target = "ppt/drawings/missing.xml";
      const changedDrawing = readChartPreview(chart);
      const copied = readChartPreview(structuredClone(chart));
      return {
        shared: original === shared,
        frozen,
        mutationBlocked,
        unchangedOriginal: original.plots[0].series[0].values[7],
        edited: edited.plots[0].series[0].values[7],
        newModel: edited !== original,
        editedStable: readChartPreview(chart) === changedDrawing,
        changedColor: recolored.plots[0].series[1].color,
        refonted: refonted.fontFamily,
        fontsInvalidate: refonted !== recolored,
        originalAnnotations: original.annotations.length,
        changedAnnotations: changedDrawing.annotations.length,
        copySeparate: copied !== changedDrawing,
      };
    },
    [...bytes],
  );
  expect(result).toMatchObject({
    shared: true,
    frozen: true,
    mutationBlocked: true,
    unchangedOriginal: 0.507,
    edited: 99,
    newModel: true,
    editedStable: true,
    changedColor: "#001122",
    refonted: "Courier New",
    fontsInvalidate: true,
    originalAnnotations: 4,
    changedAnnotations: 0,
    copySeparate: true,
  });
});

test("hiding axis labels preserves the requested gridlines", async ({
  page,
}) => {
  const zip = await JSZip.loadAsync(await labelledFixture());
  const filename = Object.keys(zip.files).find((name) =>
    /^ppt\/charts\/chart\d+\.xml$/.test(name),
  )!;
  const xml = (await zip.file(filename)!.async("string")).replace(
    /<c:tickLblPos val="[^"]*"\s*\/>/g,
    '<c:tickLblPos val="none"/>',
  );
  zip.file(filename, xml);
  await open(page, await zip.generateAsync({ type: "nodebuffer" }));
  const svg = page.locator(".editable-slide .chart-visual");
  await expect(
    svg.locator("[data-chart-value-tick], [data-chart-category-label]"),
  ).toHaveCount(0);
  expect(await svg.locator("[data-chart-grid]").count()).toBeGreaterThan(0);
});

for (const name of [
  "poi-bar-chart",
  "poi-line-chart",
  "poi-pie-chart",
  "poi-radar-chart",
  "poi-scatter-chart",
  "poi-chart-picture-bg",
])
  test(`public Apache POI ${name} retains chart data and artwork model across three saves`, async ({
    page,
  }, info) => {
    const filename = `qa/samples/${name}.pptx`;
    test.skip(
      !existsSync(filename),
      "Download the public Apache POI regression samples to qa/samples first.",
    );
    const bytes = await fs.readFile(filename);
    await page.goto("http://127.0.0.1:5190");
    const result = await page.evaluate(
      async (data) => {
        const { importPptx, exportPptx } = await import("/src/io.ts"),
          { readChartModel } = await import("/src/chart.ts");
        let deck = (await importPptx(new Uint8Array(data))).deck;
        const charts = () =>
          deck.slides.flatMap((slide, index) =>
            slide.elements
              .filter((element) => element.type === "chart")
              .map((element) => ({
                slide: index,
                model: readChartModel(element.chart!),
                workbooks: element
                  .chart!.parts.filter((part) => part.path.endsWith(".xlsx"))
                  .map((part) => part.data),
              })),
          );
        const before = charts(),
          rounds = [];
        for (let round = 0; round < 3; round++) {
          deck = (await importPptx(await exportPptx(deck))).deck;
          rounds.push(charts());
        }
        return { before, rounds };
      },
      [...bytes],
    );
    expect(result.before.length).toBeGreaterThan(0);
    for (const round of result.rounds) expect(round).toEqual(result.before);
    await page.locator('input[accept*=".pptx"]').setInputFiles({
      name: `${name}.pptx`,
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      buffer: bytes,
    });
    if (result.before[0].slide)
      await page
        .getByRole("button", {
          name: new RegExp(`^슬라이드 ${result.before[0].slide + 1}:`),
        })
        .click();
    const chart = page.locator('.editable-slide [data-type="chart"]').first();
    await expect(chart).toBeVisible();
    expect(
      await chart
        .locator("svg.chart-visual")
        .evaluate((svg) =>
          [...svg.querySelectorAll("path,rect,circle,text,line")].some((node) =>
            [...node.attributes]
              .filter((attribute) =>
                [
                  "d",
                  "cx",
                  "cy",
                  "x",
                  "y",
                  "width",
                  "height",
                  "x1",
                  "x2",
                  "y1",
                  "y2",
                ].includes(attribute.name),
              )
              .some((attribute) => /NaN|Infinity/.test(attribute.value)),
          ),
        ),
    ).toBe(false);
    await chart.screenshot({ path: info.outputPath(`${name}.png`) });
  });

for (const name of [
  "poi-bar-chart",
  "poi-line-chart",
  "poi-pie-chart",
  "poi-scatter-chart",
])
  test(`${name} restores automatic series title and original data direction`, async ({
    page,
  }, info) => {
    const filename = `qa/samples/${name}.pptx`;
    test.skip(
      !existsSync(filename),
      "Download the public Apache POI comparison samples to qa/samples first.",
    );
    await open(page, await fs.readFile(filename));
    const svg = page.locator(".editable-slide .chart-visual");
    await expect(svg).toHaveAttribute("aria-label", "Sales");
    if (name === "poi-bar-chart") {
      const first = await svg
          .locator('[data-chart-category-label="0"]')
          .getAttribute("y"),
        last = await svg
          .locator('[data-chart-category-label="3"]')
          .getAttribute("y");
      expect(Number(first)).toBeGreaterThan(Number(last));
    }
    if (name === "poi-scatter-chart") {
      await expect(svg.locator("[data-chart-point]")).toHaveCount(4);
      expect(
        await svg
          .locator("[data-chart-point]")
          .evaluateAll((nodes) =>
            nodes.map((node) => Number(node.getAttribute("cx"))),
          ),
      ).toEqual(
        [
          ...(await svg
            .locator("[data-chart-point]")
            .evaluateAll((nodes) =>
              nodes.map((node) => Number(node.getAttribute("cx"))),
            )),
        ].sort((a, b) => a - b),
      );
      await expect(svg.locator("[data-chart-value-tick]").last()).toHaveText(
        "9",
      );
    }
    if (name === "poi-line-chart")
      await expect(svg.locator("[data-chart-value-tick]").last()).toHaveText(
        "9",
      );
    await svg.screenshot({ path: info.outputPath(`${name}-corrected.png`) });
  });

test("copied charts preserve independent source themes, workbooks and native values in a mixed-theme deck", async ({
  page,
}, info) => {
  const other = "qa/samples/poi-bar-chart.pptx";
  test.skip(
    !existsSync(sample) || !existsSync(other),
    "Download the public Dickinson and Apache POI comparison samples first.",
  );
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(
    async ({ first, second }) => {
      const { importPptx, exportPptx } = await import("/src/io.ts"),
        { blankDeck, newSlide } = await import("/src/model.ts"),
        { copyElements } = await import("/src/object-groups.ts"),
        { readChartModel, readChartTheme, chartPartText, chartXml, child } =
          await import("/src/chart.ts"),
        { default: JSZip } = await import("/node_modules/.vite/deps/jszip.js");
      const sourceA = (await importPptx(new Uint8Array(first))).deck,
        sourceB = (await importPptx(new Uint8Array(second))).deck;
      const a = sourceA.slides[3].elements.find(
          (element) => element.type === "chart",
        )!,
        b = sourceB.slides[0].elements.find(
          (element) => element.type === "chart",
        )!;
      const copies = [copyElements([a], 0, 0)[0], copyElements([b], 0, 0)[0]];
      // The same object names occur in real mixed-source decks. Keep them equal
      // to exercise the preserved-node z-order fallback as well as state keys.
      copies.forEach((element) => {
        element.name = "Copied chart";
        element.width /= 2;
        element.height /= 2;
        element.groups = ["mixed-chart-group"];
      });
      let deck = blankDeck();
      deck.pptxSources = [
        ...(sourceA.pptxSources ?? []),
        ...(sourceB.pptxSources ?? []),
      ];
      deck.slides = [
        { ...newSlide("blank"), elements: copies },
        sourceA.slides[3],
      ];
      const nativeChartXml = (chart: any) => {
        const document = chartXml(
            chartPartText(
              chart.parts.find((part: any) => part.path === chart.root).data,
            ),
          ),
          colors = readChartTheme(chart).colors;
        // Theme aliases may be materialized as equivalent RGB by the existing
        // package writer. Compare all native content after that resolution.
        for (const scheme of [
          ...document.getElementsByTagNameNS(
            "http://schemas.openxmlformats.org/drawingml/2006/main",
            "schemeClr",
          ),
        ]) {
          const color = colors[scheme.getAttribute("val") ?? ""];
          if (!color) continue;
          const rgb = document.createElementNS(
            scheme.namespaceURI,
            "a:srgbClr",
          );
          rgb.setAttribute("val", color.slice(1));
          while (scheme.firstChild) rgb.append(scheme.firstChild);
          scheme.replaceWith(rgb);
        }
        const canonical = (node: Element): unknown => [
          node.namespaceURI,
          node.localName,
          [...node.attributes]
            .filter((attribute) => !attribute.name.startsWith("xmlns"))
            .map((attribute) => [
              attribute.namespaceURI,
              attribute.localName,
              attribute.value,
            ])
            .sort((a, b) => String(a[1]).localeCompare(String(b[1]))),
          [...node.childNodes].map((child) =>
            child.nodeType === Node.ELEMENT_NODE
              ? canonical(child as Element)
              : child.textContent,
          ),
        ];
        return JSON.stringify(
          canonical(child(document.documentElement, "chart")!),
        );
      };
      const snapshot = () =>
        deck.slides.flatMap((slide) =>
          slide.elements
            .filter((element) => element.type === "chart")
            .map((element) => ({
              model: readChartModel(element.chart!),
              nativeChartXml: nativeChartXml(element.chart!),
              workbooks: element
                .chart!.parts.filter((part) => part.path.endsWith(".xlsx"))
                .map((part) => part.data),
            })),
        );
      const before = snapshot(),
        rounds = [];
      let output = new Uint8Array();
      for (let round = 0; round < 3; round++) {
        output = await exportPptx(deck);
        const zip = await JSZip.loadAsync(output),
          types = await zip.file("[Content_Types].xml")!.async("string");
        deck = (await importPptx(output)).deck;
        rounds.push({
          charts: snapshot(),
          themeOverrides: (
            types.match(
              /ContentType="application\/vnd.openxmlformats-officedocument.themeOverride\+xml"/g,
            ) ?? []
          ).length,
        });
      }
      return { before, rounds, output: [...output] };
    },
    {
      first: [...(await fs.readFile(sample))],
      second: [...(await fs.readFile(other))],
    },
  );
  expect(result.before).toHaveLength(3);
  expect(result.before[0].model.plots[0].series[1].color).toBe("#C00000");
  expect(result.before[1].model.plots[0].series[0].color).not.toBe("#C00000");
  for (const round of result.rounds) {
    expect(round.charts).toEqual(result.before);
    expect(round.themeOverrides).toBe(3);
  }
  await fs.writeFile(
    info.outputPath("mixed-themes-roundtrip.pptx"),
    Buffer.from(result.output),
  );
});
