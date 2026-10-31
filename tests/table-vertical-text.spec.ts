import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

test("native table cell directions keep explicit line breaks as columns through three edited saves", async ({ page }, info) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { createTable, createTableElement, tableCellStyle } = await import("/src/table.ts");
    const { importPptx, exportPptx, serializeDeck, parseDeckJson } = await import("/src/io.ts");
    const { default: JSZip } = await import("/node_modules/.vite/deps/jszip.js");
    const { default: React } = await import("/node_modules/.vite/deps/react.js");
    const { default: { createRoot } } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { SlideVisual } = await import("/src/SlideCanvas.tsx");
    const deck = blankDeck(), table = createTable(2, 3);
    Object.assign(table, { cells: [["H\ne\na\nd\ne\nr", "Q3", "한글\n세로"], ["보통 텍스트", "Normal", "가나다"]], header: false, striped: false, autoRows: false, fontSize: 18, padding: 4, rowHeights: [48, 48] });
    deck.slides[0].elements = [{ ...createTableElement(table), x: 50, y: 80, width: 600, height: 96 }];
    const zip = await JSZip.loadAsync(await exportPptx(deck)), part = "ppt/slides/slide1.xml";
    const doc = new DOMParser().parseFromString(await zip.file(part)!.async("string"), "application/xml");
    for (const marker of Array.from(doc.getElementsByTagNameNS("urn:slide-studio:table:v1", "table"))) marker.parentElement?.remove();
    const row = doc.getElementsByTagNameNS("*", "tr")[0];
    const modes = ["vert270", "vert", "eaVert"];
    Array.from(row.getElementsByTagNameNS("*", "tcPr")).forEach((cp, i) => cp.setAttribute("vert", modes[i]));
    zip.file(part, new XMLSerializer().serializeToString(doc));
    let imported = await importPptx(await zip.generateAsync({ type: "uint8array" }));
    const rounds = [];
    for (let round = 0; round < 4; round++) {
      const el = imported.deck.slides[0].elements.find((e) => e.table)!;
      rounds.push({ modes: [0, 1, 2].map((c) => tableCellStyle(el.table!, 0, c).writingMode), firstHeight: el.table!.rowHeights![0], text: el.table!.cells[0], warnings: imported.warnings });
      if (round === 3) break;
      imported.deck.slides[0].notes = "Save " + round;
      const bytes = await exportPptx(imported.deck);
      const reopenedZip = await JSZip.loadAsync(bytes);
      const outputDoc = new DOMParser().parseFromString(await reopenedZip.file(part)!.async("string"), "application/xml");
      rounds[round].native = Array.from(outputDoc.getElementsByTagNameNS("*", "tr")[0].getElementsByTagNameNS("*", "tcPr")).map((cp) => cp.getAttribute("vert"));
      imported = await importPptx(bytes);
    }
    const json = parseDeckJson(serializeDeck(imported.deck));
    const host = document.createElement("div"); host.id = "vertical-table-test";
    Object.assign(host.style, { position: "fixed", left: "0", top: "0", width: "960px", height: "540px", background: "white", zIndex: "999999" });
    document.body.append(host);
    createRoot(host).render(React.createElement(SlideVisual, { slide: imported.deck.slides[0], width: imported.deck.width, height: imported.deck.height }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { supported: CSS.supports("writing-mode", "sideways-lr"), rounds, jsonModes: json.slides[0].elements.find((e) => e.table)!.table!.cellStyles![0].map((s) => s?.writingMode), css: Array.from(host.querySelectorAll('[data-row="0"] .table-cell-text')).map((e) => getComputedStyle(e).writingMode) };
  });
  expect(result.supported).toBe(true);
  expect(result.css).toEqual(["sideways-lr", "vertical-rl", "vertical-rl"]);
  for (const r of result.rounds) {
    expect(r.modes).toEqual(["vertical270", "vertical", "stacked"]);
    expect(r.firstHeight).toBeCloseTo(48, 0);
    expect(r.text).toEqual(["H\ne\na\nd\ne\nr", "Q3", "한글\n세로"]);
    if (r.native) expect(r.native).toEqual(["vert270", "vert", "eaVert"]);
  }
  expect(result.jsonModes).toEqual(["vertical270", "vertical", "stacked"]);
  await page.locator("#vertical-table-test").screenshot({ path: info.outputPath("native-directions.png") });
});

test("vertical table measurement grows only when the inline extent can fix wrapping", async ({ page }) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { measureTableText } = await import("/src/table-layout.tsx");
    const base = { id: "vertical", type: "text" as const, x: 0, y: 0, width: 60, height: 28, rotation: 0, opacity: 1, fontSize: 18, textInsets: [4, 4, 4, 4] as [number, number, number, number], writingMode: "vertical270" as const };
    const heights = await measureTableText([{ ...base, text: "This sentence should wrap into vertical columns without clipping." }, { ...base, width: 8, text: "H\ne\na\nd\ne\nr" }, { ...base, text: "短い文" }]);
    return heights;
  });
  expect(result[0]).toBeGreaterThan(28);
  expect(result[0]).toBeLessThan(1500);
  expect(result[1]).toBeLessThan(40);
  expect(result[2]).toBeLessThan(150);
});

test("POI native rotated and merged table cells keep the original short header row", async ({ page }, info) => {
  const file = "qa/samples/poi-table_test2.pptx";
  test.skip(!existsSync(file), "Optional pinned Apache POI public fixture; see QA source manifest.");
  expect(createHash("sha256").update(readFileSync(file)).digest("hex")).toBe("e80d09a5fa767f6ee2d024f3a4198f1e8b3241cc638183e5ebafdbacf1fb2838");
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { importPptx } = await import("/src/io.ts");
    const { tableCellStyle } = await import("/src/table.ts");
    const imported = await importPptx(await (await fetch("/qa/samples/poi-table_test2.pptx")).arrayBuffer());
    const el = imported.deck.slides[0].elements.find((e) => e.table)!;
    return { height: el.table!.rowHeights![0], mode: tableCellStyle(el.table!, 0, 3).writingMode, warnings: imported.warnings };
  });
  expect(result.mode).toBe("vertical270");
  expect(result.height).toBeCloseTo(48.4445, 1);
  await page.locator('input[type="file"][accept*=".pptx"]').setInputFiles(file);
  await expect(page.locator('.thumbnail-row')).toHaveCount(1);
  await expect(page.locator('.busy-backdrop')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("poi-native-table.png") });
});
