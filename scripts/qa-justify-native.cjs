"use strict";
// Production renderer, real menu/preload/IPC/filesystem and disposable documents.
// Only native file-panel answers are supplied; no personal profile is opened.
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { _electron, expect } = require("@playwright/test");
const JSZip = require("jszip");

const root = path.resolve(__dirname, "..");
const [executable, outputArg] = process.argv.slice(2);
if (!executable) throw Error("Usage: node scripts/qa-justify-native.cjs <app-executable> [output]");
const output = path.resolve(outputArg || "qa/results/justify-native");
const fixture = path.join(root, "tests/fixtures/justify/paragraph-justify-source.pptx");
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");

(async () => {
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "slide-justify-native-"));
  const originalHash = sha256(await fs.readFile(fixture));
  const results = [], errors = [], saved = [];
  let app;
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
    page.on("pageerror", error => errors.push(String(error)));
    await expect(page.locator(".save-indicator")).toHaveText("저장됨");
    const environment = await app.evaluate(({ app }) => ({
      version: app.getVersion(), platform: process.platform, architecture: process.arch,
      electron: process.versions.electron, chrome: process.versions.chrome,
      appPath: app.getAppPath(), packaged: app.isPackaged,
    }));
    assert.equal(environment.version, require("../package.json").version);
    await app.evaluate(({ dialog }) => {
      global.__justifyQA = { open: [], save: [], seen: [] };
      dialog.showOpenDialog = async () => {
        global.__justifyQA.seen.push("open");
        return global.__justifyQA.open.shift() || { canceled: true, filePaths: [] };
      };
      dialog.showSaveDialog = async () => {
        global.__justifyQA.seen.push("save");
        return global.__justifyQA.save.shift() || { canceled: true };
      };
      dialog.showMessageBox = async () => ({ response: 2 });
    });
    const menu = label => app.evaluate(({ Menu }, label) => {
      const item = Menu.getApplicationMenu().items.flatMap(i => i.submenu?.items || []).find(i => i.label === label);
      if (!item) throw Error("Missing native menu " + label);
      item.click();
    }, label);
    const queue = (kind, reply) => app.evaluate((_, value) => {
      global.__justifyQA[value.kind].push(value.reply);
    }, { kind, reply });
    const idle = async () => {
      await expect(page.locator(".busy-backdrop")).toHaveCount(0);
      await expect(page.locator(".save-indicator")).toHaveText("저장됨");
    };
    const open = async file => {
      const count = await app.evaluate(() => global.__justifyQA.seen.length);
      await queue("open", { canceled: false, filePaths: [file] });
      await menu("Open…");
      await expect.poll(() => app.evaluate(() => global.__justifyQA.seen.length)).toBe(count + 1);
      await expect(page.locator(".thumbnail-row")).toHaveCount(5);
      await idle();
    };
    const english = () => page.locator('.editable-slide [data-type="text"]').filter({ hasText: "Alpha teams compare" });
    const alignments = () => english().evaluateAll(nodes => nodes.map(node =>
      getComputedStyle(node.querySelector("[data-text-line]") || node.querySelector(".element-text") || node).textAlign,
    ));
    await open(fixture);
    await expect.poll(alignments).toEqual(["left", "justify"]);
    results.push("production-import-keeps-direct-justification");
    await english().first().dblclick();
    const editor = page.getByRole("textbox", { name: "슬라이드 텍스트 편집", exact: true });
    await editor.evaluate(host => {
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode, start = node.textContent.indexOf("spacing");
        if (start >= 0) {
          getSelection().setBaseAndExtent(node, start, node, start + 7);
          return;
        }
      }
      throw Error("Synthetic selection text missing");
    });
    const justify = page.getByRole("button", { name: "양쪽 맞춤", exact: true });
    await justify.click();
    await expect(editor).toBeFocused();
    assert.equal(await page.evaluate(() => getSelection().toString()), "spacing");
    await expect.poll(alignments).toEqual(["justify", "justify"]);
    await menu("Undo");
    await expect.poll(alignments).toEqual(["left", "justify"]);
    await menu("Redo");
    await expect.poll(alignments).toEqual(["justify", "justify"]);
    await justify.click();
    await menu("Undo");
    await expect.poll(alignments).toEqual(["left", "justify"]);
    await menu("Redo");
    await expect.poll(alignments).toEqual(["justify", "justify"]);
    results.push("native-menu-undo-redo-and-noop-preserve-selection-and-alignment");
    await editor.press("Escape");
    for (let round = 1; round <= 3; round++) {
      const file = path.join(output, `paragraph-justify-save-${round}.pptx`);
      await queue("save", { canceled: false, filePath: file });
      await menu("Save PowerPoint As…");
      await expect.poll(async () => !!(await fs.stat(file).catch(() => null))).toBe(true);
      await idle();
      const bytes = await fs.readFile(file), zip = await JSZip.loadAsync(bytes);
      const xml = await zip.file("ppt/slides/slide1.xml").async("string");
      const paragraphs = [...xml.matchAll(/<a:p(?:\s[^>]*)?>[\s\S]*?<\/a:p>/g)]
        .map(match => match[0]).filter(p => p.includes("Alpha teams compare"));
      assert.equal(paragraphs.length, 2);
      assert(paragraphs.every(p => /<a:pPr\b[^>]*\balgn="just"/.test(p)), "Both saved English paragraphs must use standard just");
      saved.push({ round, file: path.basename(file), bytes: bytes.length, sha256: sha256(bytes) });
      await open(file);
      await expect.poll(alignments).toEqual(["justify", "justify"]);
    }
    results.push("three-native-save-as-and-reopen-cycles-retain-standard-just");
    const pdf = path.join(output, "paragraph-justify.pdf");
    await queue("save", { canceled: false, filePath: pdf });
    await menu("Export PDF…");
    await expect.poll(async () => !!(await fs.stat(pdf).catch(() => null))).toBe(true);
    await idle();
    assert((await fs.readFile(pdf)).subarray(0, 5).equals(Buffer.from("%PDF-")));
    results.push("production-pdf-output-completes-after-justification");

    await page.getByRole("button", { name: "도형", exact: true }).click();
    await page.getByRole("button", { name: "사각형", exact: true }).click();
    const shape = page.locator('.editable-slide [data-type="shape"].selected');
    const shapeId = await shape.getAttribute("data-element-id");
    const readShape = () => page.evaluate(id => new Promise((resolve, reject) => {
      const request = indexedDB.open("slide-studio", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const read = db.transaction("documents").objectStore("documents").get("current");
        read.onerror = () => { db.close(); reject(read.error); };
        read.onsuccess = async () => {
          const record = read.result;
          db.close();
          try {
            const deck = record?.format === "slide-studio-recovery-json"
              ? JSON.parse(await record.data.text()) : record;
            resolve(deck?.slides[0].elements.find(item => item.id === id));
          } catch (error) { reject(error); }
        };
      };
    }), shapeId);
    await shape.dblclick();
    await editor.press("ControlOrMeta+A");
    await editor.pressSequentially("Alpha");
    await expect.poll(async () => (await readShape())?.text).toBe("Alpha");
    const geometry = value => Object.fromEntries(
      ["type", "shape", "x", "y", "width", "height", "fill", "stroke", "strokeWidth"]
        .map(key => [key, value[key]]),
    );
    const originalShape = geometry(await readShape());
    // Start a fresh editor session with Alpha as its initial content, so the
    // first measured typing action cannot coalesce with fixture preparation.
    await editor.press("Escape");
    await shape.dblclick();
    await editor.press("ArrowRight");
    for (let index = 0; index < 14; index++) {
      await editor.pressSequentially(` ${index}`);
      await page.getByRole("button", {
        name: index % 2 === 0 ? "양쪽 맞춤" : "왼쪽 정렬", exact: true,
      }).click();
    }
    for (let index = 0; index < 28; index++) {
      await menu("Undo");
      const live = await editor.evaluate(host =>
        getComputedStyle(host.querySelector("[data-text-line]") || host).textAlign,
      );
      await expect.poll(async () => {
        const item = await readShape();
        return item?.paragraphs?.[0]?.align ?? item?.align ?? "left";
      }, { message: `Native shape Undo ${index + 1} must agree with saved alignment` }).toBe(live);
    }
    assert.deepEqual(geometry(await readShape()), originalShape);
    await justify.click();
    await editor.press("Escape");
    await expect(justify).toHaveAttribute("aria-pressed", "true");
    const shapeFile = path.join(output, "shape-justify-save.pptx");
    await queue("save", { canceled: false, filePath: shapeFile });
    await menu("Save PowerPoint As…");
    await expect.poll(async () => !!(await fs.stat(shapeFile).catch(() => null))).toBe(true);
    await idle();
    const shapeBytes = await fs.readFile(shapeFile), shapeZip = await JSZip.loadAsync(shapeBytes);
    const shapeXml = await shapeZip.file("ppt/slides/slide1.xml").async("string");
    const savedShape = [...shapeXml.matchAll(/<p:sp(?:\s[^>]*)?>[\s\S]*?<\/p:sp>/g)]
      .map(match => match[0]).find(xml => /<a:t>Alpha<\/a:t>/.test(xml));
    assert(savedShape && /<a:prstGeom\b[^>]*\bprst="rect"/.test(savedShape));
    assert(/<a:pPr\b[^>]*\balgn="just"/.test(savedShape));
    saved.push({ kind: "shape", file: path.basename(shapeFile), bytes: shapeBytes.length, sha256: sha256(shapeBytes) });
    await open(shapeFile);
    const reopenedShape = page.locator('.editable-slide [data-type="shape"]').filter({ hasText: /^Alpha$/ });
    await expect(reopenedShape).toHaveCount(1);
    await expect(reopenedShape.locator("[data-text-line]")).toHaveCSS("text-align", "justify");
    results.push("shape-long-native-undo-keeps-visual-and-saved-alignment-geometry-and-roundtrip");
    assert.equal(sha256(await fs.readFile(fixture)), originalHash);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, "finished.png") });
    await fs.writeFile(path.join(output, "results.json"), JSON.stringify({
      status: "passed", completedAt: new Date().toISOString(), environment, results, saved, errors,
      originalFixtureSha256: originalHash,
      limitations: ["Native file-panel responses were supplied by QA.", "No live Microsoft PowerPoint verification or physical printer test."],
    }, null, 2) + "\n");
    console.log(JSON.stringify({ status: "passed", results }));
  } catch (error) {
    await (await app?.firstWindow())?.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    await fs.writeFile(path.join(output, "failure.json"), JSON.stringify({ error: String(error.stack || error), results, errors }, null, 2));
    throw error;
  } finally {
    // Only the isolated QA process/profile is closed; the user's app is untouched.
    await app?.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app?.close().catch(() => {});
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
