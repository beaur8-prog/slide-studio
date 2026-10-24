import { expect, test, type Locator, type Page } from "@playwright/test";

test.describe.configure({ timeout: 60000 });

const tableOnSlide = (page: Page) =>
  page.locator('.editable-slide [data-type="table"]');
const canvasCell = (page: Page, row: number, column: number) =>
  tableOnSlide(page).locator(
    `.inserted-table [data-row="${row}"][data-column="${column}"]`,
  );
const cell = (dialog: Locator, row: number, column: number) =>
  dialog.getByRole("textbox", {
    name: `${row + 1}행 ${column + 1}열`,
    exact: true,
  });
const rectangle = (r1: number, c1: number, r2: number, c2: number) => {
  const result: string[] = [];
  for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++)
    for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++)
      result.push(`${r},${c}`);
  return result.sort();
};

async function seedTable(page: Page, rows = 4, columns = 4) {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(
    async ({ rows, columns }) => {
      const { blankDeck } = await import("/src/model.ts");
      const { createTable, createTableElement } = await import("/src/table.ts");
      const { saveAutosave } = await import("/src/storage.ts");
      const deck = blankDeck();
      const table = createTable(rows, columns);
      table.cells = Array.from({ length: rows }, (_, r) =>
        Array.from({ length: columns }, (_, c) => `R${r + 1}C${c + 1}`),
      );
      table.fontSize = 20;
      table.padding = 4;
      deck.name = "Table range selection regression";
      deck.slides[0].elements = [createTableElement(table)];
      await saveAutosave(deck);
    },
    { rows, columns },
  );
  await page.reload();
  await expect(tableOnSlide(page)).toHaveCount(1);
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
}

async function openEditor(page: Page) {
  await canvasCell(page, 1, 1).dblclick();
  const dialog = page.getByRole("dialog", { name: "표 편집", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openSelectedCells(page: Page) {
  await page.getByRole("button", { name: "선택 셀 편집", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "표 편집", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function dragCanvasCells(
  page: Page,
  from: [number, number],
  to: [number, number],
) {
  const a = (await canvasCell(page, ...from).boundingBox())!;
  const b = (await canvasCell(page, ...to).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  try {
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  } finally {
    await page.mouse.up();
  }
}

async function expectCanvasSelection(page: Page, expected: string[]) {
  await expect
    .poll(() =>
      tableOnSlide(page)
        .locator(".table-cell-selected")
        .evaluateAll((nodes) =>
          nodes
            .map(
              (node) =>
                `${node.getAttribute("data-row")},${node.getAttribute("data-column")}`,
            )
            .sort(),
        ),
    )
    .toEqual(expected);
}

async function dragCells(
  page: Page,
  dialog: Locator,
  from: [number, number],
  to: [number, number],
) {
  const start = cell(dialog, ...from);
  const end = cell(dialog, ...to);
  await start.scrollIntoViewIfNeeded();
  const a = (await start.boundingBox())!;
  const b = (await end.boundingBox())!;
  // Start inside the textarea: selecting cell ranges must not require tiny borders.
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  try {
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, {
      steps: 12,
    });
  } finally {
    await page.mouse.up();
  }
}

async function expectSelection(dialog: Locator, expected: string[]) {
  await expect
    .poll(() =>
      dialog.locator("textarea.selected-cell").evaluateAll((nodes) =>
        nodes
          .map((node) => {
            const coordinate = node.closest("[data-row][data-column]")!;
            return `${coordinate.getAttribute("data-row")},${coordinate.getAttribute("data-column")}`;
          })
          .sort(),
      ),
    )
    .toEqual(expected);
  await expect(dialog.locator("[aria-live]")).toContainText(
    `${expected.length}개 셀 선택`,
  );
}

async function savedTable(page: Page) {
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  return page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts");
    const { tableCellStyle } = await import("/src/table.ts");
    const deck = await loadAutosave();
    const table = deck!.slides[0].elements.find(
      (el) => el.type === "table",
    )!.table!;
    const styles = table.cells.map((row, r) =>
      row.map((_, c) => {
        const style = tableCellStyle(table, r, c);
        return {
          fill: style.fill.toUpperCase(),
          color: style.color.toUpperCase(),
          fontSize: style.fontSize,
          align: style.align,
          borderColor: style.borderColor.toUpperCase(),
          borderWidth: style.borderWidth,
        };
      }),
    );
    return { table, styles };
  });
}

test("slide table supports rectangle drag, reverse drag and Shift-click without moving the object", async ({
  page,
}, testInfo) => {
  await seedTable(page);
  const geometry = () =>
    tableOnSlide(page).evaluate((el: HTMLElement) => ({
      x: el.style.left,
      y: el.style.top,
      width: el.style.width,
      height: el.style.height,
    }));
  const original = await geometry();
  await dragCanvasCells(page, [0, 0], [1, 1]);
  await expectCanvasSelection(page, rectangle(0, 0, 1, 1));
  expect(await geometry()).toEqual(original);
  await dragCanvasCells(page, [2, 2], [1, 1]);
  await expectCanvasSelection(page, rectangle(1, 1, 2, 2));
  // A plain click starts a new anchor; Shift-click expands from that cell.
  await canvasCell(page, 0, 1).click();
  await expectCanvasSelection(page, ["0,1"]);
  await canvasCell(page, 2, 3).click({ modifiers: ["Shift"] });
  await expectCanvasSelection(page, rectangle(0, 1, 2, 3));
  expect(await geometry()).toEqual(original);
  await tableOnSlide(page).screenshot({
    path: testInfo.outputPath("table-canvas-range.png"),
  });
  await page.keyboard.press("Control+a");
  await expectCanvasSelection(page, rectangle(0, 0, 3, 3));
  await page.keyboard.press("Escape");
  await expectCanvasSelection(page, []);
  await expect(page.getByTestId("table-move-handle")).toBeVisible();
  await canvasCell(page, 1, 1).click();
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  await expectCanvasSelection(page, rectangle(1, 1, 2, 2));
  const dialog = await openSelectedCells(page);
  await expectSelection(dialog, rectangle(1, 1, 2, 2));
  await expect(dialog.getByLabel("서식 적용 대상")).toHaveValue("selection");
  // The detailed editor keeps its own range gestures after receiving the canvas range.
  await dragCells(page, dialog, [2, 2], [1, 1]);
  await expectSelection(dialog, rectangle(1, 1, 2, 2));
  await cell(dialog, 0, 1).click();
  await cell(dialog, 1, 2).click({ modifiers: ["Shift"] });
  await expectSelection(dialog, rectangle(0, 1, 1, 2));
  await dialog.screenshot({
    path: testInfo.outputPath("table-range-selection.png"),
  });
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
});

test("range drag continues across both scroll axes in a large table", async ({
  page,
}) => {
  await seedTable(page, 20, 12);
  const dialog = await openEditor(page);
  const scroller = dialog.locator(".table-editor-grid-scroll");
  await cell(dialog, 0, 0).scrollIntoViewIfNeeded();
  const start = (await cell(dialog, 0, 0).boundingBox())!;
  const bounds = (await scroller.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  let target = { row: 0, column: 0, x: 0, y: 0 };
  try {
    await page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
      { steps: 6 },
    );
    await page.mouse.wheel(600, 620);
    await expect
      .poll(() => scroller.evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(100);
    await expect
      .poll(() => scroller.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(100);
    target = await scroller.evaluate((el) => {
      const bounds = el.getBoundingClientRect();
      const visible = [...el.querySelectorAll("textarea")].filter((node) => {
        const r = node.getBoundingClientRect();
        return (
          r.left >= bounds.left + 1 &&
          r.right <= bounds.right - 2 &&
          r.top >= bounds.top + 1 &&
          r.bottom <= bounds.bottom - 2
        );
      });
      const node = visible.at(-1)!;
      const r = node.getBoundingClientRect();
      const coordinate = node.closest("[data-row][data-column]")!;
      return {
        row: Number(coordinate.getAttribute("data-row")),
        column: Number(coordinate.getAttribute("data-column")),
        x: r.x + r.width / 2,
        y: r.y + r.height / 2,
      };
    });
    expect(target.row).toBeGreaterThan(5);
    expect(target.column).toBeGreaterThan(4);
    await page.mouse.move(target.x, target.y, { steps: 8 });
  } finally {
    await page.mouse.up();
  }
  await expectSelection(dialog, rectangle(0, 0, target.row, target.column));
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
});

test("dragging text within one cell preserves native selection, typing and Korean IME", async ({
  page,
}) => {
  await seedTable(page);
  const dialog = await openEditor(page);
  const input = cell(dialog, 1, 1);
  await input.fill("ABCDEFGH");
  const geometry = await input.evaluate((el: HTMLTextAreaElement) => {
    const r = el.getBoundingClientRect(),
      style = getComputedStyle(el);
    const canvas = document.createElement("canvas"),
      context = canvas.getContext("2d")!;
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const x =
      r.left +
      parseFloat(style.borderLeftWidth) +
      parseFloat(style.paddingLeft);
    return {
      x1: x + context.measureText("A").width,
      x2: x + context.measureText("ABCDE").width,
      y:
        r.top +
        parseFloat(style.borderTopWidth) +
        parseFloat(style.paddingTop) +
        parseFloat(style.fontSize) * 0.6,
    };
  });
  await page.mouse.move(geometry.x1, geometry.y);
  await page.mouse.down();
  await page.mouse.move(geometry.x2, geometry.y, { steps: 8 });
  await page.mouse.up();
  const selection = await input.evaluate((el: HTMLTextAreaElement) => ({
    start: el.selectionStart,
    end: el.selectionEnd,
    text: el.value,
  }));
  expect(selection.end).toBeGreaterThan(selection.start);
  await expectSelection(dialog, ["1,1"]);
  await page.keyboard.insertText("Z");
  await expect(input).toHaveValue(
    selection.text.slice(0, selection.start) +
      "Z" +
      selection.text.slice(selection.end),
  );
  await input.fill("보존할 내용 ");
  await input.press("End");
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Input.imeSetComposition", {
      text: "한",
      selectionStart: 1,
      selectionEnd: 1,
    });
    await expect(input).toHaveValue("보존할 내용 한");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await cdp.send("Input.insertText", { text: "한글" });
    await expect(input).toHaveValue("보존할 내용 한글");
    await input.dispatchEvent("keydown", { key: "Escape", keyCode: 229 });
    await expect(dialog).toBeVisible();
    await expectSelection(dialog, ["1,1"]);
  } finally {
    await cdp.detach();
  }
  await dialog.getByRole("button", { name: "표 적용", exact: true }).click();
  const saved = await savedTable(page);
  expect(saved.table.cells[1][1]).toBe("보존할 내용 한글");
  expect(saved.table.cells[1][2]).toBe("R2C3");
});

test("canvas range Delete clears cells as one undo step while editor cancellation and reload preserve data", async ({
  page,
}) => {
  await seedTable(page);
  const original = (await savedTable(page)).table;
  await dragCanvasCells(page, [1, 1], [2, 2]);
  let dialog = await openSelectedCells(page);
  await expectSelection(dialog, rectangle(1, 1, 2, 2));
  await dialog
    .getByRole("button", { name: "선택한 셀 내용 지우기", exact: true })
    .click();
  for (const [r, c] of [
    [1, 1],
    [1, 2],
    [2, 1],
    [2, 2],
  ])
    await expect(cell(dialog, r, c)).toHaveValue("");
  await expect(cell(dialog, 1, 0)).toHaveValue("R2C1");
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  expect((await savedTable(page)).table).toEqual(original);
  await dragCanvasCells(page, [2, 2], [1, 1]);
  await expectCanvasSelection(page, rectangle(1, 1, 2, 2));
  await page.keyboard.press("Delete");
  await expect(tableOnSlide(page)).toHaveCount(1);
  const cleared = structuredClone(original.cells);
  for (const r of [1, 2]) for (const c of [1, 2]) cleared[r][c] = "";
  for (const r of [1, 2])
    for (const c of [1, 2]) await expect(canvasCell(page, r, c)).toHaveText("");
  // The key event can finish before React updates the save indicator. Wait
  // for the persisted contents, not a stale "saved" label from the prior edit.
  await expect
    .poll(async () => (await savedTable(page)).table.cells)
    .toEqual(cleared);
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  await expect
    .poll(async () => (await savedTable(page)).table)
    .toEqual(original);
  await page.getByRole("button", { name: "다시 실행", exact: true }).click();
  await expect
    .poll(async () => (await savedTable(page)).table.cells)
    .toEqual(cleared);
  await page.reload();
  await expect(tableOnSlide(page)).toHaveCount(1);
  dialog = await openEditor(page);
  for (const r of [1, 2])
    for (const c of [1, 2]) await expect(cell(dialog, r, c)).toHaveValue("");
  await expect(cell(dialog, 0, 0)).toHaveValue("R1C1");
  await expect(cell(dialog, 3, 3)).toHaveValue("R4C4");
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
});

test("range formatting leaves other cells unchanged and round-trips through project and native PPTX cells", async ({
  page,
}, testInfo) => {
  await seedTable(page);
  const original = await savedTable(page);
  await dragCanvasCells(page, [1, 1], [2, 2]);
  const dialog = await openSelectedCells(page);
  await expectSelection(dialog, rectangle(1, 1, 2, 2));
  await expect(dialog.getByLabel("서식 적용 대상")).toHaveValue("selection");
  await dialog.getByLabel("셀 배경", { exact: true }).fill("#2157ac");
  await dialog.getByLabel("셀 글자색", { exact: true }).fill("#ffee44");
  await dialog.getByLabel("표 글자 크기", { exact: true }).fill("18");
  await dialog.getByLabel("테두리 색", { exact: true }).fill("#cc2200");
  await dialog.getByLabel("테두리 두께", { exact: true }).fill("4");
  await dialog
    .getByLabel("표 가로 정렬", { exact: true })
    .selectOption("right");
  await expectSelection(dialog, rectangle(1, 1, 2, 2));
  await dialog.getByRole("button", { name: "표 적용", exact: true }).click();
  const changed = await savedTable(page);
  const selectedStyle = {
    fill: "#2157AC",
    color: "#FFEE44",
    fontSize: 18,
    align: "right",
    borderColor: "#CC2200",
    borderWidth: 4,
  };
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      expect(changed.styles[r][c]).toEqual(
        r >= 1 && r <= 2 && c >= 1 && c <= 2
          ? selectedStyle
          : original.styles[r][c],
      );
  expect(changed.table.cells).toEqual(original.table.cells);
  expect(changed.table.fill).toBe(original.table.fill);
  expect(changed.table.fontSize).toBe(original.table.fontSize);
  const rendered = tableOnSlide(page)
    .getByRole("row")
    .nth(1)
    .getByRole("cell")
    .nth(1);
  await expect(rendered).toHaveCSS("background-color", "rgb(33, 87, 172)");
  await expect(rendered).toHaveCSS("color", "rgb(255, 238, 68)");
  await expect(rendered).toHaveCSS("font-size", "18px");
  await expect(rendered).toHaveCSS("text-align", "right");
  const borders = tableOnSlide(page).locator('.table-border-overlay line[stroke="#CC2200"]');
  await expect(borders).toHaveCount(12);
  for (const border of await borders.all())
    await expect(border).toHaveAttribute("stroke-width", "4");
  await tableOnSlide(page).screenshot({
    path: testInfo.outputPath("table-cell-borders.png"),
  });
  const roundTrip = await page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts");
    const { tableCellStyle } = await import("/src/table.ts");
    const { serializeDeck, parseDeckJson, exportPptx, importPptx } =
      await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const deck = (await loadAutosave())!;
    const project = parseDeckJson(serializeDeck(deck));
    const bytes = await exportPptx(deck);
    const zip = await JSZip.loadAsync(bytes);
    const xml = new DOMParser().parseFromString(
      await zip.file("ppt/slides/slide1.xml")!.async("string"),
      "text/xml",
    );
    const nativeTables = xml.getElementsByTagNameNS("*", "tbl");
    const nativeCells = nativeTables[0].getElementsByTagNameNS("*", "tc");
    const nativeSelected = nativeCells[5];
    const properties = nativeSelected.getElementsByTagNameNS("*", "tcPr")[0];
    const nativeFill = [...properties.children]
      .find((el) => el.localName === "solidFill")
      ?.getElementsByTagNameNS("*", "srgbClr")[0]
      ?.getAttribute("val");
    const run = nativeSelected.getElementsByTagNameNS("*", "rPr")[0];
    const nativeColor = run
      .getElementsByTagNameNS("*", "srgbClr")[0]
      ?.getAttribute("val");
    const nativeSize = Number(run.getAttribute("sz"));
    const nativeAlign = nativeSelected
      .getElementsByTagNameNS("*", "pPr")[0]
      ?.getAttribute("algn");
    const nativeBorders = ["lnT", "lnR", "lnB", "lnL"].map((name) => {
      const line = [...properties.children].find((el) => el.localName === name);
      return {
        side: name,
        width: Number(line?.getAttribute("w")),
        color: line
          ?.getElementsByTagNameNS("*", "srgbClr")[0]
          ?.getAttribute("val"),
      };
    });
    const imported = await importPptx(bytes);
    const twice = await importPptx(await exportPptx(imported.deck));
    const summarize = (value: typeof deck) => {
      const elements = value.slides[0].elements;
      const table = elements.find((el) => el.type === "table")?.table;
      return {
        types: elements.map((el) => el.type),
        cells: table?.cells,
        styles: table?.cells.map((row, r) =>
          row.map((_, c) => {
            const style = tableCellStyle(table, r, c);
            return {
              fill: style.fill.toUpperCase(),
              color: style.color.toUpperCase(),
              fontSize: style.fontSize,
              align: style.align,
              borderColor: style.borderColor.toUpperCase(),
              borderWidth: style.borderWidth,
            };
          }),
        ),
      };
    };
    return {
      nativeTables: nativeTables.length,
      nativeCells: nativeCells.length,
      nativeFill,
      nativeColor,
      nativeSize,
      nativeAlign,
      nativeBorders,
      project: summarize(project),
      imported: summarize(imported.deck),
      twice: summarize(twice.deck),
      warnings: [...imported.warnings, ...twice.warnings],
    };
  });
  expect(roundTrip.nativeTables).toBe(1);
  expect(roundTrip.nativeCells).toBe(16);
  expect(roundTrip.nativeFill).toBe("2157AC");
  expect(roundTrip.nativeColor).toBe("FFEE44");
  // App pixels map to DrawingML hundredths of a point (18px = 13.5pt).
  expect(roundTrip.nativeSize).toBe(1350);
  expect(roundTrip.nativeAlign).toBe("r");
  expect(roundTrip.nativeBorders).toEqual(
    ["lnT", "lnR", "lnB", "lnL"].map((side) => ({
      side,
      width: 38100,
      color: "CC2200",
    })),
  );
  for (const restored of [
    roundTrip.project,
    roundTrip.imported,
    roundTrip.twice,
  ]) {
    expect(restored.types).toEqual(["table"]);
    expect(restored.cells).toEqual(original.table.cells);
    expect(restored.styles).toEqual(changed.styles);
  }
  expect(roundTrip.warnings).toEqual([]);
});

test("new tables default to table formatting and canvas cells use an explicit selection or table scope", async ({
  page,
}) => {
  await seedTable(page);
  await page.getByRole("button", { name: "삽입", exact: true }).click();
  await page.getByRole("button", { name: "표", exact: true }).click();
  const fresh = page.getByRole("dialog", { name: "표 삽입", exact: true });
  await expect(fresh.getByLabel("서식 적용 대상")).toHaveValue("table");
  await fresh.getByRole("button", { name: "취소", exact: true }).click();
  let dialog = await openEditor(page);
  await expect(dialog.getByLabel("서식 적용 대상")).toHaveValue("selection");
  await cell(dialog, 1, 1).click();
  await dialog.getByLabel("서식 적용 대상").selectOption("table");
  await expect(dialog.getByLabel("서식 적용 대상")).toHaveValue("table");
  await dialog.getByLabel("셀 배경", { exact: true }).fill("#e0e1e2");
  await dialog.getByLabel("표 글자 크기", { exact: true }).fill("22");
  await dialog.getByRole("button", { name: "표 적용", exact: true }).click();
  await expect
    .poll(async () => {
      const value = await savedTable(page);
      return [value.table.fill, value.table.fontSize];
    })
    .toEqual(["#E0E1E2", 22]);
  const global = await savedTable(page);
  expect(global.table.fill).toBe("#E0E1E2");
  expect(global.table.fontSize).toBe(22);
  expect(global.styles[1][0].fill).toBe("#E0E1E2");
  expect(global.styles[1][3].fill).toBe("#E0E1E2");
  dialog = await openEditor(page);
  await cell(dialog, 1, 1).click();
  await dialog.getByLabel("서식 적용 대상").selectOption("selection");
  await dialog.getByLabel("셀 배경", { exact: true }).fill("#010203");
  await dialog.getByRole("button", { name: "표 적용", exact: true }).click();
  await expect
    .poll(async () => (await savedTable(page)).styles[1][1].fill)
    .toBe("#010203");
  const explicit = await savedTable(page);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      expect(explicit.styles[r][c]).toEqual(
        r === 1 && c === 1
          ? { ...global.styles[r][c], fill: "#010203" }
          : global.styles[r][c],
      );
  expect(explicit.table.fill).toBe("#E0E1E2");
});

test("canvas cell copy writes selected TSV without changes and cut clears only that range in one undo", async ({
  page,
}) => {
  await seedTable(page);
  const dialog = await openEditor(page);
  await cell(dialog, 1, 1).fill("한글\t값");
  await cell(dialog, 1, 2).fill('첫줄\n"둘째"');
  await dialog.getByRole("button", { name: "표 적용", exact: true }).click();
  await expect
    .poll(async () => {
      const saved = await savedTable(page);
      return [saved.table.cells[1][1], saved.table.cells[1][2]];
    })
    .toEqual(["한글\t값", '첫줄\n"둘째"']);
  const original = (await savedTable(page)).table;
  await dragCanvasCells(page, [1, 1], [2, 2]);
  await expectCanvasSelection(page, rectangle(1, 1, 2, 2));
  // Supply synchronous clipboardData without changing the user's system clipboard.
  const dispatchClipboard = (type: "copy" | "cut") =>
    canvasCell(page, 1, 1).evaluate((element, type) => {
      const clipboardData = new DataTransfer();
      const event = new ClipboardEvent(type, {
        bubbles: true,
        cancelable: true,
        clipboardData,
      });
      element.dispatchEvent(event);
      return {
        text: clipboardData.getData("text/plain"),
        prevented: event.defaultPrevented,
      };
    }, type);
  const expected = '"한글\t값"\t"첫줄\n""둘째"""\nR3C2\tR3C3';
  expect(await dispatchClipboard("copy")).toEqual({
    text: expected,
    prevented: true,
  });
  expect((await savedTable(page)).table).toEqual(original);
  expect(await dispatchClipboard("cut")).toEqual({
    text: expected,
    prevented: true,
  });
  await expect(tableOnSlide(page)).toHaveCount(1);
  const cleared = structuredClone(original.cells);
  for (const r of [1, 2]) for (const c of [1, 2]) cleared[r][c] = "";
  expect((await savedTable(page)).table.cells).toEqual(cleared);
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  expect((await savedTable(page)).table).toEqual(original);
});

test("ribbon copy, cut and paste operate on selected cells without replacing the table", async ({
  page,
}) => {
  await seedTable(page);
  const original = await savedTable(page);
  const copied = original.table.cells.slice(1, 3).map((row) => row.slice(1, 3));
  const ribbon = page.locator(".ribbon");
  const pasteExpected = (source: string[][]) => {
    const result = structuredClone(source);
    for (let r = 0; r < 2; r++)
      for (let c = 0; c < 2; c++) result[r][c] = copied[r][c];
    return result;
  };
  await dragCanvasCells(page, [1, 1], [2, 2]);
  await ribbon.getByRole("button", { name: "복사", exact: true }).click();
  expect((await savedTable(page)).table).toEqual(original.table);
  await canvasCell(page, 0, 0).click();
  await ribbon.getByRole("button", { name: "붙여넣기", exact: true }).click();
  await expect(tableOnSlide(page)).toHaveCount(1);
  // Home paste reads the external clipboard asynchronously. Wait for the
  // new cell content, rather than accepting the preceding saved indicator.
  await expect.poll(async () => (await savedTable(page)).table.cells)
    .toEqual(pasteExpected(original.table.cells));
  let pasted = await savedTable(page);
  expect(pasted.table.cells).toEqual(pasteExpected(original.table.cells));
  // Pasting into a heading retains the copied cells' effective body styles.
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 2; c++)
      expect(pasted.styles[r][c]).toEqual(original.styles[r + 1][c + 1]);
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  expect((await savedTable(page)).table).toEqual(original.table);
  await dragCanvasCells(page, [1, 1], [2, 2]);
  await ribbon.getByRole("button", { name: "잘라내기", exact: true }).click();
  await expect(tableOnSlide(page)).toHaveCount(1);
  const cleared = structuredClone(original.table.cells);
  for (const r of [1, 2]) for (const c of [1, 2]) cleared[r][c] = "";
  expect((await savedTable(page)).table.cells).toEqual(cleared);
  await canvasCell(page, 0, 0).click();
  await ribbon.getByRole("button", { name: "붙여넣기", exact: true }).click();
  await expect.poll(async () => (await savedTable(page)).table.cells)
    .toEqual(pasteExpected(cleared));
  pasted = await savedTable(page);
  await expect(tableOnSlide(page)).toHaveCount(1);
  expect(pasted.table.cells).toEqual(pasteExpected(cleared));
  // Undo the paste and the cut independently; neither operation deletes the object.
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  expect((await savedTable(page)).table.cells).toEqual(cleared);
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  expect((await savedTable(page)).table).toEqual(original.table);
});

test("editor range copy and cut quote multiline TSV and keep unselected cells and the saved document intact", async ({
  page,
}) => {
  await seedTable(page);
  const original = (await savedTable(page)).table;
  let dialog = await openEditor(page);
  await cell(dialog, 1, 1).fill("한글\t값");
  await cell(dialog, 1, 2).fill('첫줄\n"둘째"');
  await dragCells(page, dialog, [1, 1], [2, 2]);
  await expectSelection(dialog, rectangle(1, 1, 2, 2));
  const expected = '"한글\t값"\t"첫줄\n""둘째"""\nR3C2\tR3C3';
  const dispatchClipboard = (type: "copy" | "cut") =>
    cell(dialog, 1, 1).evaluate((element, type) => {
      const clipboardData = new DataTransfer();
      const event = new ClipboardEvent(type, {
        bubbles: true,
        cancelable: true,
        clipboardData,
      });
      element.dispatchEvent(event);
      return {
        text: clipboardData.getData("text/plain"),
        prevented: event.defaultPrevented,
      };
    }, type);
  expect(await dispatchClipboard("copy")).toEqual({
    text: expected,
    prevented: true,
  });
  await expect(cell(dialog, 1, 1)).toHaveValue("한글\t값");
  await expect(cell(dialog, 1, 2)).toHaveValue('첫줄\n"둘째"');
  expect((await savedTable(page)).table).toEqual(original);
  expect(await dispatchClipboard("cut")).toEqual({
    text: expected,
    prevented: true,
  });
  for (const r of [1, 2])
    for (const c of [1, 2]) await expect(cell(dialog, r, c)).toHaveValue("");
  await expect(cell(dialog, 1, 0)).toHaveValue("R2C1");
  await expect(cell(dialog, 3, 3)).toHaveValue("R4C4");
  expect((await savedTable(page)).table).toEqual(original);
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  expect((await savedTable(page)).table).toEqual(original);
  dialog = await openEditor(page);
  await expect(cell(dialog, 1, 1)).toHaveValue("R2C2");
  await expect(cell(dialog, 1, 2)).toHaveValue("R2C3");
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
});
