import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const sampleRoot = process.env.LAYOUT_COMPARISON_SAMPLES;

async function boot(page: Page) {
  await page.goto("http://127.0.0.1:5190");
  await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    (window as any).nativeTableFixture = async (
      options: {
        merged?: boolean;
        diagonals?: boolean;
        tint?: boolean;
      } = {},
    ) => {
      const deck = blankDeck();
      deck.slides[0].elements = [];
      const zip = await JSZip.loadAsync(await exportPptx(deck));
      const line = (
        name: string,
        color: string,
        width = 19050,
        alpha = 100000,
      ) =>
        `<a:${name} w="${width}"><a:solidFill><a:srgbClr val="${color}"><a:alpha val="${alpha}"/></a:srgbClr></a:solidFill></a:${name}>`;
      const cell = (r: number, c: number) => {
        const attrs = options.merged
          ? r === 0 && c === 0
            ? 'rowSpan="2" gridSpan="2"'
            : `${r ? 'vMerge="1"' : ""} ${c ? 'hMerge="1"' : ""}`
          : "";
        const text = options.merged && (r || c) ? "" : `${r}:${c}`;
        const diagonals = !options.diagonals
          ? ""
          : r === 0 && c === 0
            ? line("lnBlToTr", "1144AA", 28575, 50000) +
              line("lnTlToBr", "AA4411", 19050, 75000)
            : r === 0 && c === 1
              ? "<a:lnTlToBr><a:noFill/></a:lnTlToBr>"
              : "";
        return `<a:tc ${attrs}><a:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1000"/><a:t>${text}</a:t></a:r></a:p></a:txBody><a:tcPr marT="0" marR="0" marB="0" marL="0">${diagonals}</a:tcPr></a:tc>`;
      };
      const rows = options.tint ? 4 : 2;
      const table = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="101" name="native table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="381000" y="476250"/><a:ext cx="3810000" cy="1905000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr ${options.tint ? 'firstRow="1" bandRow="1"' : ""}><a:tableStyleId>compatibility</a:tableStyleId></a:tblPr><a:tblGrid><a:gridCol w="1905000"/><a:gridCol w="1905000"/></a:tblGrid>${Array.from({ length: rows }, (_, r) => `<a:tr h="${1905000 / rows}">${cell(r, 0)}${cell(r, 1)}</a:tr>`).join("")}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
      const name = "ppt/slides/slide1.xml";
      zip.file(
        name,
        (await zip.file(name).async("string")).replace(
          "</p:spTree>",
          table + "</p:spTree>",
        ),
      );
      const tint = (amount: number) =>
        `<a:fill><a:solidFill><a:srgbClr val="C00000"><a:tint val="${amount}"/></a:srgbClr></a:solidFill></a:fill>`;
      const diagonal = options.diagonals
        ? `<a:tcBdr><a:tl2br>${line("ln", "008800", 9525)}</a:tl2br></a:tcBdr>`
        : "";
      zip.file(
        "ppt/tableStyles.xml",
        `<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="compatibility"><a:tblStyle styleId="compatibility" styleName="Compatibility"><a:wholeTbl><a:tcStyle>${diagonal}${options.tint ? tint(20000) : ""}</a:tcStyle></a:wholeTbl>${options.tint ? `<a:band1H><a:tcStyle>${tint(40000)}</a:tcStyle></a:band1H><a:firstRow><a:tcStyle><a:fill><a:solidFill><a:srgbClr val="C00000"/></a:solidFill></a:fill></a:tcStyle></a:firstRow>` : ""}</a:tblStyle></a:tblStyleLst>`,
      );
      return (await importPptx(await zip.generateAsync({ type: "uint8array" })))
        .deck;
    };
    (window as any).renderTableDeck = async (deck: any, slide = 0) => {
      const { default: React } = await import(
        "/node_modules/.vite/deps/react.js"
      );
      const {
        default: { createRoot },
      } = await import("/node_modules/.vite/deps/react-dom_client.js");
      const { SlideVisual } = await import("/src/SlideCanvas.tsx");
      const old = (window as any).tableRender;
      old?.root.unmount();
      old?.host.remove();
      const host = document.createElement("div");
      host.id = "table-web-fixture";
      host.style.cssText =
        "position:fixed;left:0;top:0;z-index:100000;background:white";
      document.body.append(host);
      const root = createRoot(host);
      root.render(
        React.createElement(SlideVisual, {
          slide: deck.slides[slide],
          width: deck.width,
          height: deck.height,
          scale: Math.min(1, 1280 / deck.width),
        }),
      );
      (window as any).tableRender = { root, host };
      await document.fonts.ready;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    };
  });
}

test("DrawingML tint and shade blend in linear light while luminance transforms keep their HSL meaning", async ({
  page,
}) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const { applyDrawingmlColorTransforms, linearToSrgb, srgbToLinear } =
      await import("/src/drawingml-color.ts");
    const apply = (color: string, xml: string) =>
      applyDrawingmlColorTransforms(
        color,
        Array.from(
          new DOMParser().parseFromString(
            `<color>${xml}</color>`,
            "application/xml",
          ).documentElement.children,
        ),
      );
    return {
      bands: [40000, 20000].map(
        (v) => apply("#C00000", `<tint val="${v}"/>`).color,
      ),
      ends: [0, 100000].flatMap((v) =>
        ["tint", "shade"].map(
          (n) => apply("#4472C4", `<${n} val="${v}"/>`).color,
        ),
      ),
      shade: apply("#4472C4", '<shade val="50000"/>').color,
      hsl: apply("#C00000", '<lumMod val="50000"/><lumOff val="50000"/>').color,
      ordered: [
        apply("#808080", '<tint val="50000"/><shade val="50000"/>').color,
        apply("#808080", '<shade val="50000"/><tint val="50000"/>').color,
      ],
      alpha: apply(
        "#112233",
        '<alpha val="80000"/><alphaMod val="50000"/><alphaOff val="10000"/>',
      ),
      roundtrip: [0, 1, 10, 64, 128, 192, 254, 255].map((n) =>
        Math.round(linearToSrgb(srgbToLinear(n))),
      ),
      nan: apply("#112233", '<tint val="NaN"/>'),
    };
  });
  expect(result.bands).toEqual(["#E8CBCB", "#F4E7E7"]);
  expect(result.ends).toEqual(["#FFFFFF", "#000000", "#4472C4", "#4472C4"]);
  expect(result.shade).toBe("#2F528F");
  expect(result.hsl).toBe("#FF6060");
  expect(result.ordered[0]).not.toBe(result.ordered[1]);
  expect(result.alpha).toEqual({ color: "#112233", opacity: 0.5 });
  expect(result.roundtrip).toEqual([0, 1, 10, 64, 128, 192, 254, 255]);
  expect(result.nan).toEqual({ color: "#112233", opacity: 1 });
});

test("native table style precedence retains pale alternating bands and header fill", async ({
  page,
}) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const { tableCellStyle } = await import("/src/table.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    let deck = await (window as any).nativeTableFixture({ tint: true });
    const rounds = [];
    for (let i = 0; i < 3; i++) {
      rounds.push(
        deck.slides[0].elements[0].table.cells.map(
          (_: unknown, r: number) =>
            tableCellStyle(deck.slides[0].elements[0].table, r, 0).fill,
        ),
      );
      deck = (await importPptx(await exportPptx(deck))).deck;
    }
    await (window as any).renderTableDeck(deck);
    return rounds;
  });
  expect(result).toEqual(
    Array(3).fill(["#C00000", "#E8CBCB", "#F4E7E7", "#E8CBCB"]),
  );
  await expect(
    page.locator('#table-web-fixture [data-row="1"][data-column="0"]'),
  ).toHaveCSS("background-color", "rgb(232, 203, 203)");
});

test("native diagonals preserve direct override, inherited style and explicit no-fill", async ({
  page,
}) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const { tableCellStyle } = await import("/src/table.ts");
    const { tableBorderSegments } = await import("/src/table-borders.ts");
    const deck = await (window as any).nativeTableFixture({ diagonals: true });
    const element = deck.slides[0].elements[0];
    await (window as any).renderTableDeck(deck);
    return {
      styles: element.table.cells.map((row: unknown[], r: number) =>
        row.map((_, c) => tableCellStyle(element.table, r, c).diagonalBorders),
      ),
      segments: tableBorderSegments(element).filter((s) =>
        s.key.startsWith("d-"),
      ),
    };
  });
  expect(result.styles[0][0]).toEqual({
    tlToBr: { color: "#AA4411", width: 2, opacity: 0.75 },
    blToTr: { color: "#1144AA", width: 3, opacity: 0.5 },
  });
  expect(result.styles[0][1]).toEqual({
    tlToBr: { color: "transparent", width: 0 },
  });
  expect(result.styles[1][0]).toEqual({
    tlToBr: { color: "#008800", width: 1 },
  });
  expect(result.segments).toHaveLength(4);
  expect(result.segments.find((s) => s.key === "d-0-0-blToTr")).toMatchObject({
    x1: 0,
    y1: 100,
    x2: 200,
    y2: 0,
    width: 3,
    opacity: 0.5,
  });
  await expect(
    page.locator(
      '#table-web-fixture .table-border-overlay line[stroke="#1144AA"]',
    ),
  ).toHaveCount(1);
});

test("merged-cell diagonals span the full cell and survive three editable PPTX saves", async ({
  page,
}, info) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const { tableBorderSegments } = await import("/src/table-borders.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    let deck = await (window as any).nativeTableFixture({
      diagonals: true,
      merged: true,
    });
    // Exercise the editable exporter instead of reusing unchanged original XML.
    delete deck.pptxSources;
    for (const slide of deck.slides) {
      delete slide.pptxSource;
      for (const element of slide.elements) delete element.pptxRef;
    }
    const rounds = [];
    for (let i = 0; i < 3; i++) {
      deck.slides[0].elements[0].table.cells[0][0] = `edited ${i}`;
      const bytes = await exportPptx(deck);
      const zip = await JSZip.loadAsync(bytes);
      const xml = new DOMParser().parseFromString(
        await zip.file("ppt/slides/slide1.xml").async("string"),
        "application/xml",
      );
      const all = (name: string) =>
        Array.from(xml.getElementsByTagNameNS("*", name));
      rounds.push({
        cell: deck.slides[0].elements[0].table.cellStyles[0][0].diagonalBorders,
        diagonals: tableBorderSegments(deck.slides[0].elements[0]).filter((s) =>
          s.key.startsWith("d-"),
        ),
        native: all("lnBlToTr").map((n) => ({
          width: n.getAttribute("w"),
          alpha: n.getElementsByTagNameNS("*", "alpha")[0]?.getAttribute("val"),
        })),
        frames: all("graphicFrame").length,
        shapes: all("sp").length,
      });
      deck = (await importPptx(bytes)).deck;
    }
    await (window as any).renderTableDeck(deck);
    return rounds;
  });
  for (const round of result) {
    expect(round.cell.blToTr).toMatchObject({
      color: "#1144AA",
      width: 3,
      opacity: 0.5,
    });
    expect(round.diagonals).toHaveLength(2);
    expect(round.diagonals.find((s) => s.key === "d-0-0-blToTr")).toMatchObject(
      { x1: 0, y1: 200, x2: 400, y2: 0 },
    );
    expect(round.native).toContainEqual({ width: "28575", alpha: "50000" });
    expect(round.frames).toBe(1);
    expect(round.shapes).toBe(0);
  }
  await page
    .locator("#table-web-fixture .inserted-table")
    .screenshot({ path: info.outputPath("merged-diagonals.png") });
});

test("diagonal validation rejects invalid values and opacity normalization includes diagonals", async ({
  page,
}) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const { validateTableCellFormat, createTable, createTableElement } =
      await import("/src/table.ts");
    const { normalizeObjectAlpha } = await import("/src/colors.ts");
    const rejected = [
      { blToTr: { color: "#112233", width: -1 } },
      { tlToBr: { color: "url(unsafe)", width: 1 } },
      { tlToBr: { color: "#112233", width: 1, opacity: NaN } },
      { blToTr: { color: "#112233", width: 1, opacity: 2 } },
    ].map((diagonalBorders) => {
      try {
        validateTableCellFormat({ diagonalBorders });
        return false;
      } catch {
        return true;
      }
    });
    const proto = { blToTr: { color: "#FF0000", width: 100 } };
    const clean = validateTableCellFormat({
      diagonalBorders: Object.assign(Object.create(proto), {
        tlToBr: { color: "#aabbcc", width: 2 },
      }),
    });
    const table = createTable(1, 1);
    table.cells = [[""]];
    table.cellStyles = [
      [
        {
          fill: "#FFFFFF",
          fillOpacity: 0.4,
          borders: Array.from({ length: 4 }, () => ({
            color: "#112233",
            width: 1,
            opacity: 0.4,
          })),
          diagonalBorders: {
            blToTr: { color: "#334455", width: 2, opacity: 0.7 },
          },
        },
      ],
    ];
    const mixed = createTableElement(table);
    normalizeObjectAlpha(mixed);
    const uniform = structuredClone(mixed);
    uniform.table.cellStyles[0][0].diagonalBorders.blToTr.opacity = 0.4;
    normalizeObjectAlpha(uniform);
    return {
      rejected,
      clean,
      mixed: {
        opacity: mixed.opacity,
        diagonal: mixed.table.cellStyles[0][0].diagonalBorders.blToTr.opacity,
      },
      uniform: {
        opacity: uniform.opacity,
        diagonal: uniform.table.cellStyles[0][0].diagonalBorders.blToTr.opacity,
      },
    };
  });
  expect(result.rejected).toEqual([true, true, true, true]);
  expect(result.clean.diagonalBorders).toEqual({
    tlToBr: { color: "#AABBCC", width: 2 },
  });
  expect(result.mixed).toEqual({ opacity: 1, diagonal: 0.7 });
  expect(result.uniform).toEqual({ opacity: 0.4, diagonal: undefined });
});

for (const [sample, slide] of [
  ["dickinson-workplace", 4],
  ["dsu-korean", 15],
] as const) {
  test(`public ${sample} page ${slide + 1} retains the observed table colors or diagonal`, async ({
    page,
  }, info) => {
    test.skip(
      !sampleRoot,
      "Set LAYOUT_COMPARISON_SAMPLES to the downloaded public sample folder.",
    );
    const file = path.join(sampleRoot!, sample + ".pptx");
    test.skip(!fs.existsSync(file), "Public sample not downloaded.");
    await boot(page);
    const result = await page.evaluate(
      async ({ bytes, slide }) => {
        const { importPptx, exportPptx } = await import("/src/io.ts");
        const { tableCellStyle } = await import("/src/table.ts");
        const { tableBorderSegments } = await import("/src/table-borders.ts");
        let deck = (await importPptx(new Uint8Array(bytes))).deck;
        const rounds = [];
        for (let i = 0; i < 3; i++) {
          const table = deck.slides[slide].elements.find(
            (e) => e.type === "table",
          )!;
          rounds.push({
            fills: table.table!.cells.map(
              (_, r) => tableCellStyle(table.table!, r, 0).fill,
            ),
            diagonals: tableBorderSegments(table).filter((s) =>
              s.key.startsWith("d-"),
            ),
          });
          deck = (await importPptx(await exportPptx(deck))).deck;
        }
        await (window as any).renderTableDeck(deck, slide);
        return rounds;
      },
      { bytes: [...fs.readFileSync(file)], slide },
    );
    if (sample === "dickinson-workplace")
      for (const round of result)
        expect(round.fills).toEqual([
          "#C00000",
          "#E8CBCB",
          "#F4E7E7",
          "#E8CBCB",
          "#F4E7E7",
          "#E8CBCB",
          "#F4E7E7",
        ]);
    else for (const round of result) expect(round.diagonals).toHaveLength(1);
    await page
      .locator("#table-web-fixture .slide-visual")
      .screenshot({ path: info.outputPath(`${sample}-page-${slide + 1}.png`) });
  });
}

test("native diagonal edits override stale Studio table metadata", async ({
  page,
}) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const { createTable, createTableElement, tableCellStyle } = await import(
      "/src/table.ts"
    );
    const { blankDeck } = await import("/src/model.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const table = createTable(1, 1);
    table.header = false;
    table.striped = false;
    table.cells = [["Native edit"]];
    table.cellStyles = [
      [
        {
          diagonalBorders: {
            blToTr: { color: "#1144AA", width: 2, opacity: 0.5 },
          },
        },
      ],
    ];
    const deck = blankDeck();
    deck.slides[0].elements = [
      { ...createTableElement(table), x: 40, y: 40, width: 400, height: 100 },
    ];
    const original = await exportPptx(deck);
    const results = [];
    for (const mode of ["change", "remove", "add"] as const) {
      const zip = await JSZip.loadAsync(original);
      const name = "ppt/slides/slide1.xml";
      const doc = new DOMParser().parseFromString(
        await zip.file(name).async("string"),
        "application/xml",
      );
      const cp = doc.getElementsByTagNameNS("*", "tcPr")[0];
      const line = cp.getElementsByTagNameNS("*", "lnBlToTr")[0];
      if (mode === "remove") line.remove();
      else if (mode === "change") {
        line.setAttribute("w", "38100");
        line
          .getElementsByTagNameNS("*", "srgbClr")[0]
          .setAttribute("val", "FF8800");
      } else {
        const added = line.cloneNode(true) as Element;
        const renamed = doc.createElementNS(line.namespaceURI, "a:lnTlToBr");
        for (const a of Array.from(added.attributes))
          renamed.setAttribute(a.name, a.value);
        for (const child of Array.from(added.childNodes)) renamed.append(child);
        renamed
          .getElementsByTagNameNS("*", "srgbClr")[0]
          .setAttribute("val", "008800");
        cp.append(renamed);
      }
      zip.file(name, new XMLSerializer().serializeToString(doc));
      const imported = (
        await importPptx(await zip.generateAsync({ type: "uint8array" }))
      ).deck;
      const e = imported.slides[0].elements[0];
      results.push(tableCellStyle(e.table!, 0, 0).diagonalBorders);
    }
    return results;
  });
  expect(result[0]?.blToTr).toEqual({
    color: "#FF8800",
    width: 4,
    opacity: 0.5,
  });
  expect(result[1]?.blToTr).toBeUndefined();
  expect(result[2]?.tlToBr).toEqual({
    color: "#008800",
    width: 2,
    opacity: 0.5,
  });
});

test("rotated grayscale diagonals retain effective alpha across three PPTX saves", async ({
  page,
}, info) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const { createTable, createTableElement, tableCellStyle } = await import(
      "/src/table.ts"
    );
    const { blankDeck } = await import("/src/model.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const table = createTable(2, 2);
    table.header = false;
    table.striped = false;
    table.autoRows = false;
    table.cells = [
      ["Merged grayscale", ""],
      ["", ""],
    ];
    table.cellStyles = [
      [
        {
          diagonalBorders: {
            blToTr: { color: "#777777", width: 4, opacity: 0.4 },
            tlToBr: { color: "#222222", width: 2, opacity: 0.8 },
          },
        },
        null,
      ],
      [null, null],
    ];
    table.merges = [{ row: 0, column: 0, rowSpan: 2, columnSpan: 2 }];
    let deck = blankDeck();
    deck.slides[0].elements = [
      {
        ...createTableElement(table),
        x: 300,
        y: 160,
        width: 400,
        height: 220,
        rotation: 37,
        opacity: 0.6,
      },
    ];
    const rounds = [];
    for (let i = 0; i < 3; i++) {
      deck = (await importPptx(await exportPptx(deck))).deck;
      const e = deck.slides[0].elements[0];
      const style = tableCellStyle(e.table!, 0, 0);
      rounds.push({
        x: e.x,
        y: e.y,
        width: e.width,
        height: e.height,
        rotation: e.rotation,
        bl: {
          ...style.diagonalBorders!.blToTr,
          opacity:
            e.opacity *
            (style.diagonalBorders!.blToTr!.opacity ?? style.strokeOpacity),
        },
        tl: {
          ...style.diagonalBorders!.tlToBr,
          opacity:
            e.opacity *
            (style.diagonalBorders!.tlToBr!.opacity ?? style.strokeOpacity),
        },
      });
    }
    await (window as any).renderTableDeck(deck);
    return rounds;
  });
  for (const round of result) {
    expect(round).toMatchObject({
      x: 300,
      y: 160,
      width: 400,
      height: 220,
      rotation: 37,
    });
    expect(round.bl).toMatchObject({ color: "#777777", width: 4 });
    expect(round.bl.opacity).toBeCloseTo(0.24, 5);
    expect(round.tl).toMatchObject({ color: "#222222", width: 2 });
    expect(round.tl.opacity).toBeCloseTo(0.48, 5);
  }
  await page
    .locator("#table-web-fixture .slide-visual")
    .screenshot({ path: info.outputPath("rotated-alpha-diagonals.png") });
});

test("oversized table fallback keeps its rotated diagonal and text over three saves", async ({
  page,
}, info) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const { createTable, createTableElement } = await import("/src/table.ts");
    const { blankDeck } = await import("/src/model.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const table = createTable(1, 1);
    table.header = false;
    table.striped = false;
    table.cells = [["row"]];
    table.fontSize = 10;
    table.padding = 0;
    table.borderWidth = 0;
    table.cellStyles = [
      [
        {
          diagonalBorders: {
            blToTr: { color: "#444444", width: 2, opacity: 0.5 },
          },
        },
      ],
    ];
    const original = blankDeck();
    original.slides[0].elements = [
      {
        ...createTableElement(table),
        x: 220,
        y: 20,
        width: 200,
        height: 20,
        rotation: 17,
      },
    ];
    const zip = await JSZip.loadAsync(await exportPptx(original));
    const name = "ppt/slides/slide1.xml";
    const doc = new DOMParser().parseFromString(
      await zip.file(name).async("string"),
      "application/xml",
    );
    const first = doc.getElementsByTagNameNS("*", "tr")[0];
    first.setAttribute("h", "190500");
    for (let i = 1; i < 101; i++) {
      const copy = first.cloneNode(true) as Element;
      copy.getElementsByTagNameNS("*", "lnBlToTr")[0]?.remove();
      copy.getElementsByTagNameNS("*", "t")[0].textContent = `row ${i}`;
      first.parentElement!.append(copy);
    }
    zip.file(name, new XMLSerializer().serializeToString(doc));
    const imported = await importPptx(
      await zip.generateAsync({ type: "uint8array" }),
    );
    let deck = imported.deck;
    const warnings = imported.warnings;
    // Also cover native custom-path export rather than original-table passthrough.
    delete deck.pptxSources;
    for (const slide of deck.slides) {
      delete slide.pptxSource;
      for (const e of slide.elements) delete e.pptxRef;
    }
    const rounds = [];
    for (let i = 0; i < 3; i++) {
      const texts = deck.slides[0].elements.filter((e) => e.type === "text");
      const diagonals = deck.slides[0].elements.filter(
        (e) =>
          e.type === "shape" && e.shape === "custom" && e.stroke === "#444444",
      );
      rounds.push({
        texts: texts.length,
        last: texts.at(-1)?.text,
        lines: diagonals.length,
        line: diagonals[0] && {
          rotation: diagonals[0].rotation,
          width: diagonals[0].width,
          height: diagonals[0].height,
          alpha: diagonals[0].opacity * (diagonals[0].strokeOpacity ?? 1),
          path: diagonals[0].paths![0].d,
        },
      });
      deck = (await importPptx(await exportPptx(deck))).deck;
    }
    await (window as any).renderTableDeck(deck);
    return { rounds, warnings };
  });
  expect(result.warnings.some((w) => w.includes("셀별"))).toBe(true);
  for (const round of result.rounds) {
    expect(round.texts).toBe(101);
    expect(round.last).toBe("row 100");
    expect(round.lines).toBe(1);
    expect(round.line.rotation).toBeCloseTo(17, 4);
    expect(round.line.alpha).toBeCloseTo(0.5, 5);
    expect(round.line.width).toBeCloseTo(200, 3);
    expect(round.line.height).toBeCloseTo(20, 3);
  }
  await page
    .locator("#table-web-fixture .slide-visual")
    .screenshot({ path: info.outputPath("oversized-table-diagonal.png") });
});

test("table stroke opacity is the default for diagonal borders without a per-line alpha", async ({
  page,
}) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const { createTable, createTableElement, tableCellStyle } = await import(
      "/src/table.ts"
    );
    const { blankDeck } = await import("/src/model.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const table = createTable(1, 1);
    table.header = false;
    table.striped = false;
    table.cells = [["Opacity"]];
    table.cellStyles = [
      [
        {
          strokeOpacity: 0.25,
          diagonalBorders: { blToTr: { color: "#666666", width: 2 } },
        },
      ],
    ];
    let deck = blankDeck();
    deck.slides[0].elements = [{ ...createTableElement(table), opacity: 0.6 }];
    const rounds = [];
    for (let i = 0; i < 3; i++) {
      deck = (await importPptx(await exportPptx(deck))).deck;
      const element = deck.slides[0].elements[0];
      const style = tableCellStyle(element.table!, 0, 0);
      rounds.push(
        element.opacity *
          (style.diagonalBorders!.blToTr!.opacity ?? style.strokeOpacity),
      );
    }
    return rounds;
  });
  for (const alpha of result) expect(alpha).toBeCloseTo(0.15, 5);
});
