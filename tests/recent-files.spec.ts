import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const { RecentFiles } = createRequire(import.meta.url)("../electron/recent-files.cjs");

async function openEditor(page: Page) {
  await page.addInitScript(() => {
    const state = { deleted: false, opens: 0, text: "디스크 원본", session: "window-1" };
    (window as any).__recent = state;
    window.desktop = {
      windowSessionId: localStorage.getItem("test-window") || state.session,
      platform: "win32", onMenu: () => () => {},
      saveFile: async () => null, openFile: async () => null,
      exportPDF: async () => null, print: async () => false,
      recentFiles: async () => state.deleted ? [] : [{
        id: "recent-one", name: "원본.pptx", path: "C:\\자료\\원본.pptx",
        available: true, lastUsedAt: 1,
      }],
      openRecentFile: async () => {
        if (state.deleted) throw Error("ENOENT");
        state.opens++;
        return { name: "원본.slide", data: new TextEncoder().encode(JSON.stringify({
          version: 1, id: "disk-doc", name: state.text, width: 1280, height: 720, theme: "studio",
          slides: [{ id: "disk-slide", background: "#FFFFFF", transition: "none", notes: state.text, elements: [] }],
        })) };
      },
    };
  });
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
}

test("library opens the actual file and removes a missing file instead of opening a cached copy", async ({ page }) => {
  await openEditor(page);
  const library = () => page.getByTitle("내 프레젠테이션", { exact: true }).click();
  await library();
  await expect(page.locator(".library-file")).toHaveCount(1);
  await page.getByRole("button", { name: "파일 열기: 원본.pptx", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "발표자 노트", exact: true })).toHaveValue("디스크 원본");
  await page.evaluate(() => { (window as any).__recent.text = "디스크에서 바뀐 내용"; });
  await library();
  await page.locator(".library-file").click();
  await expect(page.getByRole("textbox", { name: "발표자 노트", exact: true })).toHaveValue("디스크에서 바뀐 내용");
  await library();
  await page.evaluate(() => { (window as any).__recent.deleted = true; });
  await page.locator(".library-file").click();
  await expect(page.locator(".library-file")).toHaveCount(0);
  await expect(page.locator(".toast")).toContainText("원본 파일을 열 수 없습니다");
  await expect(page.getByRole("textbox", { name: "발표자 노트", exact: true })).toHaveValue("디스크에서 바뀐 내용");
});

test("a reopened editor window starts blank and old snapshots never populate the recent file list", async ({ page }) => {
  await openEditor(page);
  await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { saveAutosave } = await import("/src/storage.ts");
    const deck = blankDeck(); deck.name = "이전 자동 저장 복사본"; deck.slides[0].notes = "이전 내용";
    await saveAutosave(deck);
  });
  await page.reload();
  await expect(page.getByRole("textbox", { name: "발표자 노트", exact: true })).toHaveValue("이전 내용");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(() => localStorage.setItem("test-window", "window-2"));
  await page.reload();
  await expect(page.locator(".thumbnail-button")).toHaveCount(1);
  await expect(page.locator(".editable-slide [data-element-id]")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "발표자 노트", exact: true })).toHaveValue("");
  await page.getByTitle("내 프레젠테이션", { exact: true }).click();
  await expect(page.locator(".library-file")).toHaveCount(1);
  await expect(page.getByRole("dialog")).not.toContainText("이전 자동 저장 복사본");
});

test("editing buffer updates do not create a stored copy for every document", async ({ page }) => {
  await openEditor(page);
  const keys = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { saveAutosave } = await import("/src/storage.ts");
    await saveAutosave(blankDeck()); await saveAutosave(blankDeck());
    return new Promise<IDBValidKey[]>((resolve, reject) => {
      const request = indexedDB.open("slide-studio", 1);
      request.onsuccess = () => {
        const db = request.result;
        const read = db.transaction("documents").objectStore("documents").getAllKeys();
        read.onsuccess = () => { db.close(); resolve(read.result); };
        read.onerror = () => { db.close(); reject(read.error); };
      };
      request.onerror = () => reject(request.error);
    });
  });
  expect(keys).toEqual(["current"]);
});

test("recent files deduplicate real paths, preserve distinct folders and remove deleted files after restart", async () => {
  const work = await mkdtemp(path.join(tmpdir(), "slide-recents-"));
  try {
    const a = path.join(work, "A"), b = path.join(work, "B");
    await Promise.all([mkdir(a), mkdir(b)]);
    const original = path.join(a, "자료.pptx"), other = path.join(b, "자료.pptx");
    await Promise.all([writeFile(original, "original document content"), writeFile(other, "other document")]);
    const metadata = path.join(work, "recent.json");
    const registry = () => new RecentFiles(() => metadata, writeFile);
    const recent = registry();
    await recent.remember(original);
    const first = (await recent.list())[0];
    await recent.remember(original);
    if (process.platform !== "win32") {
      const alias = path.join(work, "별칭.pptx");
      await symlink(original, alias);
      await recent.remember(alias);
    }
    expect(await recent.list()).toHaveLength(1);
    expect((await recent.list())[0].id).toBe(first.id);
    await recent.remember(other);
    expect(await recent.list()).toHaveLength(2);
    expect(await registry().resolve(first.id)).toBe(await realpath(original));
    await expect(recent.resolve(original)).rejects.toThrow("최근 파일 목록에 없는");
    const saved = await readFile(metadata, "utf8");
    expect(saved).not.toContain("original document content");
    await rm(original);
    const remaining = await registry().list();
    expect(remaining.map((file: any) => file.path)).toEqual([await realpath(other)]);
    expect(JSON.parse(await readFile(metadata, "utf8")).files).toHaveLength(1);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test("loading old recent metadata merges duplicate paths without merging different files with the same name", async () => {
  const work = await mkdtemp(path.join(tmpdir(), "slide-recents-migrate-"));
  try {
    const file = path.join(work, "문서.pptx"), metadata = path.join(work, "recent.json");
    await writeFile(file, "content");
    await writeFile(metadata, JSON.stringify({ version: 1, files: [
      { id: "old", path: file, lastUsedAt: 1 },
      { id: "new", path: file, lastUsedAt: 2 },
    ] }));
    const recent = new RecentFiles(() => metadata, writeFile);
    expect(await recent.list()).toMatchObject([{ id: "new", path: await realpath(file) }]);
    expect(JSON.parse(await readFile(metadata, "utf8")).files).toHaveLength(1);
  } finally { await rm(work, { recursive: true, force: true }); }
});
