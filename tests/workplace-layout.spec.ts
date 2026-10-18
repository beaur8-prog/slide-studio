import { test, expect } from "@playwright/test";
import fs from "node:fs";
import crypto from "node:crypto";

const corpus = JSON.parse(fs.readFileSync("qa/workplace-samples.json", "utf8"));
for (const sample of corpus) {
  test(`workplace corpus: ${sample.id} preserves native text, layout bounds and slide count`, async ({
    page,
  }, info) => {
    test.skip(
      !fs.existsSync(`qa/samples/${sample.id}.pptx`),
      "Run python3 scripts/fetch-qa-samples.py to fetch the pinned public corpus",
    );
    expect(
      crypto
        .createHash("sha256")
        .update(fs.readFileSync(`qa/samples/${sample.id}.pptx`))
        .digest("hex"),
    ).toBe(sample.sha256);
    await page.goto("http://127.0.0.1:5190");
    const result = await page.evaluate(async (id) => {
      const { importPptx, exportPptx, serializeDeck, parseDeckJson } =
        await import("/src/io.ts");
      const { default: JSZip } = await import(
        "/node_modules/.vite/deps/jszip.js"
      );
      const data = await (await fetch(`/qa/samples/${id}.pptx`)).arrayBuffer();
      const zip = await JSZip.loadAsync(data);
      const imported = await importPptx(data);
      const sourceMissing: string[] = [];
      const normalize = (s: string) => s.replace(/\s+/g, "").normalize("NFC");
      for (let i = 0; i < imported.deck.slides.length; i++) {
        const xml = new DOMParser().parseFromString(
          await zip.file(`ppt/slides/slide${i + 1}.xml`)!.async("string"),
          "application/xml",
        );
        const actual = normalize(
          imported.deck.slides[i].elements
            .map((e) => e.text ?? e.table?.cells.flat().join(" ") ?? "")
            .join(" "),
        );
        // Independent OOXML text oracle, including nested group text and native table cells.
        for (const t of xml.getElementsByTagNameNS(
          "http://schemas.openxmlformats.org/drawingml/2006/main",
          "t",
        )) {
          const expected = normalize(t.textContent ?? "");
          if (expected && !actual.includes(expected))
            sourceMissing.push(`slide ${i + 1}: ${t.textContent}`);
        }
      }
      const project = parseDeckJson(serializeDeck(imported.deck));
      const restored = (await importPptx(await exportPptx(project))).deck;
      const mismatches: string[] = [];
      for (let i = 0; i < project.slides.length; i++) {
        const originals = project.slides[i].elements,
          restoredElements = restored.slides[i].elements;
        // Composite border lines belong to their text box on reimport.
        // Repeated round trips must not accumulate independent edge objects.
        if (restoredElements.length !== originals.length)
          mismatches.push(`slide ${i + 1}: unexpected element count`);
        const nonLine = (e: (typeof originals)[number]) =>
          e.shape !== "line" && e.shape !== "arrow";
        const a = originals.filter(nonLine),
          b = restoredElements.filter(nonLine);
        if (a.length !== b.length) {
          mismatches.push(`slide ${i + 1}: artwork count`);
          continue;
        }
        for (let j = 0; j < a.length; j++) {
          if (normalize(a[j].text ?? "") !== normalize(b[j].text ?? ""))
            mismatches.push(`slide ${i + 1} element ${j}: text`);
          if (
            a[j].borders &&
            JSON.stringify(a[j].borders) !== JSON.stringify(b[j].borders)
          )
            mismatches.push(`slide ${i + 1} element ${j}: borders`);
          for (const k of ["x", "y", "width", "height"] as const)
            if (Math.abs(a[j][k] - b[j][k]) > 0.1)
              mismatches.push(`slide ${i + 1} element ${j}: ${k}`);
        }
      }
      const { default: React } = await import(
        "/node_modules/.vite/deps/react.js"
      );
      const {
        default: { createRoot },
      } = await import("/node_modules/.vite/deps/react-dom_client.js");
      const { SlideVisual } = await import("/src/SlideCanvas.tsx");
      const host = document.createElement("div");
      host.id = "workplace-preview";
      host.style.cssText =
        "position:fixed;inset:0;overflow:auto;z-index:9999;background:#ddd;";
      document.body.append(host);
      const representatives = [
        ...new Set([
          0,
          Math.floor(project.slides.length / 2),
          project.slides.length - 1,
        ]),
      ];
      createRoot(host).render(
        React.createElement(
          React.Fragment,
          {},
          ...representatives.map((index) =>
            React.createElement(
              "div",
              {
                key: index,
                style: {
                  width: project.width * 0.6,
                  height: project.height * 0.6,
                  margin: 12,
                  position: "relative",
                },
              },
              React.createElement(SlideVisual, {
                slide: project.slides[index],
                width: project.width,
                height: project.height,
                scale: 0.6,
              }),
            ),
          ),
        ),
      );
      return {
        slides: project.slides.length,
        sourceMissing,
        mismatches,
        warnings: imported.warnings,
        finiteBounds: project.slides.every((s) =>
          s.elements.every((e) =>
            [e.x, e.y, e.width, e.height, e.rotation].every(Number.isFinite),
          ),
        ),
        representatives: representatives.map((i) => i + 1),
        elements: project.slides.reduce((n, s) => n + s.elements.length, 0),
      };
    }, sample.id);
    expect(result.slides).toBe(sample.structure.slides);
    expect(result.finiteBounds).toBe(true);
    expect(result.sourceMissing).toEqual([]);
    expect(result.mismatches).toEqual([]);
    await expect(page.locator("#workplace-preview .slide-visual")).toHaveCount(
      result.representatives.length,
    );
    await page.evaluate(() => document.fonts.ready);
    await page
      .locator("#workplace-preview")
      .screenshot({ path: info.outputPath(`${sample.id}.png`) });
    await info.attach("corpus-result", {
      body: JSON.stringify(result, null, 2),
      contentType: "application/json",
    });
  });
}

test("inherited two-column text flows to the second column and retains native spacing through PPTX", async ({
  page,
}, info) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const text = Array.from(
      { length: 8 },
      (_, i) => `${i + 1}차 출하 계획`,
    ).join("\n");
    const deck = blankDeck();
    deck.slides[0].elements = [
      element("text", {
        x: 20,
        y: 20,
        width: 420,
        height: 96,
        fontSize: 20,
        text,
        paragraphs: [
          {
            lineSpacing: 24,
            spaceBefore: 0,
            spaceAfter: 0,
            marginLeft: 0,
            marginRight: 0,
            indent: 0,
            runs: [{ text, fontSize: 20 }],
          },
        ],
      }),
    ];
    const zip = await JSZip.loadAsync(await exportPptx(deck));
    const slidePath = "ppt/slides/slide1.xml",
      masterPath = "ppt/slideMasters/slideMaster1.xml";
    // Put the column settings in the master placeholder body to exercise inheritance.
    let slideXml = await zip.file(slidePath)!.async("string");
    const doc = new DOMParser().parseFromString(slideXml, "application/xml");
    const nsP = "http://schemas.openxmlformats.org/presentationml/2006/main",
      nsA = "http://schemas.openxmlformats.org/drawingml/2006/main";
    const shape = doc.getElementsByTagNameNS(nsP, "sp")[0];
    const ph = doc.createElementNS(nsP, "p:ph");
    ph.setAttribute("type", "body");
    ph.setAttribute("idx", "1");
    shape.getElementsByTagNameNS(nsP, "nvPr")[0].append(ph);
    zip.file(slidePath, new XMLSerializer().serializeToString(doc));
    const master = new DOMParser().parseFromString(
      await zip.file(masterPath)!.async("string"),
      "application/xml",
    );
    const body = master.importNode(shape, true);
    master.getElementsByTagNameNS(nsP, "spTree")[0].append(body);
    const bp = body.getElementsByTagNameNS(nsA, "bodyPr")[0];
    bp.setAttribute("numCol", "2");
    bp.setAttribute("spcCol", String(20 * 9525));
    zip.file(masterPath, new XMLSerializer().serializeToString(master));
    const imported = (
      await importPptx(await zip.generateAsync({ type: "uint8array" }))
    ).deck;
    const restored = (await importPptx(await exportPptx(imported))).deck;
    const { default: React } = await import(
      "/node_modules/.vite/deps/react.js"
    );
    const {
      default: { createRoot },
    } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { ElementVisual } = await import("/src/SlideCanvas.tsx");
    const host = document.createElement("div");
    host.id = "column-probe";
    host.style.cssText =
      "position:fixed;left:30px;top:30px;width:420px;height:96px;z-index:9999;background:white;";
    document.body.append(host);
    createRoot(host).render(
      React.createElement(ElementVisual, {
        element: imported.slides[0].elements[0],
      }),
    );
    return {
      imported: imported.slides[0].elements[0],
      restored: restored.slides[0].elements[0],
      text,
    };
  });
  expect(result.imported.textColumns).toBe(2);
  expect(result.imported.textColumnGap).toBe(20);
  expect(result.restored.textColumns).toBe(2);
  expect(result.restored.textColumnGap).toBe(20);
  expect(result.restored.text).toBe(result.text);
  await expect(page.locator("#column-probe [data-text-line]")).toHaveCount(8);
  const lines = await page
    .locator("#column-probe [data-text-line]")
    .evaluateAll((nodes) =>
      nodes.map((n) => ({
        left: n.getBoundingClientRect().left,
        top: n.getBoundingClientRect().top,
      })),
    );
  expect(lines[4].left - lines[0].left).toBeCloseTo(220, 1);
  expect(lines[4].top).toBeCloseTo(lines[0].top, 1);
  expect(result.imported.height).toBe(96);
  await page.screenshot({ path: info.outputPath("two-column.png") });
});
