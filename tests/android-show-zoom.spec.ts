import { expect, test, type Page, type CDPSession } from "@playwright/test";
import sharp from "sharp";

test.use({
  userAgent:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  viewport: { width: 960, height: 450 },
  hasTouch: true,
  isMobile: true,
});

async function open(page: Page) {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.getByTestId("android-reader")).toBeVisible();
  const json = await page.evaluate(async () => {
    const { blankDeck, newSlide, element } = await import("/src/model.ts");
    const deck = blankDeck();
    deck.name = "발표 확대 검증";
    deck.slides = [newSlide("blank"), newSlide("blank"), newSlide("blank")];
    deck.slides.forEach((slide, index) => {
      slide.background = "#112233";
      slide.elements = [
        element("text", {
          text: `확대해도 원본은 유지됩니다 ${index + 1}`,
          x: 100,
          y: 100,
          width: 800,
          height: 100,
          color: "#FFFFFF",
        }),
        element("shape", {
          shape: "ellipse",
          x: 600,
          y: 300,
          width: 200,
          height: 150,
          fill: "#BB5500",
        }),
      ];
    });
    return JSON.stringify(deck);
  });
  await page.locator('input[accept*=".pptx"]').setInputFiles({
    name: "zoom.slide",
    mimeType: "application/json",
    buffer: Buffer.from(json),
  });
  await expect(page.getByTestId("android-slide-viewport")).toBeVisible();
  await page.getByRole("button", { name: "현재 슬라이드에서 발표" }).click();
  await expect(page.getByTestId("presentation-view")).toBeVisible();
  await expect(page.locator(".present-slide")).toHaveCSS("width", "800px");
}
const touchClients = new WeakMap<Page, CDPSession>();
async function touch(
  page: Page,
  points: { x: number; y: number; id: number }[],
  type = "touchStart",
) {
  let session = touchClients.get(page);
  if (!session) {
    session = await page.context().newCDPSession(page);
    touchClients.set(page, session);
  }
  await session.send("Input.dispatchTouchEvent", { type, touchPoints: points });
}
async function pinch(page: Page, from = 100, to = 200) {
  await touch(page, [
    { x: 480 - from, y: 225, id: 1 },
    { x: 480 + from, y: 225, id: 2 },
  ]);
  await touch(
    page,
    [
      { x: 480 - to, y: 225, id: 1 },
      { x: 480 + to, y: 225, id: 2 },
    ],
    "touchMove",
  );
  await touch(page, [], "touchEnd");
}
async function pan(
  page: Page,
  from = { x: 650, y: 200 },
  to = { x: 250, y: 180 },
) {
  await touch(page, [{ ...from, id: 1 }]);
  await touch(page, [{ ...to, id: 1 }], "touchMove");
  await touch(page, [], "touchEnd");
}
async function tools(page: Page) {
  const controls = page.getByRole("navigation", { name: "터치 발표 도구" });
  if (!(await controls.isVisible())) {
    const trigger = page.locator(".android-presentation-tools-trigger");
    if (await trigger.isVisible()) await trigger.click();
    else await page.getByTestId("presentation-view").click({ position: { x: 480, y: 150 } });
  }
  await expect(controls).toBeVisible();
  return controls;
}
async function clean(page: Page) {
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("slide-studio-file-dirty"),
    ),
  ).toBe("false");
}

test("APK safe insets protect buttons without shrinking the presentation canvas", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    const style = document.documentElement.style;
    style.setProperty("--studio-safe-area-inset-top", "28px");
    style.setProperty("--studio-safe-area-inset-left", "40px");
    style.setProperty("--studio-safe-area-inset-bottom", "24px");
    style.setProperty("--studio-safe-area-inset-right", "12px");
  });
  expect(await page.getByTestId("presentation-view").boundingBox()).toEqual({
    x: 0,
    y: 0,
    width: 960,
    height: 450,
  });
  const controls = await tools(page);
  const bounds = (await controls.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(40);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(960 - 12);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(450 - 24);
  await controls
    .getByRole("button", { name: "발표 종료", exact: true })
    .click();
  await expect(page.getByTestId("android-reader")).toBeVisible();
  await expect(page.locator(".android-app")).toHaveCSS("padding-top", "28px");
  await expect(page.locator(".android-app")).toHaveCSS("padding-left", "40px");
  await clean(page);
});

test("presentation pinch and pan enlarge without page navigation, and fit restores swipe navigation", async ({
  page,
}, info) => {
  await open(page);
  const show = page.getByTestId("presentation-view");
  await pinch(page);
  await expect(show).toHaveAttribute("data-zoom", "2.00");
  await expect(page.locator(".present-slide")).toHaveCSS("width", "800px");
  expect(
    (await page.locator(".present-slide").boundingBox())!.width,
  ).toBeCloseTo(1600, 0);
  await pan(page);
  await expect(show).toHaveAttribute("aria-label", /^발표 슬라이드 1 \//);
  const bounds = (await page.locator(".present-slide").boundingBox())!;
  expect(bounds.x).toBeLessThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(960);
  await page.screenshot({ path: info.outputPath("presentation-zoomed.png") });
  await page.setViewportSize({ width: 800, height: 450 });
  await expect(show).toHaveAttribute("data-zoom", "1.00");
  await page.setViewportSize({ width: 960, height: 450 });
  await pinch(page);
  await expect(show).toHaveAttribute("data-zoom", "2.00");
  await pinch(page, 200, 50);
  await expect(show).toHaveAttribute("data-zoom", "1.00");
  await pan(page);
  await expect(show).toHaveAttribute("aria-label", /^발표 슬라이드 2 \//);
  await clean(page);
});

test("presentation double tap zooms and resets without opening tools or changing a slide", async ({
  page,
}) => {
  await open(page);
  const show = page.getByTestId("presentation-view");
  await show.dblclick({ position: { x: 480, y: 225 }, delay: 70 });
  await expect(show).toHaveAttribute("data-zoom", "2.00");
  await expect(
    page.getByRole("navigation", { name: "터치 발표 도구" }),
  ).toBeHidden();
  await show.dblclick({ position: { x: 480, y: 225 }, delay: 70 });
  await expect(show).toHaveAttribute("data-zoom", "1.00");
  await expect(show).toHaveAttribute("aria-label", /^발표 슬라이드 1 \//);
  await clean(page);
});

test("labeled zoom buttons clamp to fit and 500 percent, and a canceled pinch cannot advance slides", async ({
  page,
}, info) => {
  await open(page);
  const show = page.getByTestId("presentation-view");
  const controls = await tools(page);
  await expect(
    controls.getByRole("button", { name: "포인터와 판서 도구" }),
  ).toHaveText("펜·레이저");
  await expect(controls.getByText("…", { exact: true })).toHaveCount(0);
  for (let i = 0; i < 8; i++)
    await page
      .getByRole("button", { name: "발표 화면 확대", exact: true })
      .click();
  await expect(show).toHaveAttribute("data-zoom", "5.00");
  await expect(
    page.getByRole("button", { name: "발표 화면 확대", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "발표 화면 축소", exact: true })
    .click();
  await expect(show).toHaveAttribute("data-zoom", "4.50");
  await page
    .getByRole("button", { name: "발표 화면 맞춤", exact: true })
    .click();
  await expect(show).toHaveAttribute("data-zoom", "1.00");
  await expect(
    page.getByRole("button", { name: "발표 화면 축소", exact: true }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 360, height: 800 });
  await tools(page);
  await page.screenshot({ path: info.outputPath("labeled-phone-tools.png") });
  expect(
    await controls.getByRole("button").evaluateAll((buttons) =>
      buttons.every((button) => {
        const b = button.getBoundingClientRect();
        return (
          b.width >= 48 && b.height >= 48 && b.x >= 0 && b.right <= innerWidth
        );
      }),
    ),
  ).toBe(true);
  await touch(page, [
    { x: 110, y: 300, id: 1 },
    { x: 250, y: 300, id: 2 },
  ]);
  await touch(page, [], "touchCancel");
  await expect(show).toHaveAttribute("aria-label", /^발표 슬라이드 1 \//);
  await clean(page);
});

test("pinch during pen drawing cancels the draft and preserves prior ink and its zoomed coordinates", async ({
  page,
}) => {
  await open(page);
  await tools(page);
  await page
    .getByRole("button", { name: "발표 화면 확대", exact: true })
    .click();
  await page
    .getByRole("button", { name: "발표 화면 확대", exact: true })
    .click();
  await page.getByRole("button", { name: "포인터와 판서 도구" }).click();
  await page.getByRole("button", { name: "펜", exact: true }).click();
  const ink = page.getByTestId("presentation-ink");
  await expect(ink).toHaveAttribute("data-tool", "pen");
  const rect = (await ink.boundingBox())!;
  await pan(page, { x: 350, y: 150 }, { x: 430, y: 175 });
  await expect(page.getByTestId("ink-stroke")).toHaveCount(1);
  const first = (await page.getByTestId("ink-stroke").getAttribute("points"))!
    .split(" ")[0]
    .split(",")
    .map(Number);
  expect(first[0]).toBeCloseTo(((350 - rect.x) * 1280) / rect.width, 0);
  expect(first[1]).toBeCloseTo(((150 - rect.y) * 720) / rect.height, 0);
  await pinch(page, 100, 150);
  await expect(page.getByTestId("presentation-view")).toHaveAttribute(
    "data-zoom",
    "3.00",
  );
  await expect(page.getByTestId("ink-stroke")).toHaveCount(1);
  await tools(page);
  await page
    .getByRole("button", { name: "화면 이동 모드", exact: true })
    .click();
  await expect(ink).toHaveAttribute("data-tool", "arrow");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "판서 버리기" }).click();
  await clean(page);
});

test("pen and laser controls can be hidden and reopened without changing tools or ink", async ({ page }) => {
  await open(page);
  const controls = page.getByRole("navigation", { name: "터치 발표 도구" });
  const ink = page.getByTestId("presentation-ink");
  for (const [label, tool] of [["레이저 포인터", "laser"], ["펜", "pen"]]) {
    await tools(page);
    await controls.getByRole("button", { name: "포인터와 판서 도구" }).click();
    await page.getByRole("dialog", { name: "발표 도구", exact: true }).getByRole("button", { name: label, exact: true }).click();
    await expect(ink).toHaveAttribute("data-tool", tool);
    await expect(controls).toBeHidden();
    await expect(page.getByRole("dialog", { name: "발표 도구", exact: true })).toHaveCount(0);
    const trigger = page.getByRole("button", { name: "발표 도구 열기", exact: true });
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveCSS("color", "rgb(255, 255, 255)");
    if (tool === "pen") {
      await pan(page, { x: 350, y: 150 }, { x: 430, y: 175 });
      await expect(page.getByTestId("ink-stroke")).toHaveCount(1);
    } else {
      await touch(page, [{ x: 350, y: 150, id: 1 }]);
      await expect(page.getByTestId("laser-pointer")).toBeVisible();
      await touch(page, [], "touchEnd");
      await expect(page.getByTestId("laser-pointer")).toBeHidden();
    }
    await expect(controls).toBeHidden();
    await trigger.click();
    await expect(controls).toBeVisible();
    await controls.getByRole("button", { name: "발표 도구 모음 숨기기" }).click();
    await expect(controls).toBeHidden();
    await expect(trigger).toBeVisible();
    await expect(ink).toHaveAttribute("data-tool", tool);
    await expect(page.getByTestId("presentation-view")).toHaveAttribute("aria-label", /^발표 슬라이드 1 \//);
  }
  await expect(page.getByTestId("ink-stroke")).toHaveCount(1);
  await tools(page);
  await controls.getByRole("button", { name: "화면 이동 모드", exact: true }).click();
  await expect(ink).toHaveAttribute("data-tool", "arrow");
  await expect(controls).toBeHidden();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "판서 버리기" }).click();
  await clean(page);
});

test("drawing toolbar auto-hides after reopening and remains recoverable", async ({ page }) => {
  await open(page);
  const controls = await tools(page);
  await controls.getByRole("button", { name: "포인터와 판서 도구" }).click();
  await page.getByRole("button", { name: "레이저 포인터", exact: true }).click();
  await expect(controls).toBeHidden();
  await page.clock.install();
  await page.getByRole("button", { name: "발표 도구 열기", exact: true }).click();
  await expect(controls).toBeVisible();
  await page.clock.runFor(4100);
  await expect(controls).toBeHidden();
  await expect(page.locator(".android-presentation-tools-trigger")).toBeVisible();
  await expect(page.getByTestId("presentation-ink")).toHaveAttribute("data-tool", "laser");
  await page.keyboard.press("Escape");
  await clean(page);
});

test("end-screen controls can be hidden and reopened to exit", async ({ page }) => {
  await open(page);
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("presentation-end")).toBeVisible();
  const controls = page.getByRole("navigation", { name: "터치 발표 도구" });
  await expect(controls).toBeVisible();
  await controls.getByRole("button", { name: "발표 도구 모음 숨기기" }).click();
  await expect(controls).toBeHidden();
  await page.getByRole("button", { name: "발표 도구 열기", exact: true }).click();
  await controls.getByRole("button", { name: "발표 종료", exact: true }).click();
  await expect(page.getByTestId("android-slide-viewport")).toBeVisible();
  await clean(page);
});

test("letterbox and root background have no white edge or hidden control footprint", async ({
  page,
}, info) => {
  await open(page);
  const show = page.getByTestId("presentation-view");
  expect(
    await show.evaluate((node) => getComputedStyle(node).outlineStyle),
  ).toBe("none");
  expect(
    await page
      .locator("body")
      .evaluate((node) => getComputedStyle(node).backgroundColor),
  ).toBe("rgb(0, 0, 0)");
  expect(
    await page.locator(".android-screenreader-trigger").evaluate((node) => {
      const s = getComputedStyle(node);
      return {
        minWidth: s.minWidth,
        minHeight: s.minHeight,
        width: s.width,
        height: s.height,
      };
    }),
  ).toEqual({ minWidth: "0px", minHeight: "0px", width: "1px", height: "1px" });
  const bytes = await page.screenshot({
    path: info.outputPath("black-letterbox-no-white-edge.png"),
  });
  const { data, info: dimensions } = await sharp(bytes)
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let y = 10; y < dimensions.height - 10; y += 20)
    for (let x = 5; x < 70; x += 10) {
      const at = (y * dimensions.width + x) * dimensions.channels;
      expect([...data.subarray(at, at + 3)]).toEqual([0, 0, 0]);
    }
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-studio-presenting",
    "true",
  );
  await clean(page);
});

test("new-presentation notification cannot intercept the slideshow toolbar", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("http://127.0.0.1:5190");
  await page.getByRole("button", { name: "새 프레젠테이션", exact: true }).click();
  const toast = page.locator(".toast");
  await expect(toast).toContainText("새 프레젠테이션을 만들었습니다.");
  await page.locator(".document-actions .button.primary").click();
  const controls = await tools(page);
  const pen = controls.getByRole("button", { name: "포인터와 판서 도구" });
  expect(await pen.evaluate(button => {
    const rect = button.getBoundingClientRect();
    return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  })).toBe(true);
  await pen.click();
  await expect(page.getByRole("dialog", { name: "발표 도구", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "펜", exact: true }).click();
  await page.getByRole("button", { name: "발표 도구 열기", exact: true }).click();
  await controls.getByRole("button", { name: "발표 도구 모음 숨기기" }).click();
  await expect(controls).toBeHidden();
  await page.keyboard.press("Escape");
  await clean(page);
});
