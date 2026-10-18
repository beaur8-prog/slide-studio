import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ timeout: 60000 });

type Axis = "column" | "row";
type Fixture = { rotation?: number; locked?: boolean; unequal?: boolean };
const tableOnSlide = (page: Page) =>
  page.locator('.editable-slide [data-type="table"]');
const handles = ".table-column-resize-handle, .table-row-resize-handle";
const handle = (page: Page, axis: Axis, index: number) =>
  tableOnSlide(page).locator(
    `.table-${axis}-resize-handle[data-boundary-index="${index}"]`,
  );
const undo = (page: Page) =>
  page.getByRole("button", { name: "실행 취소", exact: true });
const redo = (page: Page) =>
  page.getByRole("button", { name: "다시 실행", exact: true });

async function seedTable(page: Page, fixture: Fixture = {}) {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async (fixture) => {
    const { blankDeck } = await import("/src/model.ts");
    const { createTable, createTableElement } = await import("/src/table.ts");
    const { saveAutosave } = await import("/src/storage.ts");
    const deck = blankDeck(),
      table = createTable(4, 4);
    table.cells = Array.from({ length: 4 }, (_, r) =>
      Array.from({ length: 4 }, (_, c) => `R${r + 1}C${c + 1}`),
    );
    table.fontSize = 14;
    table.padding = 4;
    if (fixture.unequal) {
      table.columnWidths = [1, 2, 1, 2];
      table.rowHeights = [1, 1.5, 1, 0.5];
    }
    const element = createTableElement(table);
    Object.assign(element, {
      x: 280,
      y: 200,
      width: 720,
      height: 320,
      rotation: fixture.rotation ?? 0,
      locked: fixture.locked ?? false,
    });
    deck.name = "Table boundary resize regression";
    deck.slides[0].elements = [element];
    await saveAutosave(deck);
  }, fixture);
  await page.reload();
  await expect(tableOnSlide(page)).toHaveCount(1);
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await expect(undo(page)).toBeDisabled();
}

async function localGeometry(page: Page) {
  return tableOnSlide(page).evaluate((element: HTMLElement) => {
    const grid = element.querySelector<HTMLElement>(".inserted-table")!;
    const style = getComputedStyle(grid);
    const tracks = (value: string) => value.split(/\s+/).map(parseFloat);
    return {
      columns: tracks(style.gridTemplateColumns),
      rows: tracks(style.gridTemplateRows),
      outer: {
        x: element.style.left,
        y: element.style.top,
        width: element.style.width,
        height: element.style.height,
        transform: element.style.transform,
      },
    };
  });
}

async function savedTable(page: Page) {
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  const visible = await localGeometry(page);
  const read = () =>
    page.evaluate(async () => {
      const { loadAutosave } = await import("/src/storage.ts");
      const { tableSizes } = await import("/src/table.ts");
      const deck = (await loadAutosave())!;
      const element = deck.slides[0].elements.find((e) => e.type === "table")!;
      const table = element.table!;
      return {
        element,
        columns: tableSizes(table.columnWidths, 4, element.width),
        rows: tableSizes(table.rowHeights, 4, element.height),
      };
    });
  // Mouseup can precede React's saving-status update. Wait for the actual
  // persisted tracks rather than accepting the previous "saved" label.
  let saved = await read();
  await expect
    .poll(async () => {
      saved = await read();
      return {
        columns: saved.columns.map(Math.round),
        rows: saved.rows.map(Math.round),
      };
    })
    .toEqual({
      columns: visible.columns.map(Math.round),
      rows: visible.rows.map(Math.round),
    });
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  return saved;
}

function expectTracks(actual: number[], expected: number[]) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 0));
}

async function expectLayout(page: Page, columns: number[], rows: number[]) {
  await expect
    .poll(async () => {
      const geometry = await localGeometry(page);
      return {
        columns: geometry.columns.map(Math.round),
        rows: geometry.rows.map(Math.round),
      };
    })
    .toEqual({ columns: columns.map(Math.round), rows: rows.map(Math.round) });
}

async function boundaryPoint(
  page: Page,
  axis: Axis,
  index: number,
  delta: number,
) {
  return tableOnSlide(page).evaluate(
    (element: HTMLElement, { axis, index, delta }) => {
      const grid = element.querySelector<HTMLElement>(".inserted-table")!;
      const style = getComputedStyle(grid);
      const widths = style.gridTemplateColumns.split(/\s+/).map(parseFloat);
      const heights = style.gridTemplateRows.split(/\s+/).map(parseFloat);
      const width = parseFloat(element.style.width),
        height = parseFloat(element.style.height);
      const slide = element.closest<HTMLElement>(".editable-slide")!;
      const scale = slide.getBoundingClientRect().width / slide.offsetWidth;
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
      const angle = Math.atan2(matrix.b, matrix.a),
        cos = Math.cos(angle),
        sin = Math.sin(angle);
      const bounds = element.getBoundingClientRect();
      // Stay away from row/column intersections and outer resize handles.
      const x =
        axis === "column"
          ? widths.slice(0, index + 1).reduce((a, b) => a + b, 0)
          : width * 0.37;
      const y =
        axis === "row"
          ? heights.slice(0, index + 1).reduce((a, b) => a + b, 0)
          : height * 0.37;
      const localX = x - width / 2,
        localY = y - height / 2;
      const startX =
        bounds.x + bounds.width / 2 + scale * (cos * localX - sin * localY);
      const startY =
        bounds.y + bounds.height / 2 + scale * (sin * localX + cos * localY);
      return {
        x: startX,
        y: startY,
        endX: startX + scale * delta * (axis === "column" ? cos : -sin),
        endY: startY + scale * delta * (axis === "column" ? sin : cos),
        scale,
      };
    },
    { axis, index, delta },
  );
}

async function moveBoundary(
  page: Page,
  axis: Axis,
  index: number,
  delta: number,
  release = true,
) {
  const point = await boundaryPoint(page, axis, index, delta);
  await page.mouse.move(point.x, point.y);
  await page.evaluate(() => {
    document.addEventListener(
      "pointerdown",
      (event) => {
        (window as any).__tableResizePointerId = event.pointerId;
      },
      { capture: true, once: true },
    );
  });
  await page.mouse.down();
  await page.mouse.move(point.endX, point.endY, { steps: 10 });
  if (release) await page.mouse.up();
  return point;
}

test("internal boundaries resize adjacent columns and rows with live preview and one undo per drag", async ({
  page,
}, testInfo) => {
  await seedTable(page);
  const original = await localGeometry(page);
  await expect(
    tableOnSlide(page).locator(".table-column-resize-handle"),
  ).toHaveCount(3);
  await expect(
    tableOnSlide(page).locator(".table-row-resize-handle"),
  ).toHaveCount(3);
  // Hover works before the table has been selected.
  await expect(page.getByTestId("table-move-handle")).toHaveCount(0);
  for (const axis of ["column", "row"] as const) {
    const point = await boundaryPoint(page, axis, 0, 0);
    await page.mouse.move(point.x, point.y);
    const target = await page.evaluate(({ x, y }) => {
      const hit = document.elementFromPoint(x, y)!;
      return { cursor: getComputedStyle(hit).cursor, className: hit.className };
    }, point);
    expect(target.className).toContain(`table-${axis}-resize-handle`);
    expect(target.cursor).toMatch(
      axis === "column"
        ? /^(col-resize|ew-resize)$/
        : /^(row-resize|ns-resize)$/,
    );
  }
  await moveBoundary(page, "column", 0, 60, false);
  await expectLayout(page, [240, 120, 180, 180], [80, 80, 80, 80]);
  expect((await localGeometry(page)).outer).toEqual(original.outer);
  await page.screenshot({
    path: testInfo.outputPath("table-boundary-resize.png"),
  });
  await page.mouse.up();
  const afterColumn = await savedTable(page);
  expectTracks(afterColumn.columns, [240, 120, 180, 180]);
  expect(afterColumn.element.table!.cells).toEqual(
    Array.from({ length: 4 }, (_, r) =>
      Array.from({ length: 4 }, (_, c) => `R${r + 1}C${c + 1}`),
    ),
  );
  await moveBoundary(page, "row", 1, 32, false);
  await expectLayout(page, [240, 120, 180, 180], [80, 112, 48, 80]);
  expect((await localGeometry(page)).outer).toEqual(original.outer);
  await page.mouse.up();
  expectTracks((await savedTable(page)).rows, [80, 112, 48, 80]);
  await undo(page).click();
  await expectLayout(page, [240, 120, 180, 180], [80, 80, 80, 80]);
  await undo(page).click();
  await expectLayout(page, [180, 180, 180, 180], [80, 80, 80, 80]);
  await expect(undo(page)).toBeDisabled();
  await redo(page).click();
  await redo(page).click();
  await savedTable(page);
  await page.reload();
  await expectLayout(page, [240, 120, 180, 180], [80, 112, 48, 80]);
  expect((await localGeometry(page)).outer).toEqual(original.outer);
  const first = (await tableOnSlide(page)
    .locator('[data-row="1"][data-column="1"]')
    .boundingBox())!;
  const last = (await tableOnSlide(page)
    .locator('[data-row="2"][data-column="2"]')
    .boundingBox())!;
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2, {
    steps: 10,
  });
  await page.mouse.up();
  await expect(tableOnSlide(page).locator(".table-cell-selected")).toHaveCount(
    4,
  );
  await expectLayout(page, [240, 120, 180, 180], [80, 112, 48, 80]);
  await tableOnSlide(page).screenshot({
    path: testInfo.outputPath("table-resized-grid.png"),
  });
});

test("minimum track size clamps resizing and a clamped no-op does not create an undo step", async ({
  page,
}) => {
  await seedTable(page);
  await moveBoundary(page, "column", 0, -500);
  await expectLayout(page, [24, 336, 180, 180], [80, 80, 80, 80]);
  await savedTable(page);
  await moveBoundary(page, "column", 0, -100);
  await expectLayout(page, [24, 336, 180, 180], [80, 80, 80, 80]);
  await undo(page).click();
  await expectLayout(page, [180, 180, 180, 180], [80, 80, 80, 80]);
  await expect(undo(page)).toBeDisabled();
  const dense = await page.evaluate(async () => {
    const { createTable, resizeTableBoundary, tableSizes } = await import(
      "/src/table.ts"
    );
    const table = createTable(2, 4);
    const original = JSON.stringify(table);
    const right = resizeTableBoundary(table, "column", 1, 100, 40);
    const left = resizeTableBoundary(table, "column", 1, -100, 40);
    return {
      inputUntouched: JSON.stringify(table) === original,
      right: tableSizes(right.columnWidths, 4, 40),
      left: tableSizes(left.columnWidths, 4, 40),
      cells: right.cells,
    };
  });
  expect(dense.inputUntouched).toBe(true);
  expectTracks(dense.right, [10, 10, 10, 10]);
  expectTracks(dense.left, [10, 10, 10, 10]);
  expect(dense.cells[0]).toEqual(["제목 1", "제목 2", "제목 3", "제목 4"]);
});

test("Escape, pointer cancellation and window blur restore the preview without recording a change", async ({
  page,
}) => {
  await seedTable(page);
  const original = await savedTable(page);
  for (const cancel of ["escape", "pointercancel", "blur"] as const) {
    await moveBoundary(page, "column", 1, 45, false);
    await expectLayout(page, [180, 225, 135, 180], [80, 80, 80, 80]);
    if (cancel === "escape") await page.keyboard.press("Escape");
    else if (cancel === "pointercancel") {
      const pointerId = await page.evaluate(
        () => (window as any).__tableResizePointerId,
      );
      await handle(page, "column", 1).dispatchEvent("pointercancel", {
        pointerId,
        bubbles: true,
      });
    } else await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.mouse.up();
    await expectLayout(page, [180, 180, 180, 180], [80, 80, 80, 80]);
    await expect(undo(page)).toBeDisabled();
    expect((await savedTable(page)).element).toEqual(original.element);
  }
});

test("locked tables, thumbnails and presentation surfaces do not expose editable boundaries", async ({
  page,
}) => {
  await seedTable(page, { locked: true });
  const original = await savedTable(page);
  await expect(tableOnSlide(page).locator(handles)).toHaveCount(0);
  await moveBoundary(page, "column", 0, 45);
  await expectLayout(page, [180, 180, 180, 180], [80, 80, 80, 80]);
  expect((await savedTable(page)).element).toEqual(original.element);
  await expect(undo(page)).toBeDisabled();
  await seedTable(page);
  await expect(page.locator(".thumbnail-button").locator(handles)).toHaveCount(
    0,
  );
  await page.keyboard.press("F5");
  const presentation = page.getByTestId("presentation-view");
  await expect(presentation.getByRole("table")).toBeVisible();
  await expect(presentation.locator(handles)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(presentation).toHaveCount(0);
  await expect(
    tableOnSlide(page).locator(".table-column-resize-handle"),
  ).toHaveCount(3);
});

test("rotated table boundaries follow the table axes at both reduced and enlarged zoom", async ({
  page,
}, testInfo) => {
  await seedTable(page, { rotation: 30 });
  const original = (await localGeometry(page)).outer;
  for (const zoom of [50, 125]) {
    await page.getByRole("slider", { name: "확대 비율" }).fill(String(zoom));
    await tableOnSlide(page).scrollIntoViewIfNeeded();
    const before = await savedTable(page);
    const point = await moveBoundary(page, "column", 1, 48);
    expect(point.scale).toBeCloseTo(zoom / 100, 2);
    const expectedColumns = [...before.columns];
    expectedColumns[1] += 48;
    expectedColumns[2] -= 48;
    expectTracks((await savedTable(page)).columns, expectedColumns);
    await moveBoundary(page, "row", 0, 24);
    const expectedRows = [...before.rows];
    expectedRows[0] += 24;
    expectedRows[1] -= 24;
    const after = await savedTable(page);
    expectTracks(after.rows, expectedRows);
    expectTracks(after.columns, expectedColumns);
    expect((await localGeometry(page)).outer).toEqual(original);
  }
  await page.screenshot({
    path: testInfo.outputPath("table-rotated-boundaries.png"),
  });
});

test("boundary keyboard resizing uses one or ten pixels and stops after Escape clears selection", async ({
  page,
}) => {
  await seedTable(page);
  const point = await boundaryPoint(page, "column", 0, 0);
  await page.mouse.click(point.x, point.y);
  const boundary = handle(page, "column", 0);
  await expect(boundary).toHaveAttribute("tabindex", "0");
  await boundary.focus();
  await expect(boundary).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expectLayout(page, [181, 179, 180, 180], [80, 80, 80, 80]);
  await page.keyboard.press("Shift+ArrowRight");
  await expectLayout(page, [191, 169, 180, 180], [80, 80, 80, 80]);
  const selected = await savedTable(page);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(boundary).toHaveAttribute("tabindex", "-1");
  // Keep the dormant handle focused to exercise the guard, not an unrelated target.
  await boundary.focus();
  await expect(boundary).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await expectLayout(page, [191, 169, 180, 180], [80, 80, 80, 80]);
  expect((await savedTable(page)).element).toEqual(selected.element);
  await undo(page).click();
  await expectLayout(page, [181, 179, 180, 180], [80, 80, 80, 80]);
  await undo(page).click();
  await expectLayout(page, [180, 180, 180, 180], [80, 80, 80, 80]);
  await expect(undo(page)).toBeDisabled();
});

test("dragged unequal row and column sizes survive project and native PowerPoint table round trips", async ({
  page,
}) => {
  await seedTable(page, { unequal: true });
  await moveBoundary(page, "column", 0, 40);
  await moveBoundary(page, "row", 1, -24);
  const resized = await savedTable(page);
  expectTracks(resized.columns, [160, 200, 120, 240]);
  expectTracks(resized.rows, [80, 96, 104, 40]);
  const result = await page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts");
    const { tableSizes } = await import("/src/table.ts");
    const { exportPptx, importPptx, serializeDeck, parseDeckJson } =
      await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const deck = (await loadAutosave())!,
      project = parseDeckJson(serializeDeck(deck));
    const bytes = await exportPptx(deck),
      zip = await JSZip.loadAsync(bytes);
    const xml = new DOMParser().parseFromString(
      await zip.file("ppt/slides/slide1.xml")!.async("string"),
      "text/xml",
    );
    const tables = xml.getElementsByTagNameNS("*", "tbl"),
      native = tables[0];
    const nativeColumns = [
      ...native.getElementsByTagNameNS("*", "gridCol"),
    ].map((column) => Number(column.getAttribute("w")) / 9525);
    const nativeRows = [...native.getElementsByTagNameNS("*", "tr")].map(
      (row) => Number(row.getAttribute("h")) / 9525,
    );
    const imported = await importPptx(bytes),
      twice = await importPptx(await exportPptx(imported.deck));
    const summarize = (value: typeof deck) => {
      const elements = value.slides[0].elements,
        element = elements.find((e) => e.type === "table"),
        table = element?.table;
      return {
        types: elements.map((e) => e.type),
        cells: table?.cells,
        geometry: element && {
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          rotation: element.rotation,
        },
        columns: table && tableSizes(table.columnWidths, 4, element!.width),
        rows: table && tableSizes(table.rowHeights, 4, element!.height),
      };
    };
    return {
      nativeTables: tables.length,
      nativeCells: native.getElementsByTagNameNS("*", "tc").length,
      nativeColumns,
      nativeRows,
      project: summarize(project),
      imported: summarize(imported.deck),
      twice: summarize(twice.deck),
      warnings: [...imported.warnings, ...twice.warnings],
    };
  });
  expect(result.nativeTables).toBe(1);
  expect(result.nativeCells).toBe(16);
  expectTracks(result.nativeColumns, resized.columns);
  expectTracks(result.nativeRows, resized.rows);
  for (const roundTrip of [result.project, result.imported, result.twice]) {
    expect(roundTrip.types).toEqual(["table"]);
    expect(roundTrip.cells).toEqual(resized.element.table!.cells);
    expect(roundTrip.geometry).toEqual({
      x: 280,
      y: 200,
      width: 720,
      height: 320,
      rotation: 0,
    });
    expectTracks(roundTrip.columns!, resized.columns);
    expectTracks(roundTrip.rows!, resized.rows);
  }
  expect(result.warnings).toEqual([]);
});
