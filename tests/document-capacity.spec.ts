import { expect, test, type Page } from "@playwright/test";

async function seed(page: Page, slides: number, perSlide: number) {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(
    async ({ slides, perSlide }) => {
      const { blankDeck, element, newSlide } = await import("/src/model.ts");
      const { saveAutosave } = await import("/src/storage.ts");
      const deck = blankDeck();
      deck.name = "문서 한도 검수";
      deck.slides = Array.from({ length: slides }, (_, i) => ({
        ...newSlide("blank"),
        id: `capacity-slide-${i}`,
        elements: Array.from({ length: perSlide }, (_, j) =>
          element("shape", {
            id: `capacity-${i}-${j}`,
            x: 80 + (j % 40) * 28,
            y: 50 + Math.floor(j / 40) * 24,
            width: 20,
            height: 16,
          }),
        ),
      }));
      await saveAutosave(deck);
    },
    { slides, perSlide },
  );
  await page.reload();
  await expect(page.locator(".thumbnail-row")).toHaveCount(slides);
}

async function savedShape(page: Page) {
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  return page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts");
    const { parseDeckJson } = await import("/src/io.ts");
    const deck = (await loadAutosave())!;
    let error = "";
    try {
      parseDeckJson(JSON.stringify(deck));
    } catch (e) {
      error = (e as Error).message;
    }
    return {
      slides: deck.slides.length,
      elements: deck.slides.map((s) => s.elements.length),
      error,
    };
  });
}

test("1,000-object slide refuses shape insertion, object duplicate and object paste without losing existing artwork", async ({
  page,
}) => {
  test.setTimeout(90000);
  await seed(page, 1, 1000);
  await page.getByRole("button", { name: "도형", exact: true }).click();
  await page.getByRole("button", { name: "사각형", exact: true }).click();
  expect(await savedShape(page)).toEqual({
    slides: 1,
    elements: [1000],
    error: "",
  });
  await page.keyboard.press("Escape");
  await page
    .locator('.editable-slide [data-element-id="capacity-0-0"]')
    .click();
  await page.keyboard.press("ControlOrMeta+d");
  expect(await savedShape(page)).toEqual({
    slides: 1,
    elements: [1000],
    error: "",
  });
  await page.keyboard.press("ControlOrMeta+c");
  await page.keyboard.press("ControlOrMeta+v");
  expect(await savedShape(page)).toEqual({
    slides: 1,
    elements: [1000],
    error: "",
  });
  await page.reload();
  await expect(page.locator(".editable-slide .slide-element")).toHaveCount(
    1000,
  );
});

test("document-wide limit accounts for every slide and allows replacing or removing existing objects", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck, newSlide, element } = await import("/src/model.ts");
    const { documentCapacityError } = await import("/src/document-limits.ts");
    const deck = blankDeck();
    deck.slides = Array.from({ length: 10 }, (_, i) => ({
      ...newSlide("blank"),
      id: `total-${i}`,
      elements: Array.from({ length: 1000 }, () => element("shape")),
    }));
    const empty = newSlide("blank");
    deck.slides.push(empty);
    return {
      unchanged: documentCapacityError(deck) ?? null,
      insert: documentCapacityError(deck, { elements: { [empty.id]: 1 } }),
      duplicate: documentCapacityError(deck, { slides: [deck.slides[0]] }),
      replace:
        documentCapacityError(deck, {
          elements: { [deck.slides[0].id]: -1, [empty.id]: 1 },
        }) ?? null,
      emptySlide:
        documentCapacityError(deck, { slides: [newSlide("blank")] }) ?? null,
    };
  });
  expect(result).toEqual({
    unchanged: null,
    insert: "문서에는 10,000개까지 개체를 넣을 수 있습니다.",
    duplicate: "문서에는 10,000개까지 개체를 넣을 수 있습니다.",
    replace: null,
    emptySlide: null,
  });
});
