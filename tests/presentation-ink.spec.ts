import { test, expect, type Page, type Locator } from "@playwright/test";

async function open(page: Page, link = false) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { get: () => "Win32" });
    window.desktop = {
      platform: "win32",
      setPresentationMode: async () => {},
      setChromeTheme: async () => {},
      openFile: async () => null,
      saveFile: async (payload) => {
        (window as any).__saved = Array.from(payload.data);
        return "qa.slide";
      },
      exportPDF: async () => null,
      print: async () => {
        (window as any).__prints = ((window as any).__prints ?? 0) + 1;
        return false;
      },
      onMenu: (callback) => {
        (window as any).__menu = callback;
        return () => {};
      },
    };
  });
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  const fixture = await page.evaluate(async (link) => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { serializeDeck } = await import("/src/io.ts");
    const deck = blankDeck();
    deck.name = "발표 표시 검증";
    deck.slides = Array.from({ length: 3 }, (_, i) => ({
      ...deck.slides[0],
      id: `ink-slide-${i}`,
      elements: [],
      notes: "발표자 노트",
      background: "#FFFFFF",
    }));
    if (link)
      deck.slides[0].elements.push(
        element("shape", {
          x: 100,
          y: 100,
          width: 200,
          height: 100,
          fill: "#118855",
          hyperlink: { slideId: deck.slides[2].id },
        }),
      );
    return serializeDeck(deck);
  }, link);
  await page.locator('input[type=file][accept*=".pptx"]').setInputFiles({
    name: "ink.slide",
    mimeType: "application/json",
    buffer: Buffer.from(fixture),
  });
  await expect(page.locator(".thumbnail-button")).toHaveCount(3);
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  if (await page.locator(".toast button").count())
    await page.locator(".toast button").click();
}
async function draw(
  page: Page,
  ink: Locator,
  start: [number, number] = [0.25, 0.3],
  end: [number, number] = [0.7, 0.3],
) {
  const b = (await ink.boundingBox())!;
  await page.mouse.move(b.x + b.width * start[0], b.y + b.height * start[1]);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * end[0], b.y + b.height * end[1], {
    steps: 12,
  });
  await page.mouse.up();
}
const menu = (page: Page) =>
  page.getByRole("dialog", { name: "발표 도구", exact: true });

test("Windows slideshow ribbon icons and labels fit without clipping at supported window widths", async ({
  page,
}, info) => {
  await open(page);
  await page.getByRole("button", { name: "슬라이드 쇼", exact: true }).click();
  for (const width of [970, 1080, 1280, 1543, 1920]) {
    await page.setViewportSize({ width, height: width === 1543 ? 1001 : 720 });
    const bounds = await page
      .locator(".ribbon button")
      .evaluateAll((buttons) => {
        const ribbon = document
          .querySelector(".ribbon")!
          .getBoundingClientRect();
        return buttons.map((button) => {
          const r = button.getBoundingClientRect();
          return {
            label: button.textContent,
            inside: r.top >= ribbon.top && r.bottom <= ribbon.bottom,
            horizontal: (() => {
              const label = button.querySelector("span");
              if (!label) return false;
              const range = document.createRange();
              range.selectNodeContents(label);
              const text = range.getBoundingClientRect();
              return text.left >= r.left + 5 && text.right <= r.right - 5;
            })(),
            visible: [button.querySelector("svg"), button.querySelector("span")]
              .filter(Boolean)
              .every((child) => {
                const c = child!.getBoundingClientRect();
                return c.top >= ribbon.top && c.bottom <= ribbon.bottom;
              }),
          };
        });
      });
    expect(bounds.length).toBe(4);
    expect(
      bounds.every((b) => b.inside && b.visible && b.horizontal),
      JSON.stringify(bounds),
    ).toBe(true);
    const hide = page
      .locator(".ribbon")
      .getByRole("button", { name: "슬라이드 숨기기", exact: true });
    await hide.click();
    await expect(
      page
        .locator(".ribbon")
        .getByRole("button", { name: "숨김 해제", exact: true }),
    ).toBeVisible();
    await page
      .locator(".ribbon")
      .getByRole("button", { name: "숨김 해제", exact: true })
      .click();
    const notes = page
      .locator(".ribbon")
      .getByRole("button", { name: "발표자 노트", exact: true });
    await notes.click();
    await expect(page.locator(".notes-pane")).toBeHidden();
    await notes.click();
    await expect(page.locator(".notes-pane")).toBeVisible();
  }
  await page.setViewportSize({ width: 1543, height: 1001 });
  await page.screenshot({ path: info.outputPath("windows-ribbon-fixed.png") });
});

test("laser follows the cursor without ink or accidental click navigation, and wheel still advances", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.press("F5");
  await page.keyboard.press("Control+l");
  const ink = page.getByTestId("presentation-ink");
  await expect(ink).toHaveAttribute("data-tool", "laser");
  const b = (await ink.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.getByTestId("laser-pointer")).toBeVisible();
  expect(
    Number(await page.getByTestId("laser-pointer").getAttribute("cx")),
  ).toBeCloseTo(640, 0);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.getByTestId("presentation-view")).toHaveAttribute(
    "aria-label",
    "발표 슬라이드 1 / 3",
  );
  await expect(page.getByTestId("ink-stroke")).toHaveCount(0);
  await page.mouse.wheel(0, 20);
  await expect(page.getByTestId("presentation-view")).toHaveAttribute(
    "aria-label",
    "발표 슬라이드 2 / 3",
  );
  await expect(page.getByTestId("laser-pointer")).toBeHidden();
  await page.keyboard.press("Control+a");
  await page.getByTestId("presentation-view").click();
  await expect(page.getByTestId("presentation-view")).toHaveAttribute(
    "aria-label",
    "발표 슬라이드 3 / 3",
  );
});

test("pen strokes use slide coordinates and survive resize, slide jumps, and return navigation", async ({
  page,
}, info) => {
  await open(page);
  await page.keyboard.press("F5");
  await page.keyboard.press("Control+p");
  const ink = page.getByTestId("presentation-ink");
  await draw(page, ink);
  await expect(page.getByTestId("ink-stroke")).toHaveCount(1);
  const before = await page.getByTestId("ink-stroke").getAttribute("points");
  const first = before!.split(" ")[0].split(",").map(Number);
  expect(first[0]).toBeCloseTo(320, 0);
  expect(first[1]).toBeCloseTo(216, 0);
  await page.setViewportSize({ width: 1080, height: 900 });
  await expect(page.getByTestId("ink-stroke")).toHaveAttribute(
    "points",
    before!,
  );
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("ink-stroke")).toHaveCount(0);
  await draw(page, ink, [0.3, 0.6], [0.5, 0.8]);
  await page.keyboard.press("1");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("ink-stroke")).toHaveAttribute(
    "points",
    before!,
  );
  await expect(ink).toHaveAttribute("data-tool", "pen");
  await page.screenshot({ path: info.outputPath("presentation-pen.png") });
});

test("eraser sweeps only touched strokes; undo, redo and clear stay separate from editor commands", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.press("F5");
  await page.keyboard.press("Control+p");
  const ink = page.getByTestId("presentation-ink");
  await draw(page, ink, [0.2, 0.3], [0.7, 0.3]);
  await draw(page, ink, [0.2, 0.7], [0.7, 0.7]);
  await expect(page.getByTestId("ink-stroke")).toHaveCount(2);
  await page.keyboard.press("Control+e");
  await draw(page, ink, [0.4, 0.15], [0.4, 0.45]);
  await expect(page.getByTestId("ink-stroke")).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("ink-stroke")).toHaveCount(2);
  await page.keyboard.press("Control+y");
  await expect(page.getByTestId("ink-stroke")).toHaveCount(1);
  await page.keyboard.press("e");
  await expect(page.getByTestId("ink-stroke")).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("ink-stroke")).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__prints ?? 0)).toBe(0);
});

test("context tools choose color and width, fit screen edges, and Escape dismisses tools before the show", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1080, height: 720 });
  await open(page);
  await page.keyboard.press("F5");
  await page
    .getByTestId("presentation-view")
    .click({ button: "right", position: { x: 1070, y: 710 } });
  await expect(menu(page)).toBeVisible();
  const b = (await menu(page).boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(1080);
  expect(b.y + b.height).toBeLessThanOrEqual(720);
  await page.getByRole("button", { name: "파랑 색상", exact: true }).click();
  await page.getByRole("combobox", { name: "펜 굵기" }).selectOption("8");
  await page.getByRole("button", { name: "펜", exact: true }).click();
  await expect(menu(page)).toBeHidden();
  await draw(page, page.getByTestId("presentation-ink"));
  await expect(page.getByTestId("ink-stroke")).toHaveAttribute(
    "stroke",
    "#3E8BFF",
  );
  await expect(page.getByTestId("ink-stroke")).toHaveAttribute(
    "stroke-width",
    "8",
  );
  await page.keyboard.press("F1");
  await expect(menu(page)).toBeVisible();
  await page.screenshot({ path: info.outputPath("presentation-tools.png") });
  await page.keyboard.press("Escape");
  await expect(menu(page)).toBeHidden();
  await expect(page.getByTestId("presentation-view")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("presentation-view")).toBeHidden();
});

test("session ink is not saved to the project and never remains in the next show", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.press("Control+s");
  const before = await page.evaluate(() => (window as any).__saved);
  await page.keyboard.press("F5");
  await page.keyboard.press("Control+p");
  await draw(page, page.getByTestId("presentation-ink"));
  await page.keyboard.press("b");
  await expect(page.locator(".present-slide")).toBeHidden();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("ink-stroke")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+s");
  expect(await page.evaluate(() => (window as any).__saved)).toEqual(before);
  await page.keyboard.press("F5");
  await expect(page.getByTestId("presentation-ink")).toHaveAttribute(
    "data-tool",
    "arrow",
  );
  await expect(page.getByTestId("ink-stroke")).toHaveCount(0);
});

test("drawing over a linked shape never activates the link; arrow mode restores it", async ({
  page,
}) => {
  await open(page, true);
  await page.keyboard.press("F5");
  const link = page.locator(".presentation-link");
  const b = (await link.boundingBox())!;
  await page.keyboard.press("Control+p");
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.getByTestId("ink-stroke")).toHaveCount(1);
  await expect(page.getByTestId("presentation-view")).toHaveAttribute(
    "aria-label",
    "발표 슬라이드 1 / 3",
  );
  await page.keyboard.press("Control+a");
  await link.click();
  await expect(page.getByTestId("presentation-view")).toHaveAttribute(
    "aria-label",
    "발표 슬라이드 3 / 3",
  );
});

test("pointer cancellation discards a draft and releases navigation for the next gesture", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.press("F5");
  await page.keyboard.press("Control+p");
  const ink = page.getByTestId("presentation-ink"),
    b = (await ink.boundingBox())!;
  await page.mouse.move(b.x + 100, b.y + 100);
  await page.mouse.down();
  await page.mouse.move(b.x + 300, b.y + 200);
  await ink.dispatchEvent("pointercancel");
  await page.mouse.up();
  await expect(page.getByTestId("ink-stroke")).toHaveCount(0);
  await draw(page, ink);
  await expect(page.getByTestId("ink-stroke")).toHaveCount(1);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("ink-stroke")).toHaveCount(0);
});

test("eraser intersection covers sparse fast crossings, nearby lines and separate strokes", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const results = await page.evaluate(async () => {
    const { touchesInk } = await import("/src/presentation-ink.ts");
    const stroke = {
      points: [
        [0, 50],
        [100, 50],
      ] as [number, number][],
      color: "#f00",
      width: 4,
    };
    return [
      touchesInk(stroke, [50, 0], [50, 100], 1),
      touchesInk(stroke, [50, 60], [60, 60], 10),
      touchesInk(stroke, [200, 0], [200, 100], 10),
      touchesInk({ ...stroke, points: [[50, 50]] }, [0, 50], [100, 50], 1),
    ];
  });
  expect(results).toEqual([true, true, false, true]);
});
