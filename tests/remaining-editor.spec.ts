import { test, expect, type Page } from "@playwright/test";
async function seed(page: Page, kind = "text") {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async (kind) => {
    const { blankDeck, element } = await import("/src/model.ts"),
      { createTable, createTableElement } = await import("/src/table.ts"),
      { saveAutosave } = await import("/src/storage.ts");
    const d = blankDeck();
    d.name = "Remaining regression";
    if (kind === "table") {
      const table = createTable(2, 2);
      table.cells = [
        ["A", "B"],
        ["C", "D"],
      ];
      d.slides[0].elements = [
        {
          ...createTableElement(table),
          x: 100,
          y: 80,
          width: 600,
          height: 100,
        },
      ];
    } else
      d.slides[0].elements = [
        element(kind === "shape" ? "shape" : "text", {
          ...(kind === "shape" ? { shape: "ellipse" as const } : {}),
          text: "Before after",
          x: 100,
          y: 100,
          width: 700,
          height: 120,
          fontSize: 30,
        }),
      ];
    if (kind === "slides")
      d.slides = Array.from({ length: 4 }, (_, i) => ({
        ...structuredClone(d.slides[0]),
        id: `slide-${i}`,
        notes: `비공개 노트 ${i + 1}`,
        elements: [
          element("text", {
            text: `Page ${i + 1}`,
            x: 100,
            y: 100,
            width: 600,
            height: 150,
            fontSize: 40,
          }),
        ],
      }));
    await saveAutosave(d);
  }, kind);
  await page.reload();
}

for (const kind of ["text", "shape", "table"]) {
  test(`${kind} inline paste updates only the edited object without creating a second text box`, async ({
    page,
  }) => {
    await seed(page, kind);
    if (kind === "table") {
      await page
        .locator('.editable-slide [data-row="0"][data-column="0"]')
        .click();
      await page.keyboard.press("Enter");
    } else
      await page.locator(`.editable-slide [data-type="${kind}"]`).dblclick();
    const editor = page.locator('.editable-slide [contenteditable="true"]');
    await expect(editor).toBeFocused();
    await editor.press("ControlOrMeta+a");
    await editor.evaluate((host) => {
      const data = new DataTransfer();
      data.setData("text/plain", "한글 붙여넣기\nBeta only");
      host.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        }),
      );
    });
    await expect(editor).toHaveText("한글 붙여넣기\nBeta only", {
      useInnerText: true,
    });
    // Native clipboard dispatch can target the document after execCommand replaces the editor.
    // It must not fall through to the canvas object-paste handler while editing.
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData("text/plain", "Must not create a canvas object");
      window.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        }),
      );
    });
    await editor.press("Escape");
    await expect(page.locator(".save-indicator")).toHaveText("저장됨");
    const elements = await page.evaluate(async () => {
      const { loadAutosave } = await import("/src/storage.ts");
      return (await loadAutosave())!.slides[0].elements;
    });
    expect(elements).toHaveLength(1);
    if (kind === "table")
      expect(elements[0].table!.cells[0][0]).toBe("한글 붙여넣기\nBeta only");
    else expect(elements[0].text).toBe("한글 붙여넣기\nBeta only");
    await page.reload();
    await expect(page.locator(".editable-slide")).toContainText("Beta only");
    await expect(page.locator(".editable-slide .slide-element")).toHaveCount(1);
  });
}

test("rich clipboard retains supported formats, rejects active HTML and preserves native undo/redo", async ({
  page,
}) => {
  await seed(page);
  await page.locator('.editable-slide [data-type="text"]').dblclick();
  const editor = page.getByRole("textbox", {
    name: "슬라이드 텍스트 편집",
    exact: true,
  });
  await editor.evaluate(async (host) => {
    const { restoreTextOffsets } = await import("/src/text-selection.ts");
    restoreTextOffsets(host, 7, 7);
    const data = new DataTransfer();
    data.setData("text/plain", "Bold 한글");
    data.setData(
      "text/html",
      '<b>Bold </b><span style="color:#aa1133;font-size:36px;font-style:italic">한글</span><script>window.PASTE_EXECUTED=1</script><img src="https://example.com/a" onerror="alert(1)">',
    );
    host.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
  });
  await expect(editor).toHaveText("Before Bold 한글after");
  expect(
    await page.evaluate(() => (window as any).PASTE_EXECUTED),
  ).toBeUndefined();
  await expect(editor.locator("script,img")).toHaveCount(0);
  await editor.press("ControlOrMeta+z");
  await expect(editor).toHaveText("Before after");
  await editor.press("ControlOrMeta+Shift+z");
  await expect(editor).toHaveText("Before Bold 한글after");
  await editor.press("Escape");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await expect(page.locator(".editable-slide .slide-element")).toHaveCount(1);
  const runs = await page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts");
    return (await loadAutosave())!.slides[0].elements[0].paragraphs![0].runs;
  });
  expect(runs.some((r) => r.text.includes("Bold") && r.bold)).toBe(true);
  expect(
    runs.some(
      (r) =>
        r.text.includes("한글") &&
        r.italic &&
        r.color === "#AA1133" &&
        r.fontSize === 36,
    ),
  ).toBe(true);
});

test("inline table rows grow for long Korean paragraphs in the text edit undo transaction", async ({
  page,
}) => {
  await seed(page, "table");
  const table = page.locator('.editable-slide [data-type="table"]');
  await table.locator('[data-row="0"][data-column="0"]').click();
  await page.keyboard.press("Enter");
  const editor = page.getByRole("textbox", { name: "1행 1열 셀 텍스트 편집" });
  await editor.press("ControlOrMeta+A");
  await editor.fill("긴 한글 문장을 여러 줄에 걸쳐 입력합니다. ".repeat(15));
  await editor.press("Escape");
  await expect
    .poll(() =>
      table.evaluate((el) => parseFloat((el as HTMLElement).style.height)),
    )
    .toBeGreaterThan(160);
  const cell = table.locator('[data-row="0"][data-column="0"]');
  const metrics = await cell.evaluate((el) => ({
    scroll: el.scrollHeight,
    client: el.clientHeight,
    cell: getComputedStyle(el).cssText,
    inner: (el.querySelector(".table-cell-text") as HTMLElement).offsetHeight,
    text: getComputedStyle(el).font,
    font: getComputedStyle(el).fontFamily,
    width: el.clientWidth,
    padding: getComputedStyle(el).padding,
  }));
  expect(metrics.scroll, JSON.stringify(metrics)).toBeLessThanOrEqual(
    metrics.client + 1,
  );
  await page.keyboard.press("ControlOrMeta+z");
  await expect(table).toHaveCSS("height", "100px");
  await expect(cell).toHaveText("A");
});

test("slides multi-select, duplicate, reorder and delete as a block and layout changes preserve content", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1500 });
  await seed(page, "slides");
  const thumbs = page.locator(".thumbnail-button");
  await thumbs.nth(0).click();
  await thumbs.nth(2).click({ modifiers: ["Shift"] });
  await expect(
    thumbs
      .locator("xpath=..")
      .filter({ has: page.locator('.thumbnail-button[aria-pressed="true"]') }),
  ).toHaveCount(3);
  await thumbs.nth(1).click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "슬라이드 복제 (3)", exact: true })
    .click();
  await expect(thumbs).toHaveCount(7);
  await thumbs.nth(0).click();
  await thumbs.nth(1).click({ modifiers: ["ControlOrMeta"] });
  await thumbs
    .nth(0)
    .locator("xpath=..")
    .dragTo(thumbs.nth(6).locator("xpath=.."));
  await expect(thumbs.nth(0)).toHaveAttribute(
    "aria-label",
    "슬라이드 1: Page 3",
  );
  await thumbs.nth(0).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await expect(thumbs).toHaveCount(7); // Keep at least one slide.
  await thumbs.nth(0).click();
  await thumbs.nth(1).click({ modifiers: ["Shift"] });
  await page.keyboard.press("Delete");
  await expect(thumbs).toHaveCount(5);
  await page.getByRole("button", { name: "서식", exact: true }).click();
  await page.locator(".editable-slide").click({ position: { x: 10, y: 10 } });
  const before = await thumbs.count();
  await page
    .locator(".layout-preview-grid button")
    .filter({ hasText: "두 단" })
    .click();
  await expect(thumbs).toHaveCount(before);
  await expect(page.locator(".editable-slide")).toContainText("Page");
});

test("different partial run links survive PPTX round trips without linking surrounding text", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const r = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts"),
      { exportPptx, importPptx } = await import("/src/io.ts");
    let d = blankDeck();
    d.slides[0].elements = [
      element("text", {
        text: "Plain Web Next",
        paragraphs: [
          {
            runs: [
              { text: "Plain " },
              { text: "Web", hyperlink: { url: "https://example.com/" } },
              { text: " Next", hyperlink: { slideId: d.slides[0].id } },
            ],
          },
        ],
      }),
    ];
    let warnings: string[] = [];
    for (let i = 0; i < 3; i++) {
      const next = await importPptx(await exportPptx(d));
      d = next.deck;
      warnings.push(...next.warnings);
    }
    return { e: d.slides[0].elements[0], id: d.slides[0].id, warnings };
  });
  expect(r.e.hyperlink).toBeUndefined();
  expect(r.e.paragraphs![0].runs[0].hyperlink).toBeUndefined();
  expect(r.e.paragraphs![0].runs[1].hyperlink).toEqual({
    url: "https://example.com/",
  });
  expect(r.e.paragraphs![0].runs[2].hyperlink).toEqual({ slideId: r.id });
  expect(r.warnings.join(" ")).not.toContain("하이퍼링크는 유지할 수 없어");
});

test("presenter window controls audience slides while notes remain private", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.desktop = {
      setPresentationMode: async () => {},
      onMenu: () => () => {},
      saveFile: async () => null,
      openFile: async () => null,
      exportPDF: async () => null,
      print: async () => false,
    };
  });
  await seed(page, "slides");
  await page.getByRole("button", { name: "슬라이드 쇼", exact: true }).click();
  const opened = page.waitForEvent("popup");
  await page.getByRole("button", { name: "발표자 보기", exact: true }).click();
  const popup = await opened;
  await expect(
    popup.getByRole("heading", { name: "발표자 보기" }),
  ).toBeVisible();
  await expect(popup.locator(".presenter-private-notes")).toHaveText(
    "비공개 노트 1",
  );
  await expect(page.locator(".present-notes")).toHaveCount(0);
  await popup.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page.getByTestId("presentation-view")).toHaveAttribute(
    "aria-label",
    "발표 슬라이드 2 / 4",
  );
  await expect(popup.locator(".presenter-private-notes")).toHaveText(
    "비공개 노트 2",
  );
  await popup.getByRole("button", { name: "발표 종료", exact: true }).click();
  await expect(page.getByTestId("presentation-view")).toHaveCount(0);
  await popup.close();
});

test("text undo remains separated by words after leaving the editor, and double-click selects the word under the pointer", async ({
  page,
}) => {
  await seed(page);
  const text = page.locator('.editable-slide [data-type="text"]');
  const point = await text.locator(".element-text").evaluate((host) => {
    const node = host.querySelector("span")!.firstChild!;
    const r = document.createRange();
    r.setStart(node, 7);
    r.setEnd(node, 12);
    const b = r.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.mouse.dblclick(point.x, point.y);
  const editor = page.getByRole("textbox", {
    name: "슬라이드 텍스트 편집",
    exact: true,
  });
  await expect
    .poll(() => page.evaluate(() => getSelection()?.toString()))
    .toBe("after");
  await editor.press("ControlOrMeta+A");
  await editor.pressSequentially("One Two Three");
  await editor.press("Escape");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(text).toHaveText("One Two ");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(text).toHaveText("One ");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(text).toHaveText("Before after");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(text).toHaveText("One ");
});

test("numbering continues on Enter and preserves alpha/roman type and list level through PPTX", async ({
  page,
}) => {
  await seed(page);
  const text = page.locator('.editable-slide [data-type="text"]');
  await text.dblclick();
  const editor = page.getByRole("textbox", {
    name: "슬라이드 텍스트 편집",
    exact: true,
  });
  await editor.fill("One\nTwo");
  await editor.press("ControlOrMeta+A");
  await page
    .getByRole("button", { name: "1. 번호 매기기", exact: true })
    .click();
  await editor.press("ArrowRight");
  await editor.press("Enter");
  await editor.pressSequentially("Three");
  await expect(editor).toHaveText("1. One2. Two3. Three");
  await editor.press("Escape");
  const r = await page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts"),
      { exportPptx, importPptx } = await import("/src/io.ts"),
      { blankDeck, element } = await import("/src/model.ts");
    const d = blankDeck();
    d.slides[0].elements = [
      element("text", {
        text: "a. Alpha\nIV) Roman",
        paragraphs: [
          {
            level: 2,
            numbering: { type: "alphaLcPeriod", value: 1 },
            bulletPrefix: "a. ",
            indent: -20,
            marginLeft: 60,
            runs: [{ text: "a. Alpha" }],
          },
          {
            level: 1,
            numbering: { type: "romanUcParenR", value: 4 },
            bulletPrefix: "IV) ",
            indent: -20,
            marginLeft: 40,
            runs: [{ text: "IV) Roman" }],
          },
        ],
      }),
    ];
    return (await importPptx(await exportPptx(d))).deck.slides[0].elements[0];
  });
  expect(r.text).toBe("a. Alpha\nIV) Roman");
  expect(r.paragraphs![0]).toMatchObject({
    level: 2,
    numbering: { type: "alphaLcPeriod", value: 1 },
  });
  expect(r.paragraphs![1]).toMatchObject({
    level: 1,
    numbering: { type: "romanUcParenR", value: 4 },
  });
});
