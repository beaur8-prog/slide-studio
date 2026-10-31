import { expect, test } from "@playwright/test";
import fs from "node:fs";

const sourcePath = "qa/samples/poi-smartart-rotated-text.pptx";

test("SmartArt text keeps independent rotation, frame, white fontRef and geometry through edited PPTX saves", async ({
  page,
}, info) => {
  test.skip(
    !fs.existsSync(sourcePath),
    "Fetch the pinned Apache POI public sample first",
  );
  test.setTimeout(60000);
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { importPptx, exportPptx } = await import("/src/io.ts");
    const { editText } = await import("/src/text-layout.ts");
    const bytes = await (
      await fetch("/qa/samples/poi-smartart-rotated-text.pptx")
    ).arrayBuffer();
    const scenarios = [];
    for (const edit of ["move", "text"] as const) {
      let deck = (await importPptx(bytes)).deck;
      const rounds = [];
      for (let round = 0; round < 4; round++) {
        rounds.push(
          deck.slides[0].elements
            .filter((e) => e.text?.trim())
            .map((e) => ({
              text: e.text,
              type: e.type,
              rotation: e.rotation,
              textRotation: e.textRotation ?? 0,
              color: e.color,
              runColors: e.paragraphs?.flatMap((p) =>
                p.runs.filter((r) => r.text.trim()).map((r) => r.color),
              ),
              textFrame: e.textFrame ?? [0, 0, 1, 1],
              x: e.x,
              y: e.y,
              width: e.width,
              height: e.height,
            })),
        );
        if (round === 3) break;
        const index = deck.slides[0].elements.findIndex((e) =>
          e.text?.startsWith("abc"),
        );
        if (edit === "move") deck.slides[0].elements[index].x += 1;
        else
          deck.slides[0].elements[index] = editText(
            deck.slides[0].elements[index],
            `abc${round + 1}`,
          );
        deck = (await importPptx(await exportPptx(deck))).deck;
      }
      scenarios.push({ edit, rounds });
    }
    return scenarios;
  });
  fs.writeFileSync(
    info.outputPath("smartart-edited-rounds.json"),
    JSON.stringify(result, null, 2),
  );
  const expectedRotations = [
    48.68128333333333, 139.18118333333334, 90, 29.514083333333332,
  ];
  for (const scenario of result) {
    expect(scenario.rounds).toHaveLength(4);
    for (const [round, elements] of scenario.rounds.entries()) {
      expect(elements).toHaveLength(4);
      for (const [index, element] of elements.entries()) {
        expect(element.color).toBe(index < 3 ? "#FFFFFF" : "#000000");
        expect(element.runColors?.every((c) => c === element.color)).toBe(true);
        expect(element.rotation).toBeCloseTo(expectedRotations[index], 4);
        expect(element.textRotation).toBe(index < 3 ? -90 : 0);
        for (const [k, value] of scenario.rounds[0][index].textFrame.entries())
          expect(element.textFrame[k]).toBeCloseTo(value, 4);
        for (const key of ["y", "width", "height"] as const)
          expect(element[key]).toBeCloseTo(scenario.rounds[0][index][key], 3);
        expect(element.x).toBeCloseTo(
          scenario.rounds[0][index].x +
            (scenario.edit === "move" && index === 0 ? round : 0),
          3,
        );
      }
    }
  }
});

test("shape fontRef color overrides inherited document defaults while direct text color stays authoritative", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { readTextBody } = await import("/src/pptx-text.ts");
    const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
    const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
    const doc = (xml: string) =>
      new DOMParser().parseFromString(xml, "application/xml");
    const fill = (color: string) =>
      `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`;
    const defaults = doc(
      `<p:defaultTextStyle xmlns:p="${P}" xmlns:a="${A}"><a:lvl1pPr><a:defRPr>${fill("000000")}</a:defRPr></a:lvl1pPr></p:defaultTextStyle>`,
    ).documentElement;
    return [
      { run: "", paragraph: "", list: "" },
      { run: fill("FF0000"), paragraph: "", list: "" },
      { run: "", paragraph: fill("00FF00"), list: "" },
      { run: "", paragraph: "", list: fill("0000FF") },
    ].map(({ run, paragraph, list }) => {
      const shape = doc(
        `<p:sp xmlns:p="${P}" xmlns:a="${A}"><p:style><a:fontRef idx="minor"><a:srgbClr val="FFFFFF"/></a:fontRef></p:style><p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr><a:defRPr>${list}</a:defRPr></a:lvl1pPr></a:lstStyle><a:p><a:pPr><a:defRPr>${paragraph}</a:defRPr></a:pPr><a:r><a:rPr>${run}</a:rPr><a:t>Text</a:t></a:r></a:p></p:txBody></p:sp>`,
      ).documentElement;
      const element = readTextBody(
        shape.getElementsByTagNameNS(P, "txBody")[0],
        {
          nodes: [shape],
          defaultStyle: defaults,
          defaultFont: "Arial",
          font: (name) => name,
          defaultColor: "#000000",
          color: (node) => {
            const color = node
              ?.getElementsByTagNameNS(A, "srgbClr")[0]
              ?.getAttribute("val");
            return color ? { color: `#${color}`, opacity: 1 } : undefined;
          },
          geometry: { x: 0, y: 0, width: 200, height: 100, rotation: 0 },
          sx: 1,
          sy: 1,
        },
      );
      return element.paragraphs![0].runs[0].color;
    });
  });
  expect(result).toEqual(["#FFFFFF", "#FF0000", "#00FF00", "#0000FF"]);
});

test("ordinary shape text uses bodyPr rotation independently and retains it after a text edit", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { importPptx, exportPptx } = await import("/src/io.ts");
    const { editText } = await import("/src/text-layout.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const deck = blankDeck();
    deck.slides[0].elements = [
      element("shape", {
        shape: "rect",
        x: 200,
        y: 120,
        width: 300,
        height: 160,
        rotation: 90,
        textRotation: -90,
        text: "Horizontal",
        fill: "#4472C4",
        color: "#FFFFFF",
        fontFamily: "Arial",
        fontSize: 24,
        textInsets: [0, 0, 0, 0],
      }),
    ];
    let bytes = await exportPptx(deck);
    const records = [];
    for (let i = 0; i < 3; i++) {
      const imported = (await importPptx(bytes)).deck;
      const e = imported.slides[0].elements[0];
      const zip = await JSZip.loadAsync(bytes);
      const xml = new DOMParser().parseFromString(
        await zip.file("ppt/slides/slide1.xml")!.async("string"),
        "application/xml",
      );
      records.push({
        rotation: e.rotation,
        textRotation: e.textRotation,
        text: e.text,
        fill: e.fill,
        color: e.color,
        sourceRotation: xml
          .getElementsByTagNameNS("*", "bodyPr")[0]
          .getAttribute("rot"),
      });
      imported.slides[0].elements[0] = editText(e, `Edited ${i + 1}`);
      bytes = await exportPptx(imported);
    }
    return records;
  });
  expect(result.map((r) => r.text)).toEqual([
    "Horizontal",
    "Edited 1",
    "Edited 2",
  ]);
  for (const record of result)
    expect(record).toMatchObject({
      rotation: 90,
      textRotation: -90,
      fill: "#4472C4",
      color: "#FFFFFF",
      sourceRotation: "-5400000",
    });
});

test("rendered SmartArt glyphs have the web PowerPoint text angles independently of the shapes", async ({
  page,
}, info) => {
  test.skip(
    !fs.existsSync(sourcePath),
    "Fetch the pinned Apache POI public sample first",
  );
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { importPptx } = await import("/src/io.ts");
    const { deck } = await importPptx(
      await (
        await fetch("/qa/samples/poi-smartart-rotated-text.pptx")
      ).arrayBuffer(),
    );
    const { default: React } = await import(
      "/node_modules/.vite/deps/react.js"
    );
    const {
      default: { createRoot },
    } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { SlideVisual } = await import("/src/SlideCanvas.tsx");
    const host = document.createElement("div");
    host.id = "smartart-proof";
    const scale = 1280 / deck.width;
    host.style.cssText = `position:fixed;left:0;top:0;width:1280px;height:${deck.height * scale}px;z-index:2147483647;background:white;overflow:hidden`;
    document.body.append(host);
    createRoot(host).render(
      React.createElement(SlideVisual, {
        slide: deck.slides[0],
        width: deck.width,
        height: deck.height,
        scale,
      }),
    );
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    await document.fonts.ready;
    return [...host.querySelectorAll("[data-text-line]")]
      .filter((line) => line.textContent?.trim())
      .map((line) => {
        const span = line.querySelector("span")!;
        const text = span.firstChild!;
        const range = document.createRange();
        const point = (index: number) => {
          range.setStart(text, index);
          range.setEnd(text, index + 1);
          const r = range.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        };
        const first = point(0),
          last = point(text.textContent!.length - 1);
        return {
          text: line.textContent,
          color: getComputedStyle(span).color,
          angle:
            (Math.atan2(last.y - first.y, last.x - first.x) * 180) / Math.PI,
        };
      });
  });
  expect(result.map((r) => r.text)).toEqual(["abc", "def", "ghi", "jkl"]);
  const angles = [-41.31871666666667, 49.18118333333334, 0, 29.514083333333332];
  result.forEach((r, i) => {
    expect(r.angle).toBeCloseTo(angles[i], 1);
    expect(r.color).toBe(i < 3 ? "rgb(255, 255, 255)" : "rgb(0, 0, 0)");
  });
  await page
    .locator("#smartart-proof")
    .screenshot({ path: info.outputPath("smartart-text-angles.png") });
});

test("editing a rotated SmartArt label keeps its text rotation, font color and Undo/Redo after saving", async ({
  page,
}, info) => {
  test.skip(
    !fs.existsSync(sourcePath),
    "Fetch the pinned Apache POI public sample first",
  );
  test.setTimeout(60000);
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async () => {
    const { importPptx } = await import("/src/io.ts");
    const { saveAutosave } = await import("/src/storage.ts");
    const { deck } = await importPptx(
      await (
        await fetch("/qa/samples/poi-smartart-rotated-text.pptx")
      ).arrayBuffer(),
    );
    await saveAutosave(deck);
  });
  await page.reload();
  const shape = (text: string) =>
    page
      .locator(".editable-slide")
      .getByTestId("slide-element")
      .filter({ hasText: text });
  await shape("abc").dblclick({ force: true });
  const editor = page.getByRole("textbox", { name: "슬라이드 텍스트 편집" });
  await expect(editor.locator("[data-text-rotation]")).toHaveAttribute(
    "data-text-rotation",
    "-90",
  );
  await editor.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await editor.pressSequentially("XYZ");
  await editor.press("Escape");
  await expect(shape("XYZ").locator("[data-text-rotation]")).toHaveAttribute(
    "data-text-rotation",
    "-90",
  );
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+z" : "Control+z",
  );
  await expect(shape("abc")).toHaveCount(1);
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z",
  );
  await expect(shape("XYZ")).toHaveCount(1);
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  const saved = await page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const deck = await loadAutosave();
    const bytes = await exportPptx(deck!);
    const reopened = (await importPptx(bytes)).deck;
    const label = reopened.slides[0].elements.find((e) => e.text === "XYZ")!;
    return {
      bytes: [...bytes],
      label: {
        text: label.text,
        textRotation: label.textRotation,
        rotation: label.rotation,
        color: label.color,
        textFrame: label.textFrame,
      },
    };
  });
  expect(saved.label).toMatchObject({
    text: "XYZ",
    textRotation: -90,
    rotation: 48.68128333333333,
    color: "#FFFFFF",
  });
  expect(saved.label.textFrame).toHaveLength(4);
  fs.writeFileSync(
    info.outputPath("smartart-after-edit-undo-redo.pptx"),
    Buffer.from(saved.bytes),
  );
});
