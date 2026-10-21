import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const cases = [
  { name: "standard 72pt frame with four 32pt rows", frame: 72 },
  { name: "Studio metadata 72pt frame", frame: 72, metadata: true },
  { name: "merged cells in a 72pt frame", frame: 72, merged: true },
  {
    name: "unequal rows in a 72pt frame",
    frame: 72,
    rows: [24, 40, 28, 36],
  },
  { name: "table in a vertically scaled group", frame: 72, scaleY: 1.5 },
  { name: "matching 128pt frame", frame: 128 },
  { name: "larger 160pt frame retains spare-height allocation", frame: 160 },
];

for (const scenario of cases) {
  test(`PPTX table preserves row heights: ${scenario.name}`, async ({
    page,
  }, testInfo) => {
    await page.goto("http://127.0.0.1:5190");
    const result = await page.evaluate(async (scenario) => {
      const { blankDeck } = await import("/src/model.ts");
      const { createTable, createTableElement, tableSizes, tableTextElements } =
        await import("/src/table.ts");
      const { exportPptx, importPptx, parseDeckJson, serializeDeck } =
        await import("/src/io.ts");
      const { default: JSZip } = await import(
        "/node_modules/.vite/deps/jszip.js"
      );
      const { default: React } = await import(
        "/node_modules/.vite/deps/react.js"
      );
      const {
        default: { createRoot },
      } = await import("/node_modules/.vite/deps/react-dom_client.js");
      const { SlideVisual } = await import("/src/SlideCanvas.tsx");
      const pointsToPixels = (pt: number) => pt / 0.75;
      const rows = scenario.rows ?? [32, 32, 32, 32];
      const table = createTable(4, 1);
      Object.assign(table, {
        autoRows: false,
        header: false,
        striped: false,
        borderWidth: 0,
        // The 24pt row in the unequal-row control needs a smaller font;
        // otherwise that fixture would clip even at its original row height.
        fontSize: pointsToPixels(scenario.rows ? 14 : 18),
        padding: pointsToPixels(3.6),
        verticalAlign: "top",
        cells: rows.map((_, r) => [`한글 ${r + 1}행`]),
        rowHeights: rows,
      });
      if (scenario.merged) {
        table.merges = [{ row: 0, column: 0, rowSpan: 2, columnSpan: 1 }];
        table.cells[1][0] = "";
      }
      const deck = blankDeck();
      deck.slides[0].elements = [
        {
          ...createTableElement(table),
          x: pointsToPixels(36),
          y: pointsToPixels(36),
          width: pointsToPixels(288),
          height: pointsToPixels(rows.reduce((a, b) => a + b, 0)),
        },
      ];
      const zip = await JSZip.loadAsync(await exportPptx(deck));
      const filename = "ppt/slides/slide1.xml";
      const xml = new DOMParser().parseFromString(
        await zip.file(filename)!.async("string"),
        "application/xml",
      );
      const frame = xml.getElementsByTagNameNS("*", "graphicFrame")[0];
      const xfrm = Array.from(frame.children).find(
        (n) => n.localName === "xfrm",
      )!;
      // Deliberately inconsistent native DrawingML: 72pt outer frame, but
      // four explicit 32pt a:tr heights (EMU uses 12,700 units per point).
      xfrm
        .getElementsByTagNameNS("*", "ext")[0]
        .setAttribute("cy", String(scenario.frame * 12700));
      if (!scenario.metadata)
        for (const marker of Array.from(
          xml.getElementsByTagNameNS("urn:slide-studio:table:v1", "table"),
        ))
          marker.parentElement?.remove();
      if (scenario.scaleY) {
        const ns = "http://schemas.openxmlformats.org/presentationml/2006/main";
        const group = xml.createElementNS(ns, "p:grpSp");
        frame.replaceWith(group);
        group.innerHTML = `<p:nvGrpSpPr><p:cNvPr id="99" name="Scaled table"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="6096000" cy="${3429000 * scenario.scaleY}"/><a:chOff x="0" y="0"/><a:chExt cx="6096000" cy="3429000"/></a:xfrm></p:grpSpPr>`;
        group.append(frame);
      }
      zip.file(filename, new XMLSerializer().serializeToString(xml));
      const fixture = await zip.generateAsync({ type: "uint8array" });
      const imported = await importPptx(fixture);
      const project = parseDeckJson(serializeDeck(imported.deck));
      const roundTrip = await importPptx(await exportPptx(project));
      const summarize = (value: typeof deck) => {
        const el = value.slides[0].elements[0];
        return {
          type: el.type,
          x: el.x,
          y: el.y,
          width: el.width,
          height: el.height,
          rows: tableSizes(el.table!.rowHeights, 4, el.height),
          cells: el.table!.cells,
          merges: el.table!.merges ?? [],
          cellStyleOverrides: !!el.table!.cellStyles,
          textHeights: tableTextElements(el).map((cell) => cell.height),
        };
      };
      const host = document.createElement("div");
      host.style.cssText =
        "position:fixed;inset:0;background:white;z-index:9999";
      document.body.append(host);
      createRoot(host).render(
        React.createElement(SlideVisual, {
          slide: imported.deck.slides[0],
          width: deck.width,
          height: deck.height,
        }),
      );
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      await document.fonts.ready;
      const textOverflow = Array.from(
        host.querySelectorAll(".table-cell-text"),
      ).map((text) => {
        const range = document.createRange();
        range.selectNodeContents(text);
        const bounds = range.getBoundingClientRect();
        const cell = text.parentElement!.getBoundingClientRect();
        return Math.max(cell.top - bounds.top, bounds.bottom - cell.bottom);
      });
      return {
        fixture: Array.from(fixture),
        imported: summarize(imported.deck),
        project: summarize(project),
        roundTrip: summarize(roundTrip.deck),
        warnings: [...imported.warnings, ...roundTrip.warnings],
        textOverflow,
      };
    }, scenario);
    await writeFile(
      testInfo.outputPath("input.pptx"),
      Buffer.from(result.fixture),
    );
    const { fixture: _fixture, ...metrics } = result;
    await writeFile(
      testInfo.outputPath("geometry.json"),
      JSON.stringify(metrics, null, 2),
    );
    // Ensure the metadata fixture really covers the native shortcut, rather
    // than silently falling back to the general DrawingML cell importer.
    expect(result.imported.cellStyleOverrides).toBe(!scenario.metadata);
    const rows = scenario.rows ?? [32, 32, 32, 32];
    const total = rows.reduce((a, b) => a + b, 0);
    const height = Math.max(scenario.frame, total);
    const scale = (scenario.scaleY ?? 1) / 0.75;
    for (const value of [result.imported, result.project, result.roundTrip]) {
      expect(value.type).toBe("table");
      expect(value.x).toBeCloseTo(36 / 0.75);
      expect(value.y).toBeCloseTo(36 * scale);
      expect(value.width).toBeCloseTo(288 / 0.75);
      expect(value.height).toBeCloseTo(height * scale, 3);
      value.rows.forEach((row, i) =>
        expect(row).toBeCloseTo(((rows[i] * height) / total) * scale, 3),
      );
      expect(value.cells).toEqual(
        rows.map((_, r) => [
          scenario.merged && r === 1 ? "" : `한글 ${r + 1}행`,
        ]),
      );
      if (scenario.merged) {
        expect(value.merges).toEqual([
          { row: 0, column: 0, rowSpan: 2, columnSpan: 1 },
        ]);
        expect(value.textHeights).toEqual([64, 32, 32].map((pt) => pt * scale));
      }
    }
    expect(result.warnings).toEqual([]);
    for (const overflow of result.textOverflow)
      expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("table-height.png") });
  });
}
