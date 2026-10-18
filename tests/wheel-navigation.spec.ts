import { test, expect } from "@playwright/test";

const current = (page: import("@playwright/test").Page) =>
  page.locator(".thumbnail-row.active .slide-number");

test("small mouse-wheel notches advance immediately and distinct notches do not wait for a fixed cooldown", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  const area = page.locator(".canvas-area");
  await area.hover();
  // Low-resolution mouse notches on macOS can be far below 60 CSS pixels.
  for (const slide of [2, 3, 4]) {
    await page.mouse.wheel(0, 20);
    await expect(current(page)).toHaveText(String(slide));
    await page.waitForTimeout(120);
  }
  await page.mouse.wheel(0, -20);
  await expect(current(page)).toHaveText("3");
  // A deliberate reversal should not be dropped by the previous direction.
  await page.mouse.wheel(0, 20);
  await expect(current(page)).toHaveText("4");
  await page.waitForTimeout(120);
  await area.dispatchEvent("wheel", {
    deltaY: -1,
    deltaMode: 1,
    bubbles: true,
    cancelable: true,
  });
  await expect(current(page)).toHaveText("3");
});

test("tiny jitter does not change slides and a long momentum tail stays on one slide", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  const area = page.locator(".canvas-area");
  // Model arrival times rather than OS scheduling delays: renderer layout can
  // stretch a 40 ms wall-clock timer beyond the intentional 80 ms quiet gap.
  const start = new Date();
  await page.clock.install({ time: start });
  await page.clock.pauseAt(new Date(start.getTime() + 1000));
  for (let i = 0; i < 3; i++)
    await area.dispatchEvent("wheel", {
      deltaY: 2,
      bubbles: true,
      cancelable: true,
    });
  await expect(current(page)).toHaveText("1");
  await page.clock.runFor(120);
  // Keep momentum arriving beyond the old 350 ms timer. It must not become
  // another page turn merely because enough wall-clock time has elapsed.
  for (const deltaY of [18, 15, 12, 10, 8, 6, 5, 4, 3, 2, 2, 1, 1, 1, 1]) {
    await area.dispatchEvent("wheel", {
      deltaY,
      bubbles: true,
      cancelable: true,
    });
    await page.clock.runFor(40);
  }
  await expect(current(page)).toHaveText("2");
  await page.clock.runFor(120);
  await area.dispatchEvent("wheel", {
    deltaY: 20,
    bubbles: true,
    cancelable: true,
  });
  await expect(current(page)).toHaveText("3");
});

test("wheel changes one slide per burst, clamps at ends and follows the active thumbnail", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1080, height: 720 });
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  const area = page.locator(".canvas-area");
  await area.hover();
  await page.mouse.wheel(0, -120);
  await expect(current(page)).toHaveText("1");
  // Dispatch the queued burst in one browser task. A nominal 30 ms timer can
  // be delayed beyond the app's 80 ms quiet gap by layout, producing a second
  // intentional gesture instead of testing repeated events in one burst.
  // The separate momentum-tail test exercises continuous timed input.
  await area.evaluate((element) => {
    for (let i = 0; i < 3; i++) {
      element.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: 120,
          bubbles: true,
          cancelable: true,
        }),
      );
    }
  });
  await expect(current(page)).toHaveText("2");
  await page.waitForTimeout(360);
  await page.mouse.wheel(0, -120);
  await expect(current(page)).toHaveText("1");
  const buttons = page.locator(".thumbnail-button");
  const count = await buttons.count();
  await buttons.last().click();
  await area.hover();
  await page.waitForTimeout(360);
  await page.mouse.wheel(0, 120);
  await expect(current(page)).toHaveText(String(count));
  // Go backwards far enough to exercise thumbnail auto-scrolling.
  for (let index = count - 1; index >= 1; index--) {
    await page.waitForTimeout(360);
    await page.mouse.wheel(0, -120);
    await expect(current(page)).toHaveText(String(index));
  }
  const listBox = (await page.locator(".thumbnail-list").boundingBox())!;
  const activeBox = (await page
    .locator(".thumbnail-row.active")
    .boundingBox())!;
  expect(activeBox.y).toBeGreaterThanOrEqual(listBox.y);
  expect(activeBox.y + activeBox.height).toBeLessThanOrEqual(
    listBox.y + listBox.height,
  );
});

test("zoomed canvas scrolls before advancing; Ctrl-wheel zoom and sidebar scrolling do not change slides", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1080, height: 720 });
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.getByRole("slider", { name: "확대 비율" }).fill("150");
  const area = page.locator(".canvas-area");
  await area.evaluate((el) => {
    el.scrollTop = 0;
  });
  await area.hover();
  await page.mouse.wheel(0, 160);
  await expect
    .poll(() => area.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  await expect(current(page)).toHaveText("1");
  await area.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.mouse.wheel(0, 120);
  await expect(current(page)).toHaveText("2");
  await expect.poll(() => area.evaluate((el) => el.scrollTop)).toBe(0);
  const zoomBefore = await page
    .getByRole("slider", { name: "확대 비율" })
    .inputValue();
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, 120);
  await page.keyboard.up("Control");
  await expect(page.getByRole("slider", { name: "확대 비율" })).not.toHaveValue(
    zoomBefore,
  );
  await expect(current(page)).toHaveText("2");
  await page
    .getByRole("button", { name: "화면에 맞춤", exact: true })
    .last()
    .click();
  const list = page.locator(".thumbnail-list");
  await list.hover();
  await page.mouse.wheel(0, 400);
  await expect
    .poll(() => list.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  await expect(current(page)).toHaveText("2");
  // Editing remains on the current slide even when the pointer is over the canvas.
  const text = page.locator('.editable-slide [data-type="text"]').first();
  await text.dblclick();
  await expect(
    page.locator('.editable-slide [contenteditable="true"]'),
  ).toBeFocused();
  await area.hover();
  await page.mouse.wheel(0, 120);
  await expect(current(page)).toHaveText("2");
});
