import { test, expect } from "@playwright/test";

test("rich cell edits preserve table header and banded-row controls across PPTX save/reopen", async ({ page }, info) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { createTable, createTableElement, tableCellStyle } = await import("/src/table.ts");
    const { importPptx, exportPptx } = await import("/src/io.ts");
    const table = createTable(4, 2);
    table.headerFill = "#225588";
    table.stripeFill = "#CCDDEE";
    table.cells = [["제목", "수치"], ["Alpha Beta", "20"], ["줄무늬 행", "30"], ["끝", "40"]];
    table.cellStyles = [[null, null], [{ paragraphs: [{ runs: [{ text: "Alpha " }, { text: "Beta", italic: true, color: "#AA2233" }] }] }, null], [null, null], [null, null]];
    let deck = blankDeck(); deck.slides[0].elements = [createTableElement(table)];
    const results = [];
    for (let i = 0; i < 3; i++) {
      deck = (await importPptx(await exportPptx(deck))).deck;
      const data = deck.slides[0].elements[0].table!;
      const noHeader = { ...data, header: false }, noStripe = { ...data, striped: false };
      results.push({
        header: data.header, striped: data.striped, cells: data.cells,
        headerStyle: tableCellStyle(data, 0, 0), stripeStyle: tableCellStyle(data, 2, 0),
        noHeaderStyle: tableCellStyle(noHeader, 0, 0), noStripeStyle: tableCellStyle(noStripe, 2, 0),
        rich: tableCellStyle(data, 1, 0).paragraphs,
      });
    }
    return { results, bytes: Array.from(await exportPptx(deck)) };
  });
  for (const state of result.results) {
    expect(state.header).toBe(true);
    expect(state.striped).toBe(true);
    expect(state.headerStyle).toMatchObject({ fill: "#225588", color: "#FFFFFF", bold: true, padding: 10 });
    expect(state.stripeStyle.fill).toBe("#CCDDEE");
    expect(state.noHeaderStyle).toMatchObject({ fill: "#FFFFFF", color: "#233D35", bold: false, padding: 10 });
    expect(state.noStripeStyle.fill).toBe("#FFFFFF");
    expect(state.rich?.[0].runs[1]).toMatchObject({ text: "Beta", italic: true, color: "#AA2233" });
    expect(state.cells[1][0]).toBe("Alpha Beta");
  }
  await page.locator('input[accept*=".pptx"]').setInputFiles({
    name: "rich-table.pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from(result.bytes),
  });
  const table = page.locator('.editable-slide [data-type="table"]');
  await table.locator('[data-row="1"][data-column="1"]').dblclick();
  const dialog = page.getByRole("dialog", { name: "표 편집", exact: true });
  await expect(dialog.getByLabel("머리글 행", { exact: true })).toBeChecked();
  await expect(dialog.getByLabel("줄무늬 행", { exact: true })).toBeChecked();
  await dialog.getByLabel("머리글 행", { exact: true }).uncheck();
  await dialog.getByLabel("줄무늬 행", { exact: true }).uncheck();
  await dialog.getByRole("button", { name: "표 적용", exact: true }).click();
  await expect(table.locator('[data-row="0"][data-column="0"]')).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(table.locator('[data-row="2"][data-column="0"]')).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await table.screenshot({ path: info.outputPath("table-style-controls-after-reopen.png") });
});

test("native external table edits override saved base-style metadata", async ({ page }) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { createTable, createTableElement, tableCellStyle } = await import("/src/table.ts");
    const { importPptx, exportPptx } = await import("/src/io.ts");
    const { default: JSZip } = await import("/node_modules/.vite/deps/jszip.js");
    const table = createTable(2, 2); table.cells = [["원본", "제목"], ["본문", "값"]];
    const deck = blankDeck(); deck.slides[0].elements = [createTableElement(table)];
    const zip = await JSZip.loadAsync(await exportPptx(deck));
    const path = "ppt/slides/slide1.xml", doc = new DOMParser().parseFromString(await zip.file(path)!.async("string"), "application/xml");
    const firstCell = doc.getElementsByTagNameNS("*", "tc")[0];
    firstCell.getElementsByTagNameNS("*", "t")[0].textContent = "외부 수정";
    firstCell.getElementsByTagNameNS("*", "rPr")[0].setAttribute("i", "1");
    Array.from(firstCell.getElementsByTagNameNS("*", "tcPr")[0].children).find((n) => n.localName === "solidFill")!.getElementsByTagNameNS("*", "srgbClr")[0].setAttribute("val", "AA4400");
    doc.getElementsByTagNameNS("*", "tblPr")[0].setAttribute("firstRow", "0");
    zip.file(path, new XMLSerializer().serializeToString(doc));
    const imported = await importPptx(await zip.generateAsync({ type: "uint8array" }));
    const data = imported.deck.slides[0].elements[0].table!;
    return { cell: data.cells[0][0], header: data.header, style: tableCellStyle(data, 0, 0) };
  });
  expect(result.cell).toBe("외부 수정");
  expect(result.header).toBe(false);
  expect(result.style.fill).toBe("#AA4400");
  expect(result.style.italic).toBe(true);
});

test("empty table cells keep their insertion font and color in native PPTX data", async ({ page }) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { createTable, createTableElement, tableCellStyle } = await import("/src/table.ts");
    const { importPptx, exportPptx } = await import("/src/io.ts");
    const { default: JSZip } = await import("/node_modules/.vite/deps/jszip.js");
    const table = createTable(2, 2);
    table.cells = [["", "제목"], ["", "본문"]];
    table.cellStyles = [[null, null], [{ color: "#AA2233", italic: true, fontSize: 36 }, null]];
    const deck = blankDeck(); deck.slides[0].elements = [{ ...createTableElement(table), opacity: 0.6 }];
    const zip = await JSZip.loadAsync(await exportPptx(deck));
    const path = "ppt/slides/slide1.xml", doc = new DOMParser().parseFromString(await zip.file(path)!.async("string"), "application/xml");
    for (const marker of Array.from(doc.getElementsByTagNameNS("urn:slide-studio:table:v1", "table"))) marker.remove();
    zip.file(path, new XMLSerializer().serializeToString(doc));
    let imported = await importPptx(await zip.generateAsync({ type: "uint8array" }));
    const states = [];
    for (let i = 0; i < 3; i++) {
      const element = imported.deck.slides[0].elements[0], data = element.table!;
      states.push([0, 1].map((row) => {
        const style = tableCellStyle(data, row, 0);
        return { ...style, effectiveOpacity: element.opacity * (style.paragraphs?.[0].runs[0].opacity ?? style.textOpacity) };
      }));
      imported = await importPptx(await exportPptx(imported.deck));
    }
    return states;
  });
  for (const state of result) {
    expect(state[0]).toMatchObject({ color: "#FFFFFF", bold: true, fontSize: 24 });
    expect(state[1]).toMatchObject({ color: "#AA2233", italic: true, fontSize: 36 });
    expect(state[0].effectiveOpacity).toBeCloseTo(0.6, 5);
    expect(state[1].effectiveOpacity).toBeCloseTo(0.6, 5);
  }
});
