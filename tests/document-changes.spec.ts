import { expect, test, type Page } from "@playwright/test";

const item = (page: Page, id = "shape") =>
  page.locator(`.editable-slide [data-element-id="${id}"]`);
const undo = (page: Page) =>
  page.getByRole("button", { name: "실행 취소", exact: true });
const redo = (page: Page) =>
  page.getByRole("button", { name: "다시 실행", exact: true });

async function open(page: Page, autoHeight = false) {
  await page.addInitScript(() => {
    window.desktop = {
      platform: "darwin",
      windowSessionId: "document-changes-qa",
      onMenu: () => () => {},
      openFile: async () => null,
      exportPDF: async () => null,
      print: async () => false,
      saveFile: async () => "/tmp/document-changes.pptx",
    };
  });
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  const fixture = await page.evaluate(async (autoHeight) => {
    const { blankDeck, element, newSlide } = await import("/src/model.ts");
    const deck = blankDeck();
    deck.name = "수정 상태 검증";
    deck.slides[0].elements = [
      element("shape", {
        id: "shape",
        shape: "triangle",
        x: 100,
        y: 340,
        width: 200,
        height: 140,
      }),
      element("text", {
        id: "text",
        text: "Alpha Beta\n자동 줄바꿈과 글자 높이를 확인합니다.",
        x: 100,
        y: 80,
        width: 350,
        height: autoHeight ? 8 : 180,
        fontSize: 32,
        autoHeight,
      }),
      element("text", {
        id: "date",
        field: "date",
        text: "2000-01-01",
        x: 700,
        y: 600,
      }),
    ];
    const next = newSlide("blank");
    next.elements = [
      element("text", {
        id: "other-text",
        text: "다음 페이지의 자동 높이도 조회로만 계산합니다.",
        x: 100,
        y: 80,
        width: 300,
        height: autoHeight ? 8 : 160,
        fontSize: 32,
        autoHeight,
      }),
    ];
    deck.slides.push(next);
    return JSON.stringify(deck);
  }, autoHeight);
  await page.locator('input[accept*=".pptx"]').setInputFiles({
    name: "수정 상태.slide",
    mimeType: "application/json",
    buffer: Buffer.from(fixture),
  });
  await expect(item(page)).toBeVisible();
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
}

async function expectClean(page: Page, clean = true) {
  await expect
    .poll(() =>
      page.evaluate(() => sessionStorage.getItem("slide-studio-file-dirty")),
    )
    .toBe(String(!clean));
  expect(
    await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(!clean);
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
}

async function startDrag(page: Page, target = item(page)) {
  const box = (await target.boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 60, start.y + 30, { steps: 4 });
  return start;
}

test("viewing and measuring automatic text height never dirties a file or adds undo", async ({
  page,
}) => {
  await open(page, true);
  await expect
    .poll(async () =>
      parseFloat(
        await item(page, "text").evaluate(
          (el) => (el as HTMLElement).style.height,
        ),
      ),
    )
    .toBeGreaterThan(8);
  await expectClean(page);
  for (const index of [1, 0, 1, 0]) {
    await page.locator(".thumbnail-button").nth(index).click();
    await expectClean(page);
    await expect(undo(page)).toBeDisabled();
  }
  await item(page, "text").dblclick();
  await page
    .getByRole("textbox", { name: "슬라이드 텍스트 편집", exact: true })
    .press("Escape");
  await item(page).click();
  await expectClean(page);
  await expect(undo(page)).toBeDisabled();
});

test("selection, entering and leaving unchanged notes/text, and a round-trip drag preserve clean history", async ({
  page,
}) => {
  await open(page);
  await item(page).click();
  await expect(undo(page)).toBeDisabled();
  await expectClean(page);
  await page.getByRole("textbox", { name: "발표자 노트", exact: true }).focus();
  await page
    .getByRole("textbox", { name: "프레젠테이션 이름", exact: true })
    .click();
  await expect(undo(page)).toBeDisabled();
  await item(page, "text").dblclick();
  await page.getByTestId("slide-canvas").click({ position: { x: 10, y: 10 } });
  await expect(undo(page)).toBeDisabled();
  const start = await startDrag(page);
  await page.mouse.move(start.x, start.y, { steps: 4 });
  await page.mouse.up();
  await expect(item(page)).toHaveCSS("left", "100px");
  await expectClean(page);
  await expect(undo(page)).toBeDisabled();
});

for (const cancel of [
  "Escape",
  "pointercancel",
  "lostpointercapture",
  "blur",
] as const) {
  test(`${cancel} restores an object move and preserves the existing redo branch`, async ({
    page,
  }) => {
    await open(page);
    await item(page).click();
    await page.keyboard.press("ArrowRight");
    await undo(page).click();
    await expect(redo(page)).toBeEnabled();
    await item(page).click();
    await page.evaluate(() => {
      window.addEventListener(
        "pointerdown",
        (event) => {
          (window as any).__objectPointer = event.pointerId;
        },
        { once: true, capture: true },
      );
    });
    await startDrag(page);
    await expect(item(page)).not.toHaveCSS("left", "100px");
    if (cancel === "Escape") await page.keyboard.press("Escape");
    else if (cancel === "blur")
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    else
      await item(page).dispatchEvent(cancel, {
        pointerId: await page.evaluate(() => (window as any).__objectPointer),
      });
    await page.mouse.up();
    await expect(item(page)).toHaveCSS("left", "100px");
    await expect(item(page)).toHaveCSS("top", "340px");
    await expectClean(page);
    await expect(undo(page)).toBeDisabled();
    await expect(redo(page)).toBeEnabled();
    await redo(page).click();
    await expect(item(page)).toHaveCSS("left", "101px");
    await expectClean(page, false);
  });
}

test("committed moves remain protected, undo is clean after layout, and redo is dirty", async ({
  page,
}) => {
  await open(page, true);
  await startDrag(page);
  await page.mouse.up();
  await expectClean(page, false);
  await expect(undo(page)).toBeEnabled();
  await undo(page).click();
  await expect(item(page)).toHaveCSS("left", "100px");
  await page.locator(".thumbnail-button").nth(1).click();
  await page.locator(".thumbnail-button").nth(0).click();
  await expectClean(page);
  await expect(redo(page)).toBeEnabled();
  await redo(page).click();
  await expectClean(page, false);
  await page.getByRole("button", { name: "PPTX 저장", exact: true }).click();
  await expect(page.locator(".busy-backdrop")).toHaveCount(0);
  await expectClean(page);
});

test("typing notes back to their saved content is clean even with new object identities", async ({
  page,
}) => {
  await open(page);
  const notes = page.getByRole("textbox", { name: "발표자 노트", exact: true });
  await notes.fill("실제 수정은 계속 보호합니다.");
  await item(page).click();
  await expectClean(page, false);
  await notes.fill("");
  await item(page).click();
  await expectClean(page);
  await undo(page).click();
  await expect(notes).toHaveValue("실제 수정은 계속 보호합니다.");
  await expectClean(page, false);
});

test("applying an already active format is a no-op and keeps redo", async ({
  page,
}) => {
  await open(page);
  await item(page).click();
  await page.keyboard.press("ArrowRight");
  await undo(page).click();
  await item(page, "text").click();
  await page.getByRole("button", { name: "왼쪽 정렬", exact: true }).click();
  await expectClean(page);
  await expect(undo(page)).toBeDisabled();
  await expect(redo(page)).toBeEnabled();
});

test("cancelled size, rotation and triangle-point edits restore all geometry", async ({
  page,
}) => {
  await open(page, true);
  for (const handle of ["resize-se", "rotate-handle"] as const) {
    await item(page, "text").click();
    const original = await item(page, "text").getAttribute("style");
    await startDrag(page, page.getByTestId(handle));
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(item(page, "text")).toHaveAttribute("style", original!);
    await expectClean(page);
    await expect(undo(page)).toBeDisabled();
  }
  // Returning a vertical resize to its starting point also keeps auto-height.
  await item(page, "text").click();
  const start = await startDrag(page, page.getByTestId("resize-s"));
  await page.mouse.move(start.x, start.y);
  await page.mouse.up();
  await expectClean(page);
  await expect(undo(page)).toBeDisabled();
  await item(page).click();
  const original = await item(page).innerHTML();
  await startDrag(page, page.getByTestId("triangle-point-0"));
  await expect.poll(() => item(page).innerHTML()).not.toBe(original);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(item(page)).toHaveJSProperty("innerHTML", original);
  await expectClean(page);
  await expect(undo(page)).toBeDisabled();
});

test("only calculated single-column text height is ignored; authored content and geometry still differ", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { sameDocument, sameValue } = await import(
      "/src/document-changes.ts"
    );
    const source = blankDeck();
    source.slides[0].elements = [
      element("text", { autoHeight: true, height: 8, text: "원문" }),
    ];
    const changed = (patch: Record<string, unknown>) => ({
      ...source,
      slides: [
        {
          ...source.slides[0],
          elements: [{ ...source.slides[0].elements[0], ...patch }],
        },
      ],
    });
    return {
      identical: sameDocument(source, structuredClone(source)),
      measured: sameDocument(source, changed({ height: 175 })),
      exactMeasured: sameValue(source, changed({ height: 175 })),
      realChanges: [
        { width: 350 },
        { fontSize: 24 },
        { text: "실제 수정" },
        { color: "#FF0000" },
        { rotation: -15 },
        { x: 101 },
        { autoHeight: false },
        { writingMode: "vertical" },
        { textColumns: 2 },
        { textInsets: [1, 2, 3, 4] },
        { bold: true },
      ].map((patch) => sameDocument(source, changed(patch))),
      fixed: sameDocument(
        changed({ autoHeight: false }),
        changed({ autoHeight: false, height: 100 }),
      ),
      multiColumn: sameDocument(
        changed({ textColumns: 2 }),
        changed({ textColumns: 2, height: 100 }),
      ),
      shape: sameDocument(
        changed({ type: "shape" }),
        changed({ type: "shape", height: 100 }),
      ),
      missingSnapshot: sameDocument(source, null),
    };
  });
  expect(result).toEqual({
    identical: true,
    measured: true,
    exactMeasured: false,
    realChanges: Array(11).fill(false),
    fixed: false,
    multiColumn: false,
    shape: false,
    missingSnapshot: false,
  });
});

test("comparison of a large immutable deck shares unchanged media instead of serializing it", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck, element, newSlide } = await import("/src/model.ts");
    const { sameDocument } = await import("/src/document-changes.ts");
    const source = blankDeck();
    const media = "data:image/png;base64," + "A".repeat(1_000_000);
    source.slides = Array.from({ length: 200 }, () => ({
      ...newSlide("blank"),
      elements: Array.from({ length: 50 }, () =>
        element("image", { src: media }),
      ),
    }));
    const start = performance.now();
    let equal = true;
    for (let n = 0; n < 300; n++) {
      const index = n % source.slides.length;
      const copy = {
        ...source,
        slides: source.slides.map((slide, i) =>
          i !== index
            ? slide
            : {
                ...slide,
                elements: slide.elements.map((el, j) => (j ? el : { ...el })),
              },
        ),
      };
      equal &&= sameDocument(source, copy);
    }
    return { equal, milliseconds: performance.now() - start };
  });
  expect(result.equal).toBe(true);
  expect(result.milliseconds).toBeLessThan(2000);
});
