import { expect, test } from "@playwright/test";

test("table dialog keeps Korean IME drafts, traps Tab and restores focus after Escape", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.getByRole("button", { name: "삽입", exact: true }).click();
  const trigger = page.getByRole("button", { name: "표", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "표 삽입", exact: true });
  const firstCell = dialog.getByRole("textbox", {
    name: "1행 1열",
    exact: true,
  });
  await expect(firstCell).toBeFocused();
  await firstCell.fill("보존할 내용 ");
  await firstCell.press("End");
  const cdp = await page.context().newCDPSession(page);
  // Start Chromium's actual Korean composition instead of merely typing committed text.
  await cdp.send("Input.imeSetComposition", {
    text: "한",
    selectionStart: 1,
    selectionEnd: 1,
  });
  await expect(firstCell).toHaveValue("보존할 내용 한");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(firstCell).toHaveValue(/보존할 내용/);
  await cdp.send("Input.insertText", { text: "한글" });
  await expect(firstCell).toHaveValue("보존할 내용 한글");
  // Also cover Windows IMEs which only expose the legacy 229 code.
  await firstCell.dispatchEvent("keydown", { key: "Escape", keyCode: 229 });
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole("button", {
    name: "표 편집 닫기",
    exact: true,
  });
  const apply = dialog.getByRole("button", { name: "표 삽입", exact: true });
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(apply).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByLabel("표 행 수")).toBeFocused();
  await firstCell.focus();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText("변경");
  await page
    .locator(".table-editor-backdrop")
    .click({ position: { x: 3, y: 3 } });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.locator('.editable-slide [data-type="table"]')).toHaveCount(
    0,
  );
  await trigger.click();
  await expect(firstCell).toBeFocused();
  await expect(firstCell).toHaveValue("제목 1");
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(trigger).toBeFocused();
  await cdp.detach();
});

test("dense new tables fit readable defaults and respect explicit formatting", async ({
  page,
}, testInfo) => {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.getByRole("button", { name: "삽입", exact: true }).click();
  await page.getByRole("button", { name: "표", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "표 삽입", exact: true });
  expect((await dialog.boundingBox())!.width).toBeGreaterThan(1000);
  await dialog.getByLabel("표 행 수").fill("20");
  await dialog.getByLabel("표 열 수").fill("12");
  await dialog
    .getByRole("textbox", { name: "1행 1열", exact: true })
    .fill("가나다라");
  await dialog
    .getByRole("textbox", { name: "2행 1열", exact: true })
    .fill("본문");
  expect(
    Number(await dialog.getByLabel("표 글자 크기").inputValue()),
  ).toBeLessThanOrEqual(18);
  expect(
    Number(await dialog.getByLabel("셀 안쪽 여백").inputValue()),
  ).toBeLessThanOrEqual(2);
  await dialog.getByRole("button", { name: "표 삽입", exact: true }).click();
  const table = page.locator('.editable-slide [data-type="table"]');
  await expect(table.getByRole("table")).toHaveAttribute("aria-rowcount", "20");
  await expect(table.getByRole("table")).toHaveAttribute("aria-colcount", "12");
  const visibleText = await table
    .getByRole("columnheader")
    .first()
    .evaluate((cell: HTMLElement) => {
      const content = cell.firstElementChild as HTMLElement;
      return {
        height: content.clientHeight,
        fullHeight: content.scrollHeight,
        width: content.clientWidth,
        fullWidth: content.scrollWidth,
      };
    });
  expect(visibleText.height).toBeGreaterThan(10);
  expect(visibleText.fullHeight).toBeLessThanOrEqual(visibleText.height);
  expect(visibleText.fullWidth).toBeLessThanOrEqual(visibleText.width);
  await table.screenshot({ path: testInfo.outputPath("dense-table.png") });
  await table.dblclick();
  const edit = page.getByRole("dialog", { name: "표 편집", exact: true });
  await edit.getByLabel("서식 적용 대상").selectOption("table");
  await edit.getByLabel("표 글자 크기").fill("28");
  await edit.getByLabel("셀 안쪽 여백").fill("8");
  await edit.getByLabel("표 행 수").fill("19");
  await expect(edit.getByLabel("표 글자 크기")).toHaveValue("28");
  await expect(edit.getByLabel("셀 안쪽 여백")).toHaveValue("8");
  await expect(edit).toContainText("글자가 잘릴 수 있습니다");
  await edit
    .getByRole("button", { name: "셀에 맞게 줄이기", exact: true })
    .click();
  expect(
    Number(await edit.getByLabel("표 글자 크기").inputValue()),
  ).toBeLessThan(28);
  await expect(edit).not.toContainText("글자가 잘릴 수 있습니다");
  await edit.getByRole("button", { name: "표 적용", exact: true }).click();
});

test("table dialog applies one undo step and supports cells, geometry, cancel, reopen and presentation", async ({
  page,
}, testInfo) => {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.getByRole("button", { name: "삽입", exact: true }).click();
  await page.getByRole("button", { name: "표", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "표 삽입", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("spinbutton", { name: "표 행 수" }).fill("3");
  await dialog.getByRole("spinbutton", { name: "표 열 수" }).fill("2");
  await dialog
    .getByRole("textbox", { name: "1행 1열", exact: true })
    .fill("항목");
  await dialog
    .getByRole("textbox", { name: "1행 2열", exact: true })
    .fill("값");
  await dialog
    .getByRole("textbox", { name: "2행 1열", exact: true })
    .fill("한글\n두 줄");
  await dialog.getByRole("button", { name: "행 추가", exact: true }).click();
  await expect(
    dialog.getByRole("spinbutton", { name: "표 행 수" }),
  ).toHaveValue("4");
  await dialog.getByRole("button", { name: "행 삭제", exact: true }).click();
  await dialog.getByRole("button", { name: "열 추가", exact: true }).click();
  await expect(
    dialog.getByRole("spinbutton", { name: "표 열 수" }),
  ).toHaveValue("3");
  await dialog.getByRole("button", { name: "열 삭제", exact: true }).click();
  await expect(
    dialog.getByRole("textbox", { name: "2행 1열", exact: true }),
  ).toHaveValue("한글\n두 줄");
  await dialog.getByLabel("표 글자 크기").fill("20");
  await dialog.getByLabel("테두리 두께").fill("2");
  await dialog.getByLabel("표 가로 정렬").selectOption("center");
  await dialog.getByLabel("머리글 배경").fill("#125577");
  await dialog.screenshot({ path: testInfo.outputPath("table-editor.png") });
  await dialog.getByRole("button", { name: "표 삽입", exact: true }).click();
  const table = page.locator('.editable-slide [data-type="table"]');
  await expect(table).toHaveCount(1);
  await expect(table.getByRole("table")).toHaveAttribute("aria-rowcount", "3");
  await expect(table.getByRole("columnheader").first()).toHaveCSS(
    "background-color",
    "rgb(18, 85, 119)",
  );
  await expect(table).toContainText("한글");
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  await expect(table).toHaveCount(0);
  await page.getByRole("button", { name: "다시 실행", exact: true }).click();
  await expect(table).toHaveCount(1);
  // Move and resize the compound object through the same handles as shapes.
  const geometry = () =>
    table.evaluate((el: HTMLElement) => ({
      x: el.style.left,
      y: el.style.top,
      w: el.style.width,
      h: el.style.height,
    }));
  const original = await geometry();
  await table.click();
  const moveHandle = (await page
    .getByTestId("table-move-handle")
    .boundingBox())!;
  const moveX = moveHandle.x + moveHandle.width / 2;
  const moveY = moveHandle.y + moveHandle.height / 2;
  await page.mouse.move(moveX, moveY);
  await page.mouse.down();
  await page.mouse.move(moveX + 30, moveY + 20, { steps: 4 });
  await page.mouse.up();
  expect((await geometry()).x).not.toBe(original.x);
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  expect(await geometry()).toEqual(original);
  await table.click();
  const handle = page.getByTestId("resize-se");
  const corner = (await handle.boundingBox())!;
  await page.mouse.move(
    corner.x + corner.width / 2,
    corner.y + corner.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(corner.x + 45, corner.y + 35, { steps: 4 });
  await page.mouse.up();
  expect((await geometry()).w).not.toBe(original.w);
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  expect(await geometry()).toEqual(original);
  await table.dblclick();
  const edit = page.getByRole("dialog", { name: "표 편집", exact: true });
  await edit
    .getByRole("textbox", { name: "2행 1열", exact: true })
    .fill("변경한 셀");
  await edit.getByLabel("표 행 수").fill("4");
  await edit.getByRole("button", { name: "표 적용", exact: true }).click();
  await expect(table).toContainText("변경한 셀");
  await expect(table.getByRole("table")).toHaveAttribute("aria-rowcount", "4");
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  await expect(table).toContainText("한글");
  await expect(table.getByRole("table")).toHaveAttribute("aria-rowcount", "3");
  await table.dblclick();
  await edit
    .getByRole("textbox", { name: "2행 1열", exact: true })
    .fill("취소한 셀");
  await edit.getByRole("button", { name: "취소", exact: true }).click();
  await expect(table).not.toContainText("취소한 셀");
  await page.keyboard.press("F5");
  await expect(
    page.getByTestId("presentation-view").getByRole("table"),
  ).toBeVisible();
  await expect(page.getByTestId("presentation-view")).toContainText("한글");
  await page.keyboard.press("Escape");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.reload();
  await expect(table.getByRole("table")).toHaveAttribute("aria-rowcount", "3");
  await table.dblclick();
  await expect(
    edit.getByRole("textbox", { name: "2행 1열", exact: true }),
  ).toHaveValue("한글\n두 줄");
  await page.keyboard.press("Escape");
  await expect(edit).toHaveCount(0);
});

test("table helpers preserve cells and reject malformed or oversized project data", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const {
      createTable,
      createTableElement,
      resizeTable,
      changeTableAxis,
      validateTable,
    } = await import("/src/table.ts");
    const { blankDeck } = await import("/src/model.ts");
    const { parseDeckJson, serializeDeck } = await import("/src/io.ts");
    const table = createTable(3, 2);
    table.cells = [
      ["제목 A", "제목 B"],
      ["원본", "2"],
      ["3", "4"],
    ];
    const enlarged = resizeTable(table, 4, 3);
    const added = changeTableAxis(table, "row", 1);
    const removed = changeTableAxis(added, "row", 1, true);
    const bad: unknown[] = [
      null,
      { ...table, cells: [] },
      { ...table, cells: [["1"], ["2", "3"]] },
      { ...table, cells: Array.from({ length: 101 }, () => [""]) },
      { ...table, cells: [Array.from({ length: 51 }, () => "")] },
      { ...table, cells: [["x".repeat(2001)]] },
      { ...table, cells: [["\u0000"]] },
      { ...table, fontSize: Infinity },
      { ...table, padding: -1 },
      { ...table, borderWidth: 13 },
      { ...table, header: "false" },
      { ...table, align: "justify" },
      { ...table, fill: "url(https://example.com)" },
      { ...table, columnWidths: [0, 1] },
      { ...table, rowHeights: [1] },
    ];
    const rejected = bad.map((input) => {
      try {
        validateTable(input);
        return false;
      } catch {
        return true;
      }
    });
    const deck = blankDeck();
    deck.slides[0].elements = [createTableElement(table)];
    const restored = parseDeckJson(serializeDeck(deck)).slides[0].elements[0];
    let projectRejected = false;
    try {
      parseDeckJson(
        JSON.stringify({
          ...deck,
          slides: [
            {
              ...deck.slides[0],
              elements: [
                {
                  ...deck.slides[0].elements[0],
                  table: { ...table, cells: [[42]] },
                },
              ],
            },
          ],
        }),
      );
    } catch {
      projectRejected = true;
    }
    const safe = validateTable({
      ...table,
      injected: "ignored",
      cells: table.cells.map((row) => [...row]),
    });
    return {
      enlarged: enlarged.cells,
      added: added.cells,
      removed: removed.cells,
      restored,
      rejected,
      projectRejected,
      unknownCopied: "injected" in safe,
    };
  });
  expect(result.enlarged).toEqual([
    ["제목 A", "제목 B", ""],
    ["원본", "2", ""],
    ["3", "4", ""],
    ["", "", ""],
  ]);
  expect(result.added[1]).toEqual(["", ""]);
  expect(result.removed).toEqual([
    ["제목 A", "제목 B"],
    ["원본", "2"],
    ["3", "4"],
  ]);
  expect(result.restored.type).toBe("table");
  expect(result.restored.table?.cells).toEqual(result.removed);
  expect(result.rejected.every(Boolean)).toBe(true);
  expect(result.projectRejected).toBe(true);
  expect(result.unknownCopied).toBe(false);
});

test("inserted tables export native editable cells and reimport geometry, styles and changed native text", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const results = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { createTable, createTableElement } = await import("/src/table.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const results = [];
    for (const borderWidth of [0, 2]) {
      const table = createTable(3, 2);
      Object.assign(table, {
        borderWidth,
        header: borderWidth > 0,
        striped: true,
        align: "center",
        verticalAlign: "bottom",
        padding: borderWidth ? 8 : 0,
        fontSize: 22,
        columnWidths: [1, 2],
        rowHeights: [1, 1.5, 2],
      });
      table.cells = [
        ["한글", "제목"],
        ["첫 줄\n둘째 줄", "42"],
        ["", "마지막"],
      ];
      const deck = blankDeck(),
        element = createTableElement(table);
      Object.assign(element, {
        x: 80,
        y: 110,
        width: 900,
        height: 330,
        rotation: 12,
        opacity: 0.6,
      });
      deck.slides[0].elements = [element];
      const bytes = await exportPptx(deck);
      const zip = await JSZip.loadAsync(bytes);
      const filename = "ppt/slides/slide1.xml";
      const doc = new DOMParser().parseFromString(
        await zip.file(filename)!.async("string"),
        "text/xml",
      );
      const tables = doc.getElementsByTagNameNS("*", "tbl").length;
      const cells = doc.getElementsByTagNameNS("*", "tc").length;
      doc.getElementsByTagNameNS("*", "t")[0].textContent = "PowerPoint 편집";
      zip.file(filename, new XMLSerializer().serializeToString(doc));
      const imported = await importPptx(
        await zip.generateAsync({ type: "uint8array" }),
      );
      const roundTrip = await importPptx(await exportPptx(imported.deck));
      // Native formatting that the table model cannot express must retain its
      // fidelity through the established flattened-cell path, not stale metadata.
      const firstColor = doc
        .getElementsByTagNameNS("*", "rPr")[0]
        .getElementsByTagNameNS("*", "srgbClr")[0];
      firstColor.setAttribute("val", "FF0000");
      zip.file(filename, new XMLSerializer().serializeToString(doc));
      const modified = await importPptx(
        await zip.generateAsync({ type: "uint8array" }),
      );
      results.push({
        tables,
        cells,
        imported: imported.deck.slides[0].elements,
        warnings: imported.warnings,
        roundTrip: roundTrip.deck.slides[0].elements,
        modified: modified.deck.slides[0].elements,
      });
    }
    return results;
  });
  for (const result of results) {
    expect(result.tables).toBe(1);
    expect(result.cells).toBe(6);
    expect(result.warnings).toEqual([]);
    expect(result.imported).toHaveLength(1);
    expect(result.imported[0]).toMatchObject({
      type: "table",
      x: 80,
      y: 110,
      width: 900,
      height: 330,
      rotation: 12,
      opacity: 0.6,
    });
    expect(result.imported[0].table).toMatchObject({
      align: "center",
      verticalAlign: "bottom",
      fontSize: 22,
      cells: [
        ["PowerPoint 편집", "제목"],
        ["첫 줄\n둘째 줄", "42"],
        ["", "마지막"],
      ],
    });
    expect(result.roundTrip[0].table).toEqual(result.imported[0].table);
    expect(result.modified).toHaveLength(1);
    expect(result.modified[0].type).toBe("table");
    expect(result.modified[0].table!.cellStyles![0][0]!.color).toBe("#FF0000");
    expect(result.modified[0].table!.cells[0][0]).toBe("PowerPoint 편집");
  }
});
