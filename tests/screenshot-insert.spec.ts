import {
  expect,
  test,
  _electron as electron,
  type Page,
} from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";

async function mountDialog(page: Page, native: boolean, delayed = false) {
  await page.goto("http://127.0.0.1:5190");
  await page.evaluate(
    async ({ native, delayed, png }) => {
      const { default: React } = await import(
        "/node_modules/.vite/deps/react.js"
      );
      const {
        default: { createRoot },
      } = await import("/node_modules/.vite/deps/react-dom_client.js");
      const { default: ScreenshotDialog } = await import(
        "/src/ScreenshotDialog.tsx"
      );
      const probe = ((window as any).__screenshotProbe = {
        captures: [] as string[],
        inserts: [] as string[],
        lists: 0,
        cancelled: 0,
        finish: null as null | (() => void),
      });
      (window as any).desktop = native
        ? {
            listCaptureSources: async () => {
              probe.lists++;
              return [
                { id: "ticket-1", name: "Sample window", thumbnail: png },
              ];
            },
            captureSource: async (id: string) => {
              probe.captures.push(id);
              if (delayed)
                await new Promise<void>((resolve) => {
                  probe.finish = resolve;
                });
              return png;
            },
          }
        : undefined;
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      const dispose = () => {
        root.unmount();
        host.remove();
      };
      root.render(
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(ScreenshotDialog, {
            onInsert: (data: string) => {
              probe.inserts.push(data);
              dispose();
            },
            onCancel: () => {
              probe.cancelled++;
              dispose();
            },
          }),
        ),
      );
    },
    { native, delayed, png: PNG },
  );
  await expect(
    page.getByRole("dialog", { name: "스크린샷 삽입" }),
  ).toBeVisible();
}

test("screenshot selection is explicit and StrictMode does not duplicate source requests", async ({
  page,
}) => {
  await mountDialog(page, true);
  const dialog = page.getByRole("dialog", { name: "스크린샷 삽입" });
  await expect(
    dialog.getByRole("button", { name: "삽입", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Sample window" }).click();
  expect(
    await page.evaluate(() => (window as any).__screenshotProbe.captures),
  ).toEqual([]);
  await dialog.getByRole("button", { name: "삽입", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as any).__screenshotProbe),
  ).toMatchObject({
    lists: 1,
    captures: ["ticket-1"],
    inserts: [PNG],
    cancelled: 0,
  });
});

test("dismissing an in-flight screenshot does not insert its late result", async ({
  page,
}) => {
  await mountDialog(page, true, true);
  const dialog = page.getByRole("dialog", { name: "스크린샷 삽입" });
  await dialog.getByRole("button", { name: "Sample window" }).click();
  await dialog.getByRole("button", { name: "삽입", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "캡처 중" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => (window as any).__screenshotProbe.finish());
  expect(
    await page.evaluate(() => (window as any).__screenshotProbe),
  ).toMatchObject({ captures: ["ticket-1"], inserts: [], cancelled: 1 });
});

test("browser screenshot fallback inserts a decoded image and rejects invalid files", async ({
  page,
}) => {
  await mountDialog(page, false);
  const dialog = page.getByRole("dialog", { name: "스크린샷 삽입" });
  const file = dialog.getByLabel("스크린샷 이미지 파일");
  await file.setInputFiles({
    name: "not-an-image.png",
    mimeType: "image/png",
    buffer: Buffer.from("invalid"),
  });
  await expect(dialog.getByRole("alert")).toContainText("읽을 수 없습니다");
  expect(
    await page.evaluate(() => (window as any).__screenshotProbe.inserts),
  ).toEqual([]);
  await file.setInputFiles({
    name: "screen.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG.split(",")[1], "base64"),
  });
  await expect(dialog).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as any).__screenshotProbe.inserts),
  ).toEqual([PNG]);
});

test("native screenshot IPC bounds tickets and rejects stale, repeated, concurrent, and foreign requests", async ({}, testInfo) => {
  test.setTimeout(60000);
  const directory = await mkdtemp(path.join(tmpdir(), "slide-studio-capture-"));
  const harness = path.join(directory, "main.cjs");
  await writeFile(
    harness,
    `
const electron = require('electron');
electron.app.setPath('appData', ${JSON.stringify(directory)});
// No real desktop content is captured and the user's app remains untouched.
electron.BrowserWindow.prototype.show = function () {};
global.captureCalls = [];
global.holdCapture = false;
global.releaseCapture = null;
global.originalNow = Date.now;
electron.desktopCapturer.getSources = async options => {
  global.captureCalls.push(options);
  if (global.holdCapture) await new Promise(resolve => {global.releaseCapture = resolve;});
  const thumbnail = electron.nativeImage.createFromBitmap(Buffer.from([80,120,160,255]), {width:1,height:1});
  return Array.from({length:30}, (_, index) => ({id:'window:fake-'+index,name:'Window '+index,thumbnail}));
};
require(${JSON.stringify(path.resolve("electron/main.cjs"))});
`,
  );
  const env = { ...process.env, SLIDE_STUDIO_DEV: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [harness], env });
  try {
    const page = await app.firstWindow();
    await expect
      .poll(() =>
        page.evaluate(() => typeof window.desktop?.listCaptureSources),
      )
      .toBe("function");
    // The IPC checks can finish before the initial autosave. Closing at that
    // point correctly opens the unsaved-work dialog and blocks headless cleanup.
    await expect(page.locator(".save-indicator")).toHaveText("저장됨");
    const list = () =>
      page.evaluate(() => window.desktop!.listCaptureSources!());
    const take = (id: string) =>
      page.evaluate(async (id) => {
        try {
          return { data: await window.desktop!.captureSource!(id) };
        } catch (error) {
          return { error: String(error) };
        }
      }, id);
    const first = await list();
    expect(first).toHaveLength(24);
    expect(first[0].id).not.toContain("window:");
    expect(first[0].thumbnail).toMatch(/^data:image\/png;base64,/);
    expect((await take("window:fake-0")).error).toContain("만료");
    const replacement = await list();
    expect((await take(first[0].id)).error).toContain("만료");
    const current = await list();
    const result = await take(current[0].id);
    expect(result.data).toMatch(/^data:image\/png;base64,/);
    expect((await take(current[0].id)).error).toContain("만료");
    const expiring = await list();
    await app.evaluate(() => {
      Date.now = () => (globalThis as any).originalNow() + 61000;
    });
    expect((await take(expiring[0].id)).error).toContain("만료");
    await app.evaluate(() => {
      Date.now = (globalThis as any).originalNow;
      (globalThis as any).holdCapture = true;
    });
    const pending = list();
    await expect
      .poll(() => app.evaluate(() => !!(globalThis as any).releaseCapture))
      .toBe(true);
    const concurrent = await page.evaluate(async () => {
      try {
        await window.desktop!.listCaptureSources!();
        return "accepted";
      } catch (error) {
        return String(error);
      }
    });
    expect(concurrent).toContain("다른 캡처");
    await app.evaluate(() => {
      (globalThis as any).holdCapture = false;
      (globalThis as any).releaseCapture();
    });
    await pending;
    const foreign = await app.evaluate(async ({ BrowserWindow }, preload) => {
      const other = new BrowserWindow({
        show: false,
        webPreferences: { preload, contextIsolation: true, sandbox: true },
      });
      try {
        await other.loadURL(
          "data:text/html,<p>Untrusted capture requester</p>",
        );
        return await other.webContents.executeJavaScript(
          "window.desktop.listCaptureSources().then(()=>'accepted', error=>String(error))",
        );
      } finally {
        other.destroy();
      }
    }, path.resolve("electron/preload.cjs"));
    expect(foreign).toContain("only to the editor window");
    const calls = await app.evaluate(() => (globalThis as any).captureCalls);
    expect(
      calls.some(
        (c: any) =>
          c.thumbnailSize.width === 320 && c.thumbnailSize.height === 180,
      ),
    ).toBe(true);
    expect(
      calls.some(
        (c: any) =>
          c.thumbnailSize.width === 1920 && c.thumbnailSize.height === 1080,
      ),
    ).toBe(true);
    await writeFile(
      testInfo.outputPath("capture-ipc.json"),
      JSON.stringify(
        { sourceCount: first.length, foreign, concurrent, calls },
        null,
        2,
      ),
    );
    expect(replacement[0].id).not.toBe(first[0].id);
  } finally {
    await app.close();
    if (
      !path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep) ||
      !path.basename(directory).startsWith("slide-studio-capture-")
    )
      throw new Error("Unexpected temporary capture test directory");
    await rm(directory, { recursive: true, force: true });
  }
});
