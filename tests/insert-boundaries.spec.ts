import { expect, test } from "@playwright/test";

test("resizing a deck keeps table formatting within reopenable and exportable bounds", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const results = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { createTable, createTableElement } = await import("/src/table.ts");
    const { scaleElement } = await import("/src/text-layout.ts");
    const { serializeDeck, parseDeckJson, exportPptx, importPptx } =
      await import("/src/io.ts");
    const results = [];
    for (const scenario of [
      {
        width: 1280,
        height: 720,
        sx: 0.75,
        sy: 1,
        style: { fontSize: 6 },
        expected: { fontSize: 6 },
      },
      {
        width: 640,
        height: 360,
        sx: 2,
        sy: 2,
        style: { fontSize: 144 },
        expected: { fontSize: 144 },
      },
      {
        width: 640,
        height: 360,
        sx: 2,
        sy: 2,
        style: { padding: 60 },
        expected: { padding: 60 },
      },
      {
        width: 640,
        height: 360,
        sx: 2,
        sy: 2,
        style: { borderWidth: 12 },
        expected: { borderWidth: 12 },
      },
    ]) {
      const deck = blankDeck();
      deck.width = scenario.width * scenario.sx;
      deck.height = scenario.height * scenario.sy;
      const table = { ...createTable(2, 2), ...scenario.style };
      table.cells[1][0] = "비율 변경 후 저장";
      deck.slides[0].elements = [
        scaleElement(
          createTableElement(table, scenario.width, scenario.height),
          scenario.sx,
          scenario.sy,
        ),
      ];
      const project = parseDeckJson(serializeDeck(deck));
      const imported = await importPptx(await exportPptx(project));
      results.push({
        expected: scenario.expected,
        style: project.slides[0].elements[0].table,
        imported: imported.deck.slides[0].elements[0].table,
        warnings: imported.warnings,
      });
    }
    return results;
  });
  for (const result of results) {
    expect(result.style).toMatchObject(result.expected);
    expect(result.imported).toMatchObject(result.expected);
    expect(result.imported?.cells[1][0]).toBe("비율 변경 후 저장");
    expect(result.warnings).toEqual([]);
  }
});

test("Escape cancels Korean composition without dismissing link or footer drafts", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.getByRole("button", { name: "삽입", exact: true }).click();
  for (const scenario of [
    { button: "링크", dialog: "링크 삽입", input: "링크 표시 텍스트" },
    {
      button: "바닥글",
      dialog: "날짜 · 슬라이드 번호 · 바닥글",
      input: "바닥글 내용",
    },
  ]) {
    await page
      .getByRole("button", { name: scenario.button, exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: scenario.dialog,
      exact: true,
    });
    const input = dialog.getByLabel(scenario.input, { exact: true });
    await input.fill("한글 입력 중");
    await input.evaluate((node) => {
      node.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      node.dispatchEvent(
        new CompositionEvent("compositionupdate", {
          bubbles: true,
          data: "중",
        }),
      );
      node.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          isComposing: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await expect(dialog).toBeVisible();
    await expect(input).toHaveValue("한글 입력 중");
    await input.evaluate((node) =>
      node.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "중" }),
      ),
    );
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
});
