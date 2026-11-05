#!/usr/bin/env node
// Read-only public-corpus rendering. Generated files belong under ignored qa/results.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MANIFEST = path.join(ROOT, "qa/layout-baseline-2026-11-05.json");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const relative = (base, file) =>
  path.relative(base, file).split(path.sep).map(encodeURIComponent).join("/");

function options(args) {
  const result = {
    url: "http://127.0.0.1:5193",
    sampleRoot: path.join(ROOT, "qa/samples"),
    sourceRoot: ROOT,
  };
  const names = {
    "--url": "url",
    "--sample-root": "sampleRoot",
    "--reference-root": "referenceRoot",
    "--out": "out",
    "--source-root": "sourceRoot",
    "--source-commit": "sourceCommit",
    "--before": "before",
  };
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === "--all") result.all = true;
    else if (key === "--verify-only") result.verifyOnly = true;
    else if (names[key] && args[index + 1] && !args[index + 1].startsWith("--"))
      result[names[key]] = args[++index];
    else throw Error(`Unknown or incomplete argument: ${key}`);
  }
  if (!result.out)
    throw Error(
      "Use --out <new qa/results directory>. Optional: --all, --before <run.json>, --verify-only, --url, --source-root, --source-commit, --sample-root, --reference-root.",
    );
  result.out = path.resolve(result.out);
  if (!result.out.startsWith(path.join(ROOT, "qa/results") + path.sep))
    throw Error(
      "Output must be a new directory under this checkout's ignored qa/results/.",
    );
  const url = new URL(result.url);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw Error("Only a dedicated localhost HTTP QA server is allowed.");
  return result;
}

function contained(root, filename) {
  const resolved = path.resolve(root, filename);
  if (!resolved.startsWith(path.resolve(root) + path.sep))
    throw Error(`Path escapes root: ${filename}`);
  return resolved;
}

async function verifyCorpus(manifest, opts) {
  const evidence = await fs.readFile(
    path.join(opts.referenceRoot, manifest.reference.evidenceFile),
  );
  if (hash(evidence) !== manifest.reference.evidenceSha256)
    throw Error("Historical evidence manifest hash changed.");
  const checked = {
    files: [],
    references: 0,
    historicalDate: manifest.reference.capturedAt,
  };
  for (const sample of manifest.sources) {
    const bytes = await fs.readFile(contained(opts.sampleRoot, sample.file));
    if (bytes.length !== sample.bytes || hash(bytes) !== sample.sha256)
      throw Error(`Source PPTX changed: ${sample.id}`);
    checked.files.push({
      id: sample.id,
      bytes: bytes.length,
      sha256: sample.sha256,
    });
  }
  for (const row of manifest.rows)
    for (const [variant, ref] of Object.entries(row.references)) {
      const bytes = await fs.readFile(contained(opts.referenceRoot, ref.file));
      if (hash(bytes) !== ref.sha256)
        throw Error(`Reference changed: ${row.id}/${row.slide}/${variant}`);
      const metadata = await sharp(bytes).metadata();
      if (metadata.width !== ref.pixels[0] || metadata.height !== ref.pixels[1])
        throw Error(`Reference dimensions changed: ${ref.file}`);
      checked.references++;
    }
  return checked;
}

async function sourceFingerprint(root) {
  const entries = [];
  async function visit(relativePath) {
    const full = path.join(root, relativePath);
    let stat;
    try {
      stat = await fs.lstat(full);
    } catch (e) {
      if (e.code === "ENOENT") return;
      throw e;
    }
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory())
      for (const name of (await fs.readdir(full)).sort())
        await visit(path.join(relativePath, name));
    else if (stat.isFile())
      entries.push({
        file: relativePath.split(path.sep).join("/"),
        sha256: hash(await fs.readFile(full)),
      });
  }
  for (const name of [
    "src",
    "public",
    "index.html",
    "package.json",
    "package-lock.json",
    "vite.config.ts",
  ])
    await visit(name);
  return {
    sha256: hash(JSON.stringify(entries)),
    files: entries.length,
    entries,
  };
}

async function pixelDifference(reference, actual, destination) {
  const metadata = await sharp(reference).metadata();
  const candidate = await sharp(actual).metadata();
  if (
    metadata.width !== candidate.width ||
    metadata.height !== candidate.height
  )
    return {
      status: "different-dimensions",
      reference: [metadata.width, metadata.height],
      actual: [candidate.width, candidate.height],
    };
  const a = await sharp(reference).removeAlpha().raw().toBuffer();
  const b = await sharp(actual).removeAlpha().raw().toBuffer();
  const delta = Buffer.alloc(a.length);
  let sum = 0,
    changed = 0;
  for (let i = 0; i < a.length; i += 3) {
    let largest = 0;
    for (let j = 0; j < 3; j++) {
      const value = Math.abs(a[i + j] - b[i + j]);
      delta[i + j] = value;
      sum += value;
      largest = Math.max(largest, value);
    }
    if (largest > 16) changed++;
  }
  await sharp(delta, {
    raw: { width: metadata.width, height: metadata.height, channels: 3 },
  })
    .png()
    .toFile(destination);
  return {
    status: "measured",
    meanAbsoluteChannelDifference: sum / a.length,
    pixelsWithAnyChannelDifferenceAbove16: changed,
    totalPixels: a.length / 3,
    interpretation:
      "Triage only; includes font/antialiasing/capture differences. Not a compatibility score.",
  };
}

async function report(manifest, run, opts) {
  const before = opts.before ? await readJson(path.resolve(opts.before)) : null;
  const beforeRoot = opts.before
    ? path.dirname(path.resolve(opts.before))
    : null;
  if (
    before &&
    (before.status !== "captured" ||
      before.manifestSha256 !== run.manifestSha256)
  )
    throw Error(
      "Before run must be a successful capture using this same manifest.",
    );
  const sections = [];
  for (const record of run.slides) {
    const row = manifest.rows.find(
      (r) => r.id === record.id && r.slide === record.slide,
    );
    const reference = contained(opts.referenceRoot, row.references.web.file);
    const current = path.join(opts.out, record.image);
    const diffName = `${record.id}-${String(record.slide).padStart(2, "0")}-web-difference.png`;
    record.webDifference = await pixelDifference(
      reference,
      current,
      path.join(opts.out, diffName),
    );
    const panels = [
      { title: "PowerPoint Web · historical 2026-10-31", file: reference },
    ];
    const prior = before?.slides.find(
      (r) => r.id === record.id && r.slide === record.slide,
    );
    if (prior) {
      const previous = contained(beforeRoot, prior.image);
      if (hash(await fs.readFile(previous)) !== prior.imageSha256)
        throw Error(`Before-image hash changed: ${previous}`);
      panels.push({
        title: `Before · ${before.sourceCommit ?? "unlabelled"}`,
        file: previous,
      });
      const name = `${record.id}-${String(record.slide).padStart(2, "0")}-before-difference.png`;
      record.beforeDifference = await pixelDifference(
        previous,
        current,
        path.join(opts.out, name),
      );
    }
    panels.push(
      {
        title: `Current · ${run.sourceCommit ?? "working tree"}`,
        file: current,
      },
      {
        title: "Absolute RGB difference · triage only",
        file: path.join(opts.out, diffName),
      },
    );
    sections.push(
      `<article><h2>${esc(record.id)} · ${record.slide}</h2><p>${esc(row.reason ?? row.category)}. ${record.pageErrors.length ? "PAGE ERRORS: " + esc(record.pageErrors.join("; ")) : "No observed page errors."}</p><div class="panels">${panels.map((p) => `<figure><figcaption>${esc(p.title)}</figcaption><a href="${relative(opts.out, p.file)}"><img loading="lazy" src="${relative(opts.out, p.file)}"></a></figure>`).join("")}</div><details><summary>Measured fonts / bounds / limitations</summary><pre>${esc(JSON.stringify({ actualFonts: record.actualFonts, requestedFontFamilies: record.requestedFontFamilies, webDifference: record.webDifference, beforeDifference: record.beforeDifference }, null, 2))}</pre></details></article>`,
    );
  }
  await fs.writeFile(
    path.join(opts.out, "index.html"),
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Slide Studio layout baseline</title><style>body{font:15px system-ui;margin:24px;background:#eef1f4;color:#172033}article{background:white;padding:16px;margin:20px 0;border:1px solid #bcc7d5}.panels{display:grid;grid-template-columns:repeat(${before ? 4 : 3},minmax(0,1fr));gap:12px}figure{margin:0}img{width:100%;height:auto}figcaption{padding:8px;background:#172033;color:white}pre{white-space:pre-wrap;max-height:500px;overflow:auto}@media(max-width:900px){.panels{grid-template-columns:1fr}}</style><h1>Slide Studio layout baseline</h1><p>Captured ${esc(run.startedAt)}. ${run.slides.length} slides. Source ${esc(run.sourceCommit ?? "working tree")}.</p><p>Microsoft references are preserved 2026-10-31 captures, not fresh Microsoft verification. Web actual font faces are unknown. Current font observations belong to this Chrome environment. RGB differences are triage evidence, not an accuracy score. Save/reopen and interactive editing require separate checks.</p><p><a href="run.json">Run data</a> · <a href="inventory.json">Verified input inventory</a></p>${sections.join("\n")}</html>`,
  );
}

async function capture(manifest, run, opts) {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  run.environment.browser = browser.version();
  const rows = manifest.rows.filter((row) => opts.all || row.representative);
  try {
    for (const sample of manifest.sources.filter((source) =>
      rows.some((row) => row.id === source.id),
    )) {
      const context = await browser.newContext({
        viewport: { width: 1920, height: 1100 },
        deviceScaleFactor: 1,
        locale: "ko-KR",
        timezoneId: "Asia/Seoul",
      });
      const page = await context.newPage();
      page.setDefaultTimeout(120000);
      const errors = [],
        networkErrors = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      page.on("response", (response) => {
        if (response.status() >= 400)
          networkErrors.push({
            type: "http",
            status: response.status(),
            url: response.url(),
            resourceType: response.request().resourceType(),
          });
      });
      page.on("requestfailed", (request) =>
        networkErrors.push({
          type: "request-failed",
          error: request.failure()?.errorText,
          url: request.url(),
          resourceType: request.resourceType(),
        }),
      );
      await page.route("**/qa-layout-input.pptx", (route) =>
        route.fulfill({
          path: contained(opts.sampleRoot, sample.file),
          contentType:
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        }),
      );
      try {
        await page.goto(opts.url);
        await page.locator(".thumbnail-row").first().waitFor();
        const imported = await page.evaluate(async () => {
          const { importPptx } = await import("/src/io.ts");
          const start = performance.now();
          const result = await importPptx(
            await (await fetch("/qa-layout-input.pptx")).arrayBuffer(),
          );
          const { default: React } = await import(
            "/node_modules/.vite/deps/react.js"
          );
          const {
            default: { createRoot },
          } = await import("/node_modules/.vite/deps/react-dom_client.js");
          const { SlideVisual } = await import("/src/SlideCanvas.tsx");
          const host = document.createElement("div");
          host.id = "qa-layout-slide";
          document.body.append(host);
          const root = createRoot(host),
            deck = result.deck;
          window.__layoutQA = {
            deck,
            render(index, pixels) {
              const scale = pixels[0] / deck.width;
              host.style.cssText = `position:fixed;left:0;top:0;width:${pixels[0]}px;height:${deck.height * scale}px;z-index:2147483647;overflow:hidden;background:white;color:#000;`;
              root.render(
                React.createElement(SlideVisual, {
                  slide: deck.slides[index],
                  width: deck.width,
                  height: deck.height,
                  scale,
                }),
              );
            },
            dispose() {
              root.unmount();
              host.remove();
            },
          };
          return {
            width: deck.width,
            height: deck.height,
            slides: deck.slides.length,
            importMs: performance.now() - start,
            warnings: result.warnings,
            userAgent: navigator.userAgent,
            languages: navigator.languages,
            devicePixelRatio,
          };
        });
        run.sources.push({ id: sample.id, ...imported });
        const cdp = await context.newCDPSession(page);
        await cdp.send("DOM.enable");
        await cdp.send("CSS.enable");
        for (const row of rows.filter((entry) => entry.id === sample.id)) {
          const expected = row.references.web.pixels;
          if (
            Math.abs(
              imported.width / imported.height - expected[0] / expected[1],
            ) > 0.001
          )
            throw Error(
              `Reference aspect ratio differs: ${row.id}/${row.slide}`,
            );
          await page.setViewportSize({
            width: expected[0],
            height: expected[1],
          });
          await page.evaluate(
            async ({ index, pixels }) => {
              window.__layoutQA.render(index, pixels);
              await new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
              );
              await document.fonts.ready;
              await Promise.all(
                [...document.querySelectorAll("#qa-layout-slide img")].map(
                  (img) => img.decode().catch(() => {}),
                ),
              );
              await new Promise((resolve) => requestAnimationFrame(resolve));
            },
            { index: row.slide - 1, pixels: expected },
          );
          const metrics = await page.evaluate((index) => {
            const slide = window.__layoutQA.deck.slides[index],
              host = document.querySelector("#qa-layout-slide"),
              outer = host.getBoundingClientRect();
            const requested = new Set();
            const visit = (value) => {
              if (!value || typeof value !== "object") return;
              if (typeof value.fontFamily === "string")
                requested.add(value.fontFamily);
              for (const child of Object.values(value))
                if (child && typeof child === "object") visit(child);
            };
            // Only the selected editable elements: do not traverse preserved binary/source packages.
            for (const el of slide.elements) {
              if (el.fontFamily) requested.add(el.fontFamily);
              visit(el.paragraphs);
              visit(el.table?.cellStyles);
            }
            const boxes = [
              ...host.querySelectorAll(".element-text,.table-cell-text"),
            ].map((node, box) => {
              const rect = node.getBoundingClientRect(),
                css = getComputedStyle(node);
              const range = document.createRange();
              range.selectNodeContents(node);
              return {
                box,
                text: node.textContent,
                x: rect.x - outer.x,
                y: rect.y - outer.y,
                width: rect.width,
                height: rect.height,
                cssFont: css.font,
                cssFontFamily: css.fontFamily,
                textAlign: css.textAlign,
                lineHeight: css.lineHeight,
                overflowX: node.scrollWidth - node.clientWidth,
                overflowY: node.scrollHeight - node.clientHeight,
                overflow: css.overflow,
                textRects: [...range.getClientRects()].map((r) => ({
                  x: r.x - outer.x,
                  y: r.y - outer.y,
                  width: r.width,
                  height: r.height,
                })),
              };
            });
            // CSS.getPlatformFontsForNode inspects direct child TextNodes, not
            // nested container text. Tag every actual text parent, including SVG
            // chart labels; retain its nearest editable text-box association.
            host
              .querySelectorAll("[data-qa-font-id]")
              .forEach((node) => node.removeAttribute("data-qa-font-id"));
            const parents = new Set(),
              walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
            let textNode;
            while ((textNode = walker.nextNode()))
              if (textNode.textContent.trim() && textNode.parentElement)
                parents.add(textNode.parentElement);
            const boxNodes = [
              ...host.querySelectorAll(".element-text,.table-cell-text"),
            ];
            const fontNodes = [...parents].map((node, fontNode) => {
              node.setAttribute("data-qa-font-id", String(fontNode));
              const css = getComputedStyle(node);
              return {
                fontNode,
                box: boxNodes.indexOf(
                  node.closest(".element-text,.table-cell-text"),
                ),
                text: [...node.childNodes]
                  .filter((n) => n.nodeType === Node.TEXT_NODE)
                  .map((n) => n.textContent)
                  .join(""),
                cssFontFamily: css.fontFamily,
                cssFontWeight: css.fontWeight,
                cssFontStyle: css.fontStyle,
              };
            });
            return {
              requestedFontFamilies: [...requested].sort(),
              elementCount: slide.elements.length,
              boxes,
              fontNodes,
              imageStatus: [...host.querySelectorAll("img")].map((img) => ({
                loaded: img.complete && img.naturalWidth > 0,
              })),
              canvas: { width: outer.width, height: outer.height },
            };
          }, row.slide - 1);
          const document = await cdp.send("DOM.getDocument");
          const { nodeIds } = await cdp.send("DOM.querySelectorAll", {
            nodeId: document.root.nodeId,
            selector: "#qa-layout-slide [data-qa-font-id]",
          });
          const actualFonts = [];
          for (const nodeId of nodeIds) {
            const { attributes } = await cdp.send("DOM.getAttributes", {
              nodeId,
            });
            const fontNode = Number(
              attributes[attributes.indexOf("data-qa-font-id") + 1],
            );
            try {
              const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", {
                nodeId,
              });
              actualFonts.push({
                fontNode,
                fonts,
                status: fonts.length ? "observed-via-cdp" : "not-reported",
              });
            } catch (error) {
              actualFonts.push({
                fontNode,
                status: "unavailable",
                error: String(error),
              });
            }
          }
          const name = `${row.id}-${String(row.slide).padStart(2, "0")}.png`,
            filename = path.join(opts.out, name);
          await page
            .locator("#qa-layout-slide")
            .screenshot({ path: filename, animations: "disabled" });
          run.slides.push({
            id: row.id,
            slide: row.slide,
            image: name,
            imageSha256: hash(await fs.readFile(filename)),
            ...metrics,
            actualFonts,
            pageErrors: [...errors],
            networkErrors: [...networkErrors],
          });
          await fs.writeFile(
            path.join(opts.out, "run.json"),
            JSON.stringify(run, null, 2) + "\n",
          );
          console.log(
            `${row.id}:${row.slide} captured; ${metrics.boxes.length} text boxes / ${actualFonts.length} font observations`,
          );
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  const opts = options(process.argv.slice(2)),
    manifest = await readJson(MANIFEST);
  opts.referenceRoot = path.resolve(
    ROOT,
    opts.referenceRoot ?? manifest.reference.defaultRoot,
  );
  opts.sampleRoot = path.resolve(opts.sampleRoot);
  opts.sourceRoot = path.resolve(opts.sourceRoot);
  await fs.mkdir(path.dirname(opts.out), { recursive: true });
  await fs.mkdir(opts.out); // Never overwrite an earlier baseline or a partial run.
  const inventory = await verifyCorpus(manifest, opts);
  await fs.writeFile(
    path.join(opts.out, "inventory.json"),
    JSON.stringify(
      { verifiedAt: new Date().toISOString(), ...inventory },
      null,
      2,
    ) + "\n",
  );
  if (opts.verifyOnly) {
    console.log(
      `Verified ${inventory.files.length} sources and ${inventory.references} historical crops.`,
    );
    return;
  }
  const fingerprint = await sourceFingerprint(opts.sourceRoot);
  const run = {
    schemaVersion: 1,
    status: "capturing",
    startedAt: new Date().toISOString(),
    sourceCommit: opts.sourceCommit ?? null,
    sourceRoot: opts.sourceRoot,
    server: opts.url,
    sourceFingerprint: fingerprint,
    manifestSha256: hash(await fs.readFile(MANIFEST)),
    historicalReferenceDate: manifest.reference.capturedAt,
    historicalReferenceLimitations: manifest.reference.fullViewportCaptureNote,
    environment: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpu: os.cpus()[0]?.model,
      nodeVersion: process.version,
      rendererMode:
        "Vite development server; isolated synthetic SlideVisual host",
      viewportScale: 1,
      fontMode:
        "Fresh isolated Chrome profile, bundled + OS fonts; no persistent user-added/Office-private font IPC",
    },
    sources: [],
    slides: [],
  };
  try {
    await capture(manifest, run, opts);
    run.sourceUnchangedDuringCapture =
      fingerprint.sha256 === (await sourceFingerprint(opts.sourceRoot)).sha256;
    if (!run.sourceUnchangedDuringCapture)
      throw Error(
        "Renderer source changed during capture; results are not a stable baseline.",
      );
    if (
      run.slides.some(
        (slide) =>
          slide.pageErrors.length ||
          slide.networkErrors.length ||
          slide.imageStatus.some((image) => !image.loaded),
      )
    )
      throw Error(
        "Page, resource, or image loading failed; this run is not a valid layout baseline. Inspect run.json.",
      );
    await report(manifest, run, opts);
    run.status = "captured";
  } catch (error) {
    run.status = "failed";
    run.error = String(error);
    throw error;
  } finally {
    run.finishedAt = new Date().toISOString();
    await fs.writeFile(
      path.join(opts.out, "run.json"),
      JSON.stringify(run, null, 2) + "\n",
    );
  }
  console.log(
    `Saved ${run.slides.length} slide captures and comparison viewer to ${opts.out}`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
