import { expect, test, type Page } from "@playwright/test";

const editor = (page: Page) =>
  page.getByRole("textbox", { name: "슬라이드 텍스트 편집", exact: true });
const item = (page: Page, id: string) =>
  page.locator(`.editable-slide [data-element-id="${id}"]`);

async function seed(page: Page) {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async () => {
    const { blankDeck, element, newSlide } = await import("/src/model.ts");
    const { saveAutosave } = await import("/src/storage.ts");
    const deck = blankDeck();
    deck.name = "실사용 편집 검수";
    deck.slides[0].elements = [
      element("text", {
        id: "qa-title",
        text: "Alpha Beta",
        x: 100,
        y: 100,
        width: 800,
        height: 120,
        fontSize: 32,
      }),
      element("shape", {
        id: "qa-shape",
        shape: "rect",
        x: 100,
        y: 350,
        width: 250,
        height: 160,
        fill: "#4472C4",
      }),
      element("shape", {
        id: "qa-circle",
        shape: "ellipse",
        x: 600,
        y: 350,
        width: 180,
        height: 160,
        fill: "#229966",
      }),
    ];
    deck.slides.push(newSlide("blank"), newSlide("blank"));
    deck.slides.forEach((slide, i) => {
      slide.notes = `검수 ${i + 1}`;
    });
    await saveAutosave(deck);
  });
  await page.reload();
  await expect(page.getByTestId("slide-element")).toHaveCount(3);
}

async function snapshot(page: Page) {
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  return page.evaluate(
    async () => (await (await import("/src/storage.ts")).loadAutosave())!,
  );
}

test("top toolbar undo and redo handle the first inline edit before leaving the text box", async ({
  page,
}) => {
  await seed(page);
  await item(page, "qa-title").dblclick();
  await editor(page).press("ControlOrMeta+a");
  await page.keyboard.insertText("Revised");
  await expect(editor(page)).toHaveText("Revised");
  await expect(
    page.getByRole("button", { name: "실행 취소", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  await expect(item(page, "qa-title")).toHaveText("Alpha Beta");
  await expect(
    page.getByRole("button", { name: "다시 실행", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "다시 실행", exact: true }).click();
  await expect(item(page, "qa-title")).toHaveText("Revised");
});

test("mixed object grouping, duplication, position edits and deleting undo and redo independently", async ({
  page,
}) => {
  await seed(page);
  await item(page, "qa-title").click();
  await item(page, "qa-shape").click({ modifiers: ["Shift"] });
  await page.keyboard.press("ControlOrMeta+g");
  await page.keyboard.press("ControlOrMeta+d");
  await expect(page.locator(".editable-slide .slide-element")).toHaveCount(5);
  await expect(
    page.locator(".editable-slide .slide-element.selected"),
  ).toHaveCount(2);
  await page.keyboard.press("Shift+ArrowRight");
  const moved = await snapshot(page);
  expect(moved.slides[0].elements.slice(-2).map((e) => e.x)).toEqual([
    134, 134,
  ]);
  await page.keyboard.press("Delete");
  await expect(page.locator(".editable-slide .slide-element")).toHaveCount(3);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".editable-slide .slide-element")).toHaveCount(5);
  expect(
    (await snapshot(page)).slides[0].elements.slice(-2).map((e) => e.x),
  ).toEqual([134, 134]);
  await page.keyboard.press("ControlOrMeta+z");
  expect(
    (await snapshot(page)).slides[0].elements.slice(-2).map((e) => e.x),
  ).toEqual([124, 124]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".editable-slide .slide-element")).toHaveCount(3);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.locator(".editable-slide .slide-element")).toHaveCount(3);
  expect((await snapshot(page)).slides[0].elements.map((e) => e.id)).toEqual([
    "qa-title",
    "qa-shape",
    "qa-circle",
  ]);
  await page.keyboard.press("ControlOrMeta+z");
  await item(page, "qa-circle").click();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("button", { name: "다시 실행", exact: true }),
  ).toBeDisabled();
  await expect(item(page, "qa-circle")).toHaveCSS("top", "351px");
});

test("cutting a selected slide removes it and paste restores its contents and notes at the destination", async ({
  page,
}) => {
  await seed(page);
  await page.locator(".thumbnail-row").nth(0).click();
  const before = await snapshot(page);
  await page.keyboard.press("ControlOrMeta+x");
  await expect(page.locator(".thumbnail-row")).toHaveCount(2);
  await page.locator(".thumbnail-row").nth(1).click();
  await page.keyboard.press("ControlOrMeta+v");
  await expect(page.locator(".thumbnail-row")).toHaveCount(3);
  const deck = await snapshot(page);
  expect(deck.slides.map((s) => s.notes)).toEqual([
    "검수 2",
    "검수 3",
    "검수 1",
  ]);
  expect(deck.slides[2].id).toBe(before.slides[0].id);
  expect(deck.slides[2].elements.map((e) => e.text).filter(Boolean)).toEqual([
    "Alpha Beta",
  ]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".thumbnail-row")).toHaveCount(2);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".thumbnail-row")).toHaveCount(3);
  expect((await snapshot(page)).slides.map((s) => s.notes)).toEqual([
    "검수 1",
    "검수 2",
    "검수 3",
  ]);
});

test("top toolbar undo handles a first notes edit without requiring a separate blur", async ({
  page,
}) => {
  await seed(page);
  const notes = page.getByRole("textbox", { name: "발표자 노트", exact: true });
  await notes.fill("새 발표 내용");
  await expect(
    page.getByRole("button", { name: "실행 취소", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  await expect(notes).toHaveValue("검수 1");
  await page.getByRole("button", { name: "다시 실행", exact: true }).click();
  await expect(notes).toHaveValue("새 발표 내용");
});

test("inline keyboard undo exposes toolbar redo without losing its redo branch on click", async ({
  page,
}) => {
  await seed(page);
  await item(page, "qa-title").dblclick();
  await editor(page).press("ControlOrMeta+a");
  await page.keyboard.insertText("Revised");
  await editor(page).press("ControlOrMeta+z");
  await expect(editor(page)).toHaveText("Alpha Beta");
  await expect(
    page.getByRole("button", { name: "다시 실행", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "다시 실행", exact: true }).click();
  await expect(editor(page)).toHaveText("Revised");
  await expect(editor(page)).toBeFocused();
});

test("Home and native cut move selected slides, keep internal links, and protect the final slide", async ({
  page,
}) => {
  await seed(page);
  await page.evaluate(async () => {
    const { loadAutosave, saveAutosave } = await import("/src/storage.ts");
    const { element } = await import("/src/model.ts");
    const deck = (await loadAutosave())!;
    deck.slides[2].elements = [
      element("text", {
        text: "목차로 이동",
        hyperlink: { slideId: deck.slides[0].id },
      }),
    ];
    await saveAutosave(deck);
  });
  await page.reload();
  const original = await snapshot(page);
  await page.locator(".thumbnail-row").nth(0).click();
  await page
    .locator(".thumbnail-row")
    .nth(1)
    .click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "잘라내기", exact: true }).click();
  await expect(page.locator(".thumbnail-row")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "잘라내기", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("ControlOrMeta+v");
  await expect(page.locator(".thumbnail-row")).toHaveCount(3);
  const moved = await snapshot(page);
  expect(moved.slides.map((s) => s.id)).toEqual([
    original.slides[2].id,
    original.slides[0].id,
    original.slides[1].id,
  ]);
  expect(moved.slides[0].elements[0].hyperlink?.slideId).toBe(
    moved.slides[1].id,
  );
  await page.locator(".thumbnail-row").nth(0).click();
  await page.evaluate(() =>
    window.dispatchEvent(
      new ClipboardEvent("cut", {
        bubbles: true,
        cancelable: true,
        clipboardData: new DataTransfer(),
      }),
    ),
  );
  await expect(page.locator(".thumbnail-row")).toHaveCount(2);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".thumbnail-row")).toHaveCount(3);
});

for (const cancelled of [false, true]) {
  test(`typing after native Save (${cancelled ? "cancelled" : "completed"}) starts a new undo transaction`, async ({
    page,
  }) => {
    await page.addInitScript((cancelled) => {
      window.desktop = {
        platform: "darwin",
        setChromeTheme: async () => {},
        saveFile: async () => {
          (window as any).__inlineSaved = true;
          return cancelled ? null : "/tmp/inline-history.pptx";
        },
        openFile: async () => null,
        exportPDF: async () => null,
        print: async () => true,
        onMenu: (callback) => {
          (window as any).__nativeMenu = callback;
          return () => {};
        },
      };
    }, cancelled);
    await seed(page);
    await item(page, "qa-title").dblclick();
    await editor(page).press("ControlOrMeta+a");
    await page.keyboard.insertText("First");
    await page.evaluate(() => (window as any).__nativeMenu("save"));
    await expect
      .poll(() => page.evaluate(() => (window as any).__inlineSaved))
      .toBe(true);
    if ((await editor(page).count()) === 0)
      await item(page, "qa-title").dblclick();
    await editor(page).press("End");
    await page.keyboard.insertText(" Again");
    await editor(page).press("Escape");
    await page.keyboard.press("ControlOrMeta+z");
    await expect(item(page, "qa-title")).toHaveText("First");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(item(page, "qa-title")).toHaveText("First Again");
  });
}
