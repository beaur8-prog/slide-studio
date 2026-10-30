"use strict";
// Packaged-app QA in a disposable profile. Only file-dialog answers are mocked;
// the image worker, CSP, renderer, native file I/O and PDF generation are real.
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const JSZip = require("jszip");
const { _electron } = require("playwright");
const { expect } = require("@playwright/test");
const [executable, source, directory] = process.argv.slice(2);
if (!executable || !source)
  throw Error(
    "Usage: node scripts/qa-vector-images.cjs <app-executable> <vector-source.pptx> [output-directory]",
  );
const output = path.resolve(directory || "qa/results/vector-images/native");
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
async function vectorHashes(file) {
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  return [
    ...new Set(
      await Promise.all(
        Object.values(zip.files)
          .filter((p) => !p.dir && /\.(?:svg|emf|wmf)$/.test(p.name))
          .map(async (p) => hash(await p.async("nodebuffer"))),
      ),
    ),
  ].sort();
}
(async () => {
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "slide-vector-qa-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.SLIDE_STUDIO_DEV;
  const results = [],
    errors = [],
    securityErrors = [];
  let app;
  try {
    app = await _electron.launch({
      executablePath: path.resolve(executable),
      args: ["--user-data-dir=" + profile],
      env,
      timeout: 45000,
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (msg) => {
      if (
        /Content Security Policy|Refused to.*worker|ERR_WORKER/i.test(
          msg.text(),
        )
      )
        securityErrors.push(msg.text());
    });
    await expect(page.locator(".save-indicator")).toHaveText("저장됨");
    const open = async (filename) => {
      await app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [file],
        });
      }, path.resolve(filename));
      await page.getByRole("button", { name: "파일", exact: true }).click();
      await page
        .locator(".file-popover button")
        .filter({ hasText: "파일 열기" })
        .click();
      await expect(page.locator(".busy-backdrop")).toHaveCount(0);
      await expect(
        page.locator('.editable-slide [data-type="image"] img'),
      ).toHaveCount(4);
      await expect
        .poll(() =>
          page
            .locator('.editable-slide [data-type="image"] img')
            .evaluateAll((nodes) =>
              nodes.every(
                (n) =>
                  n.naturalWidth > 0 &&
                  n.src.startsWith("data:image/svg+xml;base64,"),
              ),
            ),
        )
        .toBe(true);
    };
    await open(source);
    results.push("native-open-SVG-EMF-WMF-with-production-CSP");
    await page.screenshot({ path: path.join(output, "opened.png") });
    const title = page
      .locator('.editable-slide [data-type="text"]')
      .filter({ hasText: "벡터 호환성" });
    await title.dblclick();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText("벡터 그림 저장 검증");
    await page.locator(".canvas-topline").click();
    await page.getByRole("button", { name: "실행 취소", exact: true }).click();
    await expect(page.locator(".editable-slide")).toContainText("벡터 호환성");
    await page.getByRole("button", { name: "다시 실행", exact: true }).click();
    await expect(page.locator(".editable-slide")).toContainText(
      "벡터 그림 저장 검증",
    );
    results.push("native-edit-undo-redo");
    const saved = path.join(output, "native-vector-saved.pptx");
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, saved);
    await page.getByRole("button", { name: "파일", exact: true }).click();
    await page.locator(".file-popover").getByRole("button", {name:/^다른 이름으로 저장/}).click();
    await expect(page.locator(".toast")).toContainText(
      "PPTX 파일을 저장했습니다",
    );
    assert.deepEqual(await vectorHashes(saved), await vectorHashes(source));
    results.push("native-save-original-vector-hashes");
    await open(saved);
    await expect(page.locator(".editable-slide")).toContainText(
      "벡터 그림 저장 검증",
    );
    results.push("native-reopen-4-visible-vector-pictures");
    await page.screenshot({ path: path.join(output, "reopened.png") });
    const pdf = path.join(output, "native-vector.pdf");
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, pdf);
    assert.equal(
      await page.evaluate(() => window.desktop.exportPDF("벡터 그림")),
      pdf,
    );
    assert((await fs.stat(pdf)).size > 1000);
    await expect(page.locator(".print-slide")).toHaveCount(0);
    results.push("native-PDF-and-print-DOM-cleanup");
    assert.deepEqual(errors, []);
    assert.deepEqual(securityErrors, []);
    await fs.writeFile(
      path.join(output, "results.json"),
      JSON.stringify(
        {
          source: path.resolve(source),
          executable: path.resolve(executable),
          results,
          errors,
          securityErrors,
          saved,
          pdf,
        },
        null,
        2,
      ),
    );
    console.log(`Verified ${results.length} native vector workflows; ${pdf}`);
  } catch (error) {
    await fs.writeFile(
      path.join(output, "failure.json"),
      JSON.stringify(
        { results, errors, securityErrors, error: String(error) },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    if (app) await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
