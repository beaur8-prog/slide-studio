import { test, expect } from "@playwright/test";
test("partial web and slide links keep keyboard activation separate from slideshow navigation", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async () => {
    const { blankDeck, newSlide, element } = await import("/src/model.ts"),
      { exportPptx, importPptx } = await import("/src/io.ts"),
      { saveAutosave } = await import("/src/storage.ts");
    const d = blankDeck();
    d.slides = [newSlide("blank"), newSlide("blank"), newSlide("blank")];
    d.slides[1].hidden = true;
    d.slides[0].elements = [
      element("text", {
        text: "Web Plain Next",
        x: 100,
        y: 100,
        width: 800,
        height: 160,
        paragraphs: [
          {
            runs: [
              {
                text: "Web",
                hyperlink: { url: "https://example.com/partial" },
              },
              { text: " Plain " },
              { text: "Next", hyperlink: { slideId: d.slides[1].id } },
            ],
          },
        ],
      }),
    ];
    await saveAutosave((await importPptx(await exportPptx(d))).deck);
  });
  await page.reload();
  await page
    .context()
    .route("https://example.com/partial", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<title>Partial link fixture</title>",
      }),
    );
  await page.keyboard.press("F5");
  const show = page.getByTestId("presentation-view");
  await expect(show.locator(".presentation-link")).toHaveCount(0);
  const opened = page.waitForEvent("popup");
  await show.getByRole("link", { name: "Web", exact: true }).press("Enter");
  const popup = await opened;
  await expect(popup).toHaveURL("https://example.com/partial");
  await expect(show).toHaveAttribute("aria-label", "발표 슬라이드 1 / 3");
  await popup.close();
  await show.getByRole("button", { name: "Next", exact: true }).press("Space");
  await expect(show).toHaveAttribute("aria-label", "발표 슬라이드 2 / 3");
});
