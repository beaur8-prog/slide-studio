import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

async function fixture(page: Page, platform = "win32", staleSeed = false) {
  await page.addInitScript(({ platform, version, staleSeed }) => {
    const listeners = new Set<(value: any) => void>();
    const seeds: ((value: any) => void)[] = [];
    let state: any = { phase: "idle", revision: 0, currentVersion: version, version: null, percent: 0,
      receivedBytes: 0, totalBytes: 0, automatic: platform !== "linux", platform, manualOnly: platform === "linux",
      downloaded: false, filename: null, checkedAt: null, error: null, lastInstall: null };
    const pending: Record<string, (value: any) => void> = {};
    const calls: string[] = [];
    const emit = (patch: any) => { state = { ...state, ...patch, revision: state.revision + 1 }; for (const listener of listeners) listener(structuredClone(state)); return structuredClone(state); };
    const hold = (name: string) => new Promise<any>(resolve => { pending[name] = resolve; });
    (window as any).__updates = { calls, emit, finish: (name: string, patch: any) => { const value = emit(patch); pending[name]?.(value); },
      seed: () => { for (const resolve of seeds) resolve({ ...state, revision: 0, phase: "idle", percent: 0 }); } };
    Object.defineProperty(navigator, "platform", { get: () => platform === "win32" ? "Win32" : platform === "darwin" ? "MacIntel" : "Linux" });
    window.desktop = { platform, saveFile: async () => null, openFile: async () => null, exportPDF: async () => null, print: async () => true,
      onMenu: callback => { (window as any).__updateMenu = callback; return () => {}; },
      getUpdateState: () => staleSeed ? new Promise(resolve => seeds.push(resolve)) : Promise.resolve(structuredClone(state)),
      onUpdateState: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
      checkUpdates: async () => { calls.push("check"); emit({ phase: "checking", error: null }); return hold("check"); },
      downloadUpdate: async () => { calls.push("download"); emit({ phase: "downloading", receivedBytes: 0, totalBytes: 10485760, percent: 0 }); return hold("download"); },
      installUpdate: async () => { calls.push("install"); return emit({ phase: "installing" }); },
      cancelUpdate: async () => { calls.push("cancel"); const value = emit({ phase: "cancelled", downloaded: false }); pending.download?.(value); pending.check?.(value); return value; },
      openUpdatePage: async () => { calls.push("manual"); return structuredClone(state); },
      revealUpdate: async () => { calls.push("reveal"); return structuredClone(state); },
      setAutomaticUpdates: async automatic => { calls.push("automatic:" + automatic); return emit({ automatic }); },
    };
  }, { platform, version, staleSeed });
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
}
const dialog = (page: Page) => page.getByRole("dialog", { name: "Slide Studio 업데이트" });

test("File and native menus open manual update controls without editing the document", async ({ page }, info) => {
  await fixture(page);
  const before = await page.locator(".slide-thumbnail").count();
  await page.getByRole("button", { name: "파일", exact: true }).click();
  await page.getByRole("button", { name: "수동 업데이트…", exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toContainText(`현재 버전 ${version}`);
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  expect(await page.locator(".slide-thumbnail").count()).toBe(before);
  expect(await page.evaluate(() => (window as any).__updates.calls)).toEqual([]);
  await dialog(page).getByLabel("자동으로 업데이트 확인·다운로드").uncheck();
  await expect(dialog(page).getByLabel("자동으로 업데이트 확인·다운로드")).not.toBeChecked();
  await dialog(page).getByRole("button", { name: "공식 다운로드 페이지 열기" }).click();
  expect(await page.evaluate(() => (window as any).__updates.calls)).toEqual(["automatic:false", "manual"]);
  await page.keyboard.press("Escape");
  await expect(dialog(page)).not.toBeVisible();
  await page.evaluate(() => (window as any).__updateMenu("updates-check"));
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole("progressbar")).toBeVisible();
  await page.evaluate(() => (window as any).__updates.finish("check", { phase: "available", version: "9.0.0", totalBytes: 10485760, checkedAt: Date.now() }));
  await expect(dialog(page).getByRole("button", { name: "다운로드", exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 970, height: 720 });
  await page.screenshot({ path: info.outputPath("manual-update-controls.png") });
});

test("download progress stays visible after closing, then verification and installation are distinct", async ({ page }, info) => {
  await fixture(page);
  await page.evaluate(() => (window as any).__updates.emit({ phase: "available", version: "9.0.0", totalBytes: 10485760 }));
  await page.getByRole("button", { name: "업데이트 상태 보기" }).click();
  await dialog(page).getByRole("button", { name: "다운로드", exact: true }).click();
  await page.evaluate(() => (window as any).__updates.emit({ phase: "downloading", percent: 42, receivedBytes: 4404019, totalBytes: 10485760 }));
  await expect(dialog(page)).toContainText("다운로드 중 42%");
  await expect(dialog(page).getByRole("progressbar")).toHaveAttribute("value", "42");
  await dialog(page).getByRole("button", { name: "닫기", exact: true }).click();
  await expect(page.locator(".update-status")).toContainText("42%");
  await page.locator(".update-status").click();
  await expect(dialog(page)).toContainText("42%");
  await page.evaluate(() => (window as any).__updates.emit({ phase: "verifying", percent: 100, receivedBytes: 10485760 }));
  await expect(dialog(page)).toContainText("파일 검증 중");
  await expect(dialog(page).getByRole("progressbar")).not.toHaveAttribute("value", /.+/);
  await page.evaluate(() => (window as any).__updates.finish("download", { phase: "ready", downloaded: true, filename: "Slide-Studio-Setup-x64.exe", percent: 100 }));
  await expect(dialog(page).getByRole("button", { name: "지금 설치" })).toBeEnabled();
  await page.screenshot({ path: info.outputPath("verified-update-ready.png") });
  await dialog(page).getByRole("button", { name: "지금 설치" }).click();
  await expect(dialog(page)).toContainText("문서 저장·종료 확인");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
});

test("cancel and failed requests remain retryable without losing editor state", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: "파일", exact: true }).click();
  await page.getByRole("button", { name: "업데이트 확인…", exact: true }).click();
  await dialog(page).getByRole("button", { name: "취소", exact: true }).click();
  await expect(dialog(page)).toContainText("업데이트 취소됨");
  await dialog(page).getByRole("button", { name: "지금 확인" }).click();
  await page.evaluate(() => (window as any).__updates.finish("check", { phase: "error", error: "네트워크에 연결할 수 없습니다." }));
  await expect(dialog(page).getByRole("alert")).toHaveText("네트워크에 연결할 수 없습니다.");
  await dialog(page).getByRole("button", { name: "지금 확인" }).click();
  await page.evaluate(() => (window as any).__updates.finish("check", { phase: "up-to-date", version: null, error: null }));
  await expect(dialog(page)).toContainText("현재 버전보다 새로운 공개 업데이트가 없습니다.");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
});

test("a delayed initial IPC response cannot erase newer download progress", async ({ page }) => {
  await fixture(page, "win32", true);
  await page.evaluate(() => { (window as any).__updates.emit({ phase: "downloading", percent: 72 }); (window as any).__updates.seed(); });
  await expect(page.locator(".update-status")).toContainText("72%");
});

for (const platform of ["darwin", "linux"]) test(`${platform} explains manual installation and keeps keyboard focus inside the update window`, async ({ page }) => {
  await fixture(page, platform);
  await page.evaluate(() => (window as any).__updateMenu("updates-manual"));
  await expect(dialog(page)).toContainText(platform === "darwin" ? "ZIP을 풀어 기존 앱을 직접 교체" : ".deb 파일을 받아 설치");
  if (platform === "linux") {
    await expect(dialog(page).getByLabel("자동으로 업데이트 확인·다운로드")).toBeDisabled();
    await expect(dialog(page).getByRole("button", { name: "다운로드", exact: true })).toBeDisabled();
  }
  await dialog(page).getByRole("button", { name: "업데이트 창 닫기" }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog(page).getByRole("button", { name: "닫기", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog(page).getByRole("button", { name: "업데이트 창 닫기" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).not.toBeVisible();
});
