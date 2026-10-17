import { test, expect } from "@playwright/test";

test("command search executes commands and finds slides; clipboard and presentation remain editable", async ({ page }) => {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  const initial = await page.locator(".thumbnail-button").count();
  await page.keyboard.press("Control+k");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "검색 닫기", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "명령 검색" })).toBeHidden();
  await expect(page.locator(".thumbnail-button")).toHaveCount(initial);
  await page.getByRole("button", { name: "명령 및 슬라이드 검색", exact: true }).click();
  await page.getByRole("combobox", { name: "명령 검색어" }).fill("새 슬라이드");
  await page.keyboard.press("Enter");
  await expect(page.locator(".thumbnail-button")).toHaveCount(initial + 1);
  await expect(page.getByRole("dialog", { name: "명령 검색" })).toBeHidden();
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "명령 검색어" }).fill("텍스트 상자");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  const text = page.locator('.editable-slide [data-type="text"]').last();
  await text.click();
  const beforePaste = await page.locator('.editable-slide [data-testid="slide-element"]').count();
  await page.getByRole("button", { name: "복사", exact: true }).click();
  await page.getByRole("button", { name: "붙여넣기", exact: true }).click();
  await expect(page.locator('.editable-slide [data-testid="slide-element"]')).toHaveCount(beforePaste + 1);
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  await expect(page.locator('.editable-slide [data-testid="slide-element"]')).toHaveCount(beforePaste);
  await page.getByRole("button", { name: "슬라이드 쇼", exact: true }).click();
  await page.getByRole("button", { name: "현재 슬라이드부터", exact: true }).click();
  await expect(page.getByTestId("presentation-view")).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "명령 검색" })).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("presentation-view")).toBeHidden();
  await page.getByRole("button", { name: "파일", exact: true }).click();
  await page.getByRole("button", { name: "새 프레젠테이션", exact: true }).click();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "명령 검색" })).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal-backdrop")).toBeHidden();
});

test("pane, ruler, ribbon and theme switches preserve document content and fit the workspace", async ({ page }, testInfo) => {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  const artwork = await page.locator(".editable-slide").innerHTML();
  await expect(page.locator(".inspector")).toBeHidden();
  const wide = (await page.getByTestId("canvas-frame").boundingBox())!.width;
  await page.getByRole("button", { name: "서식", exact: true }).click();
  await expect(page.locator(".inspector")).toBeVisible();
  await expect.poll(async () => (await page.getByTestId("canvas-frame").boundingBox())!.width).toBeLessThan(wide);
  await page.getByRole("button", { name: "서식 패널 닫기", exact: true }).click();
  await page.getByRole("button", { name: "보기", exact: true }).click();
  await page.getByRole("checkbox", { name: "눈금자", exact: true }).check();
  await expect(page.locator(".ruler")).toBeVisible();
  await page.getByRole("button", { name: "리본 메뉴 축소", exact: true }).click();
  await expect(page.locator(".ribbon")).toBeHidden();
  await page.keyboard.press("Control+F1");
  await expect(page.locator(".ribbon")).toBeVisible();
  await page.getByRole("button", { name: "밝은 테마로 전환", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-chrome", "light");
  expect(await page.locator(".editable-slide").innerHTML()).toBe(artwork);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-chrome", "light");
  await page.getByRole("button", { name: "어두운 테마로 전환", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("windows-office-dark.png") });
  for (const width of [1080, 1280, 1920]) {
    await page.setViewportSize({ width, height: 800 });
    const overflow = await page.evaluate(() => {
      const shell = document.querySelector(".app-shell")!;
      const ribbon = document.querySelector(".ribbon")!;
      return { shell: shell.scrollWidth > window.innerWidth, ribbon: ribbon.scrollWidth > window.innerWidth };
    });
    expect(overflow).toEqual({ shell: false, ribbon: false });
  }
});

test("Windows titlebar leaves room for native window buttons and quick save uses the native bridge", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    window.desktop = {
      platform: "win32", setChromeTheme: async () => {},
      saveFile: async payload => { (window as any).__saved = payload.name; return "saved.slide"; },
      openFile: async () => null, exportPDF: async () => null, print: async () => true, onMenu: () => () => {},
    };
  });
  await page.setViewportSize({ width: 1080, height: 720 });
  await page.goto("http://127.0.0.1:5190");
  await page.getByRole("button", { name: "빠른 저장", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__saved)).toBeTruthy();
  const lastControl = (await page.locator(".theme-toggle").boundingBox())!;
  expect(lastControl.x + lastControl.width).toBeLessThanOrEqual(1080 - 138);
  await page.screenshot({ path: testInfo.outputPath("windows-minimum-size.png") });
});
