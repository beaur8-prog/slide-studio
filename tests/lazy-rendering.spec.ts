import { test, expect, type Page } from "@playwright/test";

async function openLarge(page: Page, count = 300) {
  await page.goto("http://127.0.0.1:5190");
  const deck = await page.evaluate(async (count) => {
    const { blankDeck, newSlide, element } = await import("/src/model.ts");
    const deck = blankDeck();
    deck.name = "지연 렌더링 검증";
    deck.slides = Array.from({ length: count }, (_, i) => ({
      ...newSlide("blank"),
      elements: [
        element("text", {
          text: `검증 제목 ${i + 1}`,
          x: 80,
          y: 100,
          fontSize: 36,
        }),
        ...Array.from({ length: 8 }, (_, j) =>
          element("shape", {
            shape: "ellipse",
            x: 80 + j * 100,
            y: 250,
            fill: "#224488",
          }),
        ),
      ],
    }));
    return JSON.stringify(deck);
  }, count);
  await page.locator('input[accept*=".pptx"]').setInputFiles({
    name: "lazy.slide",
    mimeType: "application/json",
    buffer: Buffer.from(deck),
  });
  await expect(page.locator(".thumbnail-row")).toHaveCount(count);
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await expect(
    page.getByRole("button", { name: "실행 취소", exact: true }),
  ).toBeDisabled();
}

test("only nearby thumbnail artwork is mounted while every slide remains selectable", async ({
  page,
}) => {
  await openLarge(page);
  const thumbnails = page.locator(".thumbnail-list .slide-visual");
  await expect.poll(() => thumbnails.count()).toBeGreaterThan(1);
  expect(await thumbnails.count()).toBeLessThan(25);
  await expect(page.locator(".print-slide")).toHaveCount(0);
  await page.locator(".thumbnail-button").last().click();
  await expect(page.locator(".editable-slide")).toContainText("검증 제목 300");
  await expect(
    page.locator(".thumbnail-row").last().locator(".slide-visual"),
  ).toContainText("검증 제목 300");
  await expect
    .poll(() =>
      page.locator(".thumbnail-row").first().locator(".slide-visual").count(),
    )
    .toBe(0);
  await page
    .locator(".thumbnail-button")
    .nth(149)
    .click({ modifiers: ["ControlOrMeta"] });
  await expect(
    page.locator('.thumbnail-button[aria-pressed="true"]'),
  ).toHaveCount(2);
  expect(await thumbnails.count()).toBeLessThan(25);
  await page.locator(".thumbnail-button").first().click();
  await expect(page.locator(".editable-slide")).toContainText("검증 제목 1");
  await expect(
    page.locator(".thumbnail-row").first().locator(".slide-visual"),
  ).toContainText("검증 제목 1");
  await expect(
    page.getByRole("button", { name: "실행 취소", exact: true }),
  ).toBeDisabled();
});

test("multi-slide view only renders visible previews and navigation preserves full slide order", async ({
  page,
}) => {
  await openLarge(page);
  await page
    .getByRole("button", { name: "여러 슬라이드 보기", exact: true })
    .click();
  await expect(
    page.locator(".slide-sorter > button[aria-pressed]"),
  ).toHaveCount(300);
  await expect
    .poll(() => page.locator(".slide-sorter .slide-visual").count())
    .toBeGreaterThan(2);
  expect(
    await page.locator(".slide-sorter .slide-visual").count(),
  ).toBeLessThan(50);
  await page.locator(".slide-sorter > button[aria-pressed]").last().dblclick();
  await expect(page.locator(".slide-sorter")).toHaveCount(0);
  await expect(page.locator(".editable-slide")).toContainText("검증 제목 300");
  await expect(page.locator(".thumbnail-row.active .slide-number")).toHaveText(
    "300",
  );
});

test("beforeprint synchronously mounts the whole current deck and afterprint releases it without document edits", async ({
  page,
}) => {
  await openLarge(page);
  for (let repeat = 0; repeat < 2; repeat++) {
    const pages = await page.evaluate(() => {
      window.dispatchEvent(new Event("beforeprint"));
      return Array.from(
        document.querySelectorAll(".print-slide"),
        (slide) => slide.textContent,
      );
    });
    expect(pages).toHaveLength(300);
    expect(pages[0]).toContain("검증 제목 1");
    expect(pages[149]).toContain("검증 제목 150");
    expect(pages[299]).toContain("검증 제목 300");
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await expect(page.locator(".print-slide")).toHaveCount(0);
  }
  await expect(
    page.getByRole("button", { name: "실행 취소", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
});
