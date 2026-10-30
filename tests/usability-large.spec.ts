import { test, expect } from "@playwright/test";

test("1,000 objects with 100 groups can be selected, hidden and restored through the selection pane", async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts"),
      { saveAutosave } = await import("/src/storage.ts");
    const deck = blankDeck();
    deck.slides[0].elements = Array.from({ length: 1000 }, (_, i) =>
      element("shape", {
        id: `large-${i}`,
        name: `Item ${i}`,
        x: (i % 50) * 24,
        y: Math.floor(i / 50) * 30,
        width: 20,
        height: 20,
        groups: [`group-${Math.floor(i / 10)}`],
        groupNames: [`Group ${Math.floor(i / 10)}`],
      }),
    );
    await saveAutosave(deck);
  });
  await page.reload();
  await expect(page.getByTestId("slide-element")).toHaveCount(1000);
  let start = Date.now();
  await page.keyboard.press("Alt+F10");
  await expect(page.getByRole("treeitem")).toHaveCount(1100);
  const openMs = Date.now() - start;
  await page.getByRole("treeitem", { name: "Item 999", exact: true }).click();
  start = Date.now();
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.getByRole("treeitem", { selected: true })).toHaveCount(
    1100,
  );
  const selectMs = Date.now() - start;
  start = Date.now();
  await page.getByRole("button", { name: "모두 숨기기", exact: true }).click();
  await expect(page.getByTestId("slide-element")).toHaveCount(0);
  const hideMs = Date.now() - start;
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("slide-element")).toHaveCount(1000);
  await expect(
    page.getByRole("button", { name: /^실행 취소/ }).first(),
  ).toBeDisabled();
  await testInfo.attach("layer-latency-ms", {
    body: JSON.stringify({ openMs, selectMs, hideMs }),
    contentType: "application/json",
  });
});

test("500-slide search includes every table and replace-all remains atomic", async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async () => {
    const { blankDeck, newSlide, element } = await import("/src/model.ts"),
      { createTable } = await import("/src/table.ts"),
      { saveAutosave } = await import("/src/storage.ts");
    const deck = blankDeck();
    deck.slides = Array.from({ length: 500 }, (_, i) => {
      const slide = newSlide("blank"),
        table = createTable(1, 1);
      table.cells = [["대용량공통검색어"]];
      slide.elements = [
        element("text", { text: `대용량공통검색어 ${i + 1}` }),
        element("table", { x: 200, y: 300, width: 500, height: 100, table }),
      ];
      return slide;
    });
    await saveAutosave(deck);
  });
  await page.reload();
  await expect(page.locator(".thumbnail-row")).toHaveCount(500);
  const start = Date.now();
  await page.getByRole("button", { name: "바꾸기", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "찾기 및 바꾸기" });
  await panel
    .getByRole("textbox", { name: "찾을 내용", exact: true })
    .fill("대용량공통검색어");
  await expect(panel.getByRole("status")).toContainText("1,000개");
  const searchMs = Date.now() - start;
  await panel
    .getByRole("textbox", { name: "바꿀 내용", exact: true })
    .fill("수정완료");
  const replaceStart = Date.now();
  await panel.getByRole("button", { name: "모두 바꾸기", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("0개");
  const replaceMs = Date.now() - replaceStart;
  await panel
    .getByRole("textbox", { name: "찾을 내용", exact: true })
    .press("Escape");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  const counts = await page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts"),
      { findDocumentText, DEFAULT_SEARCH_OPTIONS } = await import(
        "/src/document-search.ts"
      );
    const deck = (await loadAutosave())!;
    return {
      slides: deck.slides.length,
      matches: findDocumentText(
        deck,
        "대용량공통검색어",
        DEFAULT_SEARCH_OPTIONS,
      ).matches.length,
    };
  });
  expect(counts).toEqual({ slides: 500, matches: 1000 });
  await testInfo.attach("search-latency-ms", {
    body: JSON.stringify({ searchMs, replaceMs }),
    contentType: "application/json",
  });
});
