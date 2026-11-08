import { test, expect, _electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

test.skip(
  process.platform === "linux" && !process.env.DISPLAY,
  "Native history requires a desktop/Xvfb",
);
let app: Awaited<ReturnType<typeof _electron.launch>>, profile: string;
test.beforeEach(async ({}, testInfo) => {
  profile = await fs.mkdtemp(path.join(os.tmpdir(), "slide-native-history-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.SLIDE_STUDIO_DEV;
  const evidence = path.resolve("qa/results/editor-core-native-history", testInfo.testId.replace(/[^a-zA-Z0-9_-]/g, "_"));
  await fs.mkdir(evidence, { recursive: true });
  const executablePath = createRequire(path.resolve("package.json"))("electron") as string;
  app = await _electron.launch({
    executablePath,
    args: [
      path.resolve("."),
      "--user-data-dir=" + profile,
      ...(process.platform === "linux" ? ["--no-sandbox"] : []),
    ],
    env,
  });
  const output: string[] = [];
  app.process().stdout?.on("data", chunk => output.push(String(chunk)));
  app.process().stderr?.on("data", chunk => output.push(String(chunk)));
  const page = await app.firstWindow();
  page.on("pageerror", error => output.push(String(error)));
  try {
    await expect(page.locator(".save-indicator")).toHaveText("저장됨", { timeout: 20000 });
  } catch (error) {
    const details = await Promise.race([
      app.evaluate(({ app, BrowserWindow }) => ({
        appPath: app.getAppPath(), userData: app.getPath("userData"), packaged: app.isPackaged,
        windows: BrowserWindow.getAllWindows().map(window => ({ url: window.webContents.getURL(), title: window.getTitle() })),
      })).catch(error => ({ mainError: String(error) })),
      new Promise(resolve => setTimeout(() => resolve({ mainTimedOut: true }), 2000)),
    ]);
    await fs.writeFile(path.join(evidence, "startup.json"), JSON.stringify({ executablePath, details, windows: app.windows().map(window => window.url()), output }, null, 2));
    await page.screenshot({ path: path.join(evidence, "startup.png"), timeout: 3000 }).catch(() => {});
    throw error;
  }
});
test.afterEach(async () => {
  if (app) {
    // Only this disposable app owns the unsaved fixture profile. Return the IPC
    // acknowledgement before exiting; Electron then closes its renderer children.
    const child = app.process();
    if (child.exitCode === null) {
      const exited = new Promise<number | null>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Disposable history app did not exit")), 5000);
        child.once("exit", code => { clearTimeout(timer); resolve(code); });
      });
      await app.evaluate(({ app }) => {
        setTimeout(() => app.exit(0), 100);
        return true;
      });
      // Do not race BrowserContext.close against Electron's scheduled exit.
      // The process-exit event closes its protocol connection and child renderers.
      expect(await exited).toBe(0);
    }
  }
  if (profile) await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    .catch(error => console.warn("Disposable history profile cleanup:", String(error)));
});
const menu = (label: string) =>
  app.evaluate(({ Menu, BrowserWindow }, label) => {
    const item = Menu.getApplicationMenu()!
      .items.find((i) => i.label === "Edit")!
      .submenu!.items.find((i) => i.label === label)!;
    item.click(item, BrowserWindow.getAllWindows()[0], {} as any);
  }, label);

test("native menu Undo/Redo reverses slide additions and object movement", async () => {
  const page = await app.firstWindow(),
    thumbs = page.locator(".thumbnail-button");
  await page.getByRole("button", { name: "새 슬라이드", exact: true }).click();
  await expect(thumbs).toHaveCount(2);
  await menu("Undo");
  await expect(thumbs).toHaveCount(1);
  await menu("Redo");
  await expect(thumbs).toHaveCount(2);
  const object = page.locator('.editable-slide [data-type="text"]').first();
  await object.click();
  const left = await object.evaluate((e) => (e as HTMLElement).style.left);
  await page.keyboard.press("ArrowRight");
  await expect(object).not.toHaveCSS("left", left);
  const moved = await object.evaluate((e) => (e as HTMLElement).style.left);
  await menu("Undo");
  await expect(object).toHaveCSS("left", left);
  await menu("Redo");
  await expect(object).toHaveCSS("left", moved);
});

test("native history keeps inline text editing and its redo branch", async () => {
  const page = await app.firstWindow();
  await page.locator('.editable-slide [data-type="text"]').first().dblclick();
  const editor = page.getByRole("textbox", {
    name: "슬라이드 텍스트 편집",
    exact: true,
  });
  await editor.press("ControlOrMeta+a");
  await page.keyboard.insertText("Alpha Beta 한글");
  await expect(editor).toHaveText("Alpha Beta 한글");
  await menu("Undo");
  await expect(editor).not.toContainText("Alpha Beta 한글");
  await menu("Redo");
  await expect(editor).toHaveText("Alpha Beta 한글");
  await expect(editor).toBeFocused();
});

test("native history in a plain title field preserves the document's slide count", async () => {
  const page = await app.firstWindow(),
    name = page.getByRole("textbox", {
      name: "프레젠테이션 이름",
      exact: true,
    });
  const previous = await name.inputValue();
  await name.focus();
  await name.press("ControlOrMeta+a");
  await page.keyboard.insertText("Native title");
  await menu("Undo");
  await expect(name).toHaveValue(previous);
  await menu("Redo");
  await expect(name).toHaveValue("Native title");
  await expect(page.locator(".thumbnail-button")).toHaveCount(1);
});

test("native Undo/Redo during presentation operates on ink without editing slides", async () => {
  const page = await app.firstWindow();
  await page.keyboard.press("F5");
  const show = page.getByTestId("presentation-view"),
    ink = page.getByTestId("presentation-ink");
  await expect(show).toBeVisible();
  await page.keyboard.press("ControlOrMeta+p");
  await expect(ink).toHaveAttribute("data-tool", "pen");
  const b = (await ink.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.6, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(page.getByTestId("ink-stroke")).toHaveCount(1);
  await menu("Undo");
  await expect(page.getByTestId("ink-stroke")).toHaveCount(0);
  await menu("Redo");
  await expect(page.getByTestId("ink-stroke")).toHaveCount(1);
  await expect(page.locator(".thumbnail-button")).toHaveCount(1);
});
