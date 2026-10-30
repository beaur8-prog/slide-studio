import { test, expect, type Page } from "@playwright/test";
const item = (page: Page, id: string) =>
  page.locator(`.editable-slide [data-element-id="${id}"]`);
const editor = (page: Page) => page.locator(".editing-text");
async function seed(page: Page) {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts"),
      { saveAutosave } = await import("/src/storage.ts"),
      { createTable } = await import("/src/table.ts");
    const deck = blankDeck();
    deck.slides[0].elements = [
      element("shape", {
        id: "source",
        name: "원본",
        shape: "rect",
        text: "서식 원본",
        x: 50,
        y: 50,
        width: 260,
        height: 100,
        fill: "#224488",
        stroke: "#CC5522",
        strokeWidth: 4,
        fontSize: 28,
        color: "#33AA77",
        fontFamily: "Courier New",
        bold: true,
        italic: true,
        underline: false,
      }),
      element("text", {
        id: "target",
        text: "Alpha Beta",
        x: 400,
        y: 50,
        width: 700,
        height: 130,
        fontSize: 34,
        color: "#112233",
        underline: true,
        paragraphs: [
          {
            spaceAfter: 16,
            runs: [
              { text: "Alpha ", bold: false, language: "en-US" },
              {
                text: "Beta",
                hyperlink: { url: "https://example.com/" },
                underline: true,
              },
            ],
          },
        ],
      }),
      element("shape", {
        id: "shape",
        name: "대상",
        shape: "ellipse",
        x: 70,
        y: 260,
        width: 170,
        height: 140,
        fill: "#FFFFFF",
        strokeWidth: 0,
        rotation: 12,
      }),
      element("shape", {
        id: "locked",
        name: "잠김",
        x: 350,
        y: 280,
        width: 100,
        height: 100,
        locked: true,
      }),
      element("table", {
        id: "table",
        x: 650,
        y: 250,
        width: 500,
        height: 250,
        table: createTable(2, 2),
      }),
    ];
    await saveAutosave(deck);
  });
  await page.reload();
}
async function savedElement(page: Page, id: string) {
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  return page.evaluate(async (id) => {
    const { loadAutosave } = await import("/src/storage.ts");
    return (await loadAutosave())!.slides[0].elements.find((e) => e.id === id)!;
  }, id);
}
async function selectBeta(page: Page) {
  await editor(page).evaluate(async (host) => {
    const { restoreTextOffsets } = await import("/src/text-selection.ts");
    restoreTextOffsets(host as HTMLElement, 6, 10);
  });
}
async function charStyles(page: Page) {
  const e = await savedElement(page, "target");
  return e.paragraphs!.flatMap((p) =>
    p.runs.flatMap((r) =>
      [...r.text].map(() => ({
        color: r.color ?? e.color,
        size: r.fontSize ?? e.fontSize,
        bold: r.bold ?? e.bold,
        italic: r.italic ?? e.italic,
        underline: r.underline ?? e.underline,
      })),
    ),
  );
}

test("paintbrush copies shape styling without geometry or text, is one use, and one undo restores it", async ({
  page,
}) => {
  await seed(page);
  const before = await savedElement(page, "shape");
  await item(page, "source").click();
  await page.getByRole("button", { name: "서식 복사", exact: true }).click();
  await expect(
    page.getByRole("status", { name: "서식 복사 모드" }),
  ).toBeVisible();
  await item(page, "shape").click();
  await expect(
    page.getByRole("status", { name: "서식 복사 모드" }),
  ).toHaveCount(0);
  const after = await savedElement(page, "shape");
  expect(after).toMatchObject({
    id: "shape",
    name: "대상",
    shape: "ellipse",
    x: before.x,
    y: before.y,
    width: before.width,
    height: before.height,
    rotation: 12,
    fill: "#224488",
    stroke: "#CC5522",
    strokeWidth: 4,
    fontSize: 28,
    color: "#33AA77",
    bold: true,
    italic: true,
  });
  expect(after.text).toBe(before.text);
  await page.keyboard.press("ControlOrMeta+z");
  expect(await savedElement(page, "shape")).toEqual(before);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect((await savedElement(page, "shape")).fill).toBe("#224488");
});

test("keyboard formatting only paints Beta, clears inherited underline, preserves links and supports native undo/redo and PPTX", async ({
  page,
}) => {
  await seed(page);
  await item(page, "source").click();
  await page.keyboard.press("ControlOrMeta+Shift+c");
  await page.keyboard.press("Escape");
  await item(page, "target").dblclick();
  await selectBeta(page);
  const before = await charStyles(page);
  await page.keyboard.press("ControlOrMeta+Shift+v");
  expect(await page.evaluate(() => getSelection()?.toString())).toBe("Beta");
  let styles = await charStyles(page);
  expect(styles.slice(0, 6)).toEqual(before.slice(0, 6));
  expect(styles.slice(6)).toEqual(
    Array(4).fill({
      color: "#33AA77",
      size: 28,
      bold: true,
      italic: true,
      underline: false,
    }),
  );
  await page.keyboard.press("ControlOrMeta+z");
  expect(await charStyles(page)).toEqual(before);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect((await charStyles(page)).slice(6)).toEqual(styles.slice(6));
  await page.keyboard.press("Escape");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  const restored = await page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts"),
      { exportPptx, importPptx } = await import("/src/io.ts");
    const d = (await importPptx(await exportPptx((await loadAutosave())!)))
      .deck;
    return d.slides[0].elements.find((e) => e.text === "Alpha Beta")!;
  });
  expect(restored.paragraphs?.[0].spaceAfter).toBe(16);
  const beta = restored
    .paragraphs!.flatMap((p) => p.runs)
    .find((r) => r.text.includes("Beta"))!;
  expect(beta).toMatchObject({
    color: "#33AA77",
    fontSize: 28,
    bold: true,
    italic: true,
    underline: false,
    hyperlink: { url: "https://example.com/" },
  });
});

test("double click repeats, ignores locked targets, and Escape cancels without altering the document", async ({
  page,
}) => {
  await seed(page);
  await item(page, "source").click();
  await page.getByRole("button", { name: "서식 복사", exact: true }).dblclick();
  await expect(
    page.getByRole("button", { name: "계속 적용", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const locked = await savedElement(page, "locked");
  await item(page, "locked").click();
  expect(await savedElement(page, "locked")).toEqual(locked);
  await item(page, "shape").click();
  await expect(
    page.getByRole("status", { name: "서식 복사 모드" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("status", { name: "서식 복사 모드" }),
  ).toHaveCount(0);
  expect((await savedElement(page, "shape")).fill).toBe("#224488");
});

test("copying a partial source reads its actual run, and a collapsed destination does not change the whole box", async ({
  page,
}) => {
  await seed(page);
  await item(page, "target").dblclick();
  await selectBeta(page);
  await page.keyboard.press("ControlOrMeta+Shift+c");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await item(page, "source").dblclick();
  await editor(page).evaluate((host) => {
    const r = document.createRange();
    r.selectNodeContents(host);
    r.collapse(true);
    const s = getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
  });
  const before = await savedElement(page, "source");
  await page.keyboard.press("ControlOrMeta+Shift+v");
  expect(await savedElement(page, "source")).toEqual(before);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+Shift+v");
  const e = await savedElement(page, "source");
  expect(
    e
      .paragraphs!.flatMap((p) => p.runs)
      .every((r) => r.underline === true && (r.color ?? e.color) === "#112233"),
  ).toBe(true);
});

test("cell range formatting preserves text, dimensions, merges and unselected cells", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { element } = await import("/src/model.ts"),
      { createTable, tableCellStyle } = await import("/src/table.ts"),
      { applyObjectFormat, captureObjectFormat } = await import(
        "/src/format-painter.ts"
      );
    const source = element("table", { table: createTable(2, 2) });
    source.table!.cellStyles = [
      [
        {
          color: "#8822CC",
          fontSize: 26,
          italic: true,
          borders: [
            { color: "#FF0000", width: 2 },
            { color: "#00FF00", width: 3 },
            { color: "#0000FF", width: 4 },
            { color: "#000000", width: 1 },
          ],
        },
        null,
      ],
      [null, null],
    ];
    const target = element("table", {
      x: 100,
      y: 100,
      width: 900,
      height: 500,
      table: createTable(2, 2),
    });
    target.table!.cells[0][1] = "";
    target.table!.merges = [{ row: 0, column: 0, rowSpan: 1, columnSpan: 2 }];
    const sample = captureObjectFormat(source, { row: 0, column: 0 });
    const painted = applyObjectFormat(target, sample, {
      startRow: 1,
      endRow: 1,
      startColumn: 1,
      endColumn: 1,
    });
    return {
      before: target,
      after: painted,
      style: tableCellStyle(painted.table!, 1, 1),
      source: source.table!.cellStyles[0][0],
    };
  });
  expect(result.after.table!.cells).toEqual(result.before.table!.cells);
  expect(result.after.table!.merges).toEqual(result.before.table!.merges);
  expect(result.after.table!.cellStyles?.[0]).toEqual([null, null]);
  expect(result.style).toMatchObject({
    color: "#8822CC",
    fontSize: 26,
    italic: true,
    borders: result.source!.borders,
  });
  for (const key of ["x", "y", "width", "height"] as const)
    expect(result.after[key]).toBe(result.before[key]);
});

test("copying and applying identical plain text or shape formatting adds no document history", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { element } = await import("/src/model.ts"),
      { captureObjectFormat, applyObjectFormat, paintTextRange } = await import(
        "/src/format-painter.ts"
      );
    const text = element("text", { text: "Alpha Beta" }),
      shape = element("shape");
    return {
      text: paintTextRange(text, captureObjectFormat(text), 6, 10) === text,
      shape: applyObjectFormat(shape, captureObjectFormat(shape)) === shape,
    };
  });
  expect(result).toEqual({ text: true, shape: true });
});

test("right-click format paste preserves the selected characters and editing focus", async ({
  page,
}) => {
  await seed(page);
  await item(page, "source").click();
  await page.keyboard.press("ControlOrMeta+Shift+c");
  await page.keyboard.press("Escape");
  await item(page, "target").dblclick();
  await selectBeta(page);
  await editor(page).click({ button: "right" });
  await page
    .getByRole("menu", { name: "텍스트 편집" })
    .getByRole("menuitem", { name: "서식 붙여넣기", exact: true })
    .click();
  await expect(editor(page)).toBeFocused();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe("Beta");
  expect((await charStyles(page)).slice(6)).toEqual(
    Array(4).fill({
      color: "#33AA77",
      size: 28,
      bold: true,
      italic: true,
      underline: false,
    }),
  );
});

test("dragging over text with the painter active applies the copied style only to that range", async ({
  page,
}) => {
  await seed(page);
  await item(page, "target").dblclick();
  await editor(page).evaluate(async (host) => {
    const { restoreTextOffsets } = await import("/src/text-selection.ts");
    restoreTextOffsets(host as HTMLElement, 0, 5);
  });
  await page.getByRole("button", { name: "기울임", exact: true }).click();
  await page.keyboard.press("ControlOrMeta+Shift+c");
  const box = await editor(page).evaluate(async (host) => {
    const { textRangeAtOffsets } = await import("/src/text-selection.ts");
    const rect = textRangeAtOffsets(
      host as HTMLElement,
      6,
      10,
    ).getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  await page.mouse.move(box.x + 0.2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 0.2, box.y + box.height / 2, {
    steps: 10,
  });
  await page.mouse.up();
  await expect(
    page.getByRole("status", { name: "서식 복사 모드" }),
  ).toHaveCount(0);
  const italic = (await charStyles(page)).map((style) => !!style.italic);
  expect(italic).toEqual([
    ...Array(5).fill(true),
    false,
    ...Array(4).fill(true),
  ]);
  expect(await page.evaluate(() => getSelection()?.toString())).toBe("Beta");
});
