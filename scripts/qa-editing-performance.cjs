"use strict";
// Per-input paint latency in realistic editing documents. The same machine and
// Chrome version must be used for before/after comparisons. No absolute speed
// claim is made from hardware-dependent timing; content/undo checks are exact.
const fs = require("node:fs/promises"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { chromium, expect } = require("@playwright/test");
const output = path.resolve(
  process.argv[2] || "qa/results/editing-performance",
);
const baseURL = process.env.QA_BASE_URL || "http://127.0.0.1:5190";
const fixtureURL = process.env.QA_FIXTURE_URL || "http://127.0.0.1:5190";
const cases = (process.env.QA_EDITING_CASES || "simple,rich,dense,large").split(
  ",",
);
const rates = (process.env.QA_EDITING_RATES || "1,4").split(",").map(Number);
const suffix = "abcdefghij1234567890klmnopqrst";
const percent = (items, p) =>
  Math.round(
    items[Math.min(items.length - 1, Math.floor((items.length - 1) * p))] * 10,
  ) / 10;
(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const results = [];
  try {
    for (const scenario of cases)
      for (const rate of rates) {
        const context = await browser.newContext({
            viewport: { width: 1440, height: 900 },
          }),
          page = await context.newPage(),
          errors = [];
        page.setDefaultTimeout(45000);
        page.on("pageerror", (e) => errors.push(e.message));
        const record = { scenario, cpuRate: rate, errors };
        console.log(new Date().toISOString(), scenario, "CPU", rate);
        try {
          await page.goto(fixtureURL);
          await expect(page.locator(".save-indicator")).toHaveText("저장됨");
          const fixture = await page.evaluate(async (scenario) => {
            const { blankDeck, element, newSlide } = await import(
                "/src/model.ts"
              ),
              { serializeDeck } = await import("/src/io.ts");
            const deck = blankDeck();
            deck.name = "입력 성능 " + scenario;
            const rich = Array.from({ length: 12 }, (_, p) => ({
              runs: Array.from({ length: 10 }, (_, r) => ({
                text: `한글 English ${p}-${r} `,
                bold: r % 3 === 0,
                italic: r % 4 === 0,
                color: r % 2 ? "#233D35" : "#3159B0",
              })),
            }));
            const title = element("text", {
              id: "editing-target",
              x: 60,
              y: 30,
              width: 1140,
              height: 650,
              fontSize: scenario === "rich" ? 18 : 30,
              text:
                scenario === "rich"
                  ? rich
                      .map((p) => p.runs.map((r) => r.text).join(""))
                      .join("\n")
                  : "편집 성능 원본",
              ...(scenario === "rich" ? { paragraphs: rich } : {}),
              autoHeight: false,
            });
            const other = Array.from(
              { length: scenario === "dense" ? 999 : 12 },
              (_, i) =>
                element(i % 3 ? "shape" : "text", {
                  id: "object-" + i,
                  x: 60 + (i % 12) * 90,
                  y: 180 + (Math.floor(i / 12) % 7) * 60,
                  width: 65,
                  height: 40,
                  fontSize: 14,
                  text: i % 3 ? undefined : `항목 ${i}`,
                  shape: "rect",
                  fill: i % 2 ? "#4472C4" : "#E8EDF4",
                }),
            );
            deck.slides[0].elements = [
              title,
              ...(scenario === "rich" ? [] : other),
            ];
            if (scenario === "large")
              for (let i = 1; i < 300; i++)
                deck.slides.push({
                  ...newSlide("blank"),
                  elements: other
                    .slice(0, 8)
                    .map((e) => ({ ...e, id: `${i}-` + e.id })),
                });
            return {
              json: serializeDeck(deck),
              text: title.text,
              slides: deck.slides.length,
              elements: deck.slides[0].elements.length,
            };
          }, scenario);
          if (baseURL !== fixtureURL) {
            await page.goto(baseURL);
            await expect(page.locator(".save-indicator")).toHaveText("저장됨");
          }
          await page
            .locator('input[accept*=".pptx"]')
            .setInputFiles({
              name: "performance.slide",
              mimeType: "application/json",
              buffer: Buffer.from(fixture.json),
            });
          await expect(page.locator(".thumbnail-button")).toHaveCount(
            fixture.slides,
          );
          await expect(page.locator(".busy-backdrop")).toHaveCount(0);
          await expect(page.locator(".save-indicator")).toHaveText("저장됨");
          const target = page.locator(
            '.editable-slide [data-element-id="editing-target"]',
          );
          await target.dblclick({ position: { x: 20, y: 20 } });
          const editor = page.getByRole("textbox", {
            name: "슬라이드 텍스트 편집",
            exact: true,
          });
          await expect(editor).toBeFocused();
          await editor.press("ControlOrMeta+a");
          await editor.press("ArrowRight");
          await page.evaluate(() => document.fonts.ready);
          const cdp = await context.newCDPSession(page);
          await cdp.send("Emulation.setCPUThrottlingRate", { rate });
          await page.evaluate(() => {
            const state = { samples: [], tasks: [] };
            window.__typingPerformance = state;
            document.addEventListener("beforeinput", (e) => {
              if (
                !e.target.closest?.(".editing-text") ||
                e.inputType !== "insertText"
              )
                return;
              const start = performance.now();
              requestAnimationFrame(() =>
                requestAnimationFrame(() =>
                  state.samples.push(performance.now() - start),
                ),
              );
            });
            new PerformanceObserver((list) =>
              state.tasks.push(...list.getEntries().map((t) => t.duration)),
            ).observe({ type: "longtask" });
          });
          const start = Date.now();
          await editor.pressSequentially(suffix, { delay: 35 });
          await expect(editor).toHaveText(fixture.text + suffix, {
            useInnerText: true,
          });
          await expect
            .poll(() =>
              page.evaluate(() => window.__typingPerformance.samples.length),
            )
            .toBe(suffix.length);
          record.typingWallMs = Date.now() - start;
          const samples = await page.evaluate(() => window.__typingPerformance);
          samples.samples.sort((a, b) => a - b);
          record.paintMs = {
            count: samples.samples.length,
            median: percent(samples.samples, 0.5),
            p95: percent(samples.samples, 0.95),
            max: percent(samples.samples, 1),
          };
          record.longTasks = samples.tasks;
          record.domNodes = await page.evaluate(
            () => document.getElementsByTagName("*").length,
          );
          const normalize = value => value.replace(/\s+/g," ").trim();
          let undoSteps=0,current=normalize(await editor.innerText());
          while(current !== normalize(fixture.text) && undoSteps < suffix.length) {
            const previous=current;
            await editor.press("ControlOrMeta+z");
            await expect.poll(async()=>normalize(await editor.innerText())).not.toBe(previous);
            current=normalize(await editor.innerText());undoSteps++;
            assert(normalize(fixture.text+suffix).startsWith(current),'Undo changed text outside the typed suffix');
          }
          assert.equal(current,normalize(fixture.text));record.undoSteps=undoSteps;
          for(let i=0;i<undoSteps;i++)await editor.press("ControlOrMeta+Shift+z");
          await expect(editor).toHaveText(fixture.text + suffix, {
            useInnerText: true,
          });
          await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
          await page.locator(".canvas-topline").click();
          await expect(page.locator(".save-indicator")).toHaveText("저장됨");
          const actual = await page.evaluate(async () => {
            const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('slide-studio',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
            const d=await new Promise((resolve,reject)=>{const r=db.transaction('documents').objectStore('documents').get('current');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();
            return {
              text: d.slides[0].elements[0].text,
              slides: d.slides.length,
              elements: d.slides[0].elements.length,
            };
          });
          assert.deepEqual(actual, {
            text: fixture.text + suffix,
            slides: fixture.slides,
            elements: fixture.elements,
          });
          assert.deepEqual(errors, []);
          record.status = "passed";
        } catch (error) {
          record.status = "failed";
          record.failure = String(error.stack || error);
          await page
            .screenshot({
              path: path.join(output, `${scenario}-${rate}-failure.png`),
            })
            .catch(() => {});
          throw error;
        } finally {
          results.push(record);
          await fs.writeFile(
            path.join(output, "results.json"),
            JSON.stringify(results, null, 2),
          );
          console.log(JSON.stringify(record));
          await context.close();
        }
      }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
