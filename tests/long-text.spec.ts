import { test, expect, type Page } from "@playwright/test";

const longText =
  "긴 한글 문장을 입력해도 상자 너비에 맞춰 자동으로 줄이 바뀌고 마지막 글자까지 보이는지 확인합니다. ".repeat(
    5,
  );
const input = (page: Page) =>
  page.getByRole("textbox", { name: "슬라이드 텍스트 편집", exact: true });
const saved = (page: Page) =>
  page.evaluate(
    async () =>
      (await (await import("/src/storage.ts")).loadAutosave())!.slides[0]
        .elements[0],
  );
async function seed(page: Page, autoHeight = false) {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(
    async ({ text, autoHeight }) => {
      const { blankDeck, element } = await import("/src/model.ts");
      const { saveAutosave } = await import("/src/storage.ts");
      const deck = blankDeck();
      deck.slides[0].elements = [
        element("text", {
          width: 400,
          height: 70,
          text,
          fontSize: 24,
          autoHeight,
        }),
      ];
      await saveAutosave(deck);
    },
    { text: longText, autoHeight },
  );
  await page.reload();
}
async function metrics(page: Page) {
  return page.getByTestId("slide-element").evaluate((host) => {
    const box = host.querySelector<HTMLElement>(".element-text")!;
    const bounds = box.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(box);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0);
    return {
      height: host.offsetHeight,
      text: box.textContent,
      lines: new Set(rects.map((r) => Math.round(r.top))).size,
      horizontal: rects.every(
        (r) => r.left >= bounds.left - 1 && r.right <= bounds.right + 1,
      ),
      vertical: rects.every(
        (r) => r.top >= bounds.top - 1 && r.bottom <= bounds.bottom + 1,
      ),
    };
  });
}

test("fixed imported boxes keep their bounds until automatic height is chosen; long Korean wraps completely", async ({
  page,
}, info) => {
  await seed(page);
  expect((await metrics(page)).height).toBe(70);
  expect((await metrics(page)).vertical).toBe(false); // Reproduces the original fixed-height clipping.
  await page.getByTestId("slide-element").click();
  await page.getByRole("button", { name: "서식", exact: true }).click();
  await expect(page.getByLabel("상자 너비에 맞춰 자동 줄바꿈")).toBeChecked();
  await page.getByLabel("내용에 맞춰 상자 높이 자동 조절").check();
  await expect.poll(async () => (await metrics(page)).vertical).toBe(true);
  const after = await metrics(page);
  expect(after.lines).toBeGreaterThan(5);
  expect(after.horizontal).toBe(true);
  expect(after.text).toBe(longText);
  expect(after.height).toBeGreaterThan(70);
  await expect.poll(async () => (await saved(page)).autoHeight).toBe(true);
  await page.screenshot({ path: info.outputPath("long-korean.png") });
  await page.reload();
  expect((await metrics(page)).vertical).toBe(true);
  const roundtrip = await page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts");
    const { exportPptx, importPptx, serializeDeck, parseDeckJson } =
      await import("/src/io.ts");
    const deck = (await loadAutosave())!;
    return {
      json: parseDeckJson(serializeDeck(deck)).slides[0].elements[0],
      pptx: (await importPptx(await exportPptx(deck))).deck.slides[0]
        .elements[0],
    };
  });
  expect(roundtrip.json.autoHeight).toBe(true);
  expect(roundtrip.pptx.text).toBe(longText);
  expect(roundtrip.pptx.height).toBeCloseTo(after.height, 2);
});

test("new text defaults to automatic height and follows typing, no-space Korean, font size and undo", async ({
  page,
}) => {
  await seed(page);
  // Exercise the actual insertion command rather than setting the new default in the fixture.
  await page.getByRole("button", { name: "삽입", exact: true }).click();
  await page.getByRole("button", { name: "텍스트 상자", exact: true }).click();
  const added = page.getByTestId("slide-element").last();
  await added.dblclick();
  const text =
    "띄어쓰기없는긴한글문장도상자너비를넘기지않고자동으로줄바꿈되어야합니다".repeat(
      5,
    );
  await input(page).fill(text);
  await expect
    .poll(() => added.evaluate((el) => el.offsetHeight))
    .toBeGreaterThan(150);
  const original = await added.evaluate((el) => el.offsetHeight);
  await page.getByRole("textbox", { name: "발표자 노트", exact: true }).click();
  await added.click();
  await page.getByRole("button", { name: "홈", exact: true }).click();
  await page.getByLabel("글자 크기", { exact: true }).fill("42");
  await expect
    .poll(() => added.evaluate((el) => el.offsetHeight))
    .toBeGreaterThan(original);
  await added.dblclick();
  await input(page).fill("짧은 문장");
  await expect
    .poll(() => added.evaluate((el) => el.offsetHeight))
    .toBeLessThan(100);
  await input(page).press("ControlOrMeta+z");
  await expect(input(page)).toHaveText(text);
  await expect
    .poll(() => added.evaluate((el) => el.offsetHeight))
    .toBeGreaterThan(original);
});

test("wrap can be explicitly restored on a no-wrap box and sizing settings reject invalid projects", async ({
  page,
}) => {
  await seed(page);
  await page.getByTestId("slide-element").click();
  await page.getByRole("button", { name: "서식", exact: true }).click();
  await page.getByLabel("상자 너비에 맞춰 자동 줄바꿈").uncheck();
  await expect.poll(async () => (await metrics(page)).lines).toBe(1);
  await page.getByLabel("상자 너비에 맞춰 자동 줄바꿈").check();
  await expect.poll(async () => (await metrics(page)).horizontal).toBe(true);
  const rejected = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { parseDeckJson, serializeDeck } = await import("/src/io.ts");
    return [
      { autoHeight: "true" },
      { textColumns: 1.5 },
      { textColumns: 17 },
      { textColumnGap: -1 },
    ].map((patch) => {
      const deck = blankDeck();
      deck.slides[0].elements = [element("text", patch as any)];
      try {
        parseDeckJson(serializeDeck(deck));
        return false;
      } catch {
        return true;
      }
    });
  });
  expect(rejected).toEqual([true, true, true, true]);
});

test("automatic height follows width changes; manual height disables it and undo restores it", async ({
  page,
}) => {
  await seed(page, true);
  const el = page.getByTestId("slide-element");
  await expect.poll(async () => (await metrics(page)).vertical).toBe(true);
  const original = (await metrics(page)).height;
  await el.click();
  await page.getByRole("button", { name: "서식", exact: true }).click();
  await page.getByLabel("너비", { exact: true }).fill("600");
  await expect
    .poll(async () => (await metrics(page)).height)
    .toBeLessThan(original);
  await page.getByLabel("높이", { exact: true }).fill("80");
  await expect(
    page.getByLabel("내용에 맞춰 상자 높이 자동 조절"),
  ).not.toBeChecked();
  expect((await metrics(page)).height).toBe(80);
  await page.getByRole("textbox", { name: "발표자 노트", exact: true }).click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await saved(page)).autoHeight).toBe(true);
  await expect.poll(async () => (await metrics(page)).vertical).toBe(true);
});
