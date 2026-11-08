import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";

const TABLET = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
test.use({
  userAgent: TABLET,
  viewport: { width: 1280, height: 800 },
  screen: { width: 1280, height: 800 },
  hasTouch: true,
  isMobile: true,
});

async function edit(page: Page) {
  await page.goto("http://127.0.0.1:5190");
  await page.getByRole("button", { name: "새 프레젠테이션", exact: true }).click();
  await expect(page.locator(".android-editor-tablet")).toBeVisible();
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
}

const toolbar = (page: Page) => page.locator(".topbar, .tabs, .ribbon, .slide-sidebar, .inspector, .statusbar").evaluateAll((regions) =>
  regions.map(region => [...region.querySelectorAll("button,input,select")].map(control => ({
    tag: control.tagName,
    type: control.getAttribute("type"),
    label: control.getAttribute("aria-label"),
    title: control.getAttribute("title"),
    text: control.textContent?.replace(/\s+/g, " ").trim(),
  }))),
);

async function expectFit(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const area = document.querySelector(".canvas-area")!.getBoundingClientRect();
    const art = document.querySelector(".editable-slide")!.getBoundingClientRect();
    return art.width > 0 && art.height > 0 && art.left >= area.left &&
      art.right <= area.right + 1 && art.top >= area.top && art.bottom <= area.bottom + 1;
  })).toBe(true);
}

test("Android screen and touch identity distinguish tablets from rotated phones and other platforms", async ({ page }) => {
  await page.goto("http://127.0.0.1:5190");
  expect(await page.evaluate(async () => {
    const { isAndroidTabletScreen } = await import("/src/android-editor-layout.ts");
    const base = { android: true, maxTouchPoints: 5, coarsePointer: true };
    return [
      isAndroidTabletScreen({ ...base, screenWidth: 1280, screenHeight: 800 }),
      isAndroidTabletScreen({ ...base, screenWidth: 800, screenHeight: 1280 }),
      isAndroidTabletScreen({ ...base, screenWidth: 600, screenHeight: 960 }),
      isAndroidTabletScreen({ ...base, screenWidth: 412, screenHeight: 915 }),
      isAndroidTabletScreen({ ...base, screenWidth: 915, screenHeight: 412 }),
      isAndroidTabletScreen({ ...base, android: false, screenWidth: 1280, screenHeight: 800 }),
      isAndroidTabletScreen({ ...base, maxTouchPoints: 0, coarsePointer: false, screenWidth: 1280, screenHeight: 800 }),
    ];
  })).toEqual([true, true, true, false, false, false, false]);
});

test("tablet reuses every desktop ribbon command and full shape gallery in both orientations", async ({ browser, page }, info) => {
  await edit(page);
  const desktopContext = await browser.newContext({ userAgent: DESKTOP, viewport: { width: 1280, height: 800 } });
  const desktop = await desktopContext.newPage();
  await desktop.goto("http://127.0.0.1:5190");
  await expect(desktop.locator(".save-indicator")).toHaveText("저장됨");
  try {
    for (const size of [{ width: 1280, height: 800 }, { width: 800, height: 1280 }]) {
      await page.setViewportSize(size);
      await desktop.setViewportSize(size);
      await expect(page.locator(".android-editor-bars")).toHaveCount(0);
      for (const selector of [".topbar", ".tabs", ".ribbon", ".statusbar", ".slide-sidebar", ".notes-pane", ".canvas-scrollbar"]) {
        await expect(page.locator(selector)).toBeVisible();
      }
      for (const tab of ["홈", "삽입", "디자인", "전환", "슬라이드 쇼", "보기"]) {
        await page.locator(".tabs").getByRole("button", { name: tab, exact: true }).click();
        await desktop.locator(".tabs").getByRole("button", { name: tab, exact: true }).click();
        expect(await toolbar(page), `${size.width}px ${tab} commands`).toEqual(await toolbar(desktop));
      }
      await page.locator(".tabs").getByRole("button", { name: "삽입", exact: true }).click();
      await desktop.locator(".tabs").getByRole("button", { name: "삽입", exact: true }).click();
      await page.getByRole("button", { name: "도형", exact: true }).click();
      await desktop.getByRole("button", { name: "도형", exact: true }).click();
      const tabletShapes = await page.locator(".shape-options button").allTextContents();
      expect(tabletShapes).toEqual(await desktop.locator(".shape-options button").allTextContents());
      expect(tabletShapes).toHaveLength(22);
      for (const name of ["타원", "오른쪽 블록 화살표", "구름"]) {
        const preset = page.locator(".shape-options").getByRole("button", { name, exact: true });
        await preset.scrollIntoViewIfNeeded();
        const box = (await preset.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(size.width);
        expect(box.y + box.height).toBeLessThanOrEqual(size.height);
      }
      await page.screenshot({ path: info.outputPath(`tablet-full-gallery-${size.width}.png`) });
      await page.locator(".tabs").getByRole("button", { name: "홈", exact: true }).click();
      await desktop.locator(".tabs").getByRole("button", { name: "홈", exact: true }).click();
      await page.getByRole("button", { name: "서식", exact: true }).click();
      await desktop.getByRole("button", { name: "서식", exact: true }).click();
      await expect(page.locator(".inspector")).toBeVisible();
      expect(await toolbar(page)).toEqual(await toolbar(desktop));
      expect(await page.locator(".inspector").evaluate(node => getComputedStyle(node).position)).toBe("static");
      await expectFit(page);
      await page.getByRole("button", { name: "서식 패널 닫기", exact: true }).click();
      await desktop.getByRole("button", { name: "서식 패널 닫기", exact: true }).click();
      await page.getByRole("button", { name: "확대", exact: true }).click();
      await page.getByRole("button", { name: "화면에 맞춤", exact: true }).click();
      await expectFit(page);
      await page.screenshot({ path: info.outputPath(`tablet-desktop-editor-${size.width}.png`) });
    }
  } finally { await desktopContext.close(); }
});

test("native Android desktop-mode identity selects the tablet desktop editor", async ({ page }) => {
  await page.addInitScript(userAgent => {
    Object.defineProperty(navigator, "userAgent", { value: userAgent });
    Object.defineProperty(navigator, "userAgentData", { value: { platform: "Linux" } });
    (window as any).Capacitor = { getPlatform: () => "android" };
  }, DESKTOP);
  await edit(page);
  await expect(page.locator(".android-editor-bars")).toHaveCount(0);
  await expect(page.locator(".topbar").getByRole("button", { name: "발표하기", exact: true })).toBeVisible();
});

test("tablet-sized iPad and desktop touch windows retain their original desktop environment", async ({ browser }) => {
  for (const platform of ["darwin", "iPad"]) {
    const context = await browser.newContext({ userAgent: platform === "iPad" ? "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" : TABLET,
      viewport: { width: 1280, height: 800 }, screen: { width: 1280, height: 800 }, hasTouch: true, isMobile: true });
    const other = await context.newPage();
    try {
      if (platform !== "iPad") await other.addInitScript(() => {
        window.desktop = { platform: "darwin", onMenu: () => () => {}, openFile: async () => null,
          saveFile: async () => null, exportPDF: async () => null, print: async () => false };
      });
      await other.goto("http://127.0.0.1:5190");
      await expect(other.locator(".office-shell")).toBeVisible();
      await expect(other.locator(".android-editor")).toHaveCount(0);
      await expect(other.getByTestId("android-reader")).toHaveCount(0);
      await expect(other.locator("html")).not.toHaveAttribute("data-studio-platform", "android");
    } finally { await context.close(); }
  }
});

test("tablet reserves safe areas and closes desktop galleries and Find before leaving editing", async ({ page }) => {
  await page.addInitScript(() => {
    const apply = () => {
      document.documentElement.style.setProperty("--studio-safe-area-inset-top", "28px");
      document.documentElement.style.setProperty("--studio-safe-area-inset-left", "40px");
      document.documentElement.style.setProperty("--studio-safe-area-inset-bottom", "20px");
    };
    if (document.documentElement) apply();
    else document.addEventListener("DOMContentLoaded", apply, { once: true });
  });
  await edit(page);
  await expect(page.locator(".android-editor-tablet")).toHaveCSS("padding-top", "28px");
  await expect(page.locator(".android-editor-tablet")).toHaveCSS("padding-left", "40px");
  await expectFit(page);
  await page.getByRole("button", { name: "도형", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".shape-popover")).toHaveCount(0);
  await expect(page.locator(".android-editor-tablet")).toBeVisible();
  await page.getByRole("button", { name: "찾기", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "찾기 및 바꾸기", exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("slide-studio-android-back", { cancelable: true })));
  await expect(page.getByRole("complementary", { name: "찾기 및 바꾸기", exact: true })).toHaveCount(0);
  await expect(page.locator(".android-editor-tablet")).toBeVisible();
});

test("tablet inserts ellipse and block arrow from the desktop gallery, selects and formats them, saves and presents", async ({ page }) => {
  await edit(page);
  const shapes = page.locator('.editable-slide [data-type="shape"]');
  const initialShapes = await shapes.count();
  await page.getByRole("button", { name: "도형", exact: true }).click();
  await page.getByRole("button", { name: "타원", exact: true }).click();
  await expect(shapes).toHaveCount(initialShapes + 1);
  const ellipseId = await shapes.last().getAttribute("data-element-id");
  const ellipse = page.locator(`.editable-slide [data-element-id="${ellipseId}"]`);
  await page.getByLabel("도형 채우기 없음", { exact: true }).uncheck();
  await page.getByLabel("도형 채우기 색", { exact: true }).fill("#1255aa");
  await page.getByLabel("도형 선 색", { exact: true }).fill("#e5aa11");
  const strokeWidth = page.getByRole("spinbutton", { name: "도형 선 두께", exact: true });
  await strokeWidth.fill("6.5");
  await strokeWidth.press("Enter");
  await page.locator(".tabs").getByRole("button", { name: "삽입", exact: true }).click();
  await page.getByRole("button", { name: "도형", exact: true }).click();
  await page.getByRole("button", { name: "오른쪽 블록 화살표", exact: true }).click();
  await expect(shapes).toHaveCount(initialShapes + 2);
  await expect(shapes.last()).toHaveClass(/selected/);
  await page.locator(".tabs").getByRole("button", { name: "홈", exact: true }).click();
  await page.getByLabel("도형 채우기 색", { exact: true }).fill("#44aa66");
  // Tap an exposed portion of the ellipse, then verify the same desktop controls
  // reflect that object's colors rather than the most recently inserted shape.
  await ellipse.tap({ position: { x: 4, y: 4 } });
  await expect(ellipse).toHaveClass(/selected/);
  await expect(page.getByLabel("도형 채우기 색", { exact: true })).toHaveValue("#1255aa");
  await expect(page.getByLabel("도형 선 색", { exact: true })).toHaveValue("#e5aa11");
  await expect(strokeWidth).toHaveValue("6.5");
  await page.getByRole("button", { name: "서식", exact: true }).click();
  await expect(page.locator(".inspector").getByLabel("채우기", { exact: true })).toHaveValue("#1255aa");
  await page.getByRole("button", { name: "서식 패널 닫기", exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "PPTX 저장", exact: true }).click(),
  ]);
  const saved = await fs.readFile((await download.path())!);
  const savedShapes = await page.evaluate(async bytes => {
    const { deck } = await (await import("/src/io.ts")).importPptx(new Uint8Array(bytes));
    return deck.slides[0].elements.filter(item => item.type === "shape");
  }, Array.from(saved));
  expect(savedShapes).toHaveLength(initialShapes + 2);
  const savedEllipse = savedShapes.find(shape => shape.shape === "ellipse")!;
  expect(savedEllipse.fill?.toLowerCase()).toBe("#1255aa");
  expect(savedEllipse.stroke?.toLowerCase()).toBe("#e5aa11");
  expect(savedEllipse.strokeWidth).toBeCloseTo(6.5, 3);
  expect(savedShapes.find(shape => shape.fill?.toLowerCase() === "#44aa66")?.paths?.[0].d).toBeTruthy();
  await page.getByRole("button", { name: "발표하기", exact: true }).click();
  await expect(page.getByTestId("presentation-view")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("presentation-view")).toHaveCount(0);
  await expect(page.locator(".android-editor-tablet .ribbon")).toBeVisible();
  await page.getByRole("button", { name: "화면에 맞춤", exact: true }).click();
  await expectFit(page);
});
