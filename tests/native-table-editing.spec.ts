import { test, expect } from "@playwright/test";

test("foreign merged tables retain editable structure, rich paragraphs, exact insets and asymmetric borders over three PPTX rounds", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts"),
      { createTable, createTableElement } = await import("/src/table.ts"),
      { exportPptx, importPptx } = await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const data = createTable(3, 3);
    data.header = false;
    data.striped = false;
    data.cells = [
      ["한글 Bold", "", "A"],
      ["", "", "B"],
      ["C", "D", "E"],
    ];
    data.merges = [{ row: 0, column: 0, rowSpan: 2, columnSpan: 2 }];
    data.columnWidths = [1, 2, 3];
    data.rowHeights = [2, 1, 2];
    data.cellStyles = [
      [
        {
          paragraphs: [
            {
              lineHeight: 1.4,
              runs: [
                { text: "한글 ", fontSize: 20, color: "#123456" },
                {
                  text: "Bold",
                  bold: true,
                  italic: true,
                  underline: true,
                  fontSize: 26,
                  color: "#AA2233",
                },
              ],
            },
          ],
          textInsets: [3, 7, 9, 11],
          borders: [
            { color: "#FF0000", width: 1 },
            { color: "#00FF00", width: 2 },
            { color: "#0000FF", width: 3 },
            { color: "transparent", width: 0 },
          ],
        },
        null,
        null,
      ],
      [null, null, null],
      [null, null, null],
    ];
    const deck = blankDeck();
    deck.slides[0].elements = [
      { ...createTableElement(data), x: 90, y: 100, width: 900, height: 300 },
    ];
    const zip = await JSZip.loadAsync(await exportPptx(deck));
    const path = "ppt/slides/slide1.xml",
      doc = new DOMParser().parseFromString(
        await zip.file(path)!.async("string"),
        "application/xml",
      );
    for (const marker of Array.from(
      doc.getElementsByTagNameNS("urn:slide-studio:table:v1", "table"),
    ))
      marker.parentElement?.remove();
    zip.file(path, new XMLSerializer().serializeToString(doc));
    let restored = (
      await importPptx(await zip.generateAsync({ type: "uint8array" }))
    ).deck;
    const first = structuredClone(restored.slides[0].elements);
    for (let i = 0; i < 3; i++)
      restored = (await importPptx(await exportPptx(restored))).deck;
    return { first, final: restored.slides[0].elements };
  });
  expect(result.first).toHaveLength(1);
  expect(result.first[0].type).toBe("table");
  for (const element of [result.first[0], result.final[0]]) {
    expect(element).toMatchObject({ x: 90, y: 100, width: 900, height: 300 });
    expect(element.table!.cells).toEqual([
      ["한글 Bold", "", "A"],
      ["", "", "B"],
      ["C", "D", "E"],
    ]);
    expect(element.table!.merges).toEqual([
      { row: 0, column: 0, rowSpan: 2, columnSpan: 2 },
    ]);
    const style = element.table!.cellStyles![0][0]!;
    expect(style.textInsets).toEqual([3, 7, 9, 11]);
    expect(style.borders!.map((b) => b.width)).toEqual([1, 2, 3, 0]);
    expect(style.paragraphs![0].runs[1]).toMatchObject({
      text: "Bold",
      bold: true,
      italic: true,
      underline: true,
      fontSize: 26,
      color: "#AA2233",
    });
  }
});

test("table dialog pastes quoted TSV, merges/splits without losing text and Tab appends a row", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  await page.getByRole("button", { name: "삽입", exact: true }).click();
  await page.getByRole("button", { name: "표", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "표 삽입", exact: true }),
    first = dialog.getByRole("textbox", { name: "1행 1열", exact: true });
  await first.evaluate((el) => {
    const data = new DataTransfer();
    data.setData("text/plain", '"여러\n줄"\tB\nC\tD');
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
  });
  await expect(first).toHaveValue("여러\n줄");
  await expect(
    dialog.getByRole("textbox", { name: "2행 2열", exact: true }),
  ).toHaveValue("D");
  await dialog.getByRole("button", { name: "셀 병합", exact: true }).click();
  await expect(first).toHaveValue("여러\n줄\nB\nC\nD");
  await expect(
    dialog.getByRole("textbox", { name: "1행 2열", exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "셀 나누기", exact: true }).click();
  await expect(
    dialog.getByRole("textbox", { name: "1행 2열", exact: true }),
  ).toHaveCount(1);
  const last = dialog.getByRole("textbox", { name: "4행 3열", exact: true });
  await last.focus();
  await last.press("Tab");
  await expect(
    dialog.getByRole("textbox", { name: "5행 1열", exact: true }),
  ).toBeFocused();
  await dialog.getByRole("button", { name: "표 삽입", exact: true }).click();
  await expect(
    page.locator('[data-type="table"] [role="table"]'),
  ).toHaveAttribute("aria-rowcount", "5");
});

test("table clipboard and merge axes reject overlaps, keep quoted cell data and preserve a merged anchor when its row is deleted", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const r = await page.evaluate(async () => {
    const { createTable, mergeTableCells, changeTableAxis, validateTable } =
      await import("/src/table.ts");
    const { parseTableClipboard, pasteTableClipboard } = await import(
      "/src/table-clipboard.ts"
    );
    const table = createTable(2, 2);
    table.cells = [
      ["A", "B"],
      ["C", "D"],
    ];
    const merged = mergeTableCells(table, {
      startRow: 0,
      endRow: 1,
      startColumn: 0,
      endColumn: 1,
    });
    const deleted = changeTableAxis(merged, "row", 0, true);
    const pasted = pasteTableClipboard(
      table,
      1,
      1,
      parseTableClipboard('"A\tB"\t"C""D"\r\nE\tF\r\n'),
    );
    let rejects = false;
    try {
      validateTable({
        ...merged,
        merges: [...merged.merges!, ...merged.merges!],
      });
    } catch {
      rejects = true;
    }
    return { deleted, pasted, rejects };
  });
  expect(r.deleted.cells[0][0]).toBe("A\nB\nC\nD");
  expect(r.deleted.merges).toEqual([
    { row: 0, column: 0, rowSpan: 1, columnSpan: 2 },
  ]);
  expect(r.pasted.cells).toEqual([
    ["A", "B", ""],
    ["C", "A\tB", 'C"D'],
    ["", "E", "F"],
  ]);
  expect(r.rejects).toBe(true);
});

test("canvas cells support Korean input, Tab, partial italic and whole-cell font changes", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts"),
      { createTable, createTableElement } = await import("/src/table.ts"),
      { saveAutosave } = await import("/src/storage.ts");
    const deck = blankDeck(),
      table = createTable(2, 2);
    table.cells = [
      ["Alpha Beta", "둘째"],
      ["셋째", "넷째"],
    ];
    deck.slides[0].elements = [createTableElement(table)];
    await saveAutosave(deck);
  });
  await page.reload();
  const table = page.locator('.editable-slide [data-type="table"]');
  await table.locator('[data-row="0"][data-column="0"]').click();
  await page.keyboard.press("Enter");
  const editor = page.getByRole("textbox", { name: "1행 1열 셀 텍스트 편집" });
  await expect(editor).toBeFocused();
  await editor.evaluate(async (host) => {
    const { restoreTextOffsets } = await import("/src/text-selection.ts");
    restoreTextOffsets(host, 6, 10);
  });
  await page.getByRole("button", { name: "기울임", exact: true }).click();
  await expect
    .poll(() =>
      editor.evaluate((host) =>
        [...host.querySelectorAll("span")]
          .filter((n) => getComputedStyle(n).fontStyle === "italic")
          .map((n) => n.textContent)
          .join(""),
      ),
    )
    .toContain("Beta");
  await editor.press("Tab");
  const second = page.getByRole("textbox", { name: "1행 2열 셀 텍스트 편집" });
  await expect(second).toBeFocused();
  await second.press("ControlOrMeta+A");
  await second.pressSequentially("한글 입력");
  await second.press("Escape");
  await expect(table.locator('[data-row="0"][data-column="1"]')).toContainText(
    "한글 입력",
  );
  await page.getByRole("button", { name: "홈", exact: true }).click();
  const size = page
    .getByRole("spinbutton", { name: "글자 크기", exact: true })
    .first();
  await size.fill("21");
  await size.press("Enter");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { loadAutosave } = await import("/src/storage.ts");
        return (await loadAutosave())?.slides[0].elements[0].table
          ?.cellStyles?.[0];
      }),
    )
    .toMatchObject([
      {
        paragraphs: [
          { runs: [{ text: "Alpha " }, { text: "Beta", italic: true }] },
        ],
      },
      { fontSize: 28 },
    ]);
  await page.reload();
  await expect(table).toContainText("한글 입력");
});

test("clicking Apply commits the focused numeric draft even when row count recenters the dialog", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  await page.getByRole("button", { name: "삽입", exact: true }).click();
  await page.getByRole("button", { name: "표", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "표 삽입", exact: true });
  await dialog
    .getByRole("spinbutton", { name: "표 글자 크기", exact: true })
    .fill("23.25");
  await dialog.getByRole("button", { name: "표 삽입", exact: true }).click();
  const table = page.locator('.editable-slide [data-type="table"]');
  await expect(table.locator('[data-row="0"][data-column="0"]')).toHaveCSS(
    "font-size",
    "31px",
  );
  await table.dblclick();
  const edit = page.getByRole("dialog", { name: "표 편집", exact: true });
  await edit
    .getByRole("spinbutton", { name: "표 행 수", exact: true })
    .fill("5");
  await edit.getByRole("button", { name: "표 적용", exact: true }).click();
  await expect(table.locator('[role="table"]')).toHaveAttribute(
    "aria-rowcount",
    "5",
  );
});
