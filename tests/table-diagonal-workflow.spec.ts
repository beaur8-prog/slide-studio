import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

test.describe.configure({ timeout: 90000 });
const tableOnSlide = (page: Page) =>
  page.locator('.editable-slide [data-type="table"]');
const canvasCell = (page: Page, row: number, column: number) =>
  tableOnSlide(page).locator(`[data-row="${row}"][data-column="${column}"]`);
const dialogCell = (dialog: Locator, row: number, column: number) =>
  dialog.getByRole("textbox", {
    name: `${row + 1}행 ${column + 1}열`,
    exact: true,
  });

async function seed(page: Page) {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { createTable, createTableElement } = await import("/src/table.ts");
    const { saveAutosave } = await import("/src/storage.ts");
    const table = createTable(4, 4);
    table.header = false;
    table.striped = false;
    table.autoRows = false;
    table.fontSize = 14;
    table.padding = 4;
    table.cells = Array.from({ length: 4 }, (_, r) =>
      Array.from({ length: 4 }, (_, c) => `R${r + 1}C${c + 1}`),
    );
    table.cellStyles = table.cells.map((row) => row.map(() => null));
    table.cellStyles[1][1] = {
      fill: "#FFF2CC",
      diagonalBorders: {
        blToTr: { color: "#1144AA", width: 3, opacity: 0.6 },
        tlToBr: { color: "#AA4411", width: 2, opacity: 0.8 },
      },
    };
    const deck = blankDeck();
    deck.name = "Editable diagonal workflow";
    deck.slides[0].elements = [
      { ...createTableElement(table), x: 200, y: 140, width: 720, height: 320 },
    ];
    await saveAutosave(deck);
  });
  await page.reload();
  await expect(tableOnSlide(page)).toHaveCount(1);
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
}

async function read(page: Page) {
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  return page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts");
    const deck = (await loadAutosave())!;
    return deck.slides[0].elements.find((e) => e.type === "table")!;
  });
}

async function edit(page: Page, row = 1, column = 1) {
  await canvasCell(page, row, column).dblclick();
  const dialog = page.getByRole("dialog", { name: "표 편집", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function apply(page: Page, dialog: Locator) {
  await dialog.getByRole("button", { name: "표 적용", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
}

const diagonals = (element: any, row: number, column: number) =>
  element.table.cellStyles?.[row]?.[column]?.diagonalBorders;
const expectedDiagonals = {
  blToTr: { color: "#1144AA", width: 3, opacity: 0.6 },
  tlToBr: { color: "#AA4411", width: 2, opacity: 0.8 },
};

test("Studio HTML preserves relative diagonal coordinates, merged anchors and validated alpha", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { createTable, mergeTableCells } = await import("/src/table.ts");
    const { copyStudioTable, readStudioTable, pasteStudioTable } = await import(
      "/src/table-exchange.ts"
    );
    let table = createTable(4, 4);
    table.cells = table.cells.map((row, r) => row.map((_, c) => `${r},${c}`));
    table.cellStyles = table.cells.map((row) => row.map(() => null));
    table.cellStyles[1][1] = {
      diagonalBorders: {
        blToTr: { color: "#123456", width: 2.75, opacity: 0.35 },
        tlToBr: { color: "#654321", width: 1.5 },
      },
    };
    table = mergeTableCells(table, {
      startRow: 1,
      startColumn: 1,
      endRow: 2,
      endColumn: 2,
    });
    const copied = copyStudioTable(table, {
      startRow: 1,
      startColumn: 1,
      endRow: 2,
      endColumn: 2,
    });
    const source = readStudioTable(copied.html)!;
    const second = readStudioTable(copyStudioTable(source).html)!;
    const pasted = pasteStudioTable(createTable(4, 4), 1, 0, second);
    return {
      source,
      second,
      pasted,
      hasExtension: copied.html.includes("data-slide-studio-diagonals"),
      text: copied.text,
    };
  });
  expect(result.hasExtension).toBe(true);
  expect(result.source.merges).toEqual([
    { row: 0, column: 0, rowSpan: 2, columnSpan: 2 },
  ]);
  const expected = {
    blToTr: { color: "#123456", width: 2.75, opacity: 0.35 },
    tlToBr: { color: "#654321", width: 1.5, opacity: 1 },
  };
  expect(result.source.cellStyles![0][0]!.diagonalBorders).toEqual(expected);
  expect(result.second.cellStyles![0][0]!.diagonalBorders).toEqual(expected);
  expect(result.pasted.cellStyles![1][0]!.diagonalBorders).toEqual(expected);
  expect(result.pasted.merges).toContainEqual({
    row: 1,
    column: 0,
    rowSpan: 2,
    columnSpan: 2,
  });
  expect(result.text).toContain("1,1");
});

test("malformed diagonal clipboard metadata cannot block native HTML cell data or load resources", async ({
  page,
}) => {
  const resources: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("invalid.invalid"))
      resources.push(request.url());
  });
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { readStudioTable } = await import("/src/table-exchange.ts");
    const b = { blToTr: { color: "#112233", width: 2, opacity: 0.5 } };
    const variants = [
      "{",
      "x".repeat(1024 * 1024 + 1),
      "가".repeat(Math.ceil((1024 * 1024) / 3)),
      JSON.stringify({ row: 0, column: 0, borders: b }),
      JSON.stringify([{ row: -1, column: 0, borders: b }]),
      JSON.stringify([{ row: 0, column: 1, borders: b }]),
      JSON.stringify([
        {
          row: 0,
          column: 0,
          borders: { blToTr: { color: "url(unsafe)", width: 2 } },
        },
      ]),
      JSON.stringify([
        {
          row: 0,
          column: 0,
          borders: { blToTr: { color: "#112233", width: -1 } },
        },
      ]),
      JSON.stringify([
        {
          row: 0,
          column: 0,
          borders: { blToTr: { color: "#112233", width: 1, opacity: 2 } },
        },
      ]),
      JSON.stringify([
        { row: 0, column: 0, borders: b },
        { row: 0, column: 0, borders: b },
      ]),
    ];
    return variants.map((encoded) => {
      const template = document.createElement("template");
      template.innerHTML =
        '<table><tr><td style="background-color:#ffeeaa">원래 셀<img src="https://invalid.invalid/pixel"><script>window.__clipboardBad=1</script></td></tr></table>';
      template.content
        .querySelector("table")!
        .setAttribute("data-slide-studio-diagonals", encoded);
      const table = readStudioTable(template.innerHTML)!;
      return {
        text: table.cells[0][0],
        fill: table.cellStyles![0][0]!.fill,
        diagonal: table.cellStyles![0][0]!.diagonalBorders,
        bad: (window as any).__clipboardBad,
      };
    });
  });
  for (const value of result)
    expect(value).toEqual({
      text: "원래 셀",
      fill: "#FFEEAA",
      diagonal: undefined,
      bad: undefined,
    });
  expect(resources).toEqual([]);
});

test("one table keeps diagonals through editing, axes, merge split, clipboard, undo, row resizing and three saves", async ({
  page,
}, info) => {
  await seed(page);
  expect(diagonals(await read(page), 1, 1)).toEqual(expectedDiagonals);
  let dialog = await edit(page);
  await dialogCell(dialog, 1, 1).click();
  await dialog
    .getByRole("button", { name: "위에 행 삽입", exact: true })
    .click();
  await dialogCell(dialog, 2, 1).click();
  await dialog
    .getByRole("button", { name: "왼쪽에 열 삽입", exact: true })
    .click();
  await apply(page, dialog);
  await expect
    .poll(async () => diagonals(await read(page), 2, 2))
    .toEqual(expectedDiagonals);
  // Undo and redo the complete dialog apply, not individual synthetic model calls.
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  await expect
    .poll(async () => diagonals(await read(page), 1, 1))
    .toEqual(expectedDiagonals);
  await page.getByRole("button", { name: "다시 실행", exact: true }).click();
  await expect
    .poll(async () => diagonals(await read(page), 2, 2))
    .toEqual(expectedDiagonals);
  dialog = await edit(page, 2, 2);
  await dialogCell(dialog, 2, 2).click();
  await dialog.getByLabel("서식 적용 대상").selectOption("selection");
  await dialog.getByLabel("셀 배경", { exact: true }).fill("#ddeeff");
  await dialog.getByLabel("테두리 두께", { exact: true }).fill("2.5");
  await dialog.getByLabel("테두리 색", { exact: true }).fill("#333333");
  await dialogCell(dialog, 3, 3).click({ modifiers: ["Shift"] });
  await dialog.getByRole("button", { name: "셀 병합", exact: true }).click();
  await dialog.getByRole("button", { name: "셀 나누기", exact: true }).click();
  await dialog.getByLabel("서식 적용 대상").selectOption("table");
  await dialog.getByLabel("셀 글자색", { exact: true }).fill("#223344");
  await dialog.getByLabel("줄무늬 행", { exact: true }).check();
  await dialogCell(dialog, 1, 1).click();
  await dialog.getByRole("button", { name: "행 삭제", exact: true }).click();
  await dialogCell(dialog, 1, 1).click();
  await dialog.getByRole("button", { name: "열 삭제", exact: true }).click();
  await apply(page, dialog);
  await expect
    .poll(async () => diagonals(await read(page), 1, 1))
    .toEqual(expectedDiagonals);
  // Resizing a real row boundary updates diagonal endpoints along with the row.
  await canvasCell(page, 1, 1).click();
  const handle = tableOnSlide(page).getByRole("separator", {
    name: "2번째 행 높이 조절",
    exact: true,
  });
  await handle.focus();
  await handle.press("ArrowDown");
  await handle.press("ArrowDown");
  await expect
    .poll(async () => diagonals(await read(page), 1, 1))
    .toEqual(expectedDiagonals);
  // Native copy, then paste its HTML as if copied by a second Studio window.
  await canvasCell(page, 1, 1).click();
  await canvasCell(page, 1, 2).click({ modifiers: ["Shift"] });
  const copied = await page.evaluate(() => {
    const data = new DataTransfer();
    window.dispatchEvent(
      new ClipboardEvent("copy", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
    return {
      html: data.getData("text/html"),
      text: data.getData("text/plain"),
    };
  });
  expect(copied.html).toContain("data-slide-studio-diagonals");
  await canvasCell(page, 3, 0).click();
  await page.evaluate((copied) => {
    const data = new DataTransfer();
    data.setData("text/plain", copied.text);
    data.setData(
      "text/html",
      copied.html.replace(/<span data-slide-studio-copy="[^"]*"><\/span>/, ""),
    );
    window.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
  }, copied);
  await expect
    .poll(async () => diagonals(await read(page), 3, 0))
    .toEqual(expectedDiagonals);
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  await expect
    .poll(async () => diagonals(await read(page), 3, 0))
    .toBeUndefined();
  await page.getByRole("button", { name: "다시 실행", exact: true }).click();
  await expect
    .poll(async () => diagonals(await read(page), 3, 0))
    .toEqual(expectedDiagonals);
  const rounds = await page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    let deck = (await loadAutosave())!;
    const results = [];
    for (let i = 0; i < 3; i++) {
      // Make another actual model edit between saves to exercise dirty native output.
      deck.slides[0].notes = `검수 저장 ${i + 1}`;
      const bytes = await exportPptx(deck);
      deck = (await importPptx(bytes)).deck;
      const element = deck.slides[0].elements.find((e) => e.type === "table")!;
      results.push({ table: element.table, notes: deck.slides[0].notes });
    }
    return results;
  });
  for (const [i, round] of rounds.entries()) {
    expect(round.table!.cells).toHaveLength(4);
    expect(round.table!.cells[0]).toHaveLength(4);
    expect(round.table!.cellStyles![1][1]!.diagonalBorders).toEqual(
      expectedDiagonals,
    );
    expect(round.table!.cellStyles![3][0]!.diagonalBorders).toEqual(
      expectedDiagonals,
    );
    expect(round.notes).toBe(`검수 저장 ${i + 1}`);
  }
  await tableOnSlide(page).screenshot({
    path: info.outputPath("edited-table-diagonal-workflow.png"),
  });
});

test("table editor rich copy and paste keeps diagonals while single-cell text and TSV keep their existing paths", async ({
  page,
}, info) => {
  await seed(page);
  const dialog = await edit(page, 1, 1);
  await dialogCell(dialog, 1, 1).click();
  await dialogCell(dialog, 1, 2).click({ modifiers: ["Shift"] });
  const copied = await dialogCell(dialog, 1, 1).evaluate((el) => {
    const data = new DataTransfer();
    const event = new ClipboardEvent("copy", {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    });
    el.dispatchEvent(event);
    return {
      text: data.getData("text/plain"),
      html: data.getData("text/html"),
      prevented: event.defaultPrevented,
    };
  });
  expect(copied.prevented).toBe(true);
  expect(copied.html).toContain("data-slide-studio-diagonals");
  await dialogCell(dialog, 2, 0).click();
  await dialogCell(dialog, 2, 0).evaluate((el, copied) => {
    const data = new DataTransfer();
    data.setData("text/plain", copied.text);
    data.setData("text/html", copied.html);
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
  }, copied);
  await expect(dialogCell(dialog, 2, 0)).toHaveValue("R2C2");
  await expect(dialogCell(dialog, 2, 1)).toHaveValue("R2C3");
  // Partial text selections remain native browser operations rather than cell-range copy.
  await dialogCell(dialog, 0, 0).click();
  const native = await dialogCell(dialog, 0, 0).evaluate(
    (el: HTMLTextAreaElement) => {
      el.setSelectionRange(1, 3);
      const data = new DataTransfer();
      const event = new ClipboardEvent("copy", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      });
      el.dispatchEvent(event);
      const pasted = new DataTransfer();
      pasted.setData("text/plain", "ordinary text");
      const paste = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: pasted,
      });
      el.dispatchEvent(paste);
      return { copy: event.defaultPrevented, paste: paste.defaultPrevented };
    },
  );
  expect(native).toEqual({ copy: false, paste: false });
  await dialogCell(dialog, 3, 2).evaluate((el) => {
    const data = new DataTransfer();
    data.setData("text/plain", "TSV\t유지");
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
  });
  await expect(dialogCell(dialog, 3, 2)).toHaveValue("TSV");
  await expect(dialogCell(dialog, 3, 3)).toHaveValue("유지");
  await apply(page, dialog);
  await expect
    .poll(async () => diagonals(await read(page), 2, 0))
    .toEqual(expectedDiagonals);
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  await expect
    .poll(async () => diagonals(await read(page), 2, 0))
    .toBeUndefined();
  await page.getByRole("button", { name: "다시 실행", exact: true }).click();
  await expect
    .poll(async () => diagonals(await read(page), 2, 0))
    .toEqual(expectedDiagonals);
  await tableOnSlide(page).screenshot({
    path: info.outputPath("dialog-copy-diagonals.png"),
  });
});

const sampleRoot = process.env.LAYOUT_COMPARISON_SAMPLES;
test("native diagonals take precedence over damaged private metadata in the edited public DSU table", async ({
  page,
}) => {
  test.skip(
    !sampleRoot,
    "Set LAYOUT_COMPARISON_SAMPLES to the downloaded public sample folder.",
  );
  const filename = path.join(sampleRoot!, "dsu-korean.pptx");
  test.skip(!fs.existsSync(filename), "Public sample not downloaded.");
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(
    async (bytes) => {
      const { importPptx, exportPptx } = await import("/src/io.ts");
      const { tableCellStyle } = await import("/src/table.ts");
      const { default: JSZip } = await import(
        "/node_modules/.vite/deps/jszip.js"
      );
      const original = (await importPptx(new Uint8Array(bytes))).deck;
      original.slides = [original.slides[15]];
      const target = original.slides[0].elements.find(
        (e) => e.type === "table",
      )!;
      target.table!.cells[1][0] += " 실제 수정";
      const saved = await exportPptx(original);
      const output = [];
      for (const mode of ["stale", "malformed", "remove"] as const) {
        const zip = await JSZip.loadAsync(saved);
        const file = "ppt/slides/slide1.xml";
        const doc = new DOMParser().parseFromString(
          await zip.file(file).async("string"),
          "application/xml",
        );
        const marker =
          doc.getElementsByTagNameNS(
            "https://slide-studio.local/table/v1",
            "table",
          )[0] ??
          Array.from(doc.getElementsByTagNameNS("*", "table")).find((n) =>
            n.namespaceURI?.includes("slide-studio"),
          );
        if (!marker)
          throw Error("Expected Studio metadata on edited source table");
        const line = doc.getElementsByTagNameNS("*", "lnBlToTr")[0];
        if (mode === "stale") {
          line.setAttribute("w", "38100");
          line
            .getElementsByTagNameNS("*", "srgbClr")[0]
            .setAttribute("val", "FF8800");
        } else if (mode === "malformed") marker.textContent = "{broken JSON";
        else line.remove();
        zip.file(file, new XMLSerializer().serializeToString(doc));
        let deck = (
          await importPptx(await zip.generateAsync({ type: "uint8array" }))
        ).deck;
        const rounds = [];
        for (let i = 0; i < 3; i++) {
          const table = deck.slides[0].elements.find(
            (e) => e.type === "table",
          )!.table!;
          rounds.push({
            diagonal: tableCellStyle(table, 0, 0).diagonalBorders?.blToTr,
            text: table.cells[1][0],
          });
          deck.slides[0].notes = `원본 표 검수 ${i}`;
          deck = (await importPptx(await exportPptx(deck))).deck;
        }
        output.push({ mode, rounds });
      }
      return output;
    },
    [...fs.readFileSync(filename)],
  );
  for (const value of result)
    for (const round of value.rounds) {
      expect(round.text).toContain("실제 수정");
      if (value.mode === "stale")
        expect(round.diagonal).toMatchObject({ color: "#FF8800", width: 4 });
      else if (value.mode === "malformed")
        expect(round.diagonal?.width).toBeCloseTo(12700 / 9525, 5);
      else expect(round.diagonal).toBeUndefined();
    }
});

test("table editor merged rich ranges reject partial overlaps, keep cut styles and clear a resolved paste error", async ({
  page,
}) => {
  await seed(page);
  const dialog = await edit(page, 1, 1);
  await dialogCell(dialog, 1, 1).click();
  await dialogCell(dialog, 2, 2).click({ modifiers: ["Shift"] });
  await dialog.getByRole("button", { name: "셀 병합", exact: true }).click();
  const copied = await dialogCell(dialog, 1, 1).evaluate((el) => {
    const data = new DataTransfer();
    el.dispatchEvent(
      new ClipboardEvent("copy", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
    return {
      html: data.getData("text/html"),
      text: data.getData("text/plain"),
    };
  });
  const paste = async (row: number, column: number) =>
    dialogCell(dialog, row, column).evaluate((el, copied) => {
      const data = new DataTransfer();
      data.setData("text/plain", copied.text);
      data.setData("text/html", copied.html);
      el.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        }),
      );
    }, copied);
  await dialogCell(dialog, 0, 0).click();
  await paste(0, 0);
  await expect(dialog.getByRole("alert")).toContainText("대상 병합 셀 전체");
  await expect(dialogCell(dialog, 0, 0)).toHaveValue("R1C1");
  await paste(1, 1);
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialogCell(dialog, 1, 1)).toHaveValue("R2C2\nR2C3\nR3C2\nR3C3");
  // A merged range remains a range even though it has only one visible textarea.
  await dialogCell(dialog, 1, 1).evaluate((el) => {
    const data = new DataTransfer();
    el.dispatchEvent(
      new ClipboardEvent("cut", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
  });
  await expect(dialogCell(dialog, 1, 1)).toHaveValue("");
  await dialogCell(dialog, 3, 0).click();
  await paste(3, 0);
  await expect(dialogCell(dialog, 3, 0)).toHaveValue("R2C2\nR2C3\nR3C2\nR3C3");
  await apply(page, dialog);
  const element = await read(page);
  expect(element.table!.cells).toHaveLength(5);
  expect(diagonals(element, 1, 1)).toEqual(expectedDiagonals);
  expect(diagonals(element, 3, 0)).toEqual(expectedDiagonals);
  expect(element.table!.merges).toContainEqual({
    row: 3,
    column: 0,
    rowSpan: 2,
    columnSpan: 2,
  });
});
