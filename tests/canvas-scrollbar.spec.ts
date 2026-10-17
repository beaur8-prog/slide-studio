import { test, expect } from "@playwright/test";

test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });
const current = (page: import("@playwright/test").Page) =>
  page.locator(".thumbnail-row.active .slide-number");

test("main scrollbar stays visible at Fit and navigates independently of thumbnail scrolling", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1080, height: 720 });
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  const bar = page.getByRole("scrollbar", {
    name: "슬라이드 편집 영역 스크롤",
  });
  const area = page.locator(".canvas-area");
  await expect(bar).toBeVisible();
  expect(await area.evaluate((el) => el.scrollHeight - el.clientHeight)).toBe(
    0,
  );
  const a = (await area.boundingBox())!,
    b = (await bar.boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(a.x + a.width);
  await expect(
    page.getByRole("button", { name: "편집 영역 위로 스크롤", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "편집 영역 아래로 스크롤", exact: true })
    .click();
  await expect(current(page)).toHaveText("2");
  await page
    .getByRole("button", { name: "이전 슬라이드", exact: true })
    .click();
  await expect(current(page)).toHaveText("1");
  await page.locator(".thumbnail-list").hover();
  await page.mouse.wheel(0, 300);
  await expect(current(page)).toHaveText("1");
  await expect(bar).toHaveAttribute("aria-valuenow", "0");
  await bar.focus();
  await page.keyboard.press("End");
  const count = await page.locator(".thumbnail-button").count();
  await expect(current(page)).toHaveText(String(count));
  await expect(
    page.getByRole("button", { name: "편집 영역 아래로 스크롤", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Home");
  await expect(current(page)).toHaveText("1");
  const thumb = page.locator(".canvas-scroll-thumb");
  let handle = (await thumb.boundingBox())!;
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, b.y + b.height - 1, {
    steps: 12,
  });
  await page.mouse.up();
  await expect(current(page)).toHaveText(String(count));
  handle = (await thumb.boundingBox())!;
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, b.y + 1, { steps: 12 });
  await page.mouse.up();
  await expect(current(page)).toHaveText("1");
  await page.screenshot({
    path: testInfo.outputPath("main-scrollbar-fit.png"),
  });
});

test("main scrollbar pans zoomed content before advancing, with horizontal scrolling preserved", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1080, height: 720 });
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.getByRole("slider", { name: "확대 비율" }).fill("150");
  const area = page.locator(".canvas-area");
  const bar = page.getByRole("scrollbar", {
    name: "슬라이드 편집 영역 스크롤",
  });
  const down = page.getByRole("button", {
    name: "편집 영역 아래로 스크롤",
    exact: true,
  });
  await area.evaluate((el) => {
    el.scrollTop = 0;
    el.scrollLeft = 0;
  });
  const viewport = (await area.boundingBox())!;
  const frame = (await page.getByTestId("canvas-frame").boundingBox())!;
  expect(frame.x).toBeGreaterThanOrEqual(viewport.x);
  expect(frame.y).toBeGreaterThanOrEqual(viewport.y);
  await down.click();
  await expect
    .poll(() => area.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  await expect(current(page)).toHaveText("1");
  await area.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await down.click();
  await expect(current(page)).toHaveText("2");
  await expect.poll(() => area.evaluate((el) => el.scrollTop)).toBe(0);
  await page
    .getByRole("button", { name: "편집 영역 위로 스크롤", exact: true })
    .click();
  await expect(current(page)).toHaveText("1");
  await expect
    .poll(() => area.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  await area.hover();
  await page.mouse.wheel(300, 0);
  await expect
    .poll(() => area.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(0);
  const a = (await area.boundingBox())!,
    b = (await bar.boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(a.x + a.width);
  await page
    .getByRole("button", { name: "화면에 맞춤", exact: true })
    .last()
    .click();
  await expect
    .poll(() => area.evaluate((el) => el.scrollHeight - el.clientHeight))
    .toBe(0);
  await bar.hover();
  await page.mouse.wheel(0, 120);
  await expect(current(page)).toHaveText("2");
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -300);
  await page.keyboard.up("Control");
  await expect(current(page)).toHaveText("2");
  await expect(bar).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("main-scrollbar-zoom.png"),
  });
});

test("single-slide scrollbar has valid bounds and keyboard navigation never changes document content", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { saveAutosave } = await import("/src/storage.ts");
    await saveAutosave(blankDeck());
  });
  await page.reload();
  const bar = page.getByRole("scrollbar", {
    name: "슬라이드 편집 영역 스크롤",
  });
  await expect(bar).toHaveAttribute("aria-valuemax", "0");
  await expect(
    page.getByRole("button", { name: "다음 슬라이드", exact: true }),
  ).toBeDisabled();
  await bar.focus();
  for (const key of ["End", "PageDown", "ArrowDown", "PageUp", "Home"])
    await page.keyboard.press(key);
  await expect(current(page)).toHaveText("1");
  await expect(page.locator(".thumbnail-button")).toHaveCount(1);
  await expect(bar).toHaveAttribute("aria-valuenow", "0");
  await page
    .getByRole("button", { name: "밝은 테마로 전환", exact: true })
    .click();
  const colors = await page
    .locator(".canvas-scrollbar")
    .evaluate((el) => [
      getComputedStyle(el).backgroundColor,
      getComputedStyle(el.querySelector(".canvas-scroll-thumb")!)
        .backgroundColor,
    ]);
  expect(colors[0]).not.toBe(colors[1]);
});
