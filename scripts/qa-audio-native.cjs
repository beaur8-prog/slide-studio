"use strict";
// Installed-bundle QA in a disposable profile. Only native file-dialog answers
// are mocked; playback, production CSP, document I/O and PDF are real.
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto"),
  JSZip = require("jszip");
const { _electron } = require("playwright"),
  { expect } = require("@playwright/test");
const waitDocumentOpen = require("./qa-wait-document-open.cjs");
const [executable, source, directory] = process.argv.slice(2);
if (!executable || !source)
  throw Error(
    "Usage: node scripts/qa-audio-native.cjs <app-executable> <fixture.pptx> [output]",
  );
const output = path.resolve(directory || "qa/results/native-audio"),
  hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
async function mediaHashes(file) {
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  return [
    ...new Set(
      await Promise.all(
        Object.values(zip.files)
          .filter((f) => !f.dir && /\.(mp3|wav|m4a)$/.test(f.name))
          .map(async (f) => hash(await f.async("nodebuffer"))),
      ),
    ),
  ].sort();
}
(async () => {
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "slide-audio-qa-")),
    env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.SLIDE_STUDIO_DEV;
  let app;
  const results = [],
    errors = [],
    securityErrors = [];
  try {
    app = await _electron.launch({
      executablePath: path.resolve(executable),
      args: [
        ...(env.QA_APP_ROOT ? [path.resolve(env.QA_APP_ROOT)] : []),
        "--user-data-dir=" + profile,
        "--mute-audio",
        ...(process.platform === "linux" && env.QA_NO_SANDBOX === "1"
          ? ["--no-sandbox"]
          : []),
      ],
      env,
      timeout: 45000,
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (/Content Security Policy|Refused to.*media/.test(m.text()))
        securityErrors.push(m.text());
    });
    page.on("dialog", (dialog) => dialog.accept());
    await expect(page.locator(".save-indicator")).toHaveText("저장됨", {
      timeout: 20000,
    });
    const open = async (file, expectedTitle = "오디오와 한글 제목", expectedSlides = 5) => {
      await app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [file],
        });
      }, path.resolve(file));
      await page.getByRole("button", { name: "파일", exact: true }).click();
      await waitDocumentOpen(page, () =>
        page
          .locator(".file-popover button")
          .filter({ hasText: "파일 열기" })
          .click(),
      );
      await expect(page.locator(".thumbnail-button")).toHaveCount(expectedSlides);
      await expect(page.locator(".editable-slide")).toContainText(
        expectedTitle,
      );
    };
    await open(source);
    results.push("native-open-5-slides-MP3-AAC-WAV");
    const title = page.locator('.editable-slide [data-type="text"]').first();
    await title.dblclick();
    const editor = page.getByRole("textbox", {
      name: "슬라이드 텍스트 편집",
      exact: true,
    });
    await editor.press("ControlOrMeta+a");
    await page.keyboard.insertText("설치형 오디오·한글 검증");
    await page.getByRole("button", { name: "글자 크게", exact: true }).click();
    await expect(
      page.getByRole("spinbutton", { name: "글자 크기", exact: true }),
    ).toHaveValue("26");
    await page.locator(".canvas-topline").click();
    await page.getByRole("button", { name: "실행 취소", exact: true }).click();
    await page.getByRole("button", { name: "다시 실행", exact: true }).click();
    results.push("native-Korean-font-points-undo-redo");
    const saved = path.join(output, "native-audio-saved.pptx");
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, saved);
    await page.getByRole("button", { name: "파일", exact: true }).click();
    await page
      .locator(".file-popover")
      .getByRole("button", { name: /^다른 이름으로 저장/ })
      .click();
    await expect(page.locator(".toast")).toContainText(
      "PPTX 파일을 저장했습니다",
    );
    assert.deepEqual(await mediaHashes(saved), await mediaHashes(source));
    results.push("native-save-all-original-audio-hashes");
    const show = page.getByTestId("presentation-view"),
      audio = () => show.locator("audio[data-audio-id]");
    await page.keyboard.press("F5");
    await expect
      .poll(() => audio().evaluate((a) => a.currentTime))
      .toBeGreaterThan(0.15);
    const original = await audio().elementHandle(),
      at = await audio().evaluate((a) => a.currentTime);
    await page.keyboard.press("ArrowRight");
    await expect(show).toHaveAttribute("aria-label", "발표 슬라이드 2 / 5");
    assert(
      await original.evaluate(
        (a) => a === document.querySelector("audio[data-audio-id]"),
      ),
    );
    await expect
      .poll(() => audio().evaluate((a) => a.currentTime))
      .toBeGreaterThan(at);
    results.push("native-MP3-across-slides-without-restart");
    await page.keyboard.press("b");
    await expect.poll(() => audio().evaluate((a) => a.paused)).toBe(true);
    await page.keyboard.press("b");
    await expect.poll(() => audio().evaluate((a) => a.paused)).toBe(false);
    results.push("native-blackout-pause-resume");
    await page.keyboard.press("ArrowRight");
    await expect(show).toHaveAttribute("aria-label", "발표 슬라이드 3 / 5");
    await expect(audio()).toHaveCount(1);
    assert(
      await original.evaluate(
        (a) => a.paused && a.getAttribute("src") === null,
      ),
    );
    await expect.poll(() => audio().evaluate((a) => a.paused)).toBe(true);
    await show
      .getByRole("button", { name: "재생: AAC 수동 소리", exact: true })
      .click();
    await expect
      .poll(() => audio().evaluate((a) => a.currentTime))
      .toBeGreaterThan(0.1);
    results.push("native-AAC-manual-playback");
    await show.focus();
    await page.keyboard.press("ArrowRight");
    await expect(show).toHaveAttribute("aria-label", "발표 슬라이드 4 / 5");
    await expect
      .poll(() => audio().evaluate((a) => a.currentTime))
      .toBeGreaterThan(0.1);
    results.push("native-WAV-auto-playback");
    await page.keyboard.press("Escape");
    await expect(show).toHaveCount(0);
    await expect(page.locator("audio[data-audio-id]")).toHaveCount(0);
    results.push("native-show-exit-releases-players");
    // Reopen the exact disk output, rather than relying on the window buffer.
    await open(saved, "설치형 오디오·한글 검증");
    await expect(page.locator(".editable-slide")).toContainText(
      "설치형 오디오·한글 검증",
    );
    results.push("native-reopen-saved-disk-content");
    const pdf = path.join(output, "native-audio.pdf");
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, pdf);
    assert.equal(
      await page.evaluate(() => window.desktop.exportPDF("오디오 검수")),
      pdf,
    );
    assert((await fs.stat(pdf)).size > 1000);
    await expect(page.locator(".print-slide")).toHaveCount(0);
    await expect(page.locator("audio[data-audio-id]")).toHaveCount(0);
    results.push("native-PDF-with-still-icons-no-playback");
    await page.screenshot({ path: path.join(output, "reopened.png") });
    // Audio is a new editable object type. Check that cloning it and its
    // containing slide preserves independent IDs and native media on disk.
    const audioObjects = page.locator('.editable-slide [data-type="audio"]');
    await audioObjects.first().click();
    await page.keyboard.press("ControlOrMeta+d");
    await expect(audioObjects).toHaveCount(2);
    const nativeHistory = (label) => app.evaluate(({ Menu, BrowserWindow }, label) => {
      const item = Menu.getApplicationMenu().items.find(i => i.label === 'Edit')
        .submenu.items.find(i => i.label === label);
      item.click(item, BrowserWindow.getAllWindows()[0], {});
    }, label);
    await nativeHistory('Undo');
    await expect(audioObjects).toHaveCount(1);
    await nativeHistory('Redo');
    await expect(audioObjects).toHaveCount(2);
    results.push("native-audio-object-duplicate-menu-undo-redo");
    await page.locator('.thumbnail-button').first().click();
    await page.keyboard.press("ControlOrMeta+Shift+d");
    await expect(page.locator('.thumbnail-button')).toHaveCount(6);
    await nativeHistory('Undo');
    await expect(page.locator('.thumbnail-button')).toHaveCount(5);
    await nativeHistory('Redo');
    await expect(page.locator('.thumbnail-button')).toHaveCount(6);
    results.push("native-audio-slide-duplicate-menu-undo-redo");
    const copied = path.join(output, 'native-audio-duplicated.pptx');
    await fs.rm(copied, { force: true });
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, copied);
    await page.getByRole('button', { name: '파일', exact: true }).click();
    await page.locator('.file-popover').getByRole('button', { name: /^다른 이름으로 저장/ }).click();
    await expect.poll(() => fs.stat(copied).then(s => s.size, () => 0)).toBeGreaterThan(1000);
    assert.deepEqual(await mediaHashes(copied), await mediaHashes(source));
    const copiedZip = await JSZip.loadAsync(await fs.readFile(copied));
    for (const number of [1, 2]) {
      const xml = await copiedZip.file(`ppt/slides/slide${number}.xml`).async('string');
      assert.equal((xml.match(/<a:audioFile\b/g) || []).length, 2);
      const ids = [...xml.matchAll(/<p:cNvPr\b[^>]*\bid="(\d+)"/g)].map(m => m[1]);
      assert.equal(new Set(ids).size, ids.length, 'duplicate native shape IDs');
    }
    results.push("native-duplicated-audio-media-hashes-and-unique-shape-ids");
    await open(copied, '설치형 오디오·한글 검증', 6);
    await expect(audioObjects).toHaveCount(2);
    await page.locator('.thumbnail-button').nth(1).click();
    await expect(audioObjects).toHaveCount(2);
    results.push("native-reopen-duplicated-audio-objects-and-slides");
    assert.deepEqual(errors, []);
    assert.deepEqual(securityErrors, []);
    const report = {
      executable: path.resolve(executable),
      source: path.resolve(source),
      results,
      errors,
      securityErrors,
      saved,
      pdf,
      duplicated: copied,
    };
    await fs.rm(path.join(output, "failure.json"), { force: true });
    await fs.writeFile(
      path.join(output, "results.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(JSON.stringify(report, null, 2));
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
