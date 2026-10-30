"use strict";
// A separate profile and read-only public source; real production renderer,
// main process, IndexedDB and navigation reload. Only chooser answers are mocked.
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const { _electron, expect } = require("@playwright/test");
const waitDocumentOpen = require("./qa-wait-document-open.cjs");
const [executable, source, target] = process.argv.slice(2);
if (!executable || !source)
  throw Error(
    "Usage: node scripts/qa-recovery-native.cjs <app> <cmu-lecture-3.pptx> [output]",
  );
const output = path.resolve(target || "qa/results/native-recovery");
const hashFile = async (file) =>
  crypto
    .createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
(async () => {
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(
    path.join(os.tmpdir(), "slide-recovery-native-"),
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.SLIDE_STUDIO_DEV;
  const sourceHash = await hashFile(source),
    expectedSourceData = (await fs.readFile(source)).toString("base64"),
    expectedDigest = crypto
      .createHash("sha256")
      .update(expectedSourceData)
      .digest("hex"),
    results = [],
    errors = [],
    memory = [],
    processMemory = [];
  let app;
  try {
    app = await _electron.launch({
      executablePath: path.resolve(executable),
      args: ["--user-data-dir=" + profile, "--mute-audio"],
      env,
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(45000);
    // Reloading intentionally dirty disposable notes invokes the native close
    // guard. Supply that answer before the blocking OS dialog can appear.
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBoxSync = () => 1;
    });
    page.on("pageerror", (error) => errors.push(error.message));
    const cdp = await page.context().newCDPSession(page);
    await expect(page.locator(".save-indicator")).toHaveText("저장됨");
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, path.resolve(source));
    await page.getByRole("button", { name: "파일", exact: true }).click();
    await waitDocumentOpen(page, () =>
      page
        .locator(".file-popover")
        .getByRole("button", { name: /^파일 열기/ })
        .click(),
    );
    await expect(page.locator(".thumbnail-row")).toHaveCount(151);
    const notes = page.getByRole("textbox", {
      name: "발표자 노트",
      exact: true,
    });
    await notes.fill("설치형 대용량 복구 — 한글 😀");
    await expect(page.locator(".save-indicator")).toHaveText("저장됨");
    const inspect = () =>
      page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
          const r = indexedDB.open("slide-studio", 1);
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        let record;
        try {
          record = await new Promise((resolve, reject) => {
            const r = db
              .transaction("documents")
              .objectStore("documents")
              .get("current");
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
          });
        } finally {
          db.close();
        }
        const blob = record.data instanceof Blob,
          deck = blob ? JSON.parse(await record.data.text()) : record;
        const data = deck.pptxSources?.[0]?.data || "";
        const digest = Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(data),
            ),
          ),
          (b) => b.toString(16).padStart(2, "0"),
        ).join("");
        return {
          blob,
          slides: deck.slides.length,
          elements: deck.slides.reduce((n, s) => n + s.elements.length, 0),
          notes: deck.slides[0].notes,
          sourceChars: data.length,
          digest,
        };
      });
    const initialProcessMemory = await app.evaluate(({ app }) =>
      app
        .getAppMetrics()
        .map((p) => ({ type: p.type, pid: p.pid, memory: p.memory })),
    );
    results.push("production-native-151-slides-auto-save-above-127MiB");
    for (let index = 0; index < 3; index++) {
      await page.reload();
      await expect(page.locator(".thumbnail-row")).toHaveCount(151);
      await expect(notes).toHaveValue("설치형 대용량 복구 — 한글 😀");
      await expect(page.locator(".save-indicator")).toHaveText("저장됨");
      assert.equal(
        await page.evaluate(() =>
          sessionStorage.getItem("slide-studio-file-dirty"),
        ),
        "true",
      );
      await cdp.send("HeapProfiler.collectGarbage");
      memory.push(await cdp.send("Runtime.getHeapUsage"));
      processMemory.push(
        await app.evaluate(({ app }) =>
          app
            .getAppMetrics()
            .map((p) => ({ type: p.type, pid: p.pid, memory: p.memory })),
        ),
      );
      results.push(
        "production-native-reload-preserves-edited-notes-" + (index + 1),
      );
    }
    // Inspect the stored archive only after measuring ordinary UI reloads.
    // Parsing a second full recovery document for integrity checks would itself
    // inflate the renderer's peak and distort these memory observations.
    const original = await inspect();
    assert(original.blob, "Large recovery must use a Blob record");
    assert.equal(original.sourceChars, expectedSourceData.length);
    assert.equal(original.digest, expectedDigest);
    assert.equal(original.elements, 1186);
    results.push("source-archive-hash-preserved-after-three-native-reloads");
    assert.equal(await hashFile(source), sourceHash);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, "reloaded.png") });
    const report = {
      version: await app.evaluate(({ app }) => app.getVersion()),
      results,
      original,
      errors,
      memory,
      processMemory,
      initialProcessMemory,
      memoryMeasurement:
        "Native UI reloads and GC before integrity inspection; process memory in KiB, JS heap in bytes",
      sourceSHA256: sourceHash,
    };
    await fs.writeFile(
      path.join(output, "results.json"),
      JSON.stringify(report, null, 2),
    );
    await fs.rm(path.join(output, "failure.json"), { force: true });
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    await fs.writeFile(
      path.join(output, "failure.json"),
      JSON.stringify(
        { error: String(error.stack || error), results, errors },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    if (app) {
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
      await app.close().catch(() => {});
    }
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
