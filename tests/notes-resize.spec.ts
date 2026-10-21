import { expect, test } from "@playwright/test";
import verifyNotesResize from "../scripts/qa-notes-resize.cjs";

test("speaker notes resize by dragging, preserve text/undo and remember height", async ({
  page,
}, info) => {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await verifyNotesResize(page, info.outputPath("notes"));
});

test("notes resize respects workspace limits, viewport changes and cancellation", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const handle = page.getByRole("separator", { name: "발표자 노트 높이 조절" });
  await handle.focus();
  await handle.press("End");
  const requested = Number(await handle.getAttribute("aria-valuenow"));
  expect(
    await page.locator(".canvas-workspace").evaluate((e) => e.clientHeight),
  ).toBeGreaterThanOrEqual(140);
  await page.setViewportSize({ width: 1080, height: 620 });
  await expect
    .poll(async () => Number(await handle.getAttribute("aria-valuenow")))
    .toBeLessThan(requested);
  expect(
    await page.locator(".canvas-workspace").evaluate((e) => e.clientHeight),
  ).toBeGreaterThanOrEqual(140);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(handle).toHaveAttribute("aria-valuenow", String(requested));
  await handle.press("Home");
  await expect(handle).toHaveAttribute("aria-valuenow", "73");
  const b = (await handle.boundingBox())!;
  await page.mouse.move(b.x + 100, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 100, b.y - 120, { steps: 8 });
  await expect(page.locator("html")).toHaveClass(/notes-resizing/);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(handle).toHaveAttribute("aria-valuenow", "73");
  await expect(page.locator("html")).not.toHaveClass(/notes-resizing/);
  await page.reload();
  await expect(handle).toHaveAttribute("aria-valuenow", "73");
});

test("notes height survives slide changes and storage restrictions", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "slide-studio-notes-height")
        throw new DOMException("Blocked", "SecurityError");
      return original.call(this, key, value);
    };
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5190");
  const handle = page.getByRole("separator", { name: "발표자 노트 높이 조절" });
  const notes = page.getByRole("textbox", { name: "발표자 노트", exact: true });
  const original = await notes.inputValue();
  await handle.focus();
  await handle.press("Shift+ArrowUp");
  await expect(handle).toHaveAttribute("aria-valuenow", "123");
  await page.locator(".thumbnail-button").nth(1).click();
  await expect(handle).toHaveAttribute("aria-valuenow", "123");
  await page.locator(".thumbnail-button").first().click();
  await expect(notes).toHaveValue(original);
  expect(errors).toEqual([]);
});
