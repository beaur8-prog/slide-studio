import { expect, test, type Page } from "@playwright/test";

test.use({
  userAgent:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  viewport: { width: 800, height: 450 },
  isMobile: true,
  hasTouch: true,
});

async function open(
  page: Page,
  options: {
    portrait: boolean;
    slow: boolean;
    fail: boolean;
    legacy?: boolean;
  } = { portrait: false, slow: false, fail: false },
) {
  await page.addInitScript(({ slow, fail, legacy }) => {
    const state = window as any;
    state.__bars = [];
    state.__orientation = [];
    state.__fullscreenRequests = [];
    state.__overlays = [];
    state.__edgeCalls = 0;
    state.CapacitorSystemBarsAndroidInterface = legacy
      ? undefined
      : {
          onDOMReady() {
            state.__edgeCalls++;
            state.__edgeViewport = document
              .querySelector('meta[name="viewport"]')
              ?.getAttribute("content");
          },
        };
    const original = Element.prototype.requestFullscreen;
    Element.prototype.requestFullscreen = function (options) {
      state.__fullscreenRequests.push(options);
      return original.call(this, options);
    };
    const bars = {
      hide: async () => {
        state.__bars.push("hide");
        if (fail) throw new Error("system bars unavailable");
        if (slow)
          await new Promise((resolve) => {
            state.__finishHide = resolve;
          });
      },
      show: async () => {
        state.__bars.push("show");
      },
    };
    const orientation = {
      lock: async ({ orientation }: { orientation: string }) => {
        state.__orientation.push(orientation);
        if (fail) throw new Error("orientation unavailable");
      },
      unlock: async () => {
        state.__orientation.push("unlock");
      },
    };
    const status = {
      ...bars,
      getInfo: async () => ({ overlays: false }),
      setOverlaysWebView: async ({ overlay }: { overlay: boolean }) => {
        state.__overlays.push(overlay);
      },
    };
    state.Capacitor = {
      getPlatform: () => "android",
      isPluginAvailable: (name: string) =>
        [legacy ? "StatusBar" : "SystemBars", "ScreenOrientation"].includes(
          name,
        ),
      registerPlugin: (name: string) =>
        name === "SystemBars"
          ? bars
          : name === "StatusBar"
            ? status
            : orientation,
    };
  }, options);
  await page.goto("http://127.0.0.1:5190");
  await expect(page.getByTestId("android-reader")).toBeVisible();
  const fixture = await page.evaluate(async (portrait) => {
    const { blankDeck, newSlide } = await import("/src/model.ts");
    const deck = blankDeck();
    deck.slides.push(newSlide("blank"));
    if (portrait) {
      deck.width = 720;
      deck.height = 1280;
    }
    return JSON.stringify(deck);
  }, options.portrait);
  await page.locator('input[accept*=".pptx"]').setInputFiles({
    name: "immersive.slide",
    mimeType: "application/json",
    buffer: Buffer.from(fixture),
  });
  await expect(page.getByTestId("android-slide-viewport")).toBeVisible();
  await page.getByRole("button", { name: "현재 슬라이드에서 발표" }).click();
  await expect(page.getByTestId("presentation-view")).toBeVisible();
}

for (const portrait of [false, true])
  test(`Android requests hidden system bars and ${portrait ? "portrait" : "landscape"} orientation, then restores the viewer`, async ({
    page,
  }) => {
    await open(page, { portrait, slow: false, fail: false });
    await expect
      .poll(() => page.evaluate(() => (window as any).__bars))
      .toContain("hide");
    await expect
      .poll(() => page.evaluate(() => (window as any).__orientation))
      .toContain(portrait ? "portrait" : "landscape");
    expect(
      await page.evaluate(() => (window as any).__fullscreenRequests[0]),
    ).toEqual({ navigationUI: "hide" });
    expect(
      await page.evaluate(() => (window as any).__edgeCalls),
    ).toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as any).__edgeViewport)).toContain(
      "viewport-fit=cover",
    );
    await expect(
      page.getByRole("navigation", { name: "터치 발표 도구" }),
    ).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("android-slide-viewport")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => (window as any).__bars.at(-1)))
      .toBe("show");
    await expect
      .poll(() => page.evaluate(() => (window as any).__orientation.at(-1)))
      .toBe("unlock");
  });

test("a late native Hide cannot finish after restoring bars and leave the reader immersive", async ({
  page,
}) => {
  await open(page, { portrait: false, slow: true, fail: false });
  await expect
    .poll(() => page.evaluate(() => !!(window as any).__finishHide))
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("android-slide-viewport")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__bars)).not.toContain(
    "show",
  );
  await page.evaluate(() => (window as any).__finishHide());
  await expect
    .poll(() => page.evaluate(() => (window as any).__bars.at(-1)))
    .toBe("show");
});

test("legacy Android status-bar host overlays content during presentation and restores its prior layout", async ({
  page,
}) => {
  await open(page, { portrait: false, slow: false, fail: false, legacy: true });
  await expect
    .poll(() => page.evaluate(() => (window as any).__overlays))
    .toContain(true);
  await expect
    .poll(() => page.evaluate(() => (window as any).__bars))
    .toContain("hide");
  await page.keyboard.press("Escape");
  await expect
    .poll(() => page.evaluate(() => (window as any).__overlays.at(-1)))
    .toBe(false);
  await expect
    .poll(() => page.evaluate(() => (window as any).__bars.at(-1)))
    .toBe("show");
});

test("native bar/orientation failures keep Android browser fullscreen and slide navigation usable", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page, { portrait: false, slow: false, fail: true });
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(true);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("presentation-view")).toHaveAttribute(
    "aria-label",
    /^발표 슬라이드 2 \//,
  );
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("android-slide-viewport")).toBeVisible();
  expect(errors).toEqual([]);
});

test("tap tools overlay maximized artwork and automatically hide without a page popup", async ({
  page,
}) => {
  await open(page);
  await page.clock.install();
  const show = page.getByTestId("presentation-view"),
    controls = page.getByRole("navigation", { name: "터치 발표 도구" });
  const before = await page.locator(".present-slide").boundingBox();
  await expect(controls).toBeHidden();
  await show.click({ position: { x: 400, y: 225 } });
  await expect(controls).toBeVisible();
  expect(await page.locator(".present-slide").boundingBox()).toEqual(before);
  await expect(
    page.getByRole("button", { name: "발표 페이지로 이동" }),
  ).toHaveCount(0);
  await page.clock.runFor(4100);
  await expect(controls).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("android-slide-viewport")).toBeVisible();
});
