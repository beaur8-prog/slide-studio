import { expect, test, type Page } from "@playwright/test";
import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import fs from "node:fs/promises";

async function fixture(
  options: {
    style?: string;
    marker?: string;
    blank?: string;
    values?: (number | null)[];
    categories?: string[];
    series?: number;
    transform?: (xml: string) => string;
  } = {},
) {
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_WIDE";
  const values = options.values ?? [8.2, 3.2, 1.4, 1.2];
  const names = options.categories ?? values.map((_, i) => `Quarter ${i + 1}`);
  deck.addSlide().addChart(
    "radar",
    Array.from({ length: options.series ?? 1 }, (_, i) => ({
      name: `Sales ${i + 1}`,
      labels: names,
      values: values.map((v) => (v === null ? 0 : v + i)),
    })),
    {
      x: 1,
      y: 0.7,
      w: 10,
      h: 5.5,
      radarStyle: "standard",
      showLegend: true,
      legendPos: "r",
      showTitle: true,
      title: "Radar",
      catAxisLabelFontSize: 13,
      valAxisLabelFontSize: 12,
      showValue: false,
    },
  );
  const zip = await JSZip.loadAsync(
    (await deck.write({
      outputType: "uint8array",
      compression: true,
    })) as Uint8Array,
  );
  const path = Object.keys(zip.files).find((p) =>
    /^ppt\/charts\/chart\d+\.xml$/.test(p),
  )!;
  let xml = await zip.file(path)!.async("string");
  xml = xml
    .replace(
      /<c:radarStyle[^>]*\/>/,
      `<c:radarStyle val="${options.style ?? "standard"}"/>`,
    )
    .replace(
      /<c:dispBlanksAs[^>]*\/>/,
      `<c:dispBlanksAs val="${options.blank ?? "gap"}"/>`,
    )
    .replace(/<c:ser>[\s\S]*?<\/c:ser>/g, (series) => {
      const marker = `<c:marker><c:symbol val="${options.marker ?? "none"}"/><c:size val="6"/></c:marker>`;
      series = /<c:marker>/.test(series)
        ? series.replace(/<c:marker>[\s\S]*?<\/c:marker>/, marker)
        : series.replace("</c:spPr>", "</c:spPr>" + marker);
      return series.replace(/<c:val>[\s\S]*?<\/c:val>/, (value) =>
        value.replace(/<c:pt idx="(\d+)">[\s\S]*?<\/c:pt>/g, (point, i) =>
          values[Number(i)] === null ? "" : point,
        ),
      );
    });
  if (options.transform) xml = options.transform(xml);
  zip.file(path, xml);
  return zip.generateAsync({ type: "nodebuffer" });
}
async function open(page: Page, bytes: Buffer) {
  const zip = await JSZip.loadAsync(bytes);
  const chartPath = Object.keys(zip.files).find((p) =>
    /^ppt\/charts\/chart\d*\.xml$/.test(p),
  )!;
  const expectedXml = await zip.file(chartPath)!.async("string");
  await page.goto("http://127.0.0.1:5190");
  await page.locator('input[accept*=".pptx"]').setInputFiles({
    name: "radar.pptx",
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
      page.evaluate(async (expectedXml) => {
        const { loadAutosave } = await import("/src/storage.ts");
        const { chartPartText } = await import("/src/chart.ts");
        const source = (await loadAutosave())?.slides[0].elements.find(
          (e) => e.type === "chart",
        )?.chart;
        return (
          source &&
          chartPartText(
            source.parts.find((p) => p.path === source.root)!.data,
          ) === expectedXml
        );
      }, expectedXml),
    )
    .toBe(true);
}
async function model(page: Page) {
  return page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts");
    const { readChartModel } = await import("/src/chart.ts");
    return readChartModel(
      (await loadAutosave())!.slides[0].elements.find(
        (e) => e.type === "chart",
      )!.chart!,
    );
  });
}

test("public Office radar has a closed four-category Sales line, correctly ordered values, and no explicit-none markers", async ({
  page,
}, info) => {
  await open(page, await fs.readFile("qa/samples/poi-radar-chart.pptx"));
  const chart = page.locator(".editable-slide .chart-visual");
  await expect(chart.locator("[data-chart-radar-series]")).toHaveCount(1);
  await expect(chart.locator("[data-chart-point]")).toHaveCount(0);
  await expect(chart).not.toContainText("아직 지원하지");
  expect((await model(page)).approximate).toBe(false);
  const result = await chart.evaluate((svg) => {
    const radar = svg.querySelector("[data-chart-radar]")!;
    return {
      title: svg.querySelector("text")?.textContent,
      ticks: [...svg.querySelectorAll("[data-chart-value-tick]")].map(
        (n) => n.textContent,
      ),
      labels: [...svg.querySelectorAll("[data-chart-category-label]")].map(
        (n) => ({
          text: n.childNodes[0].textContent,
          x: Number(n.getAttribute("x")),
          y: Number(n.getAttribute("y")),
        }),
      ),
      path: svg.querySelector("[data-chart-radar-series]")!.getAttribute("d"),
      cx: Number(radar.getAttribute("data-chart-radar-cx")),
      cy: Number(radar.getAttribute("data-chart-radar-cy")),
      radius: Number(radar.getAttribute("data-chart-radar-radius")),
    };
  });
  expect(result.title).toBe("Sales");
  expect(result.ticks).toEqual(["0", "2", "4", "6", "8", "10"]);
  expect(result.labels.map((p) => p.text)).toEqual([
    "1st Qtr",
    "2nd Qtr",
    "3rd Qtr",
    "4th Qtr",
  ]);
  expect(result.labels[0].y).toBeLessThan(result.cy);
  expect(result.labels[1].x).toBeGreaterThan(result.cx);
  expect(result.labels[2].y).toBeGreaterThan(result.cy);
  expect(result.labels[3].x).toBeLessThan(result.cx);
  const points = result.path!.match(/[-+]?[\d.]+(?:e[-+]?\d+)?/gi)!.map(Number);
  expect(points[0]).toBeCloseTo(result.cx, 5);
  expect(result.cy - points[1]).toBeCloseTo(result.radius * 0.82, 5);
  expect(points[2] - result.cx).toBeCloseTo(result.radius * 0.32, 5);
  expect(points[5] - result.cy).toBeCloseTo(result.radius * 0.14, 5);
  expect(result.cx - points[6]).toBeCloseTo(result.radius * 0.12, 5);
  expect(result.path).toMatch(/Z$/);
  await chart.screenshot({ path: info.outputPath("public-radar.png") });
});

for (const style of ["standard", "marker", "filled"]) {
  test(`${style} radar respects explicit line/fill alpha, source series order, marker symbols and noFill`, async ({
    page,
  }, info) => {
    const bytes = await fixture({
      style,
      marker: style === "standard" ? "none" : "diamond",
      series: 2,
      transform: (xml) => {
        let i = 0;
        return xml.replace(/<c:ser>[\s\S]*?<\/c:ser>/g, (ser) => {
          const current = i++;
          return ser.replace(
            /<c:spPr>[\s\S]*?<\/c:spPr>/,
            `<c:spPr>${current ? "<a:noFill/>" : '<a:solidFill><a:srgbClr val="C00000"><a:alpha val="50000"/></a:srgbClr></a:solidFill>'}<a:ln w="38100"><a:solidFill><a:srgbClr val="008800"><a:alpha val="75000"/></a:srgbClr></a:solidFill></a:ln></c:spPr>`,
          );
        });
      },
    });
    await open(page, bytes);
    const chart = page.locator(".editable-slide .chart-visual");
    await expect(chart.locator("[data-chart-radar-series]")).toHaveCount(2);
    await expect(chart.locator("[data-chart-point]")).toHaveCount(
      style === "standard" ? 0 : 8,
    );
    await expect(
      chart.locator("[data-chart-radar-series]").first(),
    ).toHaveAttribute("stroke", "#008800");
    await expect(
      chart.locator("[data-chart-radar-series]").first(),
    ).toHaveAttribute("stroke-opacity", "0.75");
    await expect(
      chart.locator("[data-chart-radar-series]").first(),
    ).toHaveAttribute("stroke-width", "4");
    if (style === "filled") {
      await expect(
        chart.locator("[data-chart-radar-series]").first(),
      ).toHaveAttribute("fill", "#C00000");
      await expect(
        chart.locator("[data-chart-radar-series]").first(),
      ).toHaveAttribute("fill-opacity", "0.5");
      await expect(
        chart.locator("[data-chart-radar-series]").nth(1),
      ).toHaveAttribute("fill-opacity", "0");
    } else
      await expect(
        chart.locator("[data-chart-radar-series]").first(),
      ).toHaveAttribute("fill", "none");
    await chart.screenshot({ path: info.outputPath(`${style}-radar.png`) });
  });
}

test("circular gaps break only adjacent edges; span and zero are explicit and never mutate source values", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { radarSeriesPath } = await import("/src/chart-radar.ts");
    const points = [{ x: 0, y: -2 }, { x: 2, y: 0 }, null, { x: -2, y: 0 }];
    const before = JSON.stringify(points);
    return {
      gap: radarSeriesPath(points, "gap"),
      span: radarSeriesPath(points, "span"),
      firstGap: radarSeriesPath([null, ...points.slice(1)], "gap"),
      empty: radarSeriesPath([null, null, null], "gap"),
      unchanged: JSON.stringify(points) === before,
    };
  });
  expect(result).toEqual({
    gap: "M-2,0 L0,-2 L2,0",
    span: "M0,-2 L2,0 L-2,0 Z",
    firstGap: "M2,0 M-2,0",
    empty: "",
    unchanged: true,
  });
  for (const blank of ["gap", "span", "zero"]) {
    await open(
      page,
      await fixture({
        style: "marker",
        marker: "circle",
        blank,
        values: [8, 3, null, 1],
      }),
    );
    await expect(
      page.locator(".editable-slide [data-chart-point]"),
    ).toHaveCount(blank === "zero" ? 4 : 3);
    const path = await page
      .locator(".editable-slide [data-chart-radar-series]")
      .getAttribute("d");
    expect(path?.endsWith("Z")).toBe(blank !== "gap");
    expect((await model(page)).plots[0].series[0].values).toEqual([
      8,
      3,
      null,
      1,
    ]);
  }
});

test("unverified radar geometry stays explicit, finite and native instead of drawing a misleading chart", async ({
  page,
}) => {
  const cases = [
    { values: [2, 3] },
    { values: [-2, 3, 4] },
    { style: "unknown" },
    { style: "filled", values: [2, null, 3] },
    {
      transform: (xml: string) =>
        xml.replace(/<c:valAx>[\s\S]*?<\/c:valAx>/, (axis) =>
          axis.replace("<c:scaling>", '<c:scaling><c:logBase val="10"/>'),
        ),
    },
    { transform: (xml: string) => xml.replace('val="minMax"', 'val="maxMin"') },
    {
      transform: (xml: string) =>
        xml.replace(
          "</c:plotArea>",
          '<c:lineChart><c:grouping val="standard"/></c:lineChart></c:plotArea>',
        ),
    },
  ];
  for (const options of cases) {
    await open(page, await fixture(options));
    const chart = page.locator(".editable-slide .chart-visual");
    await expect(chart.locator("[data-chart-radar-series]")).toHaveCount(0);
    await expect(chart).toContainText("아직 지원하지");
    expect((await model(page)).approximate).toBe(true);
    expect(await chart.innerHTML()).not.toMatch(/NaN|Infinity/);
  }
});

test("zero and empty radar values keep finite zero-based grids, and data labels use source number formats", async ({
  page,
}) => {
  for (const values of [
    [0, 0, 0, 0],
    [null, null, null, null],
  ]) {
    await open(page, await fixture({ values }));
    const chart = page.locator(".editable-slide .chart-visual");
    expect(await chart.innerHTML()).not.toMatch(/NaN|Infinity/);
    expect(
      await chart.locator("[data-chart-value-tick]").allTextContents(),
    ).toContain("0");
    expect((await model(page)).plots[0].series[0].values).toEqual(values);
  }
  await open(
    page,
    await fixture({
      transform: (xml) =>
        xml
          .replace("</c:radarStyle>", "</c:radarStyle>")
          .replace(
            "</c:ser>",
            '<c:dLbls><c:numFmt formatCode="$0.0" sourceLinked="0"/><c:showVal val="1"/></c:dLbls></c:ser>',
          ),
    }),
  );
  expect(
    await page
      .locator(".editable-slide [data-chart-data-label]")
      .allTextContents(),
  ).toEqual(["$8.2", "$3.2", "$1.4", "$1.2"]);
});

test("radar native style, full XML, data and workbook survive mixed-theme copy and three saves", async ({
  page,
}, info) => {
  const bytes = await fs.readFile("qa/samples/poi-radar-chart.pptx");
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
        deck.slides.map((slide) => {
          const source = slide.elements.find((e) => e.type === "chart")!.chart!;
          const doc = new DOMParser().parseFromString(
            chartPartText(
              source.parts.find((p) => p.path === source.root)!.data,
            ),
            "application/xml",
          );
          return {
            model: readChartModel(source),
            plot: new XMLSerializer().serializeToString(
              doc.getElementsByTagNameNS("*", "radarChart")[0],
            ),
            workbook: source.parts
              .filter((p) => p.contentType.includes("spreadsheetml"))
              .map((p) => p.data),
          };
        });
      const rounds = [snapshot()];
      let output: Uint8Array | undefined;
      for (let i = 0; i < 3; i++) {
        output = await exportPptx(deck);
        deck = (await importPptx(output)).deck;
        rounds.push(snapshot());
      }
      return { rounds, bytes: [...output!] };
    },
    [...bytes],
  );
  const first = result.rounds[0][0];
  expect(first.workbook).toHaveLength(1);
  for (const round of result.rounds)
    for (const chart of round) expect(chart).toEqual(first);
  await fs.writeFile(
    info.outputPath("radar-mixed-theme-saved3.pptx"),
    Buffer.from(result.bytes),
  );
});

test("ten thousand categories preserve values and markers while labels and grid DOM stay bounded", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const count = 10000;
  const bytes = await fixture({
    style: "marker",
    marker: "circle",
    values: Array.from({ length: count }, (_, i) => (i % 10) + 1),
    categories: Array.from(
      { length: count },
      (_, i) => `한글 범주 ${i} 긴 텍스트`,
    ),
  });
  const start = Date.now();
  await open(page, bytes);
  const chart = page.locator(".editable-slide .chart-visual");
  await expect(chart.locator("[data-chart-radar-series]")).toHaveCount(1);
  await expect(chart.locator("[data-chart-marker-batch]")).toHaveCount(1);
  const source = await model(page);
  expect(source.plots[0].series[0].values).toHaveLength(count);
  expect(
    await chart.locator("[data-chart-category-label]").count(),
  ).toBeLessThanOrEqual(48);
  expect(
    await chart.locator("[data-chart-radar-grid]").count(),
  ).toBeLessThanOrEqual(2);
  expect(await chart.locator("*").count()).toBeLessThan(250);
  expect(await chart.innerHTML()).not.toMatch(/NaN|Infinity/);
  await fs.writeFile(
    info.outputPath("dense-radar.json"),
    JSON.stringify({
      count,
      elapsedMs: Date.now() - start,
      dom: await chart.locator("*").count(),
    }),
  );
});

test("explicit value bounds clip series paths while outer-ring markers stay complete and out-of-range values stay native", async ({
  page,
}, info) => {
  await open(
    page,
    await fixture({
      style: "marker",
      marker: "diamond",
      values: [10, 20, 5, 2],
      transform: (xml) =>
        xml.replace(/<c:valAx>[\s\S]*?<\/c:valAx>/, (axis) =>
          axis.replace(
            "<c:scaling>",
            '<c:scaling><c:min val="0"/><c:max val="10"/>',
          ),
        ),
    }),
  );
  const chart = page.locator(".editable-slide .chart-visual");
  await expect(chart.locator("[data-chart-point]")).toHaveCount(3);
  const attributes = await chart
    .locator("[data-chart-point]")
    .first()
    .evaluate((node) => {
      const path = node as SVGGraphicsElement,
        ancestors = [];
      let parent = path.parentElement;
      while (parent && parent.tagName.toLowerCase() !== "svg") {
        if (parent.hasAttribute("clip-path"))
          ancestors.push(parent.getAttribute("clip-path"));
        parent = parent.parentElement;
      }
      return {
        width: path.getBBox().width,
        height: path.getBBox().height,
        clips: ancestors,
      };
    });
  expect(attributes.width).toBeCloseTo(8, 5);
  expect(attributes.height).toBeCloseTo(8, 5);
  // Only the outer plot rectangle clips markers; a radial ring would bisect a
  // marker whose center is exactly on the explicitly selected maximum.
  expect(attributes.clips).toHaveLength(1);
  await expect(chart.locator("[data-chart-radar-series]")).toHaveAttribute(
    "clip-path",
    /radar/,
  );
  expect((await model(page)).plots[0].series[0].values).toEqual([10, 20, 5, 2]);
  await chart.screenshot({ path: info.outputPath("radar-explicit-max.png") });
});

for (const sourceLine of ["zero-width", "no-fill", "missing-width"]) {
  test(`radar ${sourceLine} line preserves explicit invisibility and the missing-width default`, async ({
    page,
  }) => {
    await open(
      page,
      await fixture({
        style: "marker",
        marker: "circle",
        transform: (xml) =>
          xml.replace(/<c:ser>[\s\S]*?<\/c:ser>/, (ser) =>
            ser.replace(
              /<c:spPr>[\s\S]*?<\/c:spPr>/,
              `<c:spPr><a:solidFill><a:srgbClr val="C00000"/></a:solidFill><a:ln${sourceLine === "zero-width" ? ' w="0"' : ""}>${sourceLine === "no-fill" ? "<a:noFill/>" : '<a:solidFill><a:srgbClr val="008800"/></a:solidFill>'}</a:ln></c:spPr>`,
            ),
          ),
      }),
    );
    const chart = page.locator(".editable-slide .chart-visual");
    const expected = sourceLine === "missing-width" ? 2.5 : 0;
    await expect(chart.locator("[data-chart-radar-series]")).toHaveAttribute(
      "stroke-width",
      String(expected),
    );
    await expect(chart.locator("[data-chart-radar-series]")).toHaveAttribute(
      "stroke",
      expected ? "#008800" : "none",
    );
    await expect(chart.locator("[data-chart-legend] line")).toHaveCount(
      expected ? 1 : 0,
    );
    await expect(chart.locator("[data-chart-point]")).toHaveCount(4);
    const original = await model(page);
    expect(original.plots[0].series[0].radarLine?.width).toBe(expected);
    expect(original.plots[0].series[0].width).toBe(expected);
  });
}
