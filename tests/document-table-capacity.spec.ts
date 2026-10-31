import { expect, test, type Page } from "@playwright/test";

const base = process.env.QA_BASE_URL ?? "http://127.0.0.1:5190";
const table = (page: Page) =>
  page.locator('.editable-slide [data-type="table"]');
const cell = (page: Page, row: number, column: number) =>
  table(page).first().locator(`[data-row="${row}"][data-column="${column}"]`);
const errorText = "표 셀을 포함한 프로젝트 개체 수가 10,000개를 초과합니다.";
test.describe.configure({ timeout: 90000 });

async function seed(page: Page, budget: number) {
  await page.goto(base);
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async (budget) => {
    const { blankDeck, newSlide, element } = await import("/src/model.ts");
    const { createTable, createTableElement } = await import("/src/table.ts");
    const { validateDeck } = await import("/src/io.ts");
    const { saveAutosave } = await import("/src/storage.ts");
    const make = (rows: number, columns: number) => {
      const data = createTable(rows, columns);
      Object.assign(data, {
        cells: Array.from({ length: rows }, () => Array(columns).fill("")),
        header: false,
        striped: false,
        autoRows: false,
        fontSize: 12,
        padding: 2,
      });
      return createTableElement(data);
    };
    const active = {
      ...make(2, 2),
      id: "capacity-active-table",
      x: 240,
      y: 150,
      width: 420,
      height: 180,
    };
    active.table!.cells = [
      ["A", "B"],
      ["C", "D"],
    ];
    const deck = blankDeck();
    deck.name = "표 한도 검수";
    deck.slides = Array.from({ length: 26 }, () => newSlide("blank"));
    deck.slides[0].elements = [active];
    // Keep large empty reservoir tables outside the thumbnail viewport. Their
    // cells count toward the same document budget as the four editable cells.
    for (let i = 21; i < 25; i++) deck.slides[i].elements = [make(100, 24)];
    deck.slides[25].elements = [
      make(7, 50),
      ...Array.from({ length: budget - 9960 }, () =>
        element("shape", { width: 10, height: 10 }),
      ),
    ];
    validateDeck(deck);
    await saveAutosave(deck);
    sessionStorage.setItem("slide-studio-file-dirty", "false");
  }, budget);
  await page.reload();
  await expect(page.locator(".thumbnail-row")).toHaveCount(26);
  await expect(table(page)).toHaveCount(1);
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(() => {
    (window as any).__capacityWrites = 0;
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "documents" && args[1] === "current")
        (window as any).__capacityWrites++;
      return original.apply(this, args as any);
    };
  });
}

async function state(page: Page) {
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  const state = await page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts");
    const { validateDeck } = await import("/src/io.ts");
    const deck = (await loadAutosave())!;
    validateDeck(deck);
    const tables = deck.slides
      .flatMap((s) => s.elements)
      .filter((e) => e.table);
    const data = new TextEncoder().encode(JSON.stringify(deck));
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
      (n) => n.toString(16).padStart(2, "0"),
    ).join("");
    return {
      hash,
      slides: deck.slides.length,
      count:
        deck.slides.reduce((n, s) => n + s.elements.length, 0) +
        tables.reduce(
          (n, e) => n + e.table!.cells.length * e.table!.cells[0].length,
          0,
        ),
      tables: tables.length,
      active: deck.slides[0].elements
        .filter((e) => e.table)
        .map((e) => ({
          id: e.id,
          rows: e.table!.cells.length,
          columns: e.table!.cells[0].length,
          cells: e.table!.cells,
        })),
      writes: (window as any).__capacityWrites,
      dirty: sessionStorage.getItem("slide-studio-file-dirty"),
    };
  });
  return {
    ...state,
    undo: await page
      .getByRole("button", { name: "실행 취소", exact: true })
      .isEnabled(),
    redo: await page
      .getByRole("button", { name: "다시 실행", exact: true })
      .isEnabled(),
  };
}

async function unchangedAfterRefusal(
  page: Page,
  before: Awaited<ReturnType<typeof state>>,
) {
  // Wait beyond the recovery debounce, so a needless write cannot hide here.
  await page.waitForTimeout(650);
  expect(await state(page)).toEqual(before);
}

async function selectWholeTable(page: Page) {
  if (!(await page.locator(".layer-panel").isVisible()))
    await page.getByRole("button", { name: "선택 창", exact: true }).click();
  await page.locator("[data-layer-key]").evaluateAll((nodes) => {
    const target = nodes.find(
      (n) =>
        n.getAttribute("data-layer-key") ===
        JSON.stringify(["element", "capacity-active-table"]),
    );
    if (!target) throw Error("Missing active table in selection pane");
    (target as HTMLElement).click();
  });
}

async function copied(page: Page) {
  return page.evaluate(() => {
    const data = new DataTransfer();
    window.dispatchEvent(
      new ClipboardEvent("copy", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
    return Object.fromEntries(
      data.types.map((key) => [key, data.getData(key)]),
    );
  });
}

async function paste(page: Page, data: Record<string, string>) {
  await page.evaluate((values) => {
    const data = new DataTransfer();
    for (const [key, value] of Object.entries(values)) data.setData(key, value);
    window.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
  }, data);
}
const html =
  "<table><tr><td>P</td><td>Q</td></tr><tr><td>R</td><td>S</td></tr></table>";

test("capacity calculator and recovery storage use object plus table-cell costs and allow exactly 10000", async ({
  page,
}) => {
  await seed(page, 9999);
  const result = await page.evaluate(async () => {
    const { loadAutosave, saveAutosave } = await import("/src/storage.ts");
    const { documentCapacityError } = await import("/src/document-limits.ts");
    const { element, newSlide } = await import("/src/model.ts");
    const { createTable, createTableElement } = await import("/src/table.ts");
    const { validateDeck } = await import("/src/io.ts");
    const deck = (await loadAutosave())!,
      shape = element("shape"),
      small = createTableElement(createTable(1, 1));
    const id = deck.slides[0].id;
    const exact = {
      ...deck,
      slides: deck.slides.map((s, i) =>
        i === 0 ? { ...s, elements: [...s.elements, shape] } : s,
      ),
    };
    const invalid = {
      ...deck,
      slides: deck.slides.map((s, i) =>
        i === 0 ? { ...s, elements: [...s.elements, small] } : s,
      ),
    };
    validateDeck(exact);
    let saveError = "";
    try {
      await saveAutosave(invalid);
    } catch (e) {
      saveError = (e as Error).message;
    }
    const old = await loadAutosave();
    return {
      exact: documentCapacityError(exact) ?? null,
      newShape:
        documentCapacityError(deck, { elements: { [id]: [shape] } }) ?? null,
      newTable: documentCapacityError(deck, { elements: { [id]: [small] } }),
      slide: documentCapacityError(deck, {
        slides: [{ ...newSlide("blank"), elements: [small] }],
      }),
      saveError,
      storedUnchanged: JSON.stringify(old) === JSON.stringify(deck),
    };
  });
  expect(result).toEqual({
    exact: null,
    newShape: null,
    newTable: errorText,
    slide: errorText,
    saveError: errorText,
    storedUnchanged: true,
  });
});

test("table duplicate stops at the exact budget and a rejected duplicate keeps document, dirty state and history", async ({
  page,
}) => {
  await seed(page, 9995);
  await selectWholeTable(page);
  await page.keyboard.press("ControlOrMeta+d");
  await expect(table(page)).toHaveCount(2);
  const before = await state(page);
  expect(before.count).toBe(10000);
  await page.keyboard.press("ControlOrMeta+d");
  await expect(page.locator(".toast")).toHaveText(errorText);
  await unchangedAfterRefusal(page, before);
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  expect((await state(page)).count).toBe(9995);
  const undo = await state(page);
  expect(undo.redo).toBe(true);
  await page.keyboard.press("Escape");
  await paste(page, {
    "text/html":
      "<table><tr><td>A</td><td>B</td><td>C</td></tr><tr><td>D</td><td>E</td><td>F</td></tr></table>",
  });
  await expect(page.locator(".toast")).toHaveText(errorText);
  await unchangedAfterRefusal(page, undo);
  await page.getByRole("button", { name: "다시 실행", exact: true }).click();
  expect((await state(page)).count).toBe(10000);
  await page.reload();
  await expect(table(page)).toHaveCount(2);
  await expect(page.locator(".thumbnail-row")).toHaveCount(26);
});

test("external table insertion reports refusal instead of success and can fill the last five budget units", async ({
  page,
}) => {
  await seed(page, 9995);
  await paste(page, { "text/html": html });
  await expect(table(page)).toHaveCount(2);
  const before = await state(page);
  expect(before.count).toBe(10000);
  await paste(page, { "text/html": html });
  await expect(page.locator(".toast")).toHaveText(errorText);
  await unchangedAfterRefusal(page, before);
});

test("native object and slide clipboard operations include table cells before committing", async ({
  page,
}) => {
  await seed(page, 9995);
  await selectWholeTable(page);
  const object = await copied(page);
  await page.locator(".thumbnail-button").nth(1).click();
  await paste(page, object);
  await expect(table(page)).toHaveCount(1);
  const before = await state(page);
  expect(before.count).toBe(10000);
  await paste(page, object);
  await expect(page.locator(".toast")).toHaveText(errorText);
  await unchangedAfterRefusal(page, before);
  await page.locator(".thumbnail-button").first().click();
  const slide = await copied(page);
  const beforeSlide = await state(page);
  await paste(page, slide);
  await expect(page.locator(".toast")).toHaveText(errorText);
  await unchangedAfterRefusal(page, beforeSlide);
  await page.keyboard.press("ControlOrMeta+Shift+d");
  await expect(page.locator(".toast")).toHaveText(errorText);
  await unchangedAfterRefusal(page, beforeSlide);
});

test("HTML paste growth checks the final table dimensions and preserves the old cells on refusal", async ({
  page,
}) => {
  await seed(page, 9995);
  await cell(page, 1, 1).click();
  await paste(page, { "text/html": html });
  await expect(cell(page, 2, 2).locator(".table-cell-text")).toHaveText("S");
  const before = await state(page);
  expect(before.count).toBe(10000);
  expect(before.active[0]).toMatchObject({ rows: 3, columns: 3 });
  await cell(page, 2, 2).click();
  await paste(page, { "text/html": html });
  await expect(page.locator(".toast")).toHaveText(errorText);
  await unchangedAfterRefusal(page, before);
});

test("table editor apply rejects growth in place and keeps its draft open without touching the saved document", async ({
  page,
}) => {
  await seed(page, 9998);
  await cell(page, 0, 0).dblclick();
  let dialog = page.getByRole("dialog", { name: "표 편집", exact: true });
  await dialog
    .getByRole("spinbutton", { name: "표 행 수", exact: true })
    .fill("3");
  await dialog.getByRole("button", { name: "표 적용", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((await state(page)).count).toBe(10000);
  await cell(page, 0, 0).dblclick();
  dialog = page.getByRole("dialog", { name: "표 편집", exact: true });
  const before = await state(page);
  await dialog
    .getByRole("spinbutton", { name: "표 행 수", exact: true })
    .fill("4");
  await dialog.getByRole("button", { name: "표 적용", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText(errorText);
  await unchangedAfterRefusal(page, before);
});

test("Tab at the last inline cell keeps the current editor and selection when a new row cannot fit", async ({
  page,
}) => {
  await seed(page, 9998);
  await cell(page, 1, 1).click();
  await page.keyboard.press("F2");
  let editor = page.getByRole("textbox", {
    name: "2행 2열 셀 텍스트 편집",
    exact: true,
  });
  await expect(editor).toBeFocused();
  await editor.press("Tab");
  await expect(cell(page, 2, 0)).toBeVisible();
  expect((await state(page)).count).toBe(10000);
  await cell(page, 2, 1).click();
  await page.keyboard.press("F2");
  editor = page.getByRole("textbox", {
    name: "3행 2열 셀 텍스트 편집",
    exact: true,
  });
  await expect(editor).toBeFocused();
  const before = await state(page);
  await editor.press("Tab");
  await expect(page.locator(".toast")).toHaveText(errorText);
  await expect(editor).toBeFocused();
  await unchangedAfterRefusal(page, before);
  await editor.press("Escape");
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  expect((await state(page)).count).toBe(9998);
  await page.getByRole("button", { name: "다시 실행", exact: true }).click();
  expect((await state(page)).count).toBe(10000);
});

test("new table insertion refuses an oversized draft and leaves the saved document clean", async ({
  page,
}) => {
  await seed(page, 10000);
  const before = await state(page);
  expect(before.dirty).toBe("false");
  await page.getByRole("button", { name: "삽입", exact: true }).click();
  await page.getByRole("button", { name: "표", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "표 삽입", exact: true });
  await dialog.getByRole("button", { name: "표 삽입", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText(errorText);
  await unchangedAfterRefusal(page, before);
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await unchangedAfterRefusal(page, before);
});

test("refusing a Tab row keeps text just entered in the last cell and its undo step", async ({
  page,
}) => {
  await seed(page, 10000);
  await cell(page, 1, 1).click();
  await page.keyboard.press("F2");
  const editor = page.getByRole("textbox", {
    name: "2행 2열 셀 텍스트 편집",
    exact: true,
  });
  await editor.fill("지우면 안 되는 한글");
  const before = await state(page);
  await editor.press("Tab");
  await expect(page.locator(".toast")).toHaveText(errorText);
  await expect(editor).toBeFocused();
  await expect(editor).toHaveText("지우면 안 되는 한글");
  await unchangedAfterRefusal(page, before);
  await editor.press("Escape");
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  expect((await state(page)).active[0].cells[1][1]).toBe("D");
  await page.getByRole("button", { name: "다시 실행", exact: true }).click();
  expect((await state(page)).active[0].cells[1][1]).toBe("지우면 안 되는 한글");
});

test("a native PPTX at exactly 10000 weighted objects remains saveable and reloadable", async ({
  page,
}, info) => {
  await seed(page, 10000);
  const result = await page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts"),
      { exportPptx, importPptx } = await import("/src/io.ts");
    const source = (await loadAutosave())!;
    const bytes = await exportPptx(source);
    const reopened = (await importPptx(bytes)).deck;
    return {
      bytes: Array.from(bytes),
      slides: reopened.slides.length,
      count: reopened.slides.reduce(
        (n, s) =>
          n +
          s.elements.reduce(
            (x, e) =>
              x +
              1 +
              (e.table ? e.table.cells.length * e.table.cells[0].length : 0),
            0,
          ),
        0,
      ),
    };
  });
  expect(result.count).toBe(10000);
  expect(result.slides).toBe(26);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(info.outputPath("exact-10000.pptx"), Buffer.from(result.bytes));
});
