import { expect, test, type Page } from "@playwright/test";

async function seed(page: Page, blank = false) {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  const json = await page.evaluate(async (blank) => {
    const { blankDeck, element, newSlide } = await import("/src/model.ts");
    const deck = blankDeck();
    deck.slides = Array.from({ length: 3 }, (_, i) => ({
      ...newSlide("blank"),
      notes: `발표자 노트 ${i + 1}`,
      elements: blank
        ? []
        : [element("text", { text: `복사할 슬라이드 ${i + 1}` })],
    }));
    deck.slides[0].hidden = true;
    deck.slides[0].transition = "fade";
    return JSON.stringify(deck);
  }, blank);
  await page.locator('input[type=file][accept*=".pptx"]').setInputFiles({
    name: "slide-clipboard.slide",
    mimeType: "application/json",
    buffer: Buffer.from(json),
  });
  await expect(page.locator(".thumbnail-row")).toHaveCount(3);
}

async function snapshot(page: Page) {
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  return page.evaluate(
    async () => (await (await import("/src/storage.ts")).loadAutosave())!,
  );
}

for (const sorter of [false, true]) {
  test(`${sorter ? "sorter" : "sidebar"} context menu pastes copied slides after the destination and supports undo/redo`, async ({
    page,
  }) => {
    await seed(page);
    if (sorter)
      await page
        .getByRole("button", { name: "여러 슬라이드 보기", exact: true })
        .click();
    const slides = page.locator(
      sorter ? ".slide-sorter > button[aria-pressed]" : ".thumbnail-button",
    );
    await slides.nth(0).click({ button: "right" });
    await expect(
      page.getByRole("menuitem", { name: "슬라이드 붙여넣기", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await slides.nth(0).click();
    await slides.nth(1).click({ modifiers: ["Shift"] });
    const before = await snapshot(page);
    await slides.nth(0).click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "슬라이드 복사", exact: true })
      .click();
    await slides.nth(2).click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "슬라이드 붙여넣기", exact: true })
      .click();
    await expect(slides).toHaveCount(5);
    const after = await snapshot(page);
    expect(after.slides.map((s) => s.notes)).toEqual([
      "발표자 노트 1",
      "발표자 노트 2",
      "발표자 노트 3",
      "발표자 노트 1",
      "발표자 노트 2",
    ]);
    for (let i = 0; i < 2; i++) {
      const source = before.slides[i],
        copy = after.slides[i + 3];
      expect(copy.id).not.toBe(source.id);
      expect(copy.elements[0].id).not.toBe(source.elements[0].id);
      expect({ ...copy, id: source.id, elements: source.elements }).toEqual(
        source,
      );
      expect({ ...copy.elements[0], id: source.elements[0].id }).toEqual(
        source.elements[0],
      );
    }
    await page.keyboard.press("ControlOrMeta+z");
    await expect(slides).toHaveCount(3);
    expect((await snapshot(page)).slides).toEqual(before.slides);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(slides).toHaveCount(5);
    expect((await snapshot(page)).slides).toEqual(after.slides);
  });
}

for (const via of ["keyboard", "Home"] as const) {
  for (const blank of [false, true]) {
    test(`${via} pastes a copied ${blank ? "blank" : "populated"} thumbnail as a slide`, async ({
      page,
    }) => {
      await seed(page, blank);
      await page.locator(".thumbnail-button").nth(0).click();
      await page.keyboard.press("ControlOrMeta+c");
      await page.locator(".thumbnail-button").nth(2).click();
      if (via === "keyboard") await page.keyboard.press("ControlOrMeta+v");
      else
        await page
          .getByRole("button", { name: "붙여넣기", exact: true })
          .click();
      await expect(page.locator(".thumbnail-row")).toHaveCount(4);
      const after = await snapshot(page);
      expect(after.slides[3].notes).toBe("발표자 노트 1");
      expect(after.slides[3].hidden).toBe(true);
      expect(after.slides[3].transition).toBe("fade");
      expect(after.slides[3].elements).toHaveLength(blank ? 0 : 1);
    });
  }
}

for (const via of ["keyboard", "Home", "context"] as const) {
  for (const index of [0, 1, 3]) {
    test(`${via} pastes at insertion gap ${index} with a visible line`, async ({
      page,
    }) => {
      await seed(page);
      const before = await snapshot(page);
      await page.locator(".thumbnail-button").nth(2).click();
      await page.keyboard.press("ControlOrMeta+c");
      const gap = page.locator(".slide-insertion-gap").nth(index);
      await gap.hover();
      expect(
        await gap.evaluate((el) => getComputedStyle(el, "::before").opacity),
      ).toBe("1");
      await gap.click({ button: via === "context" ? "right" : "left" });
      await expect(gap).toHaveAttribute("aria-pressed", "true");
      if (via === "context") {
        await expect(
          page.getByRole("menuitem", { name: "슬라이드 삭제", exact: true }),
        ).toHaveCount(0);
        await page
          .getByRole("menuitem", { name: "슬라이드 붙여넣기", exact: true })
          .click();
      } else if (via === "Home")
        await page
          .getByRole("button", { name: "붙여넣기", exact: true })
          .click();
      else await page.keyboard.press("ControlOrMeta+v");
      await expect(page.locator(".thumbnail-row")).toHaveCount(4);
      const after = await snapshot(page);
      expect(after.slides[index].notes).toBe("발표자 노트 3");
      expect(after.slides[index].id).not.toBe(before.slides[2].id);
      expect(after.slides.filter((_, i) => i !== index)).toEqual(before.slides);
      await page.keyboard.press("ControlOrMeta+z");
      await expect(page.locator(".thumbnail-row")).toHaveCount(3);
      expect((await snapshot(page)).slides).toEqual(before.slides);
      await page.keyboard.press("ControlOrMeta+Shift+z");
      await expect(page.locator(".thumbnail-row")).toHaveCount(4);
      expect((await snapshot(page)).slides).toEqual(after.slides);
    });
  }
}

test("an insertion gap supports a new slide, protects Delete, and clears when a thumbnail is selected", async ({
  page,
}) => {
  await seed(page);
  const before = await snapshot(page);
  const gap = page.locator(".slide-insertion-gap").first();
  await gap.click();
  await page.keyboard.press("Delete");
  await expect(page.locator(".thumbnail-row")).toHaveCount(3);
  await page.getByRole("button", { name: "새 슬라이드", exact: true }).click();
  await expect(page.locator(".thumbnail-row")).toHaveCount(4);
  expect((await snapshot(page)).slides.slice(1)).toEqual(before.slides);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".thumbnail-row")).toHaveCount(3);
  await gap.click();
  await page.locator(".thumbnail-button").nth(1).click();
  await expect(
    page.locator('.slide-insertion-gap[aria-pressed="true"]'),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "새 슬라이드", exact: true }).click();
  await expect(page.locator(".thumbnail-row")).toHaveCount(4);
  const after = await snapshot(page);
  expect(after.slides.slice(0, 2)).toEqual(before.slides.slice(0, 2));
  expect(after.slides[3]).toEqual(before.slides[2]);
});

test("dragging a slide block to the final gap and back to the first gap preserves order and supports undo", async ({
  page,
}) => {
  await seed(page);
  const before = await snapshot(page);
  await page.locator(".thumbnail-button").nth(0).click();
  await page
    .locator(".thumbnail-button")
    .nth(1)
    .click({ modifiers: ["Shift"] });
  await page
    .locator(".thumbnail-row")
    .first()
    .dragTo(page.locator(".slide-insertion-gap").last());
  expect((await snapshot(page)).slides.map((s) => s.id)).toEqual([
    before.slides[2].id,
    before.slides[0].id,
    before.slides[1].id,
  ]);
  await page
    .locator(".thumbnail-row")
    .nth(1)
    .dragTo(page.locator(".slide-insertion-gap").first());
  expect((await snapshot(page)).slides).toEqual(before.slides);
  await page.keyboard.press("ControlOrMeta+z");
  expect((await snapshot(page)).slides.map((s) => s.id)).toEqual([
    before.slides[2].id,
    before.slides[0].id,
    before.slides[1].id,
  ]);
});

test("dragging over the bottom half of a thumbnail marks and inserts after it", async ({
  page,
}) => {
  await seed(page);
  const before = await snapshot(page);
  await page.locator(".thumbnail-button").first().click();
  const source = await page.locator(".thumbnail-row").first().boundingBox();
  const target = await page.locator(".thumbnail-row").last().boundingBox();
  await page.mouse.move(source!.x + 80, source!.y + 30);
  await page.mouse.down();
  await page.mouse.move(source!.x + 85, source!.y + 35, { steps: 3 });
  await page.mouse.move(target!.x + 80, target!.y + target!.height - 4, {
    steps: 10,
  });
  await page.mouse.move(target!.x + 81, target!.y + target!.height - 4);
  await expect(page.locator(".slide-insertion-gap").last()).toHaveClass(
    /drop-target/,
  );
  await page.screenshot({ path: "test-results/slide-insertion-line.png" });
  await page.mouse.up();
  expect((await snapshot(page)).slides.map((s) => s.id)).toEqual([
    before.slides[1].id,
    before.slides[2].id,
    before.slides[0].id,
  ]);
  await expect(page.locator(".slide-insertion-gap.drop-target")).toHaveCount(0);
});
