#!/usr/bin/env node
// Compare public paired PPTX/PDF files. A published PDF is not fresh PowerPoint QA.
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import sharp from "sharp";
const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.resolve(process.argv[2] || "qa/results/powerpoint-pdf-reference");
assert(output.startsWith(path.join(root, "qa/results") + path.sep));
const python = process.env.QA_PYTHON || "python3";
const source = path.join(root, "qa/samples/cmu-lecture-3.pptx");
const pdfSource = path.join(root, "qa/samples/cmu-lecture-3.pdf");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
assert.equal(hash(await fs.readFile(source)), "12a8a88d3e33a520c6c037debbbab47ef9a3f706dca2dbc450d7443150df03ca");
assert.equal(hash(await fs.readFile(pdfSource)), "d15011b190da22c3e2cdeaa9502f1b57ea82b063132351a402691308c8a7652b");
await fs.mkdir(output, { recursive: false });
execFileSync(python, [path.join(root, "scripts/qa-powerpoint-pdf-reference.py"), pdfSource, output], { stdio: "inherit" });
const reference = JSON.parse(await fs.readFile(path.join(output, "pdf.json")));
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1920, height: 1200 } });
const page = await context.newPage(); page.setDefaultTimeout(90000);
const result = { status: "running", startedAt: new Date().toISOString(),
  sourceCommit: process.env.QA_SOURCE_COMMIT || null, browser: browser.version(), reference,
  slides: [], errors: [], limitations: [
    "Publisher's paired historical PDF declares Microsoft PowerPoint 2016; this is not a new Microsoft app or Web verification.",
    "PDF embedded fonts and the app's available fonts differ. Rasterization and image compression can differ too.",
    "Seven representative pages are triage evidence, not a compatibility percentage.",
  ] };
page.on("pageerror", error => result.errors.push(error.message));
try {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.locator('input[type=file][accept*=".pptx"]').setInputFiles(source);
  await expect(page.locator(".thumbnail-row")).toHaveCount(151);
  await expect(page.locator(".busy-backdrop")).toHaveCount(0);
  const slider = page.getByRole("slider", { name: "확대 비율", exact: true });
  await slider.press("End");
  for (let i = 0; i < 5; i++) await slider.press("PageDown");
  const current = Number(await slider.inputValue());
  for (let i = 0; i < Math.abs(100 - current); i++) await slider.press(current < 100 ? "ArrowRight" : "ArrowLeft");
  await expect(slider).toHaveValue("100");
  for (const ref of reference.pages) {
    await page.locator(".thumbnail-button").nth(ref.page - 1).click();
    await expect(page.locator(".canvas-topline")).toContainText(`${ref.page} / 151`);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.querySelectorAll(".editable-slide img")].map(image => image.decode().catch(() => {})));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const slide = page.locator(".editable-slide");
    const bounds = await slide.boundingBox();
    assert(Math.abs(bounds.width - 1280) < 1 && Math.abs(bounds.height - 720) < 1);
    const image = `slide-studio-${String(ref.page).padStart(3, "0")}.png`;
    await slide.screenshot({ path: path.join(output, image) });
    const metrics = await slide.evaluate(host => ({
      text: host.innerText,
      fonts: [...new Set([...host.querySelectorAll(".element-text,.table-cell-text")].map(node => getComputedStyle(node).fontFamily))],
      missingImages: [...host.querySelectorAll("img")].filter(image => !image.complete || !image.naturalWidth).length,
    }));
    result.slides.push({ page: ref.page, image, bounds, ...metrics });
    const left = await sharp(path.join(output, ref.image)).resize(1280, 720).png().toBuffer();
    const right = await sharp(path.join(output, image)).resize(1280, 720).png().toBuffer();
    await sharp({ create: { width: 2560, height: 720, channels: 3, background: "#ffffff" } })
      .composite([{ input: left, left: 0, top: 0 }, { input: right, left: 1280, top: 0 }])
      .png().toFile(path.join(output, `comparison-${ref.page}.png`));
    console.log("Captured paired public page", ref.page);
  }
  assert.deepEqual(result.errors, []); result.status = "captured";
  await fs.writeFile(path.join(output, "index.html"), `<!doctype html><meta charset="utf-8"><title>Published PowerPoint PDF vs Slide Studio</title>
<style>body{font:16px system-ui;margin:24px;background:#edf0f3}img{width:100%;background:white}section{margin:24px 0}</style>
<h1>Published PowerPoint 2016 PDF · Slide Studio</h1><p>Left: publisher's PDF. Right: current app at 100%. Different font availability and rasterizers; no accuracy percentage.</p>
${result.slides.map(slide => `<section><h2>Page ${slide.page}</h2><img src="comparison-${slide.page}.png"></section>`).join("\n")}`);
} catch (error) { result.status = "failed"; result.error = String(error.stack || error); process.exitCode = 1; }
finally {
  result.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(output, "run.json"), JSON.stringify(result, null, 2) + "\n");
  await context.close(); await browser.close();
}
