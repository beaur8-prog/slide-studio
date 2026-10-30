import { test, expect } from "@playwright/test";

for (const label of ["PDF 내보내기", "인쇄"]) {
  test(`browser ${label} opens output once with the current slide, then removes print-only rendering`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as any).__browserOutput = [];
      window.print = () => {
        (window as any).__browserOutput.push({
          slides: document.querySelectorAll(".print-slide").length,
          text: document.querySelector(".print-deck")?.textContent,
        });
      };
    });
    await page.goto("http://127.0.0.1:5190");
    await expect(page.locator(".save-indicator")).toHaveText("저장됨");
    const title = page.locator('.editable-slide [data-type="text"]').first();
    await title.dblclick();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText("출력 직전 한글 제목");
    await page.getByRole("button", { name: "파일", exact: true }).click();
    await page
      .locator(".file-popover")
      .getByRole("button", { name: new RegExp(`^${label}`) })
      .click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__browserOutput.length))
      .toBe(1);
    const printed = await page.evaluate(
      () => (window as any).__browserOutput[0],
    );
    expect(printed.slides).toBe(1);
    expect(printed.text).toContain("출력 직전 한글 제목");
    await expect(page.locator(".print-slide")).toHaveCount(0);
    await expect(page.locator(".busy-backdrop")).toHaveCount(0);
    await page.getByRole("button", { name: "실행 취소", exact: true }).click();
    await expect(title).not.toContainText("출력 직전 한글 제목");
  });
}
