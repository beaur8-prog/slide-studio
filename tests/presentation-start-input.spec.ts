import { test, expect, type Page } from "@playwright/test";
async function open(page: Page, native = false) {
  if (native)
    await page.addInitScript(() => {
      const state = { menu: () => {}, modes: [] };
      (window as any).__startQA = state;
      window.desktop = {
        platform: "darwin",
        openFile: async () => null,
        saveFile: async () => null,
        exportPDF: async () => null,
        print: async () => false,
        setPresentationMode: async (value) => {
          state.modes.push(value);
        },
        onMenu: (callback) => {
          state.menu = callback;
          return () => {};
        },
      };
    });
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  const json = await page.evaluate(async () => {
    const { blankDeck, newSlide, element } = await import("/src/model.ts"),
      { serializeDeck } = await import("/src/io.ts");
    const d = blankDeck();
    d.slides = Array.from({ length: 3 }, (_, i) => ({
      ...newSlide("blank"),
      elements: [
        element("shape", {
          id: `rect-${i}`,
          shape: "rect",
          x: 100,
          y: 100,
          width: 260,
          height: 100,
        }),
        element("text", {
          id: `text-${i}`,
          text: `본문 ${i + 1}`,
          x: 100,
          y: 300,
          width: 800,
          height: 120,
        }),
      ],
    }));
    return serializeDeck(d);
  });
  await page
    .locator('input[accept*=".pptx"]')
    .setInputFiles({
      name: "presentation-input.slide",
      mimeType: "application/json",
      buffer: Buffer.from(json),
    });
  await expect(page.locator(".thumbnail-button")).toHaveCount(3);
}
for (const native of [false, true])
  test(`${native ? "desktop" : "browser"} F5 starts while editing text and uses the current text`, async ({
    page,
  }) => {
    await open(page, native);
    await page.locator('.editable-slide [data-element-id="text-0"]').dblclick();
    const editor = page.getByRole("textbox", {
      name: "슬라이드 텍스트 편집",
      exact: true,
    });
    await editor.press("ControlOrMeta+a");
    await page.keyboard.insertText("발표 직전 수정한 한글");
    await editor.press("F5");
    const show = page.getByTestId("presentation-view");
    await expect(show).toBeVisible();
    await expect(show).toContainText("발표 직전 수정한 한글");
    await page.keyboard.press("Escape");
    await expect(show).toHaveCount(0);
    await expect(page.locator(".editable-slide")).toContainText(
      "발표 직전 수정한 한글",
    );
  });
test("F5 commits a focused numeric draft and Shift+F5 begins at the selected slide", async ({
  page,
}) => {
  await open(page);
  await page.locator(".thumbnail-button").nth(2).click();
  await page.locator('.editable-slide [data-element-id="rect-2"]').click();
  await page.getByRole("button", { name: "서식", exact: true }).click();
  const width = page.getByRole("spinbutton", { name: "너비", exact: true });
  await width.fill("200");
  await width.press("Shift+F5");
  const show = page.getByTestId("presentation-view");
  await expect(show).toHaveAttribute("aria-label", "발표 슬라이드 3 / 3");
  await expect(show.locator(".slide-element").first()).toHaveCSS(
    "width",
    "200px",
  );
  await page.keyboard.press("Escape");
  await expect(show).toHaveCount(0);
  await page.locator('.editable-slide [data-element-id="rect-2"]').click();
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "너비", exact: true }),
  ).toHaveValue("260");
});
test("native presentation command commits numeric input before entering the show", async ({
  page,
}) => {
  await open(page, true);
  await page.locator('.editable-slide [data-element-id="rect-0"]').click();
  await page.getByRole("button", { name: "서식", exact: true }).click();
  await page.getByRole("spinbutton", { name: "너비", exact: true }).fill("200");
  await page.evaluate(() => (window as any).__startQA.menu("present"));
  await expect(
    page.getByTestId("presentation-view").locator(".slide-element").first(),
  ).toHaveCSS("width", "200px");
});
test("F5 ignores composition and never starts behind an open dialog", async ({
  page,
}) => {
  await open(page);
  await page.locator('.editable-slide [data-element-id="text-0"]').dblclick();
  const editor = page.getByRole("textbox", {
    name: "슬라이드 텍스트 편집",
    exact: true,
  });
  await editor.dispatchEvent("keydown", {
    key: "F5",
    isComposing: true,
    bubbles: true,
    cancelable: true,
  });
  await expect(page.getByTestId("presentation-view")).toHaveCount(0);
  await editor.press("Escape");
  await page.getByRole("button", { name: "파일", exact: true }).click();
  await page
    .getByRole("button", { name: "새 프레젠테이션", exact: true })
    .click();
  await page.keyboard.press("F5");
  await expect(
    page.getByRole("button", { name: "만들기", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("presentation-view")).toHaveCount(0);
});
