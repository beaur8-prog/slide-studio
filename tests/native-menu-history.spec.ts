import { test, expect, _electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test.skip(
  process.platform === "linux" && !process.env.DISPLAY,
  "Native history requires a desktop/Xvfb",
);
let app: Awaited<ReturnType<typeof _electron.launch>>, profile: string;
test.beforeEach(async () => {
  profile = await fs.mkdtemp(path.join(os.tmpdir(), "slide-native-history-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.SLIDE_STUDIO_DEV;
  app = await _electron.launch({
    args: [
      path.resolve("."),
      "--user-data-dir=" + profile,
      ...(process.platform === "linux" ? ["--no-sandbox"] : []),
    ],
    env,
  });
  await expect((await app.firstWindow()).locator(".save-indicator")).toHaveText(
    "저장됨",
    { timeout: 20000 },
  );
});
test.afterEach(async () => {
  if (app) {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
  }
  if (profile) await fs.rm(profile, { recursive: true, force: true });
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
