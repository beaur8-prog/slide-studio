"use strict";
// Packaged renderer + real file IPC, in a disposable profile. Only the native
// file-dialog responses are supplied by QA; the user's document is untouched.
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const JSZip = require("jszip");
const { _electron } = require("playwright");
const { expect } = require("@playwright/test");
const [executable, fixture, directory, compoundFixture] = process.argv.slice(2);
if (!executable || !fixture)
  throw Error(
    "Usage: node scripts/qa-pptx-preservation.cjs <app-executable> <source.pptx> [output] [smartart-source.pptx]",
  );
const output = path.resolve(directory || "qa/results/pptx-preservation/native");
const hash = (data) => crypto.createHash("sha256").update(data).digest("hex");
async function assets(filename) {
  const zip = await JSZip.loadAsync(await fs.readFile(filename));
  const images = {},
    sounds = {};
  for (const filename of Object.keys(zip.files)) {
    if (filename.endsWith(".svg"))
      images[hash(await zip.file(filename).async("nodebuffer"))] = true;
    if (filename.endsWith(".wav"))
      sounds[hash(await zip.file(filename).async("nodebuffer"))] = true;
  }
  return {
    images: Object.keys(images).sort(),
    sounds: Object.keys(sounds).sort(),
    xml: await zip.file("ppt/slides/slide1.xml").async("string"),
  };
}
(async () => {
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(
    path.join(os.tmpdir(), "slide-pptx-preservation-"),
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.SLIDE_STUDIO_DEV;
  const results = [],
    errors = [];
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
    page.on("pageerror", (e) => errors.push(e.message));
    await expect(page.locator(".save-indicator")).toHaveText("저장됨");
    const open = async (filename) => {
      await app.evaluate(({ dialog }, filename) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [filename],
        });
      }, path.resolve(filename));
      await page.getByRole("button", { name: "파일", exact: true }).click();
      await page
        .locator(".file-popover button")
        .filter({ hasText: "파일 열기" })
        .click();
      await expect(page.locator(".busy-backdrop")).toHaveCount(0);
      await expect(page.locator(".save-indicator")).toHaveText("저장됨");
    };
    await open(fixture);
    await expect(page.locator(".thumbnail-row")).toHaveCount(2);
    const title = page
      .locator('.editable-slide [data-type="text"]')
      .filter({ hasText: "원본 제목 1" });
    await expect(title).toHaveCount(1);
    results.push("native-source-file-open");
    await title.dblclick();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText("실제 앱 저장 검증");
    await page.locator(".canvas-topline").click();
    await page.getByRole("button", { name: "실행 취소", exact: true }).click();
    await expect(page.locator(".editable-slide")).toContainText("원본 제목 1");
    await page.getByRole("button", { name: "다시 실행", exact: true }).click();
    await expect(page.locator(".editable-slide")).toContainText(
      "실제 앱 저장 검증",
    );
    results.push("native-text-edit-undo-redo");
    const save = async (filename) => {
      await app.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
      }, filename);
      await page
        .getByRole("button", { name: "PPTX 저장", exact: true })
        .click();
      await expect(page.locator(".toast")).toContainText(
        "PPTX 파일을 저장했습니다",
      );
      assert((await fs.stat(filename)).size > 1000);
    };
    const first = path.join(output, "native-preserved.pptx");
    await save(first);
    results.push("native-save-with-opaque-content");
    await open(first);
    await expect(page.locator(".editable-slide")).toContainText(
      "실제 앱 저장 검증",
    );
    await page.screenshot({ path: path.join(output, "reopened.png") });
    results.push("native-reopen-edited-pptx");
    const second = path.join(output, "native-preserved-again.pptx");
    await save(second);
    results.push("native-second-save");
    const original = await assets(fixture),
      one = await assets(first),
      two = await assets(second);
    for (const round of [one, two]) {
      assert.deepEqual(round.images, original.images);
      assert.deepEqual(round.sounds, original.sounds);
      for (const feature of [
        "animEffect",
        "<p:audio",
        "svgBlip",
        "pattFill",
        'advTm="4500"',
      ])
        assert(round.xml.includes(feature), "Missing " + feature);
    }
    results.push("original-media-hashes-and-native-xml-preserved");
    if (compoundFixture) {
      await open(compoundFixture);
      const title = page
        .locator('.editable-slide [data-type="text"]')
        .filter({ hasText: "Outside title" });
      await expect(title).toHaveCount(1);
      await title.dblclick();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.insertText("Native SmartArt neighbor edited");
      await page.locator(".canvas-topline").click();
      const compound = path.join(output, "native-smartart.pptx");
      await save(compound);
      const zip = await JSZip.loadAsync(await fs.readFile(compound));
      const xml = await zip.file("ppt/slides/slide1.xml").async("string");
      const types = await zip.file("[Content_Types].xml").async("string");
      assert.equal((xml.match(/<p:graphicFrame>/g) || []).length, 1);
      assert.equal((xml.match(/<dgm:relIds/g) || []).length, 1);
      assert.equal(
        (
          types.match(
            /ContentType="application\/vnd.openxmlformats-officedocument.drawingml.diagram/g,
          ) || []
        ).length,
        4,
      );
      results.push("native-smartart-survives-neighbor-edit-and-save");
      await open(compound);
      await expect(page.locator(".editable-slide")).toContainText("Stage A");
      await expect(page.locator(".editable-slide")).toContainText("Stage B");
      await expect(page.locator(".editable-slide")).toContainText(
        "Native SmartArt neighbor edited",
      );
      await page.screenshot({
        path: path.join(output, "smartart-reopened.png"),
      });
      results.push("native-smartart-reopen");
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(output, "results.json"),
      JSON.stringify(
        {
          results,
          errors,
          separateProfile: true,
          originalSVG: original.images,
          originalAudio: original.sounds,
          source: path.resolve(fixture),
          executable: path.resolve(executable),
        },
        null,
        2,
      ),
    );
    console.log(
      `Verified ${results.length} packaged PPTX-preservation workflows.`,
    );
  } finally {
    if (app) {
      await app
        .evaluate(({ BrowserWindow }) => {
          for (const win of BrowserWindow.getAllWindows()) win.destroy();
        })
        .catch(() => {});
      await app.close().catch(() => {});
    }
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
