import { test, expect } from "@playwright/test";

// Playwright hides scrollbars by default in headless Chromium. Exercise the
// actual scrollbar painting and pointer interaction used by the desktop app.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

test("off-page artwork is clipped while edge handles and blank-space deselection still work", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { saveAutosave } = await import("/src/storage.ts");
    const deck = blankDeck();
    deck.width = 800;
    deck.height = 600;
    deck.slides[0].elements = [
      element("shape", {
        shape: "rect",
        x: 700,
        y: 500,
        width: 110,
        height: 110,
        fill: "#FF0000",
        strokeWidth: 0,
      }),
    ];
    await saveAutosave(deck);
  });
  await page.reload();
  const canvas = page.getByTestId("slide-canvas");
  const box = (await canvas.boundingBox())!;
  const scale = box.width / 800;
  const hit = (x: number, y: number) =>
    page.evaluate(
      ({ x, y }) =>
        !!document
          .elementFromPoint(x, y)
          ?.closest('[data-testid="slide-element"]'),
      { x, y },
    );
  expect(await hit(box.x + 750 * scale, box.y + 550 * scale)).toBe(true);
  expect(await hit(box.x + 805 * scale, box.y + 550 * scale)).toBe(false);
  expect(await hit(box.x + 750 * scale, box.y + 605 * scale)).toBe(false);
  await page.mouse.click(box.x + 750 * scale, box.y + 550 * scale);
  const handle = page.getByTestId("resize-se");
  const h = (await handle.boundingBox())!;
  expect(h.x).toBeGreaterThan(box.x + box.width);
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    h.x + h.width / 2 - 30 * scale,
    h.y + h.height / 2 - 30 * scale,
    { steps: 4 },
  );
  await page.mouse.up();
  const width = await page
    .getByTestId("slide-element")
    .evaluate((el) => parseFloat((el as HTMLElement).style.width));
  expect(width).toBeCloseTo(80, 0);
  await page.mouse.click(box.x + 20 * scale, box.y + 20 * scale);
  await expect(page.locator(".slide-selection")).toHaveCount(0);
});

test("left slide list reserves a visible draggable scrollbar without cutting thumbnails", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1080, height: 720 });
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  const list = page.locator(".thumbnail-list");
  const metrics = await list.evaluate((el) => ({
    gutter: el.getBoundingClientRect().width - el.clientWidth,
    overflow: el.scrollWidth - el.clientWidth,
    track: getComputedStyle(el, "::-webkit-scrollbar-track").backgroundColor,
    thumb: getComputedStyle(el, "::-webkit-scrollbar-thumb").backgroundColor,
    height: el.clientHeight,
    content: el.scrollHeight,
    right: el.getBoundingClientRect().left + el.clientWidth,
    thumbnailRight: el
      .querySelector(".thumbnail-button")!
      .getBoundingClientRect().right,
  }));
  expect(metrics.gutter).toBeGreaterThanOrEqual(14);
  expect(metrics.overflow).toBe(0);
  expect(metrics.thumbnailRight).toBeLessThan(metrics.right);
  expect(metrics.track).not.toBe(metrics.thumb);
  expect(metrics.content).toBeGreaterThan(metrics.height);
  const box = (await list.boundingBox())!;
  const thumbCenter = (metrics.height * metrics.height) / metrics.content / 2;
  await page.mouse.move(box.x + box.width - 7, box.y + thumbCenter);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 7, box.y + metrics.height - 15, {
    steps: 6,
  });
  await page.mouse.up();
  await expect
    .poll(() => list.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  await expect(page.locator(".thumbnail-row.active .slide-number")).toHaveText(
    "1",
  );
  await page
    .getByRole("button", { name: "밝은 테마로 전환", exact: true })
    .click();
  const colors = await list.evaluate((el) => [
    getComputedStyle(el, "::-webkit-scrollbar-track").backgroundColor,
    getComputedStyle(el, "::-webkit-scrollbar-thumb").backgroundColor,
  ]);
  expect(colors[0]).not.toBe(colors[1]);
});
