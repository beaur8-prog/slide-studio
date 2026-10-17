import { expect, test, type Page } from "@playwright/test";

async function openDeck(page: Page, hidden: number[] = [], count = 12) {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  const json = await page.evaluate(
    async ({ hidden, count }) => {
      const { blankDeck } = await import("/src/model.ts");
      const { serializeDeck } = await import("/src/io.ts");
      const deck = blankDeck();
      deck.name = "Presentation navigation regression";
      deck.slides = Array.from({ length: count }, (_, i) => ({
        id: `slide-${i + 1}`,
        background: "#FFFFFF",
        notes: "",
        elements: [],
        transition: "none",
        hidden: hidden.includes(i + 1),
      }));
      return serializeDeck(deck);
    },
    { hidden, count },
  );
  await page.locator('input[type="file"][accept*=".pptx"]').setInputFiles({
    name: "navigation.slide",
    mimeType: "application/json",
    buffer: Buffer.from(json),
  });
  await expect(page.locator(".thumbnail-button")).toHaveCount(count);
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
}

async function expectSlide(page: Page, number: number, count = 12) {
  await expect(page.getByTestId("presentation-view")).toHaveAttribute(
    "aria-label",
    `발표 슬라이드 ${number} / ${count}`,
  );
  await expect(page.locator(".present-slide")).toBeVisible();
}

test("hidden PPTX flags survive import, project serialization and PPTX round-trip", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { exportPptx, importPptx, serializeDeck, parseDeckJson } =
      await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const deck = blankDeck();
    deck.slides = Array.from({ length: 5 }, (_, i) => ({
      ...deck.slides[0],
      id: `slide-${i}`,
      elements: [],
    }));
    const zip = await JSZip.loadAsync(await exportPptx(deck));
    const flags = [null, "0", "false", "1", "true"];
    for (const [i, flag] of flags.entries()) {
      const name = `ppt/slides/slide${i + 1}.xml`;
      const doc = new DOMParser().parseFromString(
        await zip.file(name)!.async("string"),
        "text/xml",
      );
      if (flag !== null) doc.documentElement.setAttribute("show", flag);
      zip.file(name, new XMLSerializer().serializeToString(doc));
    }
    const imported = await importPptx(
      await zip.generateAsync({ type: "uint8array" }),
    );
    const saved = parseDeckJson(serializeDeck(imported.deck));
    const exported = await exportPptx(saved);
    const output = await JSZip.loadAsync(exported);
    const exportedFlags = await Promise.all(
      saved.slides.map(async (_, i) => {
        const xml = await output
          .file(`ppt/slides/slide${i + 1}.xml`)!
          .async("string");
        return new DOMParser()
          .parseFromString(xml, "text/xml")
          .documentElement.getAttribute("show");
      }),
    );
    const reimported = await importPptx(exported);
    let rejectsInvalidFlag = false;
    try {
      parseDeckJson(
        JSON.stringify({
          ...saved,
          slides: [{ ...saved.slides[0], hidden: "false" }],
        }),
      );
    } catch {
      rejectsInvalidFlag = true;
    }
    return {
      imported: imported.deck.slides.map((s) => !!s.hidden),
      saved: saved.slides.map((s) => !!s.hidden),
      reimported: reimported.deck.slides.map((s) => !!s.hidden),
      exportedFlags,
      warnings: imported.warnings,
      rejectsInvalidFlag,
      legacyVisible: !parseDeckJson(serializeDeck(blankDeck())).slides[0]
        .hidden,
    };
  });
  for (const key of ["imported", "saved", "reimported"] as const)
    expect(result[key]).toEqual([false, true, true, false, false]);
  expect(result.exportedFlags).toEqual([null, "0", "0", null, null]);
  expect(result.warnings).toEqual([]);
  expect(result.rejectsInvalidFlag).toBe(true);
  expect(result.legacyVisible).toBe(true);
});

test("normal navigation skips hidden slides and completion restores the starting selection", async ({
  page,
}) => {
  await openDeck(page, [1, 2, 4, 12]);
  await expect(page.locator(".thumbnail-row.hidden-slide")).toHaveCount(4);
  await expect(page.locator(".thumbnail-button").nth(1)).toHaveAccessibleName(
    /숨김/,
  );
  await page.locator(".thumbnail-button").nth(6).click();
  await page.keyboard.press("F5");
  await expectSlide(page, 3);
  await page.keyboard.press("ArrowRight");
  await expectSlide(page, 5);
  await page.keyboard.press("ArrowLeft");
  await expectSlide(page, 3);
  await page.keyboard.press("ArrowLeft");
  await expectSlide(page, 3);
  await page.keyboard.press("End");
  await expectSlide(page, 11);
  await page.keyboard.press("Home");
  await expectSlide(page, 3);
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("presentation-end")).toBeVisible();
  await expect(page.locator(".present-slide")).toHaveCount(0);
  await expect(
    page.getByTestId("presentation-view").getByRole("button"),
  ).toHaveCount(0);
  await page.keyboard.press("ArrowLeft");
  await expectSlide(page, 11);
  await page.getByTestId("presentation-view").click();
  await expect(page.getByTestId("presentation-end")).toBeVisible();
  await page.getByTestId("presentation-view").click();
  await expect(page.getByTestId("presentation-view")).toBeHidden();
  await expect(page.locator(".thumbnail-button").nth(6)).toHaveAttribute(
    "aria-current",
    "true",
  );
});

test("blackout navigation restores the same slide before moving", async ({
  page,
}) => {
  await openDeck(page);
  await page.locator(".thumbnail-button").nth(4).click();
  await page.keyboard.press("Shift+F5");
  await expectSlide(page, 5);
  await page.keyboard.press("b");
  await expect(page.locator(".present-slide")).toBeHidden();
  await page.keyboard.press("ArrowRight");
  await expectSlide(page, 5);
  await page.keyboard.press("ArrowRight");
  await expectSlide(page, 6);
  await page.keyboard.press("b");
  await page.getByTestId("presentation-view").click();
  await expectSlide(page, 6);
  await page.keyboard.press("b");
  await page.keyboard.press("ArrowLeft");
  await expectSlide(page, 6);
  await page.keyboard.press("ArrowLeft");
  await expectSlide(page, 5);
});

test("number jumps accept multiple digits and hidden slides; Esc returns to that slide", async ({
  page,
}) => {
  await openDeck(page, [2]);
  await page.keyboard.press("F5");
  await page.keyboard.type("11");
  await page.keyboard.press("Enter");
  await expectSlide(page, 11);
  await page.keyboard.type("2");
  await page.keyboard.press("Enter");
  await expectSlide(page, 2);
  await page.keyboard.press("ArrowRight");
  await expectSlide(page, 3);
  for (const invalid of ["0", "99", "999999999999"]) {
    await page.keyboard.type(invalid);
    await page.keyboard.press("Enter");
    await expectSlide(page, 3);
  }
  await page.keyboard.type("12");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Enter");
  await expectSlide(page, 1);
  await page.keyboard.type("9");
  await page.keyboard.press("ArrowRight");
  await expectSlide(page, 3);
  await page.keyboard.press("Enter");
  await expectSlide(page, 4);
  await page.keyboard.type("11");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("presentation-view")).toBeHidden();
  await expect(page.locator(".thumbnail-button").nth(10)).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(page.locator(".thumbnail-button").nth(10)).toBeInViewport();
  await page.keyboard.press("Shift+F5");
  await expectSlide(page, 11);
  await page.keyboard.press("ArrowLeft");
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.getByTestId("presentation-view")).toBeHidden();
  await expect(page.locator(".thumbnail-button").nth(9)).toHaveAttribute(
    "aria-current",
    "true",
  );
});

test("hidden slides remain editable and hiding can be undone and saved", async ({
  page,
}) => {
  await openDeck(page, [2]);
  await page.locator(".thumbnail-button").nth(1).click();
  await page.keyboard.press("Shift+F5");
  await expectSlide(page, 2);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "슬라이드 쇼", exact: true }).click();
  await page.getByRole("button", { name: "숨김 해제", exact: true }).click();
  await expect(page.locator(".thumbnail-row.hidden-slide")).toHaveCount(0);
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  await expect(page.locator(".thumbnail-row.hidden-slide")).toHaveCount(1);
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.reload();
  await expect(page.locator(".thumbnail-row.hidden-slide")).toHaveCount(1);
  await page.keyboard.press("F5");
  await page.keyboard.press("ArrowRight");
  await expectSlide(page, 3);
});

test("an all-hidden deck shows the end screen without revealing slides", async ({
  page,
}) => {
  await openDeck(page, [1, 2, 3], 3);
  await page.keyboard.press("F5");
  await expect(page.getByTestId("presentation-end")).toBeVisible();
  await expect(page.locator(".present-slide")).toHaveCount(0);
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("presentation-end")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("presentation-view")).toBeHidden();
  await expect(page.locator(".thumbnail-button").first()).toHaveAttribute(
    "aria-current",
    "true",
  );
});

async function wheelBurst(page: Page, deltas: number[], interval = 30) {
  await page.getByTestId("presentation-view").evaluate(
    async (element, { deltas, interval }) => {
      for (const deltaY of deltas) {
        element.dispatchEvent(
          new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true }),
        );
        await new Promise((resolve) => setTimeout(resolve, interval));
      }
    },
    { deltas, interval },
  );
}

test("slideshow responds to small mouse-wheel notches without a fixed cooldown", async ({
  page,
}) => {
  await openDeck(page, [], 5);
  await page.keyboard.press("F5");
  const view = page.getByTestId("presentation-view");
  await view.hover();
  for (const slide of [2, 3, 4]) {
    await page.mouse.wheel(0, 20);
    await expectSlide(page, slide, 5);
    await page.waitForTimeout(120);
  }
  await page.mouse.wheel(0, -20);
  await expectSlide(page, 3, 5);
  await page.mouse.wheel(0, 20);
  await expectSlide(page, 4, 5);
  await view.dispatchEvent("wheel", {
    deltaY: -1,
    deltaMode: 1,
    bubbles: true,
    cancelable: true,
  });
  await expectSlide(page, 3, 5);
  await page.keyboard.press("End");
  await page.mouse.wheel(0, 20);
  await expect(page.getByTestId("presentation-end")).toBeVisible();
  await page.waitForTimeout(120);
  await page.mouse.wheel(0, 20);
  await expect(view).toBeHidden();
  await page.keyboard.press("F5");
  await expectSlide(page, 1, 5);
  await view.hover();
  await page.mouse.wheel(0, 20);
  await expectSlide(page, 2, 5);
});

test("slideshow ignores tiny jitter and keeps a long momentum tail on one slide", async ({
  page,
}) => {
  await openDeck(page, [], 5);
  await page.keyboard.press("F5");
  await wheelBurst(page, [2, 2, 2]);
  await expectSlide(page, 1, 5);
  await page.waitForTimeout(120);
  await wheelBurst(page, [18, 15, 12, 10, 8, 6, 5, 4, 3, 2, 2, 1, 1, 1, 1], 40);
  await expectSlide(page, 2, 5);
  await page.waitForTimeout(120);
  await page.getByTestId("presentation-view").hover();
  await page.mouse.wheel(0, 20);
  await expectSlide(page, 3, 5);
});

test("slideshow wheel skips hidden slides once per burst and follows blackout and end navigation", async ({
  page,
}) => {
  await openDeck(page, [2, 4], 5);
  await page.keyboard.press("F5");
  await page.getByTestId("presentation-view").hover();
  await page.mouse.wheel(0, -120);
  await expectSlide(page, 1, 5);
  // Explicit timing keeps assertions from splitting one burst into separate gestures.
  await wheelBurst(page, [120, 1500, 1500]);
  await expectSlide(page, 3, 5);
  await page.waitForTimeout(360);
  await page.mouse.wheel(0, -120);
  await expectSlide(page, 1, 5);
  await page.waitForTimeout(360);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, 120);
  await page.keyboard.up("Control");
  await page.mouse.wheel(1500, 0);
  await expectSlide(page, 1, 5);

  await page.keyboard.press("b");
  await expect(page.locator(".present-slide")).toBeHidden();
  await wheelBurst(page, [120, 120, 120]);
  await expectSlide(page, 1, 5);
  await page.waitForTimeout(360);
  await page.mouse.wheel(0, 120);
  await expectSlide(page, 3, 5);

  await page.keyboard.press("End");
  await page.waitForTimeout(360);
  await wheelBurst(page, [120, 120, 120]);
  await expect(page.getByTestId("presentation-end")).toBeVisible();
  await page.waitForTimeout(360);
  await page.mouse.wheel(0, -120);
  await expectSlide(page, 5, 5);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("presentation-view")).toBeHidden();
  await expect(page.locator(".thumbnail-button").last()).toHaveAttribute(
    "aria-current",
    "true",
  );
});
