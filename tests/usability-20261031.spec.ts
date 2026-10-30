import { expect, test, type Page } from "@playwright/test";
import PptxGenJS from "pptxgenjs";

async function ready(page: Page) {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
}

test("a 24pt PowerPoint title displays 24 in the font-size field without changing its 32px rendering", async ({
  page,
}) => {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.addSlide().addText("원본 크기 24pt", {
    x: 1,
    y: 1,
    w: 8,
    h: 1,
    fontFace: "Arial",
    fontSize: 24,
  });
  const bytes = (await pptx.write({ outputType: "uint8array" })) as Uint8Array;
  await ready(page);
  await page.locator('input[accept*=".pptx"]').setInputFiles({
    name: "font-24pt.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from(bytes),
  });
  const title = page
    .locator('.editable-slide [data-type="text"]')
    .filter({ hasText: "원본 크기 24pt" });
  await title.click();
  await expect(
    page.getByRole("spinbutton", { name: "글자 크기", exact: true }),
  ).toHaveValue("24");
  await expect(title.locator(".element-text")).toHaveCSS("font-size", "32px");
  await expect(
    page.getByRole("button", { name: "실행 취소", exact: true }),
  ).toBeDisabled();
});

test("resizing a group containing a zero-width marker produces finite geometry and keeps the marker zero-width", async ({
  page,
}) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const { element } = await import("/src/model.ts");
    const { resizeElements } = await import("/src/canvas-resize.ts");
    const members = [
      element("shape", {
        id: "zero",
        x: 30,
        y: 30,
        width: 0,
        height: 0,
        groups: ["group"],
      }),
      element("shape", {
        id: "normal",
        x: 100,
        y: 100,
        width: 200,
        height: 100,
        groups: ["group"],
      }),
    ];
    const next = resizeElements(
      members,
      ["zero", "normal"],
      "se",
      100,
      50,
      false,
    );
    return {
      finite: next.every((e) =>
        [e.x, e.y, e.width, e.height].every(Number.isFinite),
      ),
      zero: next[0],
      normal: next[1],
    };
  });
  expect(result.finite).toBe(true);
  expect(result.zero.width).toBe(0);
  expect(result.zero.height).toBe(0);
  expect(result.normal.width).toBeGreaterThan(200);
  expect(result.normal.width).toBeLessThan(400);
});

test("Shift-constrained horizontal dragging does not move the other axis when grid snapping is on", async ({
  page,
}) => {
  await ready(page);
  await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts"),
      { saveAutosave } = await import("/src/storage.ts");
    const deck = blankDeck();
    deck.slides[0].elements = [
      element("shape", {
        id: "grid-object",
        x: 103,
        y: 103,
        width: 200,
        height: 100,
        fill: "#2367CC",
        strokeWidth: 0,
      }),
    ];
    await saveAutosave(deck);
  });
  await page.reload();
  await page.getByRole("button", { name: "보기", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "눈금에 맞추기", exact: true })
    .check();
  const object = page.locator(
    '.editable-slide [data-element-id="grid-object"]',
  );
  await object.click();
  const box = await object.boundingBox();
  if (!box) throw Error("No object bounds");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.keyboard.down("Shift");
  await page.mouse.move(
    box.x + box.width / 2 + 103,
    box.y + box.height / 2 + 6,
    { steps: 8 },
  );
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(object).toHaveCSS("top", "103px");
  await expect(
    page.getByRole("button", { name: "실행 취소", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(object).toHaveCSS("left", "103px");
  await expect(object).toHaveCSS("top", "103px");
});

async function seedFonts(page: Page) {
  await ready(page);
  await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts"),
      { saveAutosave } = await import("/src/storage.ts");
    const deck = blankDeck();
    deck.slides[0].elements = [
      element("text", {
        id: "mixed-fonts",
        x: 90,
        y: 90,
        width: 900,
        height: 280,
        fontSize: 24,
        text: "Alpha Beta Gamma",
        paragraphs: [
          {
            runs: [
              { text: "Alpha ", fontSize: 24, bold: true },
              { text: "Beta", fontSize: 32, italic: true },
              { text: " Gamma", fontSize: 48, color: "#123456" },
            ],
          },
        ],
      }),
    ];
    await saveAutosave(deck);
  });
  await page.reload();
}
async function fontSnapshot(page: Page) {
  return page.evaluate(async () => {
    const e = (await (await import("/src/storage.ts")).loadAutosave())!
      .slides[0].elements[0];
    return e.paragraphs!.flatMap((p) =>
      p.runs.flatMap((r) =>
        Array.from(r.text, (c) => ({
          c,
          size:
            Math.round((r.fontSize ?? p.fontSize ?? e.fontSize!) * 1000) / 1000,
          bold: r.bold ?? e.bold ?? false,
          italic: r.italic ?? e.italic ?? false,
          color: r.color ?? e.color,
        })),
      ),
    );
  });
}

test("font grow/shrink preserves a partial mixed-size selection, styles and one-step undo", async ({
  page,
}) => {
  await seedFonts(page);
  await page
    .locator('.editable-slide [data-element-id="mixed-fonts"]')
    .dblclick();
  const host = page.getByRole("textbox", {
    name: "슬라이드 텍스트 편집",
    exact: true,
  });
  await host.evaluate(async (h) => {
    const { restoreTextOffsets } = await import("/src/text-selection.ts");
    restoreTextOffsets(h, 6, 12);
  });
  const before = await fontSnapshot(page);
  await page.getByRole("button", { name: "글자 크게", exact: true }).click();
  await expect(host).toBeFocused();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe("Beta G");
  await expect
    .poll(async () => (await fontSnapshot(page)).map((c) => c.size))
    .toEqual([
      ...Array(6).fill(24),
      ...Array(4).fill(34.667),
      ...Array(2).fill(53.333),
      ...Array(4).fill(48),
    ]);
  const after = await fontSnapshot(page);
  expect(after.map(({ size, ...rest }) => rest)).toEqual(
    before.map(({ size, ...rest }) => rest),
  );
  await expect(
    page.getByRole("spinbutton", { name: "글자 크기", exact: true }),
  ).toHaveValue("26");
  await host.press("ControlOrMeta+z");
  await expect.poll(() => fontSnapshot(page)).toEqual(before);
  await host.press("ControlOrMeta+Shift+z");
  await expect.poll(() => fontSnapshot(page)).toEqual(after);
  // Native redo restores the insertion endpoint; choose the same range again
  // before testing the independent shrink command.
  await host.evaluate(async (h) => {
    const { restoreTextOffsets } = await import("/src/text-selection.ts");
    restoreTextOffsets(h, 6, 12);
  });
  await host.press("ControlOrMeta+Shift+,");
  await expect.poll(() => fontSnapshot(page)).toEqual(before);
});

test("font shortcuts update selected objects independently, persist through PPTX and do not intercept numeric fields", async ({
  page,
}) => {
  await seedFonts(page);
  const object = page.locator(
    '.editable-slide [data-element-id="mixed-fonts"]',
  );
  await object.click();
  const before = await fontSnapshot(page);
  await page.keyboard.press("ControlOrMeta+Shift+.");
  await expect
    .poll(async () => (await fontSnapshot(page)).map((c) => c.size))
    .toEqual([
      ...Array(6).fill(26.667),
      ...Array(4).fill(34.667),
      ...Array(6).fill(53.333),
    ]);
  const expected = await fontSnapshot(page);
  const field = page.getByRole("spinbutton", {
    name: "글자 크기",
    exact: true,
  });
  await field.focus();
  await field.press("ControlOrMeta+Shift+.");
  expect(await fontSnapshot(page)).toEqual(expected);
  await field.press("Escape");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => fontSnapshot(page)).toEqual(before);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(() => fontSnapshot(page)).toEqual(expected);
  const roundTrip = await page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts"),
      { exportPptx, importPptx } = await import("/src/io.ts");
    const e = (await importPptx(await exportPptx((await loadAutosave())!))).deck
      .slides[0].elements[0];
    return e.paragraphs!.flatMap((p) =>
      p.runs.flatMap((r) =>
        Array(r.text.length).fill(r.fontSize ?? p.fontSize ?? e.fontSize),
      ),
    );
  });
  expect(roundTrip.map((size) => Math.round(size * 1000) / 1000)).toEqual(
    expected.map((c) => c.size),
  );
});

async function seedArrange(page: Page) {
  await ready(page);
  await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts"),
      { saveAutosave } = await import("/src/storage.ts");
    const d = blankDeck();
    d.slides[0].elements = [
      element("shape", { id: "a", x: 110, y: 110, width: 100, height: 100 }),
      element("shape", { id: "b", x: 355, y: 255, width: 200, height: 120 }),
      element("shape", { id: "c", x: 710, y: 410, width: 100, height: 80 }),
    ];
    await saveAutosave(d);
  });
  await page.reload();
}
const arrangedItem = (page: Page, id: string) =>
  page.locator(`.editable-slide [data-element-id="${id}"]`);
async function selectArrange(page: Page) {
  await arrangedItem(page, "a").click();
  await arrangedItem(page, "b").click({ modifiers: ["Shift"] });
  await arrangedItem(page, "c").click({ modifiers: ["Shift"] });
}
async function arrangePositions(page: Page) {
  return page
    .getByTestId("slide-element")
    .evaluateAll((nodes) =>
      nodes.map((n) => [
        (n as HTMLElement).style.left,
        (n as HTMLElement).style.top,
      ]),
    );
}

test("Home object alignment uses selection or slide bounds, distributes with equal gaps, and restores focus and undo", async ({
  page,
}) => {
  await seedArrange(page);
  await selectArrange(page);
  const before = await arrangePositions(page);
  const trigger = page.getByRole("button", { name: "개체 맞춤", exact: true });
  await trigger.click();
  let menu = page.getByRole("menu", { name: "개체 맞춤", exact: true });
  await expect(
    menu.getByRole("menuitemradio", { name: "선택 개체에 맞춤" }),
  ).toHaveAttribute("aria-checked", "true");
  await menu
    .getByRole("menuitem", { name: "아래쪽 가장자리 맞춤", exact: true })
    .click();
  await expect(trigger).toBeFocused();
  expect(await arrangePositions(page)).toEqual([
    ["110px", "390px"],
    ["355px", "370px"],
    ["710px", "410px"],
  ]);
  await page.keyboard.press("ControlOrMeta+z");
  expect(await arrangePositions(page)).toEqual(before);
  await trigger.click();
  await menu.getByRole("menuitemradio", { name: "슬라이드에 맞춤" }).click();
  await expect(menu).toBeVisible();
  await menu
    .getByRole("menuitem", { name: "가로 간격 동일하게", exact: true })
    .click();
  expect(await arrangePositions(page)).toEqual([
    ["0px", "110px"],
    ["540px", "255px"],
    ["1180px", "410px"],
  ]);
  await page.keyboard.press("ControlOrMeta+z");
  expect(await arrangePositions(page)).toEqual(before);
  await trigger.click();
  await menu.press("End");
  await menu.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(
    page.getByRole("button", { name: "실행 취소", exact: true }),
  ).toBeDisabled();
});

test("alignment scope changes and menu shortcuts do not edit the document; one object aligns to the slide", async ({
  page,
}) => {
  await seedArrange(page);
  await arrangedItem(page, "a").click();
  await page.getByRole("button", { name: "개체 맞춤", exact: true }).click();
  const menu = page.getByRole("menu", { name: "개체 맞춤", exact: true });
  await expect(
    menu.getByRole("menuitemradio", { name: "선택 개체에 맞춤" }),
  ).toBeDisabled();
  await expect(
    menu.getByRole("menuitem", { name: "가로 간격 동일하게" }),
  ).toBeDisabled();
  await menu.press("ControlOrMeta+Shift+.");
  await expect(
    page.getByRole("button", { name: "실행 취소", exact: true }),
  ).toBeDisabled();
  await menu
    .getByRole("menuitem", { name: "가로 가운데 맞춤", exact: true })
    .click();
  await expect(arrangedItem(page, "a")).toHaveCSS("left", "590px");
  await expect(arrangedItem(page, "a")).toHaveCSS("top", "110px");
});

test("grid display, grid snapping and smart guides are independent view settings with no edit history", async ({
  page,
}) => {
  await seedArrange(page);
  await page.getByRole("button", { name: "보기", exact: true }).click();
  const canvas = page.getByTestId("slide-canvas");
  await expect(
    page.getByRole("checkbox", { name: "개체에 맞추기", exact: true }),
  ).toBeChecked();
  await expect(canvas).not.toHaveClass(/grid-visible/);
  await page
    .getByRole("checkbox", { name: "눈금에 맞추기", exact: true })
    .check();
  await expect(canvas).not.toHaveClass(/grid-visible/);
  await page.getByRole("checkbox", { name: "눈금 표시", exact: true }).check();
  await expect(canvas).toHaveClass(/grid-visible/);
  await page
    .getByRole("checkbox", { name: "개체에 맞추기", exact: true })
    .uncheck();
  await page
    .getByRole("checkbox", { name: "가운데 안내선", exact: true })
    .check();
  await expect(
    page.getByRole("checkbox", { name: "개체에 맞추기", exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "실행 취소", exact: true }),
  ).toBeDisabled();
});

test("repeated font growth at a caret previews the pending point size and applies only to newly typed text", async ({
  page,
}) => {
  await seedFonts(page);
  await arrangedItem(page, "mixed-fonts").dblclick();
  const host = page.getByRole("textbox", {
    name: "슬라이드 텍스트 편집",
    exact: true,
  });
  await host.evaluate(async (h) => {
    const { restoreTextOffsets } = await import("/src/text-selection.ts");
    restoreTextOffsets(h, 10, 10);
  });
  const before = await fontSnapshot(page);
  await page.getByRole("button", { name: "글자 크게", exact: true }).click();
  await page.getByRole("button", { name: "글자 크게", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "글자 크기", exact: true }),
  ).toHaveValue("28");
  expect(await fontSnapshot(page)).toEqual(before);
  await page.keyboard.insertText("새");
  await expect
    .poll(async () => (await fontSnapshot(page))[10].size)
    .toBe(37.333);
  await host.evaluate(async (h) => {
    const { restoreTextOffsets } = await import("/src/text-selection.ts");
    restoreTextOffsets(h, 2, 2);
  });
  await expect(
    page.getByRole("spinbutton", { name: "글자 크기", exact: true }),
  ).toHaveValue("18");
  await page.keyboard.insertText("글");
  await expect.poll(async () => (await fontSnapshot(page))[2].size).toBe(24);
});
