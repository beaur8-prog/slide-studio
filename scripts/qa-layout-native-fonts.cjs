"use strict";
// Observe actual font faces in the production renderer with public files only.
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { _electron, expect } = require("@playwright/test");
const root = path.resolve(__dirname, "..");
const [executable, outputArg, corpus = "baseline"] = process.argv.slice(2);
assert(executable && outputArg, "Pass the packaged executable and a new qa/results directory.");
assert(["baseline", "powerpoint-pdf"].includes(corpus), "Optional corpus must be baseline or powerpoint-pdf.");
const output = path.resolve(outputArg);
assert(output.startsWith(path.join(root, "qa/results") + path.sep));
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const selected = corpus === "powerpoint-pdf" ? [
  { id: "cmu-lecture-3", slides: [1, 2, 22, 50, 75, 113, 151] },
] : [
  { id: "poi-themes", slides: [8] },
  { id: "dsu-korean", slides: [8, 14, 15, 20] },
  { id: "dickinson-workplace", slides: [6] },
];
(async () => {
  await fs.mkdir(output, { recursive: false });
  const manifest = JSON.parse(await fs.readFile(path.join(root, "qa/layout-baseline-2026-11-05.json")));
  if (corpus === "powerpoint-pdf") manifest.sources.push({
    id: "cmu-lecture-3", file: "cmu-lecture-3.pptx", slides: 151,
    sha256: "12a8a88d3e33a520c6c037debbbab47ef9a3f706dca2dbc450d7443150df03ca",
  });
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "slide-native-fonts-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; delete env.SLIDE_STUDIO_DEV;
  const report = { status: "running", corpus, startedAt: new Date().toISOString(), slides: [], errors: [],
    limitations: ["Native file-panel answers supplied by QA; original public files are not edited.",
      "Font observations belong to this Mac and fresh profile, not Microsoft's rendering environment."] };
  let app;
  try {
    app = await _electron.launch({ executablePath: path.resolve(executable), args: ["--user-data-dir=" + profile], env, timeout: 45000 });
    const page = await app.firstWindow(); page.setDefaultTimeout(20000);
    page.on("pageerror", error => report.errors.push(String(error)));
    await expect(page.locator(".save-indicator")).toHaveText("저장됨");
    report.environment = await app.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged,
      platform: process.platform, arch: process.arch, electron: process.versions.electron, chrome: process.versions.chrome }));
    report.registeredFaces = await page.evaluate(() => [...document.fonts].map(face => ({
      family: face.family, weight: face.weight, style: face.style, status: face.status,
    })));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
    for (const sample of selected) {
      const source = manifest.sources.find(row => row.id === sample.id);
      assert(source, "Public sample must be pinned in the baseline manifest");
      const file = path.join(root, "qa/samples", source.file);
      assert.equal(hash(await fs.readFile(file)), source.sha256);
      const previous = await page.locator('.editable-slide [data-element-id]').first().getAttribute("data-element-id");
      await app.evaluate(({ dialog, Menu }, filename) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
        Menu.getApplicationMenu().items.flatMap(item => item.submenu?.items || []).find(item => item.label === "Open…").click();
      }, file);
      await expect(page.locator('.editable-slide [data-element-id]').first()).not.toHaveAttribute("data-element-id", previous);
      await expect(page.locator(".thumbnail-row")).toHaveCount(source.slides);
      await expect(page.locator(".busy-backdrop")).toHaveCount(0);
      for (const slide of sample.slides) {
        await page.locator(".thumbnail-button").nth(slide - 1).click();
        await expect(page.locator(".canvas-topline")).toContainText(`${slide} / ${source.slides}`);
        await page.evaluate(async () => { await document.fonts.ready;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
        const fontNodes = await page.locator(".editable-slide").evaluate(host => {
          host.querySelectorAll("[data-qa-native-font]").forEach(node => node.removeAttribute("data-qa-native-font"));
          const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT), parents = new Set();
          while (walker.nextNode()) if (walker.currentNode.textContent.trim()) parents.add(walker.currentNode.parentElement);
          return [...parents].map((node, fontNode) => {
            node.setAttribute("data-qa-native-font", String(fontNode)); const css = getComputedStyle(node);
            return { fontNode, text: [...node.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join(""),
              cssFontFamily: css.fontFamily, cssFontWeight: css.fontWeight, cssFontStyle: css.fontStyle };
          });
        });
        const document = await cdp.send("DOM.getDocument");
        const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: document.root.nodeId,
          selector: ".editable-slide [data-qa-native-font]" });
        const actualFonts = [];
        for (const nodeId of nodeIds) {
          const { attributes } = await cdp.send("DOM.getAttributes", { nodeId });
          const fontNode = Number(attributes[attributes.indexOf("data-qa-native-font") + 1]);
          const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
          actualFonts.push({ fontNode, fonts, status: fonts.length ? "observed-via-cdp" : "not-reported" });
        }
        const image = `${sample.id}-${slide}.png`;
        await page.getByTestId("canvas-frame").screenshot({ path: path.join(output, image) });
        report.slides.push({ id: sample.id, slide, sourceSha256: source.sha256, fontNodes, actualFonts, image });
        await fs.writeFile(path.join(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
        console.log(sample.id, slide, actualFonts.length, "font parents observed");
      }
      assert.equal(hash(await fs.readFile(file)), source.sha256);
    }
    assert.deepEqual(report.errors, []); report.status = "passed";
  } catch (error) {
    report.status = "failed"; report.error = String(error.stack || error); process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
    await app?.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app?.close().catch(() => {});
    await fs.rm(profile, { recursive: true, force: true });
  }
})();
