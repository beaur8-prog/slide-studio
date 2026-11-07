import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";

const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
test.use({
  userAgent: ANDROID,
  viewport: { width: 412, height: 915 },
  hasTouch: true,
  isMobile: true,
});

async function fixture(page: Page, count = 3) {
  const bytes = await page.evaluate(async (count) => {
    const { blankDeck, element, newSlide } = await import("/src/model.ts");
    const { createTable, createTableElement } = await import("/src/table.ts");
    const { exportPptx } = await import("/src/io.ts");
    const deck = blankDeck();
    deck.name = "Android 원본 보존";
    const table = createTable(2, 2);
    table.cells = [
      ["한글 표", "값"],
      ["자료", "200"],
    ];
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    canvas.getContext("2d")!.fillRect(0, 0, 16, 16);
    deck.slides = Array.from({ length: count }, (_, i) => ({
      ...newSlide("blank"),
      id: `android-slide-${i}`,
      hidden: i === 1,
      notes: `비공개 발표자 노트 ${i + 1}`,
      elements: [
        element("text", {
          id: `text-${i}`,
          text: `Alpha Beta ${i + 1}`,
          x: 80,
          y: 50,
          width: 600,
          height: 100,
          autoHeight: true,
        }),
        element("image", {
          id: `image-${i}`,
          src: canvas.toDataURL(),
          x: 100,
          y: 200,
          width: 80,
          height: 80,
        }),
        {
          ...createTableElement(table, deck.width, deck.height),
          id: `table-${i}`,
          x: 250,
          y: 200,
          width: 500,
        },
      ],
    }));
    return Array.from(await exportPptx(deck));
  }, count);
  return Buffer.from(bytes);
}
async function open(page: Page, count = 3) {
  await page.goto("http://127.0.0.1:5190");
  await expect(
    page.getByRole("button", { name: "파일 열기", exact: true }),
  ).toBeVisible();
  const bytes = await fixture(page, count);
  await page.locator('input[accept*=".pptx"]').setInputFiles({
    name: "android-original.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: bytes,
  });
  await expect(page.getByTestId("android-slide-viewport")).toBeVisible();
  return bytes;
}
const menu = async (page: Page) => {
  await page.getByRole("button", { name: "문서 메뉴", exact: true }).click();
  return page.getByRole("dialog", { name: "문서 메뉴", exact: true });
};
async function clean(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => sessionStorage.getItem("slide-studio-file-dirty")),
    )
    .toBe("false");
  expect(
    await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(false);
}
async function swipe(
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...start, id: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ ...end, id: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await session.detach();
}

test("Android reader fits phones/tablets, retains table/images and 48px navigation targets", async ({
  page,
}, info) => {
  await open(page);
  for (const size of [
    { width: 360, height: 800 },
    { width: 800, height: 360 },
    { width: 600, height: 960 },
    { width: 800, height: 1280 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(size);
    await expect(page.locator(".android-slide-position img")).toHaveCount(1);
    await expect(page.locator(".android-slide-position")).toContainText(
      "한글 표",
    );
    await expect
      .poll(() =>
        page.evaluate(() => {
          const slide = document
            .querySelector(".android-slide-position")!
            .getBoundingClientRect();
          const viewport = document
            .querySelector(".android-slide-viewport")!
            .getBoundingClientRect();
          return (
            slide.left >= viewport.left &&
            slide.right <= viewport.right + 1 &&
            slide.top >= viewport.top &&
            slide.bottom <= viewport.bottom + 1
          );
        }),
      )
      .toBe(true);
    const bounds = await page
      .locator(".android-topbar button,.android-navigation button")
      .evaluateAll((buttons) =>
        buttons.map((button) => {
          const box = button.getBoundingClientRect();
          return box.width >= 48 && box.height >= 48;
        }),
      );
    expect(bounds.every(Boolean)).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`reader-${size.width}x${size.height}.png`),
    });
  }
  await clean(page);
  expect(await page.locator(".editable-slide").count()).toBe(0);
});

test("viewer search, page validation, notes and repeated navigation cannot edit or autosave", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.press("Control+v");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Delete");
  await (await menu(page)).getByRole("button", { name: "문서 검색" }).click();
  await page.getByRole("searchbox", { name: "문서에서 찾기" }).fill("Beta 3");
  await page.locator(".android-search-results button").click();
  await expect(
    page.getByRole("button", { name: "페이지로 이동 · 3 / 3" }),
  ).toBeVisible();
  await (await menu(page)).getByRole("button", { name: "발표자 노트" }).click();
  await expect(page.getByRole("dialog")).toContainText("비공개 발표자 노트 3");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "페이지로 이동 · 3 / 3" }).click();
  await page.getByRole("textbox", { name: "슬라이드 번호" }).fill("0");
  await page.getByRole("button", { name: "이동", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("textbox", { name: "슬라이드 번호" }).fill("1");
  await page.getByRole("button", { name: "이동", exact: true }).click();
  for (let i = 0; i < 5; i++) {
    await page
      .getByRole("button", { name: "다음 슬라이드", exact: true })
      .click();
    await page
      .getByRole("button", { name: "이전 슬라이드", exact: true })
      .click();
  }
  await clean(page);
  const saved = await page.evaluate(async () =>
    (await import("/src/storage.ts")).loadAutosave(
      (await import("/src/io.ts")).validateDeck,
    ),
  );
  expect(saved).toBeUndefined();
});

test("pinch and pan never change slides; fit swipe moves exactly one page; cancel clears the gesture", async ({
  page,
}) => {
  await open(page);
  const box = (await page.getByTestId("android-slide-viewport").boundingBox())!;
  const y = box.y + box.height / 2;
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: 150, y, id: 1 },
      { x: 250, y, id: 2 },
    ],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: 80, y, id: 1 },
      { x: 320, y, id: 2 },
    ],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(() =>
      page.getByTestId("android-slide-viewport").getAttribute("data-zoom"),
    )
    .not.toBe("1.00");
  await swipe(page, { x: 320, y }, { x: 80, y });
  await expect(
    page.getByRole("button", { name: "페이지로 이동 · 1 / 3" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "화면에 맞춤", exact: true }).click();
  await swipe(page, { x: 320, y }, { x: 80, y });
  await expect(
    page.getByRole("button", { name: "페이지로 이동 · 2 / 3" }),
  ).toBeVisible();
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: 320, y, id: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: 80, y, id: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
  await expect(
    page.getByRole("button", { name: "페이지로 이동 · 2 / 3" }),
  ).toBeVisible();
  await session.detach();
  await clean(page);
});

test("sharing and downloading use exact original bytes; failed import leaves the current source intact", async ({
  page,
}) => {
  const bytes = await open(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        (window as any).__shared = Array.from(
          new Uint8Array(await data.files![0].arrayBuffer()),
        );
      },
    });
  });
  await (await menu(page))
    .getByRole("button", { name: "원본 파일 공유", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__shared?.length))
    .toBe(bytes.length);
  expect(
    Buffer.from(await page.evaluate(() => (window as any).__shared)),
  ).toEqual(bytes);
  await page.locator('input[accept*=".pptx"]').setInputFiles({
    name: "bad.pptx",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("not a pptx"),
  });
  await expect(page.locator(".toast")).toContainText("파일 열기 실패");
  await expect(page.getByTestId("android-slide-viewport")).toBeVisible();
  const dialog = await menu(page);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog
      .getByRole("button", { name: "원본 파일 다운로드", exact: true })
      .click(),
  ]);
  expect(await fs.readFile((await download.path())!)).toEqual(bytes);
  await clean(page);
});

test("touch slideshow skips hidden slides, exposes pointer tools and keeps notes private", async ({
  page,
}, info) => {
  await open(page);
  await page.getByRole("button", { name: "현재 슬라이드에서 발표" }).click();
  await expect(page.locator(".android-presentation")).toBeVisible();
  await expect(page.locator(".present-notes")).toHaveCount(0);
  for (const size of [
    { width: 800, height: 360 },
    { width: 412, height: 915 },
  ]) {
    await page.setViewportSize(size);
    await expect
      .poll(async () => {
        const slide = (await page.locator(".present-slide").boundingBox())!;
        const controls = (await page
          .locator(".android-presentation-controls")
          .boundingBox())!;
        return (
          slide.y + slide.height <= controls.y &&
          slide.x >= 0 &&
          slide.x + slide.width <= size.width + 1
        );
      })
      .toBe(true);
  }
  await page.getByRole("button", { name: "다음 발표 슬라이드" }).click();
  await expect(
    page.getByRole("button", { name: "발표 페이지로 이동" }),
  ).toHaveText("3 / 3");
  await page.getByRole("button", { name: "이전 발표 슬라이드" }).click();
  await page.getByRole("button", { name: "포인터와 판서 도구" }).click();
  await expect(
    page.getByRole("dialog", { name: "발표 도구", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  const box = (await page.locator(".present-slide").boundingBox())!;
  const y = box.y + box.height / 2;
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: 200, y, id: 1 }],
  });
  await expect(page.getByTestId("android-touch-laser")).toBeVisible();
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.getByTestId("android-touch-laser")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "발표 페이지로 이동" }),
  ).toHaveText("1 / 3");
  await page.screenshot({ path: info.outputPath("android-presentation.png") });
  await page.getByRole("button", { name: "발표 종료" }).click();
  await expect(page.getByTestId("android-slide-viewport")).toBeVisible();
  await session.detach();
  await clean(page);
});

test("tablet editing uses touch actions, numeric drafts, undo and PPTX reopen", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await (await menu(page))
    .getByRole("button", { name: "편집", exact: true })
    .click();
  await expect(page.locator(".android-editor")).toBeVisible();
  await page.getByRole("button", { name: "선택", exact: true }).click();
  await page
    .locator(".android-edit-panel")
    .getByRole("button", { name: "Alpha Beta 1", exact: true })
    .click();
  await page.getByRole("button", { name: "글자", exact: true }).click();
  const size = page.getByRole("spinbutton", { name: "글자 크기", exact: true });
  await size.fill("24");
  await expect(size).toHaveValue("24");
  await size.press("Enter");
  await page.getByRole("button", { name: "기울임", exact: true }).click();
  await page.getByRole("button", { name: "편집 옵션 닫기" }).click();
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  await page.getByRole("button", { name: "다시 실행", exact: true }).click();
  await page.screenshot({ path: info.outputPath("android-tablet-editor.png") });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "PPTX 저장", exact: true }).click(),
  ]);
  const saved = await fs.readFile((await download.path())!);
  await page.getByRole("button", { name: "보기로 돌아가기" }).click();
  await page.locator('input[accept*=".pptx"]').setInputFiles({
    name: "saved.pptx",
    mimeType: "application/octet-stream",
    buffer: saved,
  });
  await expect(page.locator(".android-slide-position")).toContainText(
    "한글 표",
  );
  const state = await page.evaluate(
    async (bytes) =>
      (await import("/src/io.ts")).importPptx(new Uint8Array(bytes)),
    Array.from(saved),
  );
  expect(state.deck.slides).toHaveLength(3);
  const text = state.deck.slides[0].elements.find((element) =>
    element.text?.includes("Alpha Beta"),
  )!;
  expect(text.fontSize).toBeCloseTo(32, 1);
  expect(text.italic).toBe(true);
  expect(
    state.deck.slides[0].elements.filter((element) => element.type === "image"),
  ).toHaveLength(1);
  expect(
    state.deck.slides[0].elements.filter((element) => element.type === "table"),
  ).toHaveLength(1);
  await clean(page);
});

test("slide grid mounts only nearby previews in a large document", async ({
  page,
}) => {
  await open(page, 151);
  await page
    .getByRole("button", { name: "슬라이드 목록", exact: true })
    .click();
  await expect(page.locator(".android-slide-grid button")).toHaveCount(151);
  await expect
    .poll(() => page.locator(".android-slide-grid .slide-visual").count())
    .toBeGreaterThan(0);
  expect(
    await page.locator(".android-slide-grid .slide-visual").count(),
  ).toBeLessThan(40);
  await page.locator(".android-slide-grid").evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await page.locator(".android-slide-grid button").last().click();
  await expect(
    page.getByRole("button", { name: "페이지로 이동 · 151 / 151" }),
  ).toBeVisible();
  await clean(page);
});

test("Android back closes nested panels and slideshow page input before leaving the document", async ({
  page,
}) => {
  await open(page);
  await (await menu(page)).getByRole("button", { name: "문서 검색" }).click();
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("android-slide-viewport")).toBeVisible();
  await page.getByRole("button", { name: "현재 슬라이드에서 발표" }).click();
  await page.getByRole("button", { name: "발표 페이지로 이동" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".android-presentation-jump")).toHaveCount(0);
  await expect(page.locator(".android-presentation")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("android-slide-viewport")).toBeVisible();
  await clean(page);
});

test("tablet partial italic stays on Beta and touch slide copy inserts at the chosen gap", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await (await menu(page))
    .getByRole("button", { name: "편집", exact: true })
    .click();
  const text = page
    .locator(".editable-slide .slide-element")
    .filter({ hasText: "Alpha Beta 1" })
    .first();
  await text.click({ position: { x: 30, y: 14 } });
  await page.getByRole("button", { name: "글자", exact: true }).click();
  await page
    .getByRole("button", { name: "선택한 텍스트 편집", exact: true })
    .click();
  await expect(page.locator(".editing-text")).toBeVisible();
  await page.locator(".editing-text").evaluate((host) => {
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const at = (node.textContent || "").indexOf("Beta");
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + 4);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      break;
    }
  });
  await page.getByRole("button", { name: "글자", exact: true }).click();
  await page.getByRole("button", { name: "기울임", exact: true }).click();
  const runs = await page.locator(".editing-text").evaluate((host) => {
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT),
      result: { text: string; italic: boolean }[] = [];
    let node: Node | null;
    while ((node = walker.nextNode()))
      if (node.textContent)
        result.push({
          text: node.textContent,
          italic: getComputedStyle(node.parentElement!).fontStyle === "italic",
        });
    return result;
  });
  expect(
    runs
      .filter((run) => run.italic)
      .map((run) => run.text)
      .join(""),
  ).toBe("Beta");
  await page.getByRole("button", { name: "편집 옵션 닫기" }).click();
  await page.getByRole("button", { name: "슬라이드", exact: true }).click();
  await page
    .getByRole("button", { name: "슬라이드 복사", exact: true })
    .click();
  await page
    .getByRole("button", { name: "현재 장 앞에 삽입", exact: true })
    .click();
  await page
    .getByRole("button", { name: "슬라이드 붙여넣기", exact: true })
    .click();
  await expect(page.locator(".thumbnail-button")).toHaveCount(4);
  await page.getByRole("button", { name: "편집 옵션 닫기" }).click();
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  await expect(page.locator(".thumbnail-button")).toHaveCount(3);
});

test("touch file picker cancellation and invalid files do not block the next open request", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const [first] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "파일 열기", exact: true }).click(),
  ]);
  await first.setFiles([]);
  const [second] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "파일 열기", exact: true }).click(),
  ]);
  await second.setFiles({
    name: "bad.pptx",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("broken"),
  });
  await expect(page.locator(".toast")).toContainText("파일 열기 실패");
  const bytes = await fixture(page);
  const [third] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "파일 열기", exact: true }).click(),
  ]);
  await third.setFiles({
    name: "good.pptx",
    mimeType: "application/octet-stream",
    buffer: bytes,
  });
  await expect(page.getByTestId("android-slide-viewport")).toBeVisible();
  await clean(page);
});

test("viewer offers button zoom and exposes failed pictures instead of a silent blank", async ({
  page,
}) => {
  await open(page);
  await (await menu(page))
    .getByRole("button", { name: "슬라이드 확대", exact: true })
    .click();
  await expect(page.getByTestId("android-slide-viewport")).toHaveAttribute(
    "data-zoom",
    "2.00",
  );
  await page.locator(".android-slide-position img").evaluate((image) => {
    (image as HTMLImageElement).src = "data:image/png;base64,invalid";
  });
  await expect(page.locator(".android-image-error")).toBeVisible();
  await clean(page);
});

for (const platform of ["darwin", "win32", "linux"])
  test(`desktop ${platform} stays on the original editor, even with Android UA and a narrow touch window`, async ({
    page,
  }) => {
    await page.addInitScript((platform) => {
      window.desktop = {
        platform,
        onMenu: () => () => {},
        openFile: async () => null,
        saveFile: async () => null,
        exportPDF: async () => null,
        print: async () => false,
      };
    }, platform);
    await page.goto("http://127.0.0.1:5190");
    await expect(page.locator(".office-shell")).toBeVisible();
    await expect(page.getByTestId("android-reader")).toHaveCount(0);
    await expect(page.locator(".android-editor-bars")).toHaveCount(0);
    expect(
      await page.locator("html").getAttribute("data-studio-platform"),
    ).toBeNull();
    expect(
      await page
        .locator(".office-shell")
        .evaluate((node) => getComputedStyle(node).minWidth),
    ).toBe("970px");
  });

test("native Android identity enables the reader with desktop-mode UA", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", {
      value:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36",
    });
    (window as any).Capacitor = { getPlatform: () => "android" };
  });
  await page.goto("http://127.0.0.1:5190");
  await expect(page.getByTestId("android-reader")).toBeVisible();
});

test("a narrow iPad touch browser retains the desktop UI because only Android is opted in", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgentData", {
      value: { platform: "iOS" },
    });
    Object.defineProperty(navigator, "userAgent", {
      value:
        "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
    });
  });
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".office-shell")).toBeVisible();
  await expect(page.getByTestId("android-reader")).toHaveCount(0);
});

async function previousDraft(page: Page) {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.getByTestId("android-reader")).toBeVisible();
  await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts"),
      { saveAutosave } = await import("/src/storage.ts");
    const deck = blankDeck();
    deck.name = "이전 Android 편집 자료";
    deck.slides[0].notes = "보존해야 하는 노트";
    await saveAutosave(deck);
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "임시 저장한 문서 이어서 편집" }),
  ).toBeVisible();
}

test("Android starts at home and explicitly resumes an earlier draft as unsaved editing", async ({
  page,
}) => {
  await previousDraft(page);
  await expect(page.getByTestId("android-slide-viewport")).toHaveCount(0);
  await page
    .getByRole("button", { name: "임시 저장한 문서 이어서 편집" })
    .click();
  await expect(page.locator(".android-editor .android-topbar")).toContainText(
    "이전 Android 편집 자료",
  );
  await expect
    .poll(() =>
      page.evaluate(() => sessionStorage.getItem("slide-studio-file-dirty")),
    )
    .toBe("true");
});

test("starting another Android document preserves the earlier draft in an atomic backup", async ({
  page,
}) => {
  await previousDraft(page);
  await page
    .getByRole("button", { name: "새 프레젠테이션", exact: true })
    .click();
  await expect(page.locator(".android-editor")).toBeVisible();
  const backup = await page.evaluate(async () => {
    const { listRecoveryBackups, recoveryDownload } = await import(
      "/src/storage.ts"
    );
    const records = await listRecoveryBackups();
    return {
      records,
      data: JSON.parse(
        await (await recoveryDownload(records[0].id)).blob.text(),
      ),
    };
  });
  expect(backup.records).toHaveLength(1);
  expect(backup.data.name).toBe("이전 Android 편집 자료");
  expect(backup.data.slides[0].notes).toBe("보존해야 하는 노트");
});

test("backup failure keeps the old Android draft and cancels opening a new editor", async ({
  page,
}) => {
  await previousDraft(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: any, key?: IDBValidKey) {
      if (String(key).startsWith("recovery-quarantine:data:"))
        throw new DOMException("quota", "QuotaExceededError");
      return original.call(this, value, key);
    };
  });
  await page
    .getByRole("button", { name: "새 프레젠테이션", exact: true })
    .click();
  await expect(page.locator(".toast")).toContainText("실패");
  await expect(
    page.getByRole("button", { name: "임시 저장한 문서 이어서 편집" }),
  ).toBeVisible();
  expect(
    await page.evaluate(async () => {
      const { loadAutosave, listRecoveryBackups } = await import(
          "/src/storage.ts"
        ),
        { validateDeck } = await import("/src/io.ts");
      return {
        name: (await loadAutosave(validateDeck))?.name,
        backups: (await listRecoveryBackups()).length,
      };
    }),
  ).toEqual({ name: "이전 Android 편집 자료", backups: 0 });
});
