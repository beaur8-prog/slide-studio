import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import JSZip from "jszip";
const base = process.env.QA_BASE_URL ?? "http://127.0.0.1:5190";
async function harness(page: Page, disableLocks = false) {
  if (disableLocks) await page.addInitScript(() => Object.defineProperty(navigator, "locks", { value: undefined }));
  await page.route("**/qa-recovery-harness", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body>Recovery test<script type="module">import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script></body></html>' }));
  await page.goto(base + "/qa-recovery-harness");
}
async function raw(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("slide-studio", 1); r.onsuccess = () => resolve(r.result); });
    const current = await new Promise<any>(resolve => { const r = db.transaction("documents").objectStore("documents").get("current"); r.onsuccess = () => resolve(r.result); });
    db.close(); return current;
  });
}
test("invalid legacy project is atomically quarantined without changing raw data, and repeated launches do not duplicate it", async ({ page }) => {
  await harness(page);
  const result = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { validateDeck } = await import("/src/io.ts");
    const { saveAutosave, loadAutosave, listRecoveryBackups, recoveryDownload } = await import("/src/storage.ts");
    await saveAutosave(blankDeck());
    const invalid = { ...blankDeck(), name: "보존할 한글 원문 😀", version: 999, extra: { secret: "개인 자료", flag: [true, null, 4] } };
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("slide-studio", 1); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>(resolve => { const tx = db.transaction("documents", "readwrite"); tx.objectStore("documents").put(invalid, "current"); tx.objectStore("documents").delete("current-revision"); tx.oncomplete = () => resolve(); });
    let preserved = false;
    try { await loadAutosave(validateDeck); } catch (error) { preserved = !!(error as any).backup; }
    const records = await listRecoveryBackups();
    const download = await recoveryDownload(records[0].id);
    const empty = await loadAutosave(validateDeck);
    const secondEmpty = await loadAutosave(validateDeck);
    await saveAutosave(blankDeck());
    await loadAutosave(validateDeck);
    const rawRecord = await new Promise<any>(resolve => { const r = db.transaction("documents").objectStore("documents").get("recovery-quarantine:data:" + records[0].id); r.onsuccess = () => resolve(r.result); });
    db.close();
    return { preserved, records: records.length, finalRecords: (await listRecoveryBackups()).length,
      absent: empty === undefined && secondEmpty === undefined, exact: JSON.stringify(rawRecord) === JSON.stringify(invalid),
      downloaded: JSON.parse(await download.blob.text()), extension: download.name.split(".").at(-1), description: download.description };
  });
  expect(result.preserved).toBe(true);
  expect(result.records).toBe(1); expect(result.finalRecords).toBe(1); expect(result.absent).toBe(true); expect(result.exact).toBe(true);
  expect(result.downloaded.name).toBe("보존할 한글 원문 😀"); expect(result.downloaded.extra.secret).toBe("개인 자료");
  expect(result.extension).toBe("json"); expect(result.description).toContain("PPTX 파일이 아니며");
});
test("damaged Blob JSON retains every original byte and unknown envelope fields", async ({ page }) => {
  await harness(page);
  const result = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { saveAutosave, loadAutosave, listRecoveryBackups, recoveryDownload } = await import("/src/storage.ts");
    const { validateDeck } = await import("/src/io.ts");
    await saveAutosave(blankDeck());
    const bytes = new Uint8Array([123, 34, 255, 92, 0, 240, 159, 152, 128]);
    const original = { format: "slide-studio-recovery-json", version: 1, data: new Blob([bytes], { type: "application/json" }), extra: "원형 보존" };
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("slide-studio", 1); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>(resolve => { const tx = db.transaction("documents", "readwrite"); tx.objectStore("documents").put(original, "current"); tx.oncomplete = () => resolve(); });
    try { await loadAutosave(validateDeck); } catch {}
    const records = await listRecoveryBackups(), file = await recoveryDownload(records[0].id);
    const preserved = await new Promise<any>(resolve => { const r = db.transaction("documents").objectStore("documents").get("recovery-quarantine:data:" + records[0].id); r.onsuccess = () => resolve(r.result); });
    db.close();
    return { count: records.length, name: file.name, archiveBytes: [...new Uint8Array(await file.blob.arrayBuffer())],
      originalBytes: [...new Uint8Array(await preserved.data.arrayBuffer())], extra: preserved.extra };
  });
  const zip = await JSZip.loadAsync(new Uint8Array(result.archiveBytes));
  const manifest = JSON.parse(await zip.file("record.json")!.async("string"));
  const bytes = [...await zip.file("blobs/0.bin")!.async("uint8array")];
  expect(result.count).toBe(1); expect(result.name).toMatch(/\.zip$/); expect(result.extra).toBe("원형 보존"); expect(manifest.record.extra).toBe("원형 보존");
  expect(bytes).toEqual([123, 34, 255, 92, 0, 240, 159, 152, 128]); expect(result.originalBytes).toEqual(bytes);
});
test("failed quarantine aborts all writes and blocks every autosave until preservation is retried", async ({ page }) => {
  await harness(page);
  const result = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { validateDeck } = await import("/src/io.ts");
    const { saveAutosave, loadAutosave, listRecoveryBackups, recoveryDownload } = await import("/src/storage.ts");
    await saveAutosave(blankDeck());
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("slide-studio", 1); r.onsuccess = () => resolve(r.result); });
    const original = { original: "지우면 안 되는 원문", version: 999 };
    await new Promise<void>(resolve => { const tx = db.transaction("documents", "readwrite"); tx.objectStore("documents").put(original, "current"); tx.oncomplete = () => resolve(); });
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const request = put.apply(this, args as any);
      if (String(args[1]).startsWith("recovery-quarantine:data:")) this.transaction.abort();
      return request;
    };
    let blocked = false, saveBlocked = false;
    try { await loadAutosave(validateDeck); } catch (error) { blocked = !(error as any).backup; }
    try { await saveAutosave(blankDeck()); } catch { saveBlocked = true; }
    const countBefore = (await listRecoveryBackups()).length;
    const unchanged = await new Promise<any>(resolve => { const r = db.transaction("documents").objectStore("documents").get("current"); r.onsuccess = () => resolve(r.result); });
    const download = await recoveryDownload();
    IDBObjectStore.prototype.put = put;
    try { await loadAutosave(validateDeck); } catch {}
    await saveAutosave(blankDeck()); db.close();
    return { blocked, saveBlocked, countBefore, after: (await listRecoveryBackups()).length,
      unchanged, download: JSON.parse(await download.blob.text()) };
  });
  expect(result.blocked).toBe(true); expect(result.saveBlocked).toBe(true); expect(result.countBefore).toBe(0); expect(result.after).toBe(1);
  expect(result.unchanged).toEqual({ original: "지우면 안 되는 원문", version: 999 }); expect(result.download).toEqual(result.unchanged);
});
test("Web Locks keep another window's save behind load validation and quarantine", async ({ page, context }) => {
  await harness(page); const other = await context.newPage(); await harness(other);
  await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts"); const { saveAutosave, loadAutosave } = await import("/src/storage.ts");
    await saveAutosave(blankDeck());
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("slide-studio", 1); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>(resolve => { const tx = db.transaction("documents", "readwrite"); tx.objectStore("documents").put({ legacy: "원형" }, "current"); tx.oncomplete = () => resolve(); }); db.close();
    (window as any).loadFinished = false; (window as any).validating = false;
    (window as any).load = loadAutosave(async () => { (window as any).validating = true; await new Promise(resolve => { (window as any).resume = resolve; }); throw new Error("old invalid"); })
      .catch(() => {}).finally(() => { (window as any).loadFinished = true; });
  });
  await expect.poll(() => page.evaluate(() => (window as any).validating)).toBe(true);
  await other.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts"); const { saveAutosave } = await import("/src/storage.ts");
    const deck = blankDeck(); deck.name = "다른 창 최신 작업"; (window as any).saved = false;
    (window as any).save = saveAutosave(deck).then(() => { (window as any).saved = true; });
  });
  expect(await other.evaluate(() => (window as any).saved)).toBe(false);
  expect(await raw(page)).toEqual({ legacy: "원형" });
  await page.evaluate(async () => { (window as any).resume(); await (window as any).load; });
  await other.evaluate(async () => { await (window as any).save; });
  expect((await raw(page)).name).toBe("다른 창 최신 작업");
  expect(await page.evaluate(async () => { const { listRecoveryBackups, recoveryDownload } = await import("/src/storage.ts"); const rows = await listRecoveryBackups(); return JSON.parse(await (await recoveryDownload(rows[0].id)).blob.text()); })).toEqual({ legacy: "원형" });
});
test("revision CAS retries a stale load instead of quarantining another window's new current when Web Locks are unavailable", async ({ page, context }) => {
  await harness(page, true); const other = await context.newPage(); await harness(other, true);
  await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts"); const { saveAutosave, loadAutosave } = await import("/src/storage.ts"); const { validateDeck } = await import("/src/io.ts");
    await saveAutosave(blankDeck());
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("slide-studio", 1); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>(resolve => { const tx = db.transaction("documents", "readwrite"); tx.objectStore("documents").put({ legacy: "원형" }, "current"); tx.oncomplete = () => resolve(); }); db.close();
    (window as any).validating = false;
    (window as any).load = loadAutosave(async value => { if ((value as any).legacy) { (window as any).validating = true; await new Promise(resolve => { (window as any).resume = resolve; }); throw new Error("invalid"); } return validateDeck(value); });
  });
  await expect.poll(() => page.evaluate(() => (window as any).validating)).toBe(true);
  await other.evaluate(async () => { const { blankDeck } = await import("/src/model.ts"); const { saveAutosave } = await import("/src/storage.ts"); const deck = blankDeck(); deck.name = "CAS 최신 작업"; await saveAutosave(deck); });
  expect(await page.evaluate(async () => { (window as any).resume(); return (await (window as any).load).name; })).toBe("CAS 최신 작업");
  expect((await raw(page)).name).toBe("CAS 최신 작업");
  expect(await page.evaluate(async () => (await (await import("/src/storage.ts")).listRecoveryBackups()).length)).toBe(0);
});
test("ordinary load validates once without re-encoding, writing, or full structured cloning", async ({ page }) => {
  await harness(page);
  const result = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts"); const { saveAutosave, loadAutosave } = await import("/src/storage.ts"); const { validateDeck } = await import("/src/io.ts");
    const deck = blankDeck(); deck.name = "정상 데이터"; await saveAutosave(deck);
    let writes = 0, clones = 0, validations = 0;
    const put = IDBObjectStore.prototype.put, clone = window.structuredClone;
    IDBObjectStore.prototype.put = function (...args) { writes++; return put.apply(this, args as any); };
    window.structuredClone = ((...args: any[]) => { clones++; return (clone as any)(...args); }) as any;
    const validator = (value: unknown) => { validations++; return validateDeck(value); };
    const [restored, concurrent] = await Promise.all([loadAutosave(validator), loadAutosave(validator)]);
    if (restored !== concurrent) throw new Error("Start-up loads did not share the validated snapshot");
    IDBObjectStore.prototype.put = put; window.structuredClone = clone;
    return { writes, clones, validations, name: restored!.name };
  });
  expect(result).toEqual({ writes: 0, clones: 0, validations: 1, name: "정상 데이터" });
});
test("app exposes retained recovery downloads across restarts and new work saves normally", async ({ page }, testInfo) => {
  await page.goto(base); await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("slide-studio", 1); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>(resolve => { const tx = db.transaction("documents", "readwrite"); tx.objectStore("documents").put({ version: 999, text: "옛날 원문 보관" }, "current"); tx.oncomplete = () => resolve(); }); db.close();
  });
  await page.reload(); await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await expect(page.locator(".recovery-notice")).toContainText("별도로 보관");
  await page.getByRole("button", { name: "복구 데이터 확인", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "보관된 복구 데이터" })).toBeVisible();
  const downloaded = page.waitForEvent("download"); await page.getByRole("button", { name: "원문 내려받기", exact: true }).click();
  const download = await downloaded; const filename = testInfo.outputPath(download.suggestedFilename()); await download.saveAs(filename);
  expect(JSON.parse(await fs.readFile(filename, "utf8"))).toEqual({ version: 999, text: "옛날 원문 보관" });
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.reload(); await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.getByRole("button", { name: /^파일$/ }).click(); await page.getByRole("button", { name: "보관된 복구 데이터", exact: true }).click();
  await expect(page.locator(".recovery-record")).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("retained-recovery.png") });
});
test("failed preservation remains visible while native PPTX Save stays available and retry resumes autosave", async ({ page }, testInfo) => {
  await page.goto(base); await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("slide-studio", 1); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>(resolve => { const tx = db.transaction("documents", "readwrite"); tx.objectStore("documents").put({ version: 999, keep: "실패해도 유지" }, "current"); tx.oncomplete = () => resolve(); }); db.close();
  });
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    (window as any).restorePut = () => { IDBObjectStore.prototype.put = put; };
    IDBObjectStore.prototype.put = function (...args) { const request = put.apply(this, args as any); if (String(args[1]).startsWith("recovery-quarantine:data:")) this.transaction.abort(); return request; };
    (window as any).nativeSaves = 0;
    Object.defineProperty(window, "desktop", { value: { saveFile: async () => { (window as any).nativeSaves++; return null; }, saveRecoveryData: async () => false, onMenu: () => () => {} } });
  });
  await page.reload(); await expect(page.locator(".recovery-notice")).toContainText("자동 저장을 중지");
  await expect(page.locator(".save-indicator")).toHaveText("저장 실패");
  await page.getByRole("button", { name: "PPTX 저장", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).nativeSaves)).toBe(1);
  expect(await raw(page)).toEqual({ version: 999, keep: "실패해도 유지" });
  await page.screenshot({ path: testInfo.outputPath("blocked-recovery.png") });
  await page.getByRole("button", { name: "복구 데이터 확인", exact: true }).click();
  await page.getByRole("button", { name: "기존 원문 내려받기", exact: true }).click();
  await expect(page.locator(".recovery-message")).toContainText("취소");
  await page.evaluate(() => (window as any).restorePut());
  await page.getByRole("button", { name: "다시 보관 시도", exact: true }).click();
  await expect(page.getByRole("button", { name: "다시 보관 시도", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  expect((await raw(page)).version).toBe(1);
});

test("a legacy 10,002-unit table recovery is preserved before a fresh title slide autosaves", async ({ page }) => {
  await page.goto(base); await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  const expected = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { createTable, createTableElement } = await import("/src/table.ts");
    const { validateDeck } = await import("/src/io.ts");
    const deck = blankDeck(); deck.name = "구버전의 한도 초과 자료";
    deck.slides[0].elements = Array.from({ length: 2 }, () => createTableElement(createTable(100, 50)));
    deck.slides[0].elements[0].table!.cells[99][49] = "마지막 한글 원문";
    let error = ""; try { validateDeck(deck); } catch (e) { error = (e as Error).message; }
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("slide-studio", 1); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>(resolve => { const tx = db.transaction("documents", "readwrite"); tx.objectStore("documents").put(deck, "current"); tx.objectStore("documents").delete("current-revision"); tx.oncomplete = () => resolve(); }); db.close();
    return { error, source: JSON.stringify(deck) };
  });
  expect(expected.error).toContain("10,000");
  await page.reload(); await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  expect((await raw(page)).name).not.toBe("구버전의 한도 초과 자료");
  const preserved = await page.evaluate(async () => {
    const { listRecoveryBackups, recoveryDownload } = await import("/src/storage.ts");
    const backups = await listRecoveryBackups(); return { count: backups.length, source: await (await recoveryDownload(backups[0].id)).blob.text(), reason: backups[0].reason };
  });
  expect(preserved.count).toBe(1); expect(preserved.source).toBe(expected.source); expect(preserved.reason).toContain("10,000");
});

test("a failed quarantine also blocks another already-open window from replacing the raw current", async ({ page, context }) => {
  await harness(page); const other = await context.newPage(); await harness(other);
  await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts"); const { saveAutosave, loadAutosave } = await import("/src/storage.ts"); const { validateDeck } = await import("/src/io.ts");
    await saveAutosave(blankDeck());
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("slide-studio", 1); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>(resolve => { const tx = db.transaction("documents", "readwrite"); tx.objectStore("documents").put({ legacy: "다른 창에서도 지키기" }, "current"); tx.oncomplete = () => resolve(); }); db.close();
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) { const request = put.apply(this, args as any); if (String(args[1]).startsWith("recovery-quarantine:data:")) this.transaction.abort(); return request; };
    try { await loadAutosave(validateDeck); } catch {}
    IDBObjectStore.prototype.put = put;
  });
  expect(await other.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts"); const { saveAutosave } = await import("/src/storage.ts");
    try { await saveAutosave(blankDeck()); return "overwritten"; } catch (error) { return (error as Error).message; }
  })).toContain("자동 저장을 중지");
  expect(await raw(page)).toEqual({ legacy: "다른 창에서도 지키기" });
  await page.evaluate(async () => {
    const { validateDeck } = await import("/src/io.ts"); const { loadAutosave } = await import("/src/storage.ts");
    try { await loadAutosave(validateDeck); } catch {}
  });
  await other.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts"); const { loadAutosave, saveAutosave } = await import("/src/storage.ts"); const { validateDeck } = await import("/src/io.ts");
    await loadAutosave(validateDeck); await saveAutosave(blankDeck());
  });
  expect((await raw(page)).version).toBe(1);
});

test("retry in a blocked window retains the download menu after another window preserves the original", async ({ page, context }) => {
  await page.goto(base); await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("slide-studio", 1); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>(resolve => { const tx = db.transaction("documents", "readwrite"); tx.objectStore("documents").put({ version: 999, keep: "교차 창 원문" }, "current"); tx.oncomplete = () => resolve(); }); db.close();
  });
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) { const request = put.apply(this, args as any); if (String(args[1]).startsWith("recovery-quarantine:data:")) this.transaction.abort(); return request; };
  });
  await page.reload(); await expect(page.locator(".recovery-notice")).toContainText("자동 저장을 중지");
  const other = await context.newPage(); await harness(other);
  await other.evaluate(async () => { const { loadAutosave } = await import("/src/storage.ts"); const { validateDeck } = await import("/src/io.ts"); try { await loadAutosave(validateDeck); } catch {} });
  await page.getByRole("button", { name: "복구 데이터 확인", exact: true }).click();
  await page.getByRole("button", { name: "다시 보관 시도", exact: true }).click();
  await expect(page.getByRole("button", { name: "다시 보관 시도", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await expect(page.locator(".recovery-notice")).toContainText("별도로 보관");
  await page.getByRole("button", { name: /^파일$/ }).click();
  await page.getByRole("button", { name: "보관된 복구 데이터", exact: true }).click();
  await expect(page.locator(".recovery-record")).toHaveCount(1);
});
