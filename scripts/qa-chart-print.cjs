"use strict";

// Run in a disposable packaged-app profile. File dialog replies and printer
// callbacks are stubbed only in that process; PDF generation and disk I/O are real.
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { _electron } = require("playwright");
const { expect } = require("@playwright/test");
const executable = process.argv[2],
  output = path.resolve(
    process.argv[3] || "qa/results/usability-continuation/native-chart-print",
  );
if (!executable)
  throw Error(
    "Usage: node scripts/qa-chart-print.cjs <app-executable> [output-directory]",
  );

(async () => {
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(
    path.join(os.tmpdir(), "slide-chart-print-"),
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.SLIDE_STUDIO_DEV;
  const errors = [],
    results = [];
  let app;
  try {
    app = await _electron.launch({
      executablePath: path.resolve(executable),
      args: ["--user-data-dir=" + profile],
      env,
      timeout: 45000,
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => errors.push(error.message));
    await expect(page.locator(".save-indicator")).toHaveText("저장됨");
    const fixture = path.join(output, "fixture.slide");
    await fs.writeFile(
      fixture,
      JSON.stringify({
        version: 1,
        id: "chart-print",
        name: "차트와 PDF 검증",
        width: 1280,
        height: 720,
        theme: "paper",
        slides: Array.from({ length: 3 }, (_, i) => ({
          id: `slide-${i}`,
          notes: `비공개 노트 ${i}`,
          transition: "none",
          background: "#FFFFFF",
          elements: i
            ? [
                {
                  id: `title-${i}`,
                  type: "text",
                  text: `한글 출력 검증 ${i + 1}`,
                  x: 80,
                  y: 100,
                  width: 1000,
                  height: 100,
                  rotation: 0,
                  opacity: 1,
                  fontFamily: "Arial",
                  fontSize: 40,
                  color: "#112233",
                },
              ]
            : [],
        })),
      }),
    );
    const open = async (filename) => {
      await app.evaluate(({ dialog }, filename) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [filename],
        });
      }, filename);
      await page.getByRole("button", { name: "파일", exact: true }).click();
      await page
        .locator(".file-popover button")
        .filter({ hasText: "파일 열기" })
        .click();
      await expect(page.locator(".busy-backdrop")).toHaveCount(0);
      await expect(page.locator(".save-indicator")).toHaveText("저장됨");
    };
    await open(fixture);
    await expect(page.locator(".thumbnail-row")).toHaveCount(3);
    await expect(page.locator(".print-slide")).toHaveCount(0);
    await page.getByRole("button", { name: "삽입", exact: true }).click();
    await page.getByRole("button", { name: "차트", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "차트 삽입", exact: true });
    await dialog.getByLabel("차트 제목").fill("분기별 매출");
    await dialog
      .getByLabel("차트 데이터", { exact: true })
      .fill("항목,값\n1분기,35\n2분기,80\n3분기,50");
    await dialog.getByRole("button", { name: "삽입", exact: true }).click();
    const chart = page.locator('.editable-slide [data-type="chart"]');
    await chart.dblclick();
    const editor = page.getByRole("dialog", {
      name: "차트 데이터 편집",
      exact: true,
    });
    await editor
      .getByLabel("차트 데이터", { exact: true })
      .fill("항목,값\n1분기,35\n2분기,120\n3분기,75");
    await editor.getByRole("button", { name: "꺾은선", exact: true }).click();
    await editor.getByRole("button", { name: "적용", exact: true }).click();
    await expect(chart.locator("[data-chart-line]")).toHaveCount(1);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(chart.locator("[data-chart-bar]")).toHaveCount(3);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(chart.locator("[data-chart-line]")).toHaveCount(1);
    results.push("chart-insert-edit-undo-redo");
    const pptx = path.join(output, "native-chart.pptx");
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, pptx);
    await page.getByRole("button", { name: "PPTX 저장", exact: true }).click();
    await expect(page.locator(".toast")).toContainText(
      "PPTX 파일을 저장했습니다",
    );
    assert((await fs.stat(pptx)).size > 1000);
    await open(pptx);
    await chart.dblclick();
    await expect(
      editor.getByLabel("차트 데이터", { exact: true }),
    ).toContainText('"2분기",120');
    await expect(
      editor.getByRole("button", { name: "꺾은선", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({ path: path.join(output, "chart-reopened.png") });
    await editor.getByRole("button", { name: "취소", exact: true }).click();
    results.push("native-pptx-save-reopen-edit");
    const pdf = path.join(output, "native-chart.pdf");
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, pdf);
    const pdfResult = await page.evaluate(() =>
      window.desktop.exportPDF("차트 출력"),
    );
    assert.equal(pdfResult, pdf);
    assert((await fs.stat(pdf)).size > 1000);
    await expect(page.locator(".print-slide")).toHaveCount(0);
    results.push("native-pdf-and-print-dom-release");
    // Check cleanup on every native print callback outcome without requiring a
    // printer or opening a system print sheet on the user's desktop.
    for (const outcome of ["success", "cancelled", "failure"]) {
      await app.evaluate(({ BrowserWindow }, outcome) => {
        const contents = BrowserWindow.getAllWindows()[0].webContents;
        contents.print = (_options, callback) =>
          callback(
            outcome === "success",
            outcome === "cancelled" ? "cancelled" : "test printer unavailable",
          );
      }, outcome);
      const result = await page.evaluate(async () => {
        try {
          return { value: await window.desktop.print() };
        } catch (error) {
          return { error: String(error) };
        }
      });
      if (outcome === "success") assert.equal(result.value, true);
      else if (outcome === "cancelled") assert.equal(result.value, false);
      else assert.match(result.error, /test printer unavailable/);
      await expect(page.locator(".print-slide")).toHaveCount(0);
      results.push("print-" + outcome + "-releases-dom");
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(output, "results.json"),
      JSON.stringify(
        { results, errors, separateProfile: true, nativePdfPagesExpected: 3 },
        null,
        2,
      ),
    );
    console.log(
      `Verified ${results.length} packaged chart/print workflows; ${pdf}`,
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
