"use strict";

// Run packaged renderer and file IPC in a disposable profile. Mocked dialog
// replies apply only to this QA process. The user's app/profile is untouched.
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { _electron } = require("playwright");
const output = path.resolve(process.argv[2] || "qa/results/usability/native");
const executable = process.argv[3];
if (!executable)
  throw new Error(
    "Usage: node scripts/qa-usability.cjs <output-directory> <app-executable>",
  );
const item = (id, type, extra = {}) => ({
  id,
  type,
  x: 60,
  y: 60,
  width: 300,
  height: 100,
  rotation: 0,
  opacity: 1,
  ...extra,
});
const text = (id, value, extra = {}) =>
  item(id, "text", {
    text: value,
    fontFamily: "Arial",
    fontSize: 30,
    color: "#112233",
    align: "left",
    verticalAlign: "top",
    ...extra,
  });
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8C8AAAAASUVORK5CYII=";
const fixture = {
  version: 1,
  id: crypto.randomUUID(),
  name: "사용성 통합 검증",
  width: 1280,
  height: 720,
  theme: "paper",
  slides: Array.from({ length: 27 }, (_, i) => ({
    id: crypto.randomUUID(),
    background: "#FFFFFF",
    notes: `한글 노트 ${i + 1}`,
    transition: "none",
    elements: [
      text(`title-${i}`, `공통검색어 ${i + 1}`, {
        x: 60,
        y: 40,
        width: 700,
        bold: true,
        italic: true,
        color: "#CC3322",
        fontSize: 32,
      }),
      text(`body-${i}`, "Alpha Beta", { x: 60, y: 190, width: 650 }),
      item(`shape-${i}`, "shape", {
        name: "테두리 도형",
        x: 840,
        y: 220,
        width: 230,
        height: 180,
        shape: "ellipse",
        fill: "#224488",
        stroke: "#CC5522",
        strokeWidth: 4,
      }),
      item(`image-${i}`, "image", {
        name: "원본 그림",
        x: 820,
        y: 450,
        width: 300,
        height: 170,
        src: png,
        crop: [0, 0.1, 0, 0.1],
      }),
      item(`table-${i}`, "table", {
        x: 60,
        y: 380,
        width: 600,
        height: 140,
        table: {
          cells: [
            ["표전용검색어", "분기"],
            ["Beta", "100"],
          ],
          header: true,
          striped: false,
          headerFill: "#224488",
          headerColor: "#FFFFFF",
          fill: "#FFFFFF",
          stripeFill: "#EEEEEE",
          color: "#112233",
          borderColor: "#112233",
          borderWidth: 1,
          fontFamily: "Arial",
          fontSize: 24,
          padding: 8,
          align: "left",
          verticalAlign: "middle",
        },
      }),
    ],
  })),
};

(async () => {
  await fs.mkdir(output, { recursive: true });
  const raster = await require("sharp")(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#224488"/><circle cx="160" cy="90" r="64" fill="#F2B040"/><path d="M0 90H320M160 0V180" stroke="#FFFFFF" stroke-width="4"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  for (const slide of fixture.slides)
    slide.elements.find((e) => e.type === "image").src =
      "data:image/png;base64," + raster.toString("base64");
  const fixturePath = path.join(output, "fixture.slide"),
    pptxPath = path.join(output, "usability-roundtrip.pptx");
  await fs.writeFile(fixturePath, JSON.stringify(fixture));
  const profile = await fs.mkdtemp(
    path.join(os.tmpdir(), "slide-usability-native-"),
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
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBoxSync = () => 1;
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    page.on("pageerror", (error) => errors.push(error.message));
    const current = async () => {
      await page.waitForFunction(
        () =>
          document.querySelector(".save-indicator")?.textContent === "저장됨",
      );
      return page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const open = indexedDB.open("slide-studio", 1);
            open.onsuccess = () => {
              const db = open.result,
                request = db
                  .transaction("documents")
                  .objectStore("documents")
                  .get("current");
              request.onsuccess = () => {
                resolve(request.result);
                db.close();
              };
              request.onerror = () => reject(request.error);
            };
            open.onerror = () => reject(open.error);
          }),
      );
    };
    const openFile = async (filename) => {
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
      await page.waitForFunction(
        () => document.querySelectorAll(".thumbnail-row").length === 27,
      );
    };
    const check = async (name, run) => {
      const start = Date.now();
      await run();
      results.push({ name, passed: true, elapsedMs: Date.now() - start });
      console.log("PASS " + name);
    };
    const object = (id) =>
      page.locator(`.editable-slide [data-element-id="${id}"]`);
    await current();
    await openFile(fixturePath);
    await check("table-search-and-all-27-quick-results", async () => {
      await page
        .getByRole("button", { name: "명령 및 슬라이드 검색", exact: true })
        .click();
      await page
        .getByRole("combobox", { name: "명령 검색어" })
        .fill("공통검색어");
      await page.waitForFunction(
        () =>
          document.querySelectorAll('.command-results [role="option"]')
            .length === 27,
      );
      await page.keyboard.press("Escape");
      await page.keyboard.press("Meta+f");
      const panel = page.getByRole("complementary", { name: "찾기 및 바꾸기" });
      await panel
        .getByRole("textbox", { name: "찾을 내용", exact: true })
        .fill("표전용검색어");
      await page.waitForFunction(() =>
        document
          .querySelector('.find-replace-panel [role="status"]')
          ?.textContent.includes("27개"),
      );
      await page.screenshot({ path: path.join(output, "table-search.png") });
      await panel
        .getByRole("textbox", { name: "찾을 내용", exact: true })
        .press("Escape");
    });
    await check("tab-select-and-object-format-shortcut", async () => {
      await object("title-0").click();
      await page.keyboard.press("Tab");
      assert(
        (await object("body-0").getAttribute("class")).includes("selected"),
      );
      await page.keyboard.press("Meta+b");
      assert.equal(
        (await current()).slides[0].elements.find((e) => e.id === "body-0")
          .bold,
        true,
      );
      await page.keyboard.press("Meta+z");
    });
    await check("partial-format-painter-and-native-undo-redo", async () => {
      await object("title-0").click();
      await page.keyboard.press("Meta+Shift+c");
      await page.keyboard.press("Escape");
      await object("body-0").dblclick();
      await page.locator(".editing-text").evaluate((host) => {
        const node = document
          .createTreeWalker(host, NodeFilter.SHOW_TEXT)
          .nextNode();
        getSelection().setBaseAndExtent(node, 6, node, 10);
      });
      await page.keyboard.press("Meta+Shift+v");
      const styles = async () => {
        const e = (await current()).slides[0].elements.find(
          (e) => e.id === "body-0",
        );
        return (
          e.paragraphs?.flatMap((p) =>
            p.runs.flatMap((r) =>
              [...r.text].map(() => r.italic ?? e.italic ?? false),
            ),
          ) ?? Array(10).fill(false)
        );
      };
      assert.deepEqual(await styles(), [
        ...Array(6).fill(false),
        ...Array(4).fill(true),
      ]);
      assert.equal(
        await page.evaluate(() => getSelection()?.toString()),
        "Beta",
      );
      await page.keyboard.press("Meta+z");
      assert.deepEqual(await styles(), Array(10).fill(false));
      await page.keyboard.press("Meta+Shift+z");
      assert.deepEqual(await styles(), [
        ...Array(6).fill(false),
        ...Array(4).fill(true),
      ]);
      await page.keyboard.press("Escape");
    });
    await check("layer-rename-hide-show-and-image-crop", async () => {
      await page.keyboard.press("Alt+F10");
      await page
        .getByRole("treeitem", { name: "테두리 도형", exact: true })
        .click();
      await page.keyboard.press("F2");
      await page
        .getByRole("textbox", { name: "개체 이름", exact: true })
        .fill("저장할 도형");
      await page.keyboard.press("Enter");
      await page
        .getByRole("button", { name: "저장할 도형 숨기기", exact: true })
        .click();
      assert.equal(await object("shape-0").count(), 0);
      await page
        .getByRole("button", { name: "저장할 도형 표시", exact: true })
        .click();
      await page.screenshot({ path: path.join(output, "layers.png") });
      await page
        .getByRole("button", { name: "서식 패널 닫기", exact: true })
        .click();
      await object("image-0").click();
      await page
        .getByRole("button", { name: "그림 자르기", exact: true })
        .first()
        .click();
      const dialog = page.getByRole("dialog", {
        name: "그림 자르기",
        exact: true,
      });
      await dialog.waitFor();
      await page.screenshot({ path: path.join(output, "crop.png") });
      await dialog.getByRole("button", { name: "취소", exact: true }).click();
      await page.keyboard.press("Alt+F10");
      await page
        .getByRole("button", { name: "저장할 도형 숨기기", exact: true })
        .click();
      await page
        .getByRole("button", { name: "서식 패널 닫기", exact: true })
        .click();
    });
    await check("native-pptx-save-and-reopen", async () => {
      await app.evaluate(({ dialog }, pptxPath) => {
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: pptxPath,
        });
      }, pptxPath);
      const before = await current();
      await page
        .getByRole("button", { name: "PPTX 저장", exact: true })
        .click();
      await page.waitForFunction(
        () => sessionStorage.getItem("slide-studio-file-dirty") === "false",
      );
      assert((await fs.stat(pptxPath)).size > 1000);
      await openFile(pptxPath);
      await page.waitForFunction(
        () =>
          document
            .querySelector(".editable-slide")
            ?.textContent?.includes("Alpha Beta") &&
          !document.querySelector('.editable-slide [data-element-id="body-0"]'),
      );
      const after = await current();
      assert.equal(after.slides.length, 27);
      assert.equal(
        after.slides[0].elements.length,
        before.slides[0].elements.length,
      );
      assert(
        after.slides[0].elements.some(
          (e) => e.name === "저장할 도형" && e.hidden,
        ),
      );
      const body = after.slides[0].elements.find(
        (e) => e.text === "Alpha Beta",
      );
      assert.deepEqual(
        body.paragraphs.flatMap((p) =>
          p.runs.flatMap((r) =>
            [...r.text].map(() => r.italic ?? body.italic ?? false),
          ),
        ),
        [...Array(6).fill(false), ...Array(4).fill(true)],
      );
      await page.screenshot({ path: path.join(output, "reopened.png") });
    });
    await check("native-pdf-export-after-reopen", async () => {
      const pdfPath = path.join(output, "native-print.pdf");
      await app.evaluate(({ dialog }, pdfPath) => {
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: pdfPath,
        });
      }, pdfPath);
      await page.getByRole("button", { name: "파일", exact: true }).click();
      await page
        .locator(".file-popover button")
        .filter({ hasText: "PDF 내보내기" })
        .click();
      await page.waitForFunction(() =>
        document
          .querySelector(".toast")
          ?.textContent?.includes("PDF 파일을 저장했습니다."),
      );
      assert((await fs.stat(pdfPath)).size > 1000);
    });
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(output, "results.json"),
      JSON.stringify(
        {
          version: await app.evaluate(({ app }) => app.getVersion()),
          profileDisposable: true,
          originalUserWindowTouched: false,
          results,
          errors,
        },
        null,
        2,
      ),
    );
    console.log(`Verified ${results.length} native workflows; ${pptxPath}`);
  } finally {
    if (app) {
      await app
        .evaluate(({ BrowserWindow }) => {
          for (const window of BrowserWindow.getAllWindows()) window.destroy();
        })
        .catch(() => {});
      await app.close().catch(() => {});
    }
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
