import { expect, test, type Page } from "@playwright/test";

const shape = (page: Page, id = "triangle") =>
  page.locator(`.editable-slide [data-element-id="${id}"]`);
const handle = (page: Page, index: number) =>
  page.getByTestId(`triangle-point-${index}`);
const undo = (page: Page) =>
  page.getByRole("button", { name: "실행 취소", exact: true });
const redo = (page: Page) =>
  page.getByRole("button", { name: "다시 실행", exact: true });

async function seed(
  page: Page,
  options: { rotation?: number; flipH?: boolean; flipV?: boolean } = {},
) {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async (options) => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { saveAutosave } = await import("/src/storage.ts");
    const deck = blankDeck();
    deck.slides[0].elements = [
      element("shape", {
        id: "triangle",
        shape: "triangle",
        x: 300,
        y: 220,
        width: 300,
        height: 240,
        fill: "#4080C0",
        stroke: "#15283A",
        strokeWidth: 3,
        text: "원본 텍스트",
        ...options,
      }),
    ];
    await saveAutosave(deck);
  }, options);
  await page.reload();
  await expect(shape(page)).toBeVisible();
  await shape(page).click({ position: { x: 100, y: 100 } });
  await expect(page.locator(".shape-point-handle")).toHaveCount(3);
}

async function visiblePoints(page: Page, id = "triangle") {
  return shape(page, id).evaluate((node: HTMLElement) => {
    const width = parseFloat(node.style.width),
      height = parseFloat(node.style.height);
    const path = node.querySelector<SVGPathElement>(".element-svg path");
    const polygon = node.querySelector<SVGPolygonElement>("polygon");
    if (polygon)
      return Array.from(polygon.points).map((p) => [p.x / width, p.y / height]);
    const matrix = (
      path!.parentElement as unknown as SVGGElement
    ).transform.baseVal.consolidate()!.matrix;
    const values = path!
      .getAttribute("d")!
      .match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi)!
      .map(Number);
    return [0, 2, 4].map((i) => [
      Math.round(((values[i] * matrix.a) / width) * 1e5) / 1e5,
      Math.round(((values[i + 1] * matrix.d) / height) * 1e5) / 1e5,
    ]);
  });
}

async function box(page: Page, id = "triangle") {
  return shape(page, id).evaluate((node: HTMLElement) => [
    node.style.left,
    node.style.top,
    node.style.width,
    node.style.height,
    node.style.transform,
  ]);
}

async function dragPoint(page: Page, index: number, dx: number, dy: number) {
  const start = await handle(page, index).boundingBox();
  expect(start).not.toBeNull();
  const scale = await page
    .getByTestId("slide-canvas")
    .evaluate(
      (node: HTMLElement) =>
        node.getBoundingClientRect().width / node.offsetWidth,
    );
  await page.mouse.move(
    start!.x + start!.width / 2,
    start!.y + start!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    start!.x + start!.width / 2 + dx * scale,
    start!.y + start!.height / 2 + dy * scale,
    { steps: 12 },
  );
  await page.mouse.up();
}

async function persisted(page: Page, id = "triangle") {
  // Wait for autosave contents, not the previous render's saved status label.
  const expected = await visiblePoints(page, id);
  const read = () =>
    page.evaluate(async (id) => {
      const { loadAutosave } = await import("/src/storage.ts");
      const { trianglePoints } = await import("/src/shape-points.ts");
      const deck = (await loadAutosave())!;
      const element = deck.slides[0].elements.find((e) => e.id === id)!;
      return {
        element,
        points: element && trianglePoints(element)?.map((p) => [p.x, p.y]),
      };
    }, id);
  await expect
    .poll(async () =>
      (await read()).points?.flat().map((v) => Math.round(v * 1e5)),
    )
    .toEqual(expected.flat().map((v) => Math.round(v * 1e5)));
  return read();
}

test("dragging a triangle vertex changes only that vertex, with one undo and durable JSON/PPTX geometry", async ({
  page,
}, info) => {
  await seed(page);
  const original = await visiblePoints(page);
  const originalBox = await box(page);
  await dragPoint(page, 0, 60, 36);
  const moved = await visiblePoints(page);
  expect(moved[0][0]).toBeCloseTo(0.7, 2);
  expect(moved[0][1]).toBeCloseTo(0.15, 2);
  expect(moved.slice(1)).toEqual(original.slice(1));
  expect(await box(page)).toEqual(originalBox);
  await undo(page).click();
  expect(await visiblePoints(page)).toEqual(original);
  await expect(undo(page)).toBeDisabled();
  await redo(page).click();
  expect(await visiblePoints(page)).toEqual(moved);
  const saved = await persisted(page);
  expect(saved.element).toMatchObject({
    fill: "#4080C0",
    stroke: "#15283A",
    strokeWidth: 3,
    text: "원본 텍스트",
  });
  await page.reload();
  expect(await visiblePoints(page)).toEqual(moved);
  const roundTrip = await page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts");
    const { exportPptx, importPptx, parseDeckJson, serializeDeck } =
      await import("/src/io.ts");
    const { trianglePoints } = await import("/src/shape-points.ts");
    const deck = parseDeckJson(serializeDeck((await loadAutosave())!));
    const imported = await importPptx(await exportPptx(deck));
    return {
      points: trianglePoints(imported.deck.slides[0].elements[0])?.map((p) => [
        p.x,
        p.y,
      ]),
      element: imported.deck.slides[0].elements[0],
      warnings: imported.warnings,
    };
  });
  expect(roundTrip.points, JSON.stringify(roundTrip)).toBeDefined();
  roundTrip
    .points!.flat()
    .forEach((p, i) => expect(p).toBeCloseTo(moved.flat()[i], 4));
  expect(roundTrip.element).toMatchObject({
    fill: "#4080C0",
    stroke: "#15283A",
    strokeWidth: 3,
    text: "원본 텍스트",
  });
  expect(roundTrip.warnings).toEqual([]);
  await shape(page).click();
  await page
    .getByTestId("canvas-frame")
    .screenshot({ path: info.outputPath("editable-triangle.png") });
});

test("PowerPoint adjustment guides and Edit Points custom geometry retain their original vertices and can both be dragged", async ({
  page,
}, info) => {
  await page.goto("http://127.0.0.1:5190");
  const source = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { exportPptx } = await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const deck = blankDeck();
    deck.slides[0].elements = [];
    const zip = await JSZip.loadAsync(await exportPptx(deck));
    // Independent literal OOXML inputs: a native yellow-handle adjustment,
    // and all three points edited (including a vertex outside the shape box).
    const geometries = [
      '<a:prstGeom prst="triangle"><a:avLst><a:gd name="adj" fmla="val 20000"/></a:avLst></a:prstGeom>',
      '<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="300" b="240"/><a:pathLst><a:path w="300" h="240"><a:moveTo><a:pt x="-30" y="216"/></a:moveTo><a:lnTo><a:pt x="210" y="-24"/></a:lnTo><a:lnTo><a:pt x="270" y="192"/></a:lnTo><a:lnTo><a:pt x="-30" y="216"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>',
    ];
    const xml = geometries
      .map(
        (g, i) =>
          `<p:sp><p:nvSpPr><p:cNvPr id="${i + 2}" name="edited-${i}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${(250 + i * 440) * 9525}" y="${220 * 9525}"/><a:ext cx="${300 * 9525}" cy="${240 * 9525}"/></a:xfrm>${g}<a:solidFill><a:srgbClr val="4080C0"/></a:solidFill><a:ln w="28575"><a:solidFill><a:srgbClr val="15283A"/></a:solidFill></a:ln></p:spPr></p:sp>`,
      )
      .join("");
    const name = "ppt/slides/slide1.xml";
    zip.file(
      name,
      (await zip.file(name)!.async("string")).replace(
        "</p:spTree>",
        xml + "</p:spTree>",
      ),
    );
    return Array.from(await zip.generateAsync({ type: "uint8array" }));
  });
  await page.locator('input[type=file][accept*=".pptx"]').setInputFiles({
    name: "powerpoint-edited-vertices.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from(source),
  });
  await expect(page.locator('.editable-slide [data-type="shape"]')).toHaveCount(
    2,
  );
  const ids = await page
    .locator('.editable-slide [data-type="shape"]')
    .evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("data-element-id")!),
    );
  const original = await Promise.all(ids.map((id) => visiblePoints(page, id)));
  expect(original[0]).toEqual([
    [0, 1],
    [0.2, 0],
    [1, 1],
  ]);
  expect(original[1]).toEqual([
    [-0.1, 0.9],
    [0.7, -0.1],
    [0.9, 0.8],
  ]);
  for (const id of ids) {
    await shape(page, id).click();
    await expect(page.locator(".shape-point-handle")).toHaveCount(3);
    const before = await visiblePoints(page, id);
    const beforeBox = await box(page, id);
    await dragPoint(page, 1, 30, 24);
    const after = await visiblePoints(page, id);
    expect(after[1][0]).toBeCloseTo(before[1][0] + 0.1, 2);
    expect(after[1][1]).toBeCloseTo(before[1][1] + 0.1, 2);
    expect(after[0]).toEqual(before[0]);
    expect(after[2]).toEqual(before[2]);
    expect(await box(page, id)).toEqual(beforeBox);
    await persisted(page, id);
  }
  await page
    .getByTestId("canvas-frame")
    .screenshot({ path: info.outputPath("powerpoint-imported-triangles.png") });
  await page.keyboard.press("F5");
  await expect(page.getByTestId("presentation-view")).toBeVisible();
  await expect(
    page.locator(".presentation-view .shape-point-handle"),
  ).toHaveCount(0);
  await expect(
    page.locator(".presentation-view .element-svg path"),
  ).toHaveCount(2);
});

for (const options of [
  { rotation: 37, flipH: true },
  { rotation: -48, flipH: true, flipV: true },
])
  test(`vertex movement respects rotation and reflections ${JSON.stringify(options)}`, async ({
    page,
  }) => {
    await seed(page, options);
    const originalBox = await box(page);
    const bounds = await handle(page, 0).boundingBox();
    await dragPoint(page, 0, 40, 25);
    const after = await handle(page, 0).boundingBox();
    const scale = await page
      .getByTestId("slide-canvas")
      .evaluate(
        (n: HTMLElement) => n.getBoundingClientRect().width / n.offsetWidth,
      );
    expect(after!.x - bounds!.x).toBeCloseTo(40 * scale, 0);
    expect(after!.y - bounds!.y).toBeCloseTo(25 * scale, 0);
    expect(await box(page)).toEqual(originalBox);
    await persisted(page);
  });

test("keyboard point edits and box resizing coexist, while locked and multiselected shapes have no point handles", async ({
  page,
}) => {
  await seed(page);
  await handle(page, 0).focus();
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("ArrowDown");
  const points = await visiblePoints(page);
  expect(points[0][0]).toBeCloseTo(0.5 + 10 / 300, 5);
  expect(points[0][1]).toBeCloseTo(1 / 240, 5);
  const corner = await page.getByTestId("resize-se").boundingBox();
  await page.mouse.move(
    corner!.x + corner!.width / 2,
    corner!.y + corner!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(corner!.x + 30, corner!.y + 30, { steps: 5 });
  await page.mouse.up();
  expect(parseFloat((await box(page))[2])).toBeGreaterThan(300);
  expect(await visiblePoints(page)).toEqual(points);
  await page.keyboard.press("ControlOrMeta+d");
  await page.keyboard.press("ControlOrMeta+a");
  await expect(
    page.locator(".editable-slide .slide-element.selected"),
  ).toHaveCount(2);
  await expect(page.locator(".shape-point-handle")).toHaveCount(0);
  const front = page.locator(".editable-slide .slide-element").last();
  await front.click({ button: "right" });
  await page.getByRole("menuitem", { name: "잠금", exact: true }).click();
  await expect(front).toHaveClass(/locked/);
  await expect(page.locator(".shape-point-handle")).toHaveCount(0);
});
