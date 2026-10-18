import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

test("round presets retain ring thickness and inscribed text bounds through PPTX export", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { exportPptx, importPptx, serializeDeck, parseDeckJson } =
      await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const deck = blankDeck();
    deck.slides[0].elements = [];
    const zip = await JSZip.loadAsync(await exportPptx(deck));
    const shapes = [
      ["donut", "6764"],
      ["donut", null],
      ["donut", "50000"],
      ["donut", "0"],
      ["ellipse", null],
    ]
      .map(
        ([preset, adjustment], i) =>
          `<p:sp><p:nvSpPr><p:cNvPr id="${i + 20}" name="round-${i}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="952500" y="952500"/><a:ext cx="1905000" cy="952500"/></a:xfrm><a:prstGeom prst="${preset}"><a:avLst>${adjustment === null ? "" : `<a:gd name="adj" fmla="val ${adjustment}"/>`}</a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="AABBCC"/></a:solidFill></p:spPr><p:txBody><a:bodyPr lIns="95250" rIns="95250" tIns="47625" bIns="47625" anchor="ctr"/><a:p><a:r><a:rPr sz="1800"/><a:t>round ${i}</a:t></a:r></a:p></p:txBody></p:sp>`,
      )
      .join("");
    const name = "ppt/slides/slide1.xml";
    zip.file(
      name,
      (await zip.file(name)!.async("string")).replace(
        "</p:spTree>",
        shapes + "</p:spTree>",
      ),
    );
    const imported = (
      await importPptx(await zip.generateAsync({ type: "uint8array" }))
    ).deck;
    const restored = parseDeckJson(serializeDeck(imported));
    return {
      imported: imported.slides[0].elements,
      restored: restored.slides[0].elements,
      roundTrip: (await importPptx(await exportPptx(restored))).deck.slides[0]
        .elements,
    };
  });
  expect(result.restored).toEqual(result.imported);
  for (const key of ["imported", "roundTrip"] as const) {
    expect(result[key]).toHaveLength(5);
    const texts = result[key]
      .filter((e) => e.text !== undefined)
      .map((e) => {
        const f = e.textFrame ?? [0, 0, 1, 1],
          ins = e.textInsets ?? [0, 0, 0, 0];
        return {
          ...e,
          x: e.x + e.width * f[0] + ins[3],
          y: e.y + e.height * f[1] + ins[0],
          width: e.width * f[2] - ins[1] - ins[3],
          height: e.height * f[3] - ins[0] - ins[2],
        };
      });
    expect(texts).toHaveLength(5);
    for (const text of texts) {
      expect(text.x).toBeCloseTo(139.28932, 3);
      expect(text.y).toBeCloseTo(119.64466, 3);
      expect(text.width).toBeCloseTo(121.42136, 3);
      expect(text.height).toBeCloseTo(60.71068, 3);
      expect(text.verticalAlign).toBe("middle");
    }
    const paths = result[key]
      .filter((e) => e.type === "shape" && e.paths)
      .map((e) => e.paths![0]);
    expect(paths).toHaveLength(4);
    // The source is 200 × 100. Both radii lose the same absolute thickness,
    // so normalizing it to a square would distort this non-circular ring.
    const radii = paths.map((p) =>
      [...p.d.matchAll(/A\s+([\d.]+)\s+([\d.]+)/g)].map((m) => [
        Number(m[1]) / p.width,
        Number(m[2]) / p.height,
      ]),
    );
    expect(radii[0]).toHaveLength(4);
    expect(radii[0][2][0]).toBeCloseTo(0.46618, 4);
    expect(radii[0][2][1]).toBeCloseTo(0.43236, 4);
    expect(radii[1][2]).toEqual([0.375, 0.25]);
    expect(radii[2]).toHaveLength(2); // Collapsed hole does not create invalid arcs.
    expect(radii[3][2]).toEqual([0.5, 0.5]);
  }
});

test("DSU slide 10 preserves label bounds and matches the native reference when its font is available", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  const file = path.resolve("qa/samples/dsu-korean.pptx");
  test.skip(!fs.existsSync(file), "Download the public QA sample first");
  await page.goto("http://127.0.0.1:5190");
  await page.locator('input[type="file"][accept*=".pptx"]').setInputFiles(file);
  await page
    .getByRole("button", { name: "편집 시작하기", exact: true })
    .click();
  await expect(page.locator(".thumbnail-button")).toHaveCount(22, {
    timeout: 90000,
  });
  await page.keyboard.press("Escape");
  await page.locator(".thumbnail-button").nth(9).click();
  await page.evaluate(() => document.fonts.ready);
  const result = await page
    .locator(".editable-slide")
    .evaluate(async (root) => {
      let referenceFontAvailable = false;
      try {
        await new FontFace(
          "QA Malgun Gothic availability",
          'local("Malgun Gothic"), local("맑은 고딕")',
        ).load();
        referenceFontAvailable = true;
      } catch {
        // The Windows PowerPoint reference uses Malgun Gothic. The documented
        // macOS substitute has different glyph advances; it must still fit.
      }
      const labels = ["상리사회복지관", "목포시 종합사회복지관"];
      const rendered = labels.map((label) => {
        const el = [...root.querySelectorAll(".element-text")].find(
          (e) => e.textContent?.replace(/\s/g, "") === label.replace(/\s/g, ""),
        )!;
        const rows = new Map<number, string>();
        const box = el.getBoundingClientRect();
        let overflow = 0;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          for (let i = 0; i < (node.textContent?.length ?? 0); i++) {
            const range = document.createRange();
            range.setStart(node, i);
            range.setEnd(node, i + 1);
            const rect = range.getBoundingClientRect();
            const y = Math.round(rect.top);
            overflow = Math.max(
              overflow,
              box.left - rect.left,
              rect.right - box.right,
              box.top - rect.top,
              rect.bottom - box.bottom,
            );
            rows.set(y, (rows.get(y) ?? "") + node.textContent![i]);
          }
        }
        return {
          label,
          overflow,
          lines: [...rows.values()].map((s) => s.trim()).filter(Boolean),
        };
      });
      return { referenceFontAvailable, rendered };
    });
  for (const item of result.rendered) {
    expect(item.lines).toHaveLength(2);
    expect(item.lines.join("").replace(/\s/g, "")).toBe(
      item.label.replace(/\s/g, ""),
    );
    expect(item.overflow).toBeLessThanOrEqual(1);
  }
  if (result.referenceFontAvailable) {
    expect(result.rendered.map((item) => item.lines)).toEqual([
      ["상리사회", "복지관"],
      ["목포시 종합", "사회복지관"],
    ]);
  } else {
    testInfo.annotations.push({
      type: "font-substitution",
      description:
        "Malgun Gothic unavailable: checked both complete labels fit on two lines; exact Windows reference wrapping requires the original font.",
    });
  }
  await page.screenshot({ path: testInfo.outputPath("dsu-10-workspace.png") });
  await page
    .getByTestId("canvas-frame")
    .screenshot({ path: testInfo.outputPath("dsu-10.png") });
});
