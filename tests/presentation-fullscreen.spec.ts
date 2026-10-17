import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("Windows slideshow covers the display and restores normal, maximized, and fullscreen editors", async ({}, testInfo) => {
  test.skip(process.platform !== "win32", "Windows native fullscreen regression");
  test.setTimeout(60000);
  const directory = await mkdtemp(path.join(tmpdir(), "slide-studio-fullscreen-"));
  const harness = path.join(directory, "main.cjs");
  // Exercise the real main/preload/renderer with a separate profile so the
  // user's running app, autosaved slides, and single-instance lock stay intact.
  await writeFile(harness, `require('electron').app.setPath('appData', ${JSON.stringify(directory)});\nrequire(${JSON.stringify(path.resolve("electron/main.cjs"))});\n`);
  const env = { ...process.env, SLIDE_STUDIO_DEV: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [harness], env });
  try {
    const page = await app.firstWindow();
    await expect(page.locator(".save-indicator")).toHaveText("저장됨");
    const windowState = () => app.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const display = screen.getDisplayMatching(win.getBounds());
      return {
        fullscreen: win.isFullScreen(), maximized: win.isMaximized(),
        bounds: win.getBounds(), normal: win.getNormalBounds(),
        display: display.bounds, workArea: display.workArea,
      };
    });
    const expectFullscreen = async () => {
      await expect.poll(async () => (await windowState()).fullscreen).toBe(true);
      await expect.poll(async () => {
        const state = await windowState();
        return state.bounds;
      }).toEqual((await windowState()).display);
      const display = (await windowState()).display;
      await expect(page.getByTestId("presentation-view")).toBeVisible();
      await expect.poll(() => page.getByTestId("presentation-view").boundingBox()).toEqual({
        x: 0, y: 0, width: display.width, height: display.height,
      });
    };
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.unmaximize();
      win.setBounds({ x: 60, y: 40, width: 1120, height: 760 });
    });
    const original = await windowState();
    await page.keyboard.press("F5");
    await expectFullscreen();
    await page.screenshot({ path: testInfo.outputPath("native-fullscreen.png") });
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".present-controls small")).toContainText("2 /");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("presentation-view")).toBeHidden();
    await expect.poll(async () => (await windowState()).fullscreen).toBe(false);
    expect((await windowState()).bounds).toEqual(original.bounds);
    expect((await windowState()).maximized).toBe(false);

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
    await page.locator(".thumbnail-button").nth(1).click();
    await page.getByRole("button", { name: "슬라이드 쇼", exact: true }).click();
    await page.getByRole("button", { name: "현재 슬라이드부터", exact: true }).click();
    await expectFullscreen();
    await expect(page.locator(".present-controls small")).toContainText("2 /");
    await page.getByRole("button", { name: "발표 종료", exact: true }).click();
    await expect(page.getByTestId("presentation-view")).toBeHidden();
    await expect.poll(async () => (await windowState()).fullscreen).toBe(false);
    expect((await windowState()).maximized).toBe(true);
    expect((await windowState()).normal).toEqual(original.normal);

    await page.keyboard.press("Shift+F5");
    await expectFullscreen();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(false));
    await expect(page.getByTestId("presentation-view")).toBeHidden();

    // An editor already in fullscreen should remain so after the show ends.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(true));
    await page.keyboard.press("F5");
    await expectFullscreen();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("presentation-view")).toBeHidden();
    expect((await windowState()).fullscreen).toBe(true);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("browser slideshow enters fullscreen automatically and follows native fullscreen exit", async ({ page }) => {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.keyboard.press("F5");
  await expect(page.getByTestId("presentation-view")).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.getByTestId("presentation-view")).toBeHidden();
  await page.keyboard.press("Shift+F5");
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("presentation-view")).toBeHidden();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
});
