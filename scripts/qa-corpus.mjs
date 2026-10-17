import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const root = path.resolve(import.meta.dirname, "..");
const label = process.argv[2] || "baseline";
const requested = process.argv.slice(3).filter((arg) => !arg.startsWith("--"));
const roundTrip = process.argv.includes("--round-trip");
const repeats = Math.max(
  1,
  Math.min(
    5,
    Number(
      process.argv.find((arg) => arg.startsWith("--repeat="))?.split("=")[1] ||
        1,
    ),
  ),
);
const output = path.join(root, "qa", "results", label);
await fs.mkdir(output, { recursive: true });
const files = (await fs.readdir(path.join(root, "qa", "samples"))).filter(
  (name) =>
    name.endsWith(".pptx") && (!requested.length || requested.includes(name)),
);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
let previousScreenshots = [];
try {
  previousScreenshots = JSON.parse(
    await fs.readFile(path.join(root, "qa/results/final/corpus.json"), "utf8"),
  ).results;
} catch {}
try {
  for (const filename of files.flatMap((file) =>
    Array.from({ length: repeats }, () => file),
  )) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(120000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const item = {
      filename,
      repetition: results.filter((r) => r.filename === filename).length + 1,
      bytes: (await fs.stat(path.join(root, "qa", "samples", filename))).size,
    };
    try {
      await page.goto("http://127.0.0.1:5190");
      await page.waitForFunction(() =>
        document
          .querySelector(".save-indicator")
          ?.textContent.includes("저장됨"),
      );
      await page.evaluate(() => {
        window.__qaTasks = [];
        new PerformanceObserver((list) =>
          window.__qaTasks.push(
            ...list
              .getEntries()
              .map((e) => ({ start: e.startTime, ms: e.duration })),
          ),
        ).observe({ type: "longtask", buffered: false });
      });
      const stats = await page.evaluate(async (file) => {
        const { importPptx } = await import("/src/io.ts");
        const bytes = await (await fetch(`/qa/samples/${file}`)).arrayBuffer();
        const start = performance.now();
        try {
          const result = await importPptx(bytes);
          const ms = performance.now() - start;
          return {
            status: "parsed",
            import_ms: ms,
            slides: result.deck.slides.length,
            elements: result.deck.slides.reduce(
              (n, s) => n + s.elements.length,
              0,
            ),
            text_elements: result.deck.slides
              .flatMap((s) => s.elements)
              .filter((e) => e.type === "text").length,
            hangul_elements: result.deck.slides
              .flatMap((s) => s.elements)
              .filter((e) => /[가-힣]/.test(e.text || "")).length,
            warnings: result.warnings,
            expanded_model_chars: JSON.stringify(result.deck).length,
          };
        } catch (error) {
          return {
            status: "rejected",
            import_ms: performance.now() - start,
            error: String(error),
          };
        }
      }, filename);
      Object.assign(item, stats);
      if (stats.status === "parsed") {
        // Exercise the actual file-input handler, document replacement, rendering and autosave.
        const start = performance.now();
        await page
          .locator('input[type=file][accept*=".pptx"]')
          .setInputFiles(path.join(root, "qa", "samples", filename));
        await page.waitForFunction(
          () =>
            document
              .querySelector(".toast")
              ?.textContent.includes("파일 열기 실패") ||
            document.querySelector(".warning-list") ||
            document
              .querySelector(".toast")
              ?.textContent.includes("불러왔습니다"),
        );
        item.open_to_ui_ms = performance.now() - start;
        if (await page.locator(".warning-list").count())
          await page
            .getByRole("button", { name: "편집 시작하기", exact: true })
            .click();
        await page.waitForFunction(() =>
          document
            .querySelector(".save-indicator")
            ?.textContent.includes("저장됨"),
        );
        item.open_to_saved_ms = performance.now() - start;
        const switches = [];
        for (const index of [
          ...new Set([0, 1, Math.floor(stats.slides / 2), stats.slides - 1]),
        ]) {
          const started = performance.now();
          await page.locator(".thumbnail-row").nth(index).click();
          await page.evaluate(
            () =>
              new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
              ),
          );
          switches.push(performance.now() - started);
        }
        item.slide_switch_ms = switches;
        const cdp = await context.newCDPSession(page);
        item.heap_before_layout = await cdp.send("Runtime.getHeapUsage");
        if (item.repetition === 1) {
          await page.emulateMedia({ media: "print" });
          await page.evaluate(() => document.fonts.ready);
          await page.evaluate(() =>
            Promise.all(
              Array.from(document.querySelectorAll(".print-deck img")).map(
                (img) => img.decode().catch(() => {}),
              ),
            ),
          );
          item.layout = await page.evaluate(() => {
            return Array.from(document.querySelectorAll(".print-slide")).map(
              (slide, index) => {
                const boxes = Array.from(
                  slide.querySelectorAll(".slide-element"),
                );
                const text = boxes.filter((box) =>
                  box.querySelector(".element-text"),
                );
                const overflow = text
                  .map((box, element) => {
                    const el = box.querySelector(".element-text");
                    return {
                      element,
                      text: el.textContent.slice(0, 100),
                      overflow_y: el.scrollHeight - el.clientHeight,
                      overflow_x: el.scrollWidth - el.clientWidth,
                      width: el.clientWidth,
                      height: el.clientHeight,
                      clipping: getComputedStyle(el).overflow === "hidden",
                    };
                  })
                  .filter((el) => el.overflow_y > 2 || el.overflow_x > 2);
                const clipped = overflow.filter((el) => el.clipping);
                const slideRect = slide.getBoundingClientRect();
                const glyphs = text.map((box) => {
                  const walker = document.createTreeWalker(
                      box.querySelector(".element-text"),
                      NodeFilter.SHOW_TEXT,
                    ),
                    rects = [];
                  let node;
                  while ((node = walker.nextNode())) {
                    const value = node.textContent ?? "";
                    if (!value.trim()) continue;
                    // A preserved tab at a wrapped line end can have a Range
                    // outside the slide without drawing ink. Measure each
                    // non-tab segment, trimming its edge whitespace.
                    for (const match of value.matchAll(/[^\t\r\n]+/g)) {
                      if (!match[0].trim()) continue;
                      const range = document.createRange();
                      range.setStart(node, match.index + match[0].search(/\S/));
                      range.setEnd(node, match.index + match[0].trimEnd().length);
                      rects.push(...range.getClientRects());
                    }
                  }
                  return rects;
                });
                const offSlide = glyphs.flatMap((rects, element) =>
                  rects.some(
                    (r) =>
                      r.left < slideRect.left - 3 ||
                      r.right > slideRect.right + 3 ||
                      r.top < slideRect.top - 3 ||
                      r.bottom > slideRect.bottom + 3,
                  )
                    ? [
                        {
                          element,
                          text: text[element].textContent.slice(0, 100),
                        },
                      ]
                    : [],
                );
                const glyphOverlaps = [];
                for (let a = 0; a < glyphs.length; a++)
                  for (let b = a + 1; b < glyphs.length; b++) {
                    if (
                      glyphs[a].some((x) =>
                        glyphs[b].some(
                          (y) =>
                            Math.min(x.right, y.right) -
                              Math.max(x.left, y.left) >
                              3 &&
                            Math.min(x.bottom, y.bottom) -
                              Math.max(x.top, y.top) >
                              3,
                        ),
                      )
                    )
                      glyphOverlaps.push({
                        a,
                        b,
                        first: text[a].textContent.slice(0, 80),
                        second: text[b].textContent.slice(0, 80),
                      });
                  }
                const overlaps = [];
                for (let a = 0; a < text.length; a++)
                  for (let b = a + 1; b < text.length; b++) {
                    if (
                      !text[a].textContent.trim() ||
                      !text[b].textContent.trim()
                    )
                      continue;
                    const x = text[a].getBoundingClientRect(),
                      y = text[b].getBoundingClientRect();
                    const w =
                      Math.min(x.right, y.right) - Math.max(x.left, y.left);
                    const h =
                      Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top);
                    if (
                      w > 3 &&
                      h > 3 &&
                      w * h >
                        Math.min(x.width * x.height, y.width * y.height) * 0.1
                    )
                      overlaps.push({
                        a,
                        b,
                        first: text[a].textContent.slice(0, 55),
                        second: text[b].textContent.slice(0, 55),
                        intersection: Math.round(w * h),
                      });
                  }
                return {
                  slide: index + 1,
                  elements: boxes.length,
                  clipped,
                  overflow_boxes: overflow,
                  text_box_overlap_candidates: overlaps,
                  glyph_overlap_candidates: glyphOverlaps,
                  off_slide_text_candidates: offSlide,
                };
              },
            );
          });
          const suspect = item.layout
            .filter(
              (s) =>
                s.clipped.length ||
                s.glyph_overlap_candidates.length ||
                s.off_slide_text_candidates.length,
            )
            .sort(
              (a, b) =>
                b.clipped.length +
                b.glyph_overlap_candidates.length +
                b.off_slide_text_candidates.length -
                (a.clipped.length +
                  a.glyph_overlap_candidates.length +
                  a.off_slide_text_candidates.length),
            )
            .slice(0, 3)
            .map((s) => s.slide - 1);
          const picks = [
            ...new Set([
              0,
              1,
              Math.floor(stats.slides / 2),
              stats.slides - 1,
              ...suspect,
              ...(
                previousScreenshots.find(
                  (r) => r.filename === filename && r.screenshots,
                )?.screenshots ?? []
              ).map((name) => Number(name.match(/slide-(\d+)/)[1]) - 1),
              ...(filename === "cmu-lecture-2.pptx" ? [27] : []),
              ...(filename === "cmu-lecture-3.pptx" ? [33, 116, 117] : []),
            ]),
          ];
          item.screenshots = [];
          for (const index of picks) {
            const name = `${filename.replace(".pptx", "")}-slide-${String(index + 1).padStart(3, "0")}.png`;
            await page
              .locator(".print-slide")
              .nth(index)
              .screenshot({ path: path.join(output, name), timeout: 30000 });
            item.screenshots.push(name);
          }
          await page.emulateMedia({ media: "screen" });
          if (roundTrip)
            item.round_trip = await page.evaluate(async () => {
              const { loadAutosave } = await import("/src/storage.ts");
              const { exportPptx, importPptx } = await import("/src/io.ts");
              const deck = await loadAutosave(),
                start = performance.now();
              const bytes = await exportPptx(deck),
                exportMs = performance.now() - start;
              const imported = await importPptx(bytes);
              const texts = (d) =>
                d.slides.map((s) =>
                  s.elements
                    .filter((e) => e.type === "text")
                    .map((e) => e.text),
                );
              const images = (d) =>
                d.slides.map(
                  (s) => s.elements.filter((e) => e.type === "image").length,
                );
              return {
                bytes: bytes.length,
                export_ms: exportMs,
                total_ms: performance.now() - start,
                slides: imported.deck.slides.length,
                text_preserved:
                  JSON.stringify(texts(deck)) ===
                  JSON.stringify(texts(imported.deck)),
                image_count_preserved:
                  JSON.stringify(images(deck)) ===
                  JSON.stringify(images(imported.deck)),
              };
            });
        }
        item.long_tasks = await page.evaluate(() => window.__qaTasks);
      }
    } catch (error) {
      item.run_error = String(error);
    }
    item.page_errors = errors;
    results.push(item);
    await fs.writeFile(
      path.join(output, "corpus.json"),
      JSON.stringify(
        {
          label,
          date: new Date().toISOString(),
          platform: process.platform,
          architecture: process.arch,
          cpu: os.cpus()[0]?.model,
          browser: browser.version(),
          results,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        filename,
        status: item.status,
        bytes: item.bytes,
        slides: item.slides,
        import_ms: item.import_ms,
        open_to_ui_ms: item.open_to_ui_ms,
        open_to_saved_ms: item.open_to_saved_ms,
        clipped: item.layout?.reduce((n, s) => n + s.clipped.length, 0),
        overlap_candidates: item.layout?.reduce(
          (n, s) => n + s.text_box_overlap_candidates.length,
          0,
        ),
        error: item.error || item.run_error,
        page_errors: errors,
      }),
    );
    await context.close();
  }
} finally {
  await browser.close();
}
