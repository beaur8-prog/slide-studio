// Separate Playwright actionability/scroll waits from input-to-painted-slide time.
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium, expect } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "..");
const [outArg, sampleArg, beforeUrl, afterUrl] = process.argv.slice(2);
assert(outArg && sampleArg && beforeUrl && afterUrl);
const output = path.resolve(outArg), sample = path.resolve(sampleArg);
assert(output.startsWith(path.join(root, "qa/results") + path.sep));
assert(sample.startsWith(path.join(root, "qa/results") + path.sep));
for (const address of [beforeUrl, afterUrl]) {
  const url = new URL(address);
  assert(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname));
}
await fs.mkdir(output, { recursive: false });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const sha256 = hash(await fs.readFile(sample));
const report = { startedAt: new Date().toISOString(), sampleSha256: sha256,
  sourceCommits: { before: "fd5a04cd77b49e70de5d1734f814e97a41b0e856", after: "b49c00cfd8de01c2bd01e8152e218129febb224d" },
  status: "running", runs: [], limitations: [
    "One fresh profile per version, ten navigation cycles; diagnostic, not an independent ten-profile performance distribution.",
    "Input-to-paint includes one commit frame, current-slide image decoding, and two further animation frames; this is not isolated JavaScript execution time.",
  ] };
const browser = await chromium.launch({ channel: "chrome" });
try {
  for (const [variant, url] of [["before", beforeUrl], ["after", afterUrl]]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage(); page.setDefaultTimeout(90000);
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(url);
    await page.locator('input[type=file][accept*=".pptx"]').setInputFiles(sample);
    await expect(page.locator(".thumbnail-row")).toHaveCount(300);
    await expect(page.locator(".busy-backdrop")).toHaveCount(0);
    await expect(page.locator(".save-indicator")).toHaveText("저장됨");
    await page.evaluate(() => {
      window.__navigationObservations = [];
      document.addEventListener("click", event => {
        const button = event.target.closest?.(".thumbnail-button");
        if (!button) return;
        const record = { id: button.dataset.slideId, eventAt: performance.now() };
        window.__navigationObservations.push(record);
        requestAnimationFrame(async () => {
          await Promise.all([...document.querySelectorAll(".editable-slide img")].map(image => image.decode().catch(() => {})));
          requestAnimationFrame(() => requestAnimationFrame(() => {
            record.paintedAt = performance.now();
            record.active = document.querySelector('.thumbnail-button[aria-current="true"]')?.dataset.slideId;
          }));
        });
      }, true);
    });
    for (let repeat = 1; repeat <= 10; repeat++) {
      for (const [label, index] of [["first-to-last", 299], ["last-to-middle", 150], ["middle-to-first", 0]]) {
        const target = page.locator(".thumbnail-button").nth(index);
        const id = await target.getAttribute("data-slide-id");
        const from = await page.evaluate(() => performance.now());
        const start = performance.now(); await target.click();
        const clicked = performance.now();
        await expect(page.locator(".canvas-topline")).toContainText(`${index + 1} / 300`);
        await page.waitForFunction(id => window.__navigationObservations.at(-1)?.active === id, id);
        const observation = await page.evaluate(() => window.__navigationObservations.at(-1));
        report.runs.push({ variant, repeat, label, id, clickWallMs: clicked - start,
          totalWallMs: performance.now() - start, beforeInputMs: observation.eventAt - from,
          inputToPaintMs: observation.paintedAt - observation.eventAt });
      }
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  assert.equal(hash(await fs.readFile(sample)), sha256);
  report.status = "passed";
} catch (error) {
  report.status = "failed"; report.error = String(error.stack || error); process.exitCode = 1;
} finally {
  await browser.close(); report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
}
