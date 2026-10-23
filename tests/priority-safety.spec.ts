import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";

async function open(page: Page) {
  await page.addInitScript(() => {
    const command = document.execCommand.bind(document);
    document.execCommand = (name, ui, value) => {
      if (name !== "copy") return command(name, ui, value);
      const data = new DataTransfer();
      document.dispatchEvent(
        new ClipboardEvent("copy", {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        }),
      );
      (window as any).__copied = data;
      return true;
    };
  });
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async () => {
    const { blankDeck, newSlide, element } = await import("/src/model.ts");
    const { saveAutosave } = await import("/src/storage.ts");
    const deck = blankDeck();
    deck.slides = [newSlide("blank"), newSlide("blank"), newSlide("blank")];
    deck.slides.forEach((s, i) => {
      s.id = `slide-${i}`;
      s.notes = `note-${i}`;
    });
    deck.slides[0].elements = [
      element("shape", { id: "one", x: 565, y: 100, width: 100, height: 80 }),
      element("shape", { id: "two", x: 585, y: 230, width: 80, height: 80 }),
    ];
    await saveAutosave(deck);
  });
  await page.reload();
  await expect(page.locator(".thumbnail-button")).toHaveCount(3);
}
const item = (page: Page, id: string) =>
  page.locator(`[data-element-id="${id}"]`);
async function paste(page: Page, kind: "image" | "text" | "internal") {
  const pixel = fs.readFileSync("tests/fixtures/pixel.png").toString("base64");
  return page.evaluate(
    ({ kind, pixel }) => {
      const key = new KeyboardEvent("keydown", {
        key: "v",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(key);
      if (key.defaultPrevented) return { blocked: true };
      const data =
        kind === "internal" ? (window as any).__copied : new DataTransfer();
      if (kind === "image")
        data.items.add(
          new File(
            [Uint8Array.from(atob(pixel), (c) => c.charCodeAt(0))],
            "external.png",
            { type: "image/png" },
          ),
        );
      if (kind === "text") data.setData("text/plain", "외부에서 복사한 문장");
      document.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        }),
      );
      return { blocked: false };
    },
    { kind, pixel },
  );
}

test("Delete on blank canvas preserves the slide; focused thumbnail deletion and undo still work", async ({
  page,
}) => {
  await open(page);
  await page.getByTestId("slide-canvas").click({ position: { x: 20, y: 20 } });
  await page.keyboard.press("Delete");
  await page.keyboard.press("Backspace");
  await expect(page.locator(".thumbnail-button")).toHaveCount(3);
  await page.locator(".thumbnail-button").nth(1).click();
  await page.keyboard.press("Delete");
  await expect(page.locator(".thumbnail-button")).toHaveCount(2);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".thumbnail-button")).toHaveCount(3);
});

for (const kind of ["image", "text", "internal"] as const)
  test(`after internal copy, ${kind} paste uses the current clipboard`, async ({
    page,
  }) => {
    await open(page);
    await item(page, "one").click();
    await page.getByRole("button", { name: "복사", exact: true }).click();
    expect(await paste(page, kind)).toEqual({ blocked: false });
    await expect(page.getByTestId("slide-element")).toHaveCount(3);
    if (kind === "image")
      await expect(page.locator('[data-type="image"]')).toHaveCount(1);
    if (kind === "text")
      await expect(page.getByTestId("slide-canvas")).toContainText(
        "외부에서 복사한 문장",
      );
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.getByTestId("slide-element")).toHaveCount(2);
  });

test("center-guide and grid snapping preserve the offset of a multi-selection", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "보기", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "가운데 안내선", exact: true })
    .check();
  await item(page, "one").click();
  await item(page, "two").click({ modifiers: ["Shift"] });
  const canvas = (await page.getByTestId("slide-canvas").boundingBox())!;
  const scale = canvas.width / 1280;
  const box = (await item(page, "one").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 20 * scale,
    box.y + box.height / 2,
    { steps: 4 },
  );
  await page.mouse.up();
  const x = (id: string) =>
    item(page, id).evaluate((el) => parseFloat((el as HTMLElement).style.left));
  expect((await x("two")) - (await x("one"))).toBeCloseTo(20);
  await page.keyboard.press("ControlOrMeta+z");
  expect(await x("one")).toBe(565);
});

test("dropping a slide at the before marker inserts it before the indicated slide in both directions", async ({
  page,
}) => {
  await open(page);
  await page
    .locator(".thumbnail-row")
    .nth(0)
    .dragTo(page.locator(".slide-insertion-gap").nth(2));
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  const ids = () =>
    page.evaluate(async () =>
      (await (await import("/src/storage.ts")).loadAutosave())!.slides.map(
        (s) => s.id,
      ),
    );
  expect(await ids()).toEqual(["slide-1", "slide-0", "slide-2"]);
  await page
    .locator(".thumbnail-row")
    .nth(2)
    .dragTo(page.locator(".slide-insertion-gap").first());
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  expect(await ids()).toEqual(["slide-2", "slide-1", "slide-0"]);
});

test("refreshing slide/date fields preserves paragraph and run formatting", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { resolveDeckFields, todayText } = await import(
      "/src/insert-fields.ts"
    );
    const deck = blankDeck();
    const p = {
      lineHeight: 1.6,
      spaceBefore: 9,
      marginLeft: 12,
      runs: [
        {
          text: "old",
          fontFamilyEastAsian: "Malgun Gothic",
          letterSpacing: 2,
          italic: true,
        },
      ],
    };
    deck.slides[0].elements = [
      element("text", { text: "old", field: "slideNumber", paragraphs: [p] }),
      element("text", { text: "old", field: "date", paragraphs: [p] }),
    ];
    return {
      elements: resolveDeckFields(deck).slides[0].elements,
      today: todayText(),
    };
  });
  for (const [i, el] of result.elements.entries())
    expect(el.paragraphs).toEqual([
      {
        lineHeight: 1.6,
        spaceBefore: 9,
        marginLeft: 12,
        runs: [
          {
            text: i ? result.today : "1",
            fontFamilyEastAsian: "Malgun Gothic",
            letterSpacing: 2,
            italic: true,
          },
        ],
      },
    ]);
});

test("multi-selection scales positions and sizes together, vertical Shift drag respects ratio, rotated resize fixes its opposite edge", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const r = await page.evaluate(async () => {
    const { element } = await import("/src/model.ts");
    const { resizeElements } = await import("/src/canvas-resize.ts");
    const a = element("shape", {
        id: "a",
        x: 100,
        y: 100,
        width: 100,
        height: 100,
      }),
      b = element("shape", {
        id: "b",
        x: 300,
        y: 100,
        width: 100,
        height: 100,
      });
    const group = resizeElements([a, b], ["a", "b"], "se", 150, 50, false);
    const vertical = resizeElements([a], ["a"], "se", 0, 100, true)[0];
    const rotated = resizeElements(
      [{ ...a, rotation: 90 }],
      ["a"],
      "e",
      0,
      100,
      false,
    )[0];
    const line = resizeElements(
      [element("shape", { id: "line", shape: "line", width: 100, height: 1 })],
      ["line"],
      "e",
      100,
      0,
      false,
    )[0];
    return { group, vertical, rotated, line };
  });
  expect(r.group.map((e) => [e.x, e.y, e.width, e.height])).toEqual([
    [100, 100, 150, 150],
    [400, 100, 150, 150],
  ]);
  expect(r.vertical).toMatchObject({ x: 100, y: 100, width: 200, height: 200 });
  expect(r.rotated.x).toBeCloseTo(50);
  expect(r.rotated.y).toBeCloseTo(150);
  expect(r.rotated.width).toBeCloseTo(200);
  expect(r.rotated.height).toBeCloseTo(100);
  expect(r.line.width).toBe(200);
  expect(r.line.height).toBe(1);
});

test("group resize handles scale a selection together and make one undo step", async ({
  page,
}) => {
  await open(page);
  await item(page, "one").click();
  await item(page, "two").click({ modifiers: ["Shift"] });
  const group = page.getByTestId("selection-group");
  await expect(group).toBeVisible();
  const handle = (await group.getByTestId("resize-se").boundingBox())!;
  const scale =
    (await page.getByTestId("slide-canvas").boundingBox())!.width / 1280;
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2 + 50 * scale,
    handle.y + handle.height / 2 + 105 * scale,
    { steps: 4 },
  );
  await page.mouse.up();
  const geometry = () =>
    page.getByTestId("slide-element").evaluateAll((nodes) =>
      nodes.map((node) => {
        const s = (node as HTMLElement).style;
        return [s.left, s.top, s.width, s.height].map(parseFloat);
      }),
    );
  const resized = await geometry();
  for (const [i, value] of [565, 100, 150, 120].entries())
    expect(resized[0][i]).toBeCloseTo(value, 0);
  for (const [i, value] of [595, 295, 120, 120].entries())
    expect(resized[1][i]).toBeCloseTo(value, 0);
  await page.keyboard.press("ControlOrMeta+z");
  expect(await geometry()).toEqual([
    [565, 100, 100, 80],
    [585, 230, 80, 80],
  ]);
});

test("holding an arrow key uses one undo step without evicting the previous edit", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "텍스트", exact: true }).click();
  const added = page.getByTestId("slide-element").last();
  const x = () =>
    added.evaluate((node) => parseFloat((node as HTMLElement).style.left));
  const before = await x();
  for (let i = 0; i < 80; i++) await page.keyboard.down("ArrowRight");
  await page.keyboard.up("ArrowRight");
  expect(await x()).toBe(before + 80);
  await page.keyboard.press("ControlOrMeta+z");
  expect(await x()).toBe(before);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("slide-element")).toHaveCount(2);
});
