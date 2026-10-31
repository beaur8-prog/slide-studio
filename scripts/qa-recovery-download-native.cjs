"use strict";
// Real production renderer, preload, IPC and disk writes; only OS dialog answers
// use deterministic QA replies. Every file and profile belongs to this run.
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { _electron } = require("playwright");
const { expect } = require("@playwright/test");
const PptxGenJS = require("pptxgenjs");
const JSZip = require("jszip");

const [executable, directory] = process.argv.slice(2);
if (!executable) throw Error("Usage: qa-recovery-download-native.cjs <app-executable> [output]");
const output = path.resolve(directory || "qa/results/recovery-native");
const exists = file => fs.stat(file).then(() => true, () => false);
const originalBytes = [255, 123, 0, 125, 13, 10];

(async () => {
  await fs.mkdir(output, { recursive: true });
  const runOutput = await fs.mkdtemp(path.join(output, "run-"));
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "slide-recovery-native-"));
  await fs.mkdir(path.join(profile, "updates"));
  await fs.writeFile(path.join(profile, "updates", "settings.json"), JSON.stringify({ automatic: false }));
  const original = path.join(runOutput, "working-document.pptx");
  const first = path.join(runOutput, "original-recovery.zip");
  const second = path.join(runOutput, "retained-recovery.zip");
  const collision = path.join(runOutput, "collision.zip");
  const untouched = path.join(runOutput, "unrelated.bin");
  await fs.writeFile(collision, "KEEP COLLISION");
  await fs.writeFile(untouched, "KEEP UNRELATED");
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_WIDE";
  deck.addSlide().addShape(deck.ShapeType.rect, {
    x: 1, y: 1, w: 260 / 96, h: 100 / 96, fill: { color: "4472C4" },
  });
  await deck.writeFile({ fileName: original });
  let app;
  const results = [], errors = [];
  try {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.SLIDE_STUDIO_DEV;
    app = await _electron.launch({
      executablePath: path.resolve(executable),
      args: [
        ...(env.QA_APP_ROOT ? [path.resolve(env.QA_APP_ROOT)] : []),
        "--user-data-dir=" + profile, "--mute-audio",
        ...(process.platform === "linux" && env.QA_NO_SANDBOX === "1" ? ["--no-sandbox"] : []),
      ], env, timeout: 45000,
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    page.on("pageerror", error => errors.push(error.message));
    await expect(page.locator(".save-indicator")).toHaveText("저장됨");
    await app.evaluate(({ dialog }) => {
      global.__recoveryQA = { open: [], save: [], messages: [], seen: [] };
      const q = global.__recoveryQA;
      dialog.showOpenDialog = async (_, options) => {
        q.seen.push({ kind: "open", options });
        return q.open.shift() || { canceled: true, filePaths: [] };
      };
      dialog.showSaveDialog = async (_, options) => {
        q.seen.push({ kind: "save", options });
        return q.save.shift() || { canceled: true };
      };
      dialog.showMessageBox = async (_, options) => {
        q.seen.push({ kind: "message", options });
        return q.messages.shift() || { response: 2 };
      };
    });
    const queue = (kind, reply) => app.evaluate((_, data) => {
      global.__recoveryQA[data.kind].push(data.reply);
    }, { kind, reply });
    const menu = label => app.evaluate(({ Menu }, label) => {
      const item = Menu.getApplicationMenu().items.flatMap(item => item.submenu?.items || [])
        .find(item => item.label === label);
      if (!item) throw Error("Missing menu " + label);
      item.click();
    }, label);
    const seen = () => app.evaluate(() => global.__recoveryQA.seen);
    const retained = () => page.evaluate(() => new Promise((resolve, reject) => {
      let db, settled = false;
      const finish = (error, count) => {
        if (settled) return;
        settled = true; clearTimeout(timeout); db?.close();
        if (error) reject(error); else resolve(count);
      };
      const timeout = setTimeout(() => finish(Error("Recovery inspection exceeded 15 seconds")), 15000);
      const open = indexedDB.open("slide-studio", 1);
      open.onerror = () => finish(open.error);
      open.onblocked = () => finish(Error("Recovery database open was blocked"));
      open.onsuccess = () => {
        db = open.result;
        if (settled) { db.close(); return; }
        try {
          const tx = db.transaction("documents");
          const request = tx.objectStore("documents")
            .getAllKeys(IDBKeyRange.bound("recovery-quarantine:data:", "recovery-quarantine:data:\uffff"));
          let count;
          request.onerror = () => finish(request.error);
          request.onsuccess = () => { count = request.result.length; };
          tx.onerror = tx.onabort = () => finish(tx.error || Error("Recovery inspection aborted"));
          tx.oncomplete = () => finish(undefined, count);
        } catch (error) { finish(error); }
      };
    }));
    await page.evaluate(bytes => new Promise((resolve, reject) => {
      let db, settled = false;
      const finish = error => {
        if (settled) return;
        settled = true; clearTimeout(timeout); db?.close();
        if (error) reject(error); else resolve();
      };
      const timeout = setTimeout(() => finish(Error("Recovery fixture write exceeded 15 seconds")), 15000);
      const open = indexedDB.open("slide-studio", 1);
      open.onerror = () => finish(open.error);
      open.onblocked = () => finish(Error("Recovery fixture database was blocked"));
      open.onsuccess = () => {
        db = open.result;
        if (settled) { db.close(); return; }
        try {
          const tx = db.transaction("documents", "readwrite");
          const request = tx.objectStore("documents").put({
              format: "slide-studio-recovery-json", version: 2,
              data: new Blob([new Uint8Array(bytes)], { type: "application/json" }),
              extra: { label: "원문과 버전 보존" },
            }, "current");
          request.onerror = () => finish(request.error);
          tx.onerror = tx.onabort = () => finish(tx.error || Error("Recovery fixture write aborted"));
          tx.oncomplete = () => finish();
        } catch (error) { finish(error); }
      };
    }), originalBytes);
    await page.reload();
    await expect(page.locator(".recovery-notice")).toContainText("별도로 보관");
    await expect(page.locator(".save-indicator")).toHaveText("저장됨");
    assert.equal(await retained(), 1);
    results.push("invalid-original-quarantined-before-new-work-autosave");
    await queue("open", { canceled: false, filePaths: [original] });
    await menu("Open…");
    await expect(page.locator('.editable-slide [data-type="shape"]')).toHaveCount(1);
    const originalFile = await fs.readFile(original);
    await page.getByRole("button", { name: /^파일$/ }).click();
    await page.getByRole("button", { name: "보관된 복구 데이터", exact: true }).click();
    await expect(page.locator(".recovery-record")).toHaveCount(1);
    await queue("save", { canceled: false, filePath: first.slice(0, -4) });
    await page.getByRole("button", { name: "원문 내려받기", exact: true }).click();
    await expect(page.locator(".recovery-message")).toContainText("저장했습니다");
    assert(await exists(first));
    const readArchive = async file => {
      const zip = await JSZip.loadAsync(await fs.readFile(file));
      const manifest = JSON.parse(await zip.file("record.json").async("string"));
      assert.equal(manifest.record.version, 2);
      assert.equal(manifest.record.extra.label, "원문과 버전 보존");
      assert.deepEqual([...(await zip.file("blobs/0.bin").async("uint8array"))], originalBytes);
      return manifest;
    };
    const manifest = await readArchive(first);
    assert.deepEqual(await fs.readFile(original), originalFile);
    assert.equal(await retained(), 1);
    results.push("real-recovery-dialog-ipc-and-atomic-write-keep-envelope-and-original-bytes");
    await queue("save", { canceled: true });
    await page.getByRole("button", { name: "원문 내려받기", exact: true }).click();
    await expect(page.locator(".recovery-message")).toContainText("취소");
    assert.equal(await retained(), 1);
    results.push("cancelled-recovery-save-keeps-quarantine-and-working-pptx");
    await queue("save", { canceled: false, filePath: collision.slice(0, -4) });
    await queue("messages", { response: 1 });
    const beforeCollision = (await seen()).filter(item => item.kind === "message").length;
    await page.getByRole("button", { name: "원문 내려받기", exact: true }).click();
    await expect(page.locator(".recovery-message")).toContainText("취소");
    assert.equal((await seen()).filter(item => item.kind === "message").length, beforeCollision + 1);
    assert.deepEqual(await app.evaluate(() => ({
      save: global.__recoveryQA.save.length, messages: global.__recoveryQA.messages.length,
    })), { save: 0, messages: 0 });
    assert.equal(await fs.readFile(collision, "utf8"), "KEEP COLLISION");
    assert.equal(await retained(), 1);
    results.push("appended-extension-collision-cancel-does-not-overwrite");
    const beforeRejected = (await seen()).length;
    const rejected = await page.evaluate(async file => {
      try {
        await window.desktop.saveRecoveryData({
          name: "blocked", extension: "bin", data: new Uint8Array([1]), path: file,
        });
        return false;
      } catch { return true; }
    }, untouched);
    assert(rejected);
    assert.equal((await seen()).length, beforeRejected);
    assert.equal(await fs.readFile(untouched, "utf8"), "KEEP UNRELATED");
    results.push("real-preload-ipc-rejects-renderer-supplied-path-before-dialog-or-write");
    await page.screenshot({ path: path.join(runOutput, "recovery-cancel-preserved.png") });
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await page.locator('.editable-slide [data-type="shape"]').click();
    const field = page.getByRole("spinbutton", { name: "너비", exact: true });
    if (!(await field.isVisible())) await page.getByRole("button", { name: "서식", exact: true }).click();
    await field.fill("200"); await field.press("Enter");
    const beforeSave = (await seen()).filter(item => item.kind === "save").length;
    await menu("Save PowerPoint");
    await expect.poll(async () => {
      const zip = await JSZip.loadAsync(await fs.readFile(original));
      const slide = await zip.file("ppt/slides/slide1.xml").async("string");
      const shape = slide.match(/<p:sp[\s>]([\s\S]*?)<\/p:sp>/)?.[1];
      return Number(shape?.match(/<a:ext cx="(\d+)" cy="(\d+)"/)?.[1]) / 9525;
    }).toBe(200);
    await expect(page.locator(".save-indicator")).toHaveText("저장됨");
    assert.equal((await seen()).filter(item => item.kind === "save").length, beforeSave);
    assert.equal(await fs.readFile(collision, "utf8"), "KEEP COLLISION");
    results.push("recovery-saves-do-not-change-working-file-token-or-normal-save-target");
    await page.reload();
    await expect(page.locator(".save-indicator")).toHaveText("저장됨");
    await page.getByRole("button", { name: /^파일$/ }).click();
    await page.getByRole("button", { name: "보관된 복구 데이터", exact: true }).click();
    await expect(page.locator(".recovery-record")).toHaveCount(1);
    await queue("save", { canceled: false, filePath: second });
    await page.getByRole("button", { name: "원문 내려받기", exact: true }).click();
    await expect(page.locator(".recovery-message")).toContainText("저장했습니다");
    assert.deepEqual(await readArchive(second), manifest);
    assert.equal(await retained(), 1);
    results.push("reopened-production-profile-keeps-identical-raw-record-and-download");
    await page.screenshot({ path: path.join(runOutput, "recovery-retained.png") });
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(runOutput, "results.json"), JSON.stringify({
      platform: process.platform, production: true, isolatedProfile: true,
      dialogAnswersMocked: true, rendererPreloadIpcFilesystem: "real", passed: results, errors,
    }, null, 2));
    console.log(JSON.stringify({ output: runOutput, passed: results.length, results, errors }));
  } catch (error) {
    await fs.writeFile(path.join(runOutput, "failure.json"), JSON.stringify({ passed: results, errors, message: error.message }, null, 2));
    throw error;
  } finally {
    if (app) {
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
      await app.close().catch(() => {});
    }
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
