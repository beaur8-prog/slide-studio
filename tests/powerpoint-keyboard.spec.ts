import { test, expect, type Page } from "@playwright/test";

const object = (page: Page, id: string) =>
  page.locator(`.editable-slide [data-element-id="${id}"]`);
async function seed(page: Page, slides = 1) {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  const json = await page.evaluate(async (count) => {
    const { blankDeck, element, newSlide } = await import("/src/model.ts"),
      { serializeDeck } = await import("/src/io.ts");
    const deck = blankDeck();
    deck.name = "단축키 비교";
    deck.slides = Array.from({ length: count }, (_, i) => ({
      ...newSlide("blank"),
      notes: `노트 ${i + 1}`,
      elements: [
        element("text", {
          id: `first-${i}`,
          text: `슬라이드 ${i + 1}\nSecond paragraph`,
          paragraphs: [
            { runs: [{ text: `슬라이드 ${i + 1}` }] },
            { runs: [{ text: "Second paragraph" }] },
          ],
          x: 70,
          y: 70,
          width: 500,
          height: 140,
        }),
        element("shape", {
          id: `rect-${i}`,
          shape: "rect",
          x: 700,
          y: 180,
          width: 200,
          height: 100,
        }),
        element("text", {
          id: `locked-${i}`,
          text: "잠긴 글자",
          x: 70,
          y: 400,
          width: 400,
          height: 80,
          locked: true,
        }),
      ],
    }));
    return serializeDeck(deck);
  }, slides);
  await page.locator('input[accept*=".pptx"]').setInputFiles({
    name: "keyboard.slide",
    mimeType: "application/json",
    buffer: Buffer.from(json),
  });
  await expect(object(page, "first-0")).toBeVisible();
}
async function saved(page: Page) {
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  return page.evaluate(
    async () => (await (await import("/src/storage.ts")).loadAutosave())!,
  );
}

for (const modifier of ["Control", "Meta"]) {
  test(`${modifier}+E centers selected text objects, preserves locked objects and undoes once`, async ({
    page,
  }) => {
    await seed(page);
    await object(page, "first-0").click();
    await object(page, "locked-0").click({ modifiers: ["Shift"] });
    await page.keyboard.press(`${modifier}+e`);
    await expect(
      page.getByRole("button", { name: "가운데 정렬", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const d = await saved(page);
    expect(d.slides[0].elements[0].align).toBe("center");
    expect(d.slides[0].elements[2].align).toBe("left");
    await page.getByRole("button", { name: "실행 취소", exact: true }).click();
    expect((await saved(page)).slides[0].elements[0].align).toBe("left");
  });
}

test("paragraph alignment shortcut affects only the active paragraph and retains its caret and native text undo", async ({
  page,
}) => {
  await seed(page);
  await object(page, "first-0").dblclick();
  const editor = page.getByRole("textbox", {
    name: "슬라이드 텍스트 편집",
    exact: true,
  });
  await editor.evaluate((host) => {
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let node;
    while (walker.nextNode())
      if (walker.currentNode.textContent?.includes("Second"))
        node = walker.currentNode;
    if (!node) throw Error("Second paragraph missing");
    getSelection()!.setBaseAndExtent(node, 2, node, 2);
  });
  await page.keyboard.press("ControlOrMeta+e");
  await expect(editor).toBeFocused();
  await expect
    .poll(async () => {
      const d = await saved(page),
        e = d.slides[0].elements[0];
      return (e.paragraphs ?? []).map((p) => p.align ?? e.align);
    })
    .toEqual(["left", "center"]);
  await editor.press("ControlOrMeta+z");
  await expect
    .poll(async () => {
      const d = await saved(page),
        e = d.slides[0].elements[0];
      return (e.paragraphs ?? []).map((p) => p.align ?? e.align);
    })
    .toEqual(["left", "left"]);
});

test("Alt+arrow rotates a selected object by 15 degrees without nudging it and supports undo", async ({
  page,
}) => {
  await seed(page);
  const rect = object(page, "rect-0");
  await rect.click();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(rect).toHaveCSS("left", "700px");
  await expect(rect).toHaveCSS("top", "180px");
  expect((await saved(page)).slides[0].elements[1].rotation).toBe(15);
  await page.keyboard.press("Alt+ArrowLeft");
  expect((await saved(page)).slides[0].elements[1].rotation).toBe(0);
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  expect((await saved(page)).slides[0].elements[1].rotation).toBe(15);
});

test("Ctrl/Command+Shift+D duplicates the current slide even when a shape is selected", async ({
  page,
}) => {
  await seed(page);
  await object(page, "rect-0").click();
  await page.keyboard.press("ControlOrMeta+Shift+d");
  await expect(page.locator(".thumbnail-button")).toHaveCount(2);
  const d = await saved(page);
  expect(d.slides.map((s) => s.elements.length)).toEqual([3, 3]);
  expect(d.slides[1].notes).toBe("노트 1");
  expect(d.slides[1].elements[0].id).not.toBe(d.slides[0].elements[0].id);
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  await expect(page.locator(".thumbnail-button")).toHaveCount(1);
});

test("thumbnail Ctrl/Command+arrow reorders slides, keeps the selection and supports undo", async ({
  page,
}) => {
  await seed(page, 4);
  const thumbs = page.locator(".thumbnail-button");
  await thumbs.nth(1).click();
  await page.keyboard.press("ControlOrMeta+ArrowDown");
  await expect
    .poll(async () => (await saved(page)).slides.map((s) => s.notes))
    .toEqual(["노트 1", "노트 3", "노트 2", "노트 4"]);
  await expect(thumbs.nth(2)).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("ControlOrMeta+Shift+ArrowUp");
  await expect
    .poll(async () => (await saved(page)).slides.map((s) => s.notes))
    .toEqual(["노트 2", "노트 1", "노트 3", "노트 4"]);
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  await expect
    .poll(async () => (await saved(page)).slides.map((s) => s.notes))
    .toEqual(["노트 1", "노트 3", "노트 2", "노트 4"]);
});

test("editing fields keep ordinary Alt+arrow and paragraph shortcuts away from selected objects", async ({
  page,
}) => {
  await seed(page);
  await object(page, "rect-0").click();
  await page.getByRole("button", { name: "서식", exact: true }).click();
  const width = page.getByRole("spinbutton", { name: "너비", exact: true });
  await width.focus();
  await width.press("Alt+ArrowRight");
  await expect(width).toBeFocused();
  expect((await saved(page)).slides[0].elements[1].rotation).toBe(0);
  await page.getByRole("textbox", { name: "발표자 노트", exact: true }).focus();
  await page.keyboard.press("ControlOrMeta+e");
  expect((await saved(page)).slides[0].elements[0].align).toBe("left");
  await expect(
    page.getByRole("button", { name: "실행 취소", exact: true }),
  ).toBeDisabled();
});

test("context-menu one-step ordering never splits a neighboring group", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  const json = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts"),
      { serializeDeck } = await import("/src/io.ts");
    const d = blankDeck();
    d.slides[0].elements = ["a1", "a2", "b1", "b2"].map((id, i) =>
      element("shape", {
        id,
        x: 70 + i * 220,
        y: 140,
        width: 150,
        height: 100,
        groups: [id[0]],
        groupNames: [id[0]],
      }),
    );
    return serializeDeck(d);
  });
  await page.locator('input[accept*=".pptx"]').setInputFiles({
    name: "groups.slide",
    mimeType: "application/json",
    buffer: Buffer.from(json),
  });
  await object(page, "a1").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "앞으로 한 단계", exact: true })
    .click();
  expect((await saved(page)).slides[0].elements.map((e) => e.id)).toEqual([
    "b1",
    "b2",
    "a1",
    "a2",
  ]);
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  expect((await saved(page)).slides[0].elements.map((e) => e.id)).toEqual([
    "a1",
    "a2",
    "b1",
    "b2",
  ]);
});

test("alignment shortcuts do not reload the presentation and left/right changes undo independently", async ({
  page,
}) => {
  await seed(page);
  let navigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations++;
  });
  await object(page, "first-0").click();
  for (const [key, align] of [
    ["e", "center"],
    ["r", "right"],
    ["l", "left"],
  ]) {
    await page.keyboard.press(`ControlOrMeta+${key}`);
    expect((await saved(page)).slides[0].elements[0].align).toBe(align);
  }
  expect(navigations).toBe(0);
  await page.keyboard.press("ControlOrMeta+z");
  expect((await saved(page)).slides[0].elements[0].align).toBe("right");
});

test("holding the rotation shortcut creates one undo entry and does not remove the preceding edit", async ({
  page,
}) => {
  await seed(page);
  await object(page, "first-0").click();
  await page.keyboard.press("ControlOrMeta+b");
  await object(page, "rect-0").click();
  await page.keyboard.down("Alt");
  for (let i = 0; i < 4; i++) await page.keyboard.down("ArrowRight");
  await page.keyboard.up("ArrowRight");
  await page.keyboard.up("Alt");
  expect((await saved(page)).slides[0].elements[1].rotation).toBe(60);
  await page.keyboard.press("ControlOrMeta+z");
  let d = await saved(page);
  expect(d.slides[0].elements[1].rotation).toBe(0);
  expect(d.slides[0].elements[0].bold).toBe(true);
  await page.keyboard.press("ControlOrMeta+z");
  d = await saved(page);
  expect(!!d.slides[0].elements[0].bold).toBe(false);
});

test("moving a selected slide range preserves its order, selection and keyboard focus", async ({
  page,
}) => {
  await seed(page, 4);
  const thumbs = page.locator(".thumbnail-button");
  await thumbs.first().click();
  await thumbs.nth(2).click({ modifiers: ["Shift"] });
  await page.keyboard.press("ControlOrMeta+ArrowDown");
  expect((await saved(page)).slides.map((s) => s.notes)).toEqual([
    "노트 4",
    "노트 1",
    "노트 2",
    "노트 3",
  ]);
  await expect(thumbs.nth(3)).toBeFocused();
  expect(
    await thumbs.evaluateAll(
      (nodes) =>
        nodes.filter((n) => n.getAttribute("aria-pressed") === "true").length,
    ),
  ).toBe(3);
  await page.keyboard.press("ControlOrMeta+Shift+ArrowUp");
  expect((await saved(page)).slides.map((s) => s.notes)).toEqual([
    "노트 1",
    "노트 2",
    "노트 3",
    "노트 4",
  ]);
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  expect((await saved(page)).slides.map((s) => s.notes)).toEqual([
    "노트 4",
    "노트 1",
    "노트 2",
    "노트 3",
  ]);
});

test("AltGr-style character shortcuts cannot invoke Save or Print while typing", async ({
  page,
}) => {
  await seed(page);
  await object(page, "first-0").dblclick();
  const editor = page.getByRole("textbox", {
    name: "슬라이드 텍스트 편집",
    exact: true,
  });
  const handled = await editor.evaluate((host) =>
    ["s", "p"].map((key) => {
      const e = new KeyboardEvent("keydown", {
        key,
        ctrlKey: true,
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      host.dispatchEvent(e);
      return e.defaultPrevented;
    }),
  );
  expect(handled).toEqual([false, false]);
  await expect(page.locator(".busy-backdrop")).toHaveCount(0);
  await expect(editor).toBeFocused();
  await page.keyboard.insertText("ś");
  await expect(editor).toContainText("ś");
});

test("keyboard slide order clamps at edges and keeps discontiguous selected slides in source order", async ({
  page,
}) => {
  await seed(page);
  const result = await page.evaluate(async () => {
    const { newSlide } = await import("/src/model.ts"),
      { stepSlides } = await import("/src/slide-operations.ts");
    const slides = [0, 1, 2, 3, 4].map((i) => ({
      ...newSlide("blank"),
      id: String(i),
    }));
    const ids = (s: typeof slides) => s.map((x) => x.id);
    return {
      up: ids(stepSlides(slides, ["1", "3"], -1)),
      down: ids(stepSlides(slides, ["1", "3"], 1)),
      front: ids(stepSlides(slides, ["1", "3"], -1, true)),
      back: ids(stepSlides(slides, ["1", "3"], 1, true)),
      same: stepSlides(slides, ["0"], -1) === slides,
    };
  });
  expect(result).toEqual({
    up: ["1", "0", "3", "2", "4"],
    down: ["0", "2", "1", "4", "3"],
    front: ["1", "3", "0", "2", "4"],
    back: ["0", "2", "4", "1", "3"],
    same: true,
  });
});
