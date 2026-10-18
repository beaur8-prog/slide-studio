import { test, expect, type Page } from "@playwright/test";

async function seed(page: Page) {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { saveAutosave } = await import("/src/storage.ts");
    const d = blankDeck();
    d.slides[0].elements = [
      element("shape", { id: "a", x: 100, y: 100, width: 100, height: 100 }),
      element("shape", { id: "b", x: 300, y: 100, width: 100, height: 100 }),
      element("text", {
        id: "c",
        text: "한글",
        x: 800,
        y: 400,
        width: 200,
        height: 100,
      }),
    ];
    await saveAutosave(d);
  });
  await page.reload();
}
const item = (p: Page, id: string) => p.locator(`[data-element-id="${id}"]`);

test("marquee selects complete objects; Ctrl/Cmd click, grouping, independent duplication and ungrouping persist", async ({
  page,
}) => {
  await seed(page);
  const box = (await page.getByTestId("slide-canvas").boundingBox())!,
    scale = box.width / 1280;
  await page.mouse.move(box.x + 70 * scale, box.y + 70 * scale);
  await page.mouse.down();
  await page.mouse.move(box.x + 420 * scale, box.y + 230 * scale, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator(".slide-element.selected")).toHaveCount(2);
  await page.keyboard.press("ControlOrMeta+g");
  await page.getByTestId("slide-canvas").click({ position: { x: 10, y: 10 } });
  await item(page, "a").click();
  await expect(page.locator(".slide-element.selected")).toHaveCount(2);
  await page.keyboard.press("ControlOrMeta+d");
  await expect(page.getByTestId("slide-element")).toHaveCount(5);
  await page.getByTestId("slide-canvas").click({ position: { x: 10, y: 10 } });
  await item(page, "b").click({ position: { x: 2, y: 2 } });
  await expect(page.locator(".slide-element.selected")).toHaveCount(2);
  await page.keyboard.press("ControlOrMeta+Shift+g");
  await page.getByTestId("slide-canvas").click({ position: { x: 10, y: 10 } });
  await item(page, "a").click({ position: { x: 2, y: 2 } });
  await expect(page.locator(".slide-element.selected")).toHaveCount(1);
  await item(page, "c").click({ modifiers: ["ControlOrMeta"] });
  await expect(page.locator(".slide-element.selected")).toHaveCount(2);
});

test("rotation handle rotates a multi-selection around one center and supports undo", async ({
  page,
}) => {
  await seed(page);
  await item(page, "a").click();
  await item(page, "b").click({ modifiers: ["Shift"] });
  const h = (await page.getByTestId("rotate-handle").boundingBox())!;
  const c = (await page.getByTestId("slide-canvas").boundingBox())!,
    s = c.width / 1280;
  const cx = c.x + 250 * s,
    cy = c.y + 150 * s;
  const x = h.x + h.width / 2,
    y = h.y + h.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(cx + (cy - y), cy, { steps: 8 });
  await page.mouse.up();
  const matrix = await item(page, "a").evaluate((n) => {
    const m = new DOMMatrix(getComputedStyle(n).transform);
    return [m.a, m.b, m.c, m.d];
  });
  for (const [i, v] of [0, 1, -1, 0].entries())
    expect(matrix[i]).toBeCloseTo(v, 4);
  const pos = () =>
    item(page, "a").evaluate((n) => [
      (n as HTMLElement).style.left,
      (n as HTMLElement).style.top,
    ]);
  const moved = (await pos()).map(parseFloat);
  expect(moved[0]).toBeCloseTo(200, 3);
  expect(moved[1]).toBeCloseTo(0, 3);
  await page.keyboard.press("ControlOrMeta+z");
  expect(await pos()).toEqual(["100px", "100px"]);
});

test("nested group hierarchy survives native PPTX and project round trips without changing artwork geometry", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { exportPptx, importPptx, serializeDeck, parseDeckJson } =
      await import("/src/io.ts");
    const d = blankDeck();
    d.slides[0].elements = [
      element("shape", {
        x: 20,
        y: 30,
        width: 100,
        height: 80,
        groups: ["outer", "inner"],
      }),
      element("text", {
        text: "한글 묶음",
        x: 140,
        y: 30,
        width: 200,
        height: 80,
        groups: ["outer", "inner"],
      }),
      element("shape", {
        x: 40,
        y: 200,
        width: 100,
        height: 80,
        groups: ["outer"],
      }),
    ];
    let restored = parseDeckJson(serializeDeck(d));
    for (let i = 0; i < 3; i++)
      restored = (await importPptx(await exportPptx(restored))).deck;
    return {
      source: d.slides[0].elements,
      restored: restored.slides[0].elements,
    };
  });
  expect(result.restored).toHaveLength(3);
  for (let i = 0; i < 3; i++)
    for (const k of ["x", "y", "width", "height"] as const)
      expect(result.restored[i][k]).toBeCloseTo(result.source[i][k], 1);
  expect(result.restored.map((e) => e.groups?.length)).toEqual([2, 2, 1]);
  expect(new Set(result.restored.map((e) => e.groups?.[0])).size).toBe(1);
});

test("alignment and equal gaps use selected object bounds, and snapping finds other artwork edges", async ({
  page,
}) => {
  await seed(page);
  await item(page, "a").click();
  await item(page, "b").click({ modifiers: ["Shift"] });
  await item(page, "c").click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "서식", exact: true }).click();
  await page
    .getByRole("button", { name: "아래쪽 가장자리 맞춤", exact: true })
    .click();
  const y = () =>
    page
      .getByTestId("slide-element")
      .evaluateAll((nodes) =>
        nodes.map((n) => parseFloat((n as HTMLElement).style.top)),
      );
  expect(await y()).toEqual([400, 400, 400]);
  await page
    .getByRole("button", { name: "가로 간격 동일", exact: true })
    .click();
  expect(
    await item(page, "b").evaluate((n) =>
      parseFloat((n as HTMLElement).style.left),
    ),
  ).toBe(450);
  await page.keyboard.press("ControlOrMeta+z");
  expect(
    await item(page, "b").evaluate((n) =>
      parseFloat((n as HTMLElement).style.left),
    ),
  ).toBe(300);
  const r = await page.evaluate(async () => {
    const { snapMovement, arrangeElements } = await import(
        "/src/object-arrange.ts"
      ),
      { element } = await import("/src/model.ts");
    const items = [
      element("shape", { id: "a", x: 100, y: 100, width: 100, height: 100 }),
      element("shape", { id: "b", x: 300, y: 100, width: 100, height: 100 }),
    ];
    return {
      snap: snapMovement(items, ["a"], 98, 0, 1280, 720, 7),
      slide: arrangeElements(items, ["a", "b"], "bottom", 1280, 720, "slide"),
    };
  });
  expect(r.snap.dx).toBe(100);
  expect(r.snap.guides).toContainEqual({ axis: "x", at: 300 });
  expect(r.slide.map((e) => e.y)).toEqual([620, 620]);
});
