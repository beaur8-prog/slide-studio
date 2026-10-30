import { expect, test, type Page } from "@playwright/test";

async function seed(page: Page, count = 3) {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async (count) => {
    const { blankDeck, element, newSlide } = await import("/src/model.ts");
    const { createTable } = await import("/src/table.ts");
    const { saveAutosave } = await import("/src/storage.ts");
    const deck = blankDeck();
    deck.slides = Array.from({ length: count }, (_, i) => ({
      ...newSlide("blank"),
      notes: `노트 Beta ${i + 1}`,
      elements: [
        element("text", {
          id: `title-${i}`,
          text: `검색 문서 ${i + 1}`,
          x: 70,
          y: 30,
          width: 800,
          height: 80,
        }),
        element("text", {
          id: `body-${i}`,
          text: "Alpha Beta Beta",
          x: 70,
          y: 180,
          width: 800,
          height: 100,
          paragraphs: [
            {
              spaceAfter: 12,
              runs: [
                { text: "Alpha ", color: "#112233" },
                { text: "Beta", color: "#CC2233", italic: true },
                { text: " Beta", bold: true },
              ],
            },
          ],
        }),
        element("table", {
          id: `table-${i}`,
          x: 70,
          y: 400,
          width: 850,
          height: 140,
          table: {
            ...createTable(2, 2),
            cells: [
              ["표전용검색어", "분기"],
              ["Beta", "100"],
            ],
            cellStyles: [
              [null, null],
              [
                {
                  paragraphs: [
                    {
                      spaceBefore: 7,
                      runs: [
                        { text: "Beta", underline: true, color: "#2244CC" },
                      ],
                    },
                  ],
                },
                null,
              ],
            ],
          },
        }),
      ],
    }));
    await saveAutosave(deck);
  }, count);
  await page.reload();
  await expect(
    page.locator('.editable-slide [data-element-id="body-0"]'),
  ).toBeVisible();
}
const panel = (page: Page) =>
  page.getByRole("complementary", { name: "찾기 및 바꾸기" });
async function saved(page: Page) {
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  return page.evaluate(
    async () => (await (await import("/src/storage.ts")).loadAutosave())!,
  );
}

test("quick command search finds table cells and exposes all 27 matching slides with keyboard navigation", async ({
  page,
}) => {
  await seed(page, 27);
  await page
    .getByRole("button", { name: "명령 및 슬라이드 검색", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "명령 검색어" })
    .fill("표전용검색어");
  await expect(page.locator('.command-results [role="option"]')).toHaveCount(
    27,
  );
  for (let i = 0; i < 26; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(
    page.locator('.editable-slide [data-element-id="table-26"]'),
  ).toBeVisible();
});

test("find navigates every text and table occurrence, highlights it and leaves history unchanged", async ({
  page,
}) => {
  await seed(page);
  await page.keyboard.press("ControlOrMeta+f");
  await panel(page)
    .getByRole("textbox", { name: "찾을 내용", exact: true })
    .fill("표전용검색어");
  await expect(panel(page).getByRole("status")).toHaveText("1 / 3개");
  await expect(
    page.locator(".editable-slide .slide-element.selected"),
  ).toHaveAttribute("data-element-id", "table-0");
  await expect
    .poll(() =>
      page.evaluate(
        () => (CSS as any).highlights?.get("studio-search-match")?.size,
      ),
    )
    .toBe(1);
  await panel(page).getByRole("button", { name: "다음 검색 결과" }).click();
  await expect(
    page.locator(".editable-slide .slide-element.selected"),
  ).toHaveAttribute("data-element-id", "table-1");
  await panel(page)
    .getByRole("textbox", { name: "찾을 내용", exact: true })
    .press("Shift+Enter");
  await expect(
    page.locator(".editable-slide .slide-element.selected"),
  ).toHaveAttribute("data-element-id", "table-0");
  await expect(
    page.getByRole("button", { name: "실행 취소", exact: true }),
  ).toBeDisabled();
  await panel(page)
    .getByRole("textbox", { name: "찾을 내용", exact: true })
    .press("Escape");
  await expect(panel(page)).toHaveCount(0);
});

test("replace all preserves mixed run styles and table paragraph properties, undoes atomically and saves to PPTX", async ({
  page,
}) => {
  await seed(page);
  await page.getByRole("button", { name: "바꾸기", exact: true }).click();
  await panel(page)
    .getByRole("textbox", { name: "찾을 내용", exact: true })
    .fill("Beta");
  await panel(page)
    .getByRole("textbox", { name: "바꿀 내용", exact: true })
    .fill("Gamma");
  await expect(panel(page).getByRole("status")).toHaveText("1 / 9개");
  await panel(page)
    .getByRole("button", { name: "모두 바꾸기", exact: true })
    .click();
  await expect(panel(page).getByRole("status")).toHaveText("0 / 0개");
  const next = await saved(page);
  for (const slide of next.slides) {
    const body = slide.elements[1];
    expect(body.text).toBe("Alpha Gamma Gamma");
    expect(body.paragraphs![0].spaceAfter).toBe(12);
    expect(
      body.paragraphs![0].runs.find((run) => run.text === "Gamma"),
    ).toMatchObject({ color: "#CC2233", italic: true });
    expect(slide.elements[2].table!.cells[1][0]).toBe("Gamma");
    expect(
      slide.elements[2].table!.cellStyles![1][0]!.paragraphs![0],
    ).toMatchObject({
      spaceBefore: 7,
      runs: [{ text: "Gamma", underline: true, color: "#2244CC" }],
    });
    expect(slide.notes).toContain("Beta");
  }
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  await expect(panel(page).getByRole("status")).toHaveText("1 / 9개");
  await page.getByRole("button", { name: "다시 실행", exact: true }).click();
  await expect(panel(page).getByRole("status")).toHaveText("0 / 0개");
  await saved(page);
  const result = await page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const deck = (await loadAutosave())!;
    const result = (await importPptx(await exportPptx(deck))).deck;
    return {
      texts: result.slides.map(
        (slide) =>
          slide.elements.find((e) => e.text?.startsWith("Alpha"))?.text,
      ),
      cells: result.slides.map(
        (slide) => slide.elements.find((e) => e.table)?.table?.cells[1][0],
      ),
    };
  });
  expect(result.texts).toEqual(Array(3).fill("Alpha Gamma Gamma"));
  expect(result.cells).toEqual(Array(3).fill("Gamma"));
});

test("case, whole word, literal regex characters, notes and protected objects have predictable replacements", async ({
  page,
}) => {
  await seed(page);
  const result = await page.evaluate(async () => {
    const { findDocumentText, replaceDocumentMatches, DEFAULT_SEARCH_OPTIONS } =
      await import("/src/document-search.ts");
    const { blankDeck, element } = await import("/src/model.ts");
    const d = blankDeck();
    d.slides[0].notes = "Beta note";
    d.slides[0].elements = [
      element("text", {
        id: "notes",
        text: "Beta beta Betamax [a+b] 한글 한글말",
      }),
      element("text", { id: "locked", text: "Beta", locked: true }),
      element("text", { id: "field", text: "Beta", field: "footer" }),
    ];
    const defaults = DEFAULT_SEARCH_OPTIONS;
    const simple = findDocumentText(d, "Beta", defaults);
    const exact = findDocumentText(d, "Beta", {
      ...defaults,
      wholeWord: true,
      caseSensitive: true,
    });
    const literal = findDocumentText(d, "[a+b]", defaults);
    const korean = findDocumentText(d, "한글", {
      ...defaults,
      wholeWord: true,
    });
    const notes = findDocumentText(d, "Beta", {
      ...defaults,
      includeNotes: true,
    });
    const updated = replaceDocumentMatches(d, notes.matches, "$&");
    let stale = "";
    try {
      replaceDocumentMatches(
        d,
        [{ ...simple.matches[0], value: "stale" }],
        "Gamma",
      );
    } catch (error) {
      stale = String(error);
    }
    return {
      counts: [
        simple.matches.length,
        exact.matches.length,
        literal.matches.length,
        korean.matches.length,
        notes.matches.length,
      ],
      text: updated.deck.slides[0].elements[0].text,
      note: updated.deck.slides[0].notes,
      locked: updated.deck.slides[0].elements[1].text,
      field: updated.deck.slides[0].elements[2].text,
      replaced: updated.count,
      skipped: updated.skipped,
      stale,
    };
  });
  expect(result.counts).toEqual([5, 3, 1, 1, 6]);
  expect(result.text).toBe("$& $& $&max [a+b] 한글 한글말");
  expect(result.note).toBe("$& note");
  expect([result.locked, result.field]).toEqual(["Beta", "Beta"]);
  expect([result.replaced, result.skipped]).toEqual([4, 2]);
  expect(result.stale).toContain("검색 결과가 바뀌었습니다");
});

test("a single replacement changes only its occurrence and identical replacement creates no history", async ({
  page,
}) => {
  await seed(page);
  await page.getByRole("button", { name: "바꾸기", exact: true }).click();
  await panel(page)
    .getByRole("textbox", { name: "찾을 내용", exact: true })
    .fill("Beta");
  await panel(page)
    .getByRole("textbox", { name: "바꿀 내용", exact: true })
    .fill("Beta");
  await panel(page)
    .getByRole("button", { name: "바꾸기", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "실행 취소", exact: true }),
  ).toBeDisabled();
  await panel(page)
    .getByRole("textbox", { name: "바꿀 내용", exact: true })
    .fill("Gamma");
  await panel(page)
    .getByRole("button", { name: "바꾸기", exact: true })
    .click();
  expect((await saved(page)).slides[0].elements[1].text).toBe(
    "Alpha Gamma Beta",
  );
  await expect(panel(page).getByRole("status")).toHaveText("1 / 8개");
});

test("large result sets paginate completely and overflow disables partial replace all", async ({
  page,
}) => {
  await seed(page, 27);
  await page.getByRole("button", { name: "찾기", exact: true }).click();
  await panel(page)
    .getByRole("textbox", { name: "찾을 내용", exact: true })
    .fill("Beta");
  await expect(panel(page).getByRole("status")).toHaveText("1 / 81개");
  await expect(panel(page).getByRole("option")).toHaveCount(40);
  await panel(page)
    .getByRole("button", { name: "다음 목록", exact: true })
    .click();
  await expect(panel(page).getByRole("status")).toHaveText("41 / 81개");
  await panel(page)
    .getByRole("button", { name: "다음 목록", exact: true })
    .click();
  await expect(panel(page).getByRole("status")).toHaveText("81 / 81개");
  const limited = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { findDocumentText, MAX_SEARCH_RESULTS } = await import(
      "/src/document-search.ts"
    );
    const d = blankDeck();
    d.slides[0].elements = [
      element("text", { text: "a".repeat(MAX_SEARCH_RESULTS + 10) }),
    ];
    const found = findDocumentText(d, "a");
    return {
      count: found.matches.length,
      truncated: found.truncated,
      limit: MAX_SEARCH_RESULTS,
    };
  });
  expect(limited).toEqual({
    count: limited.limit,
    truncated: true,
    limit: limited.limit,
  });
  await panel(page).getByRole("button", { name: "찾기 닫기" }).click();
  const overflowFixture = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { MAX_SEARCH_RESULTS } = await import("/src/document-search.ts");
    const d = blankDeck();
    d.slides[0].elements = [
      element("text", { text: "a".repeat(MAX_SEARCH_RESULTS + 10) }),
    ];
    return JSON.stringify(d);
  });
  // Load through the real import flow. Writing IndexedDB behind a live editor
  // can race its pending layout/recovery write and restore the preceding deck.
  await page.locator('input[accept*=".pptx"]').setInputFiles({
    name: "search-overflow.slide",
    mimeType: "application/json",
    buffer: Buffer.from(overflowFixture),
  });
  await expect(page.locator(".editable-slide")).toContainText("a".repeat(100));
  await page.getByRole("button", { name: "바꾸기", exact: true }).click();
  await panel(page)
    .getByRole("textbox", { name: "찾을 내용", exact: true })
    .fill("a");
  await expect(panel(page).getByRole("alert")).toContainText("20,000개");
  await expect(
    panel(page).getByRole("button", { name: "모두 바꾸기", exact: true }),
  ).toBeDisabled();
});

test("choosing the same active search result again restores its object selection", async ({
  page,
}) => {
  await seed(page);
  await page.getByRole("button", { name: "찾기", exact: true }).click();
  await panel(page)
    .getByRole("textbox", { name: "찾을 내용", exact: true })
    .fill("표전용검색어");
  await page.locator('.editable-slide [data-element-id="title-0"]').click();
  await expect(
    page.locator(".editable-slide .slide-element.selected"),
  ).toHaveAttribute("data-element-id", "title-0");
  await panel(page).getByRole("option").first().click();
  await expect(
    page.locator(".editable-slide .slide-element.selected"),
  ).toHaveAttribute("data-element-id", "table-0");
  await expect(
    page.getByRole("button", { name: "실행 취소", exact: true }),
  ).toBeDisabled();
});

test("replacement across rich runs preserves surrounding hyperlinks, blank lines and soft breaks", async ({
  page,
}) => {
  await seed(page);
  const result = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { findDocumentText, replaceDocumentMatches } = await import(
      "/src/document-search.ts"
    );
    const { parseDeckJson } = await import("/src/io.ts");
    const d = blankDeck();
    d.slides[0].elements = [
      element("text", {
        text: "Lead Beta tail\n\nBeta\nsoft",
        paragraphs: [
          {
            spaceAfter: 9,
            runs: [
              { text: "Lead ", hyperlink: { url: "https://example.com/" } },
              { text: "Be", italic: true, color: "#112233" },
              { text: "ta", bold: true },
              { text: " tail", underline: true },
            ],
          },
          { spaceBefore: 7, runs: [{ text: "" }] },
          { lineHeight: 1.8, runs: [{ text: "Beta\nsoft", color: "#223344" }] },
        ],
      }),
    ];
    const next = replaceDocumentMatches(
      d,
      findDocumentText(d, "Beta").matches,
      "한글😀",
    ).deck;
    const safe = parseDeckJson(JSON.stringify(next));
    return safe.slides[0].elements[0];
  });
  expect(result.text).toBe("Lead 한글😀 tail\n\n한글😀\nsoft");
  expect(result.paragraphs).toHaveLength(3);
  expect(result.paragraphs![0].runs).toEqual([
    { text: "Lead ", hyperlink: { url: "https://example.com/" } },
    { text: "한글😀", italic: true, color: "#112233" },
    { text: " tail", underline: true },
  ]);
  expect(result.paragraphs![1].spaceBefore).toBe(7);
  expect(result.paragraphs![2].runs).toEqual([
    { text: "한글😀\nsoft", color: "#223344" },
  ]);
});

test("replace all rejects oversized table content atomically instead of changing preceding text", async ({
  page,
}) => {
  await seed(page);
  await page.getByRole("button", { name: "바꾸기", exact: true }).click();
  await panel(page)
    .getByRole("textbox", { name: "찾을 내용", exact: true })
    .fill("Beta");
  await panel(page)
    .getByRole("textbox", { name: "바꿀 내용", exact: true })
    .fill("x".repeat(2001));
  await panel(page)
    .getByRole("button", { name: "모두 바꾸기", exact: true })
    .click();
  await expect(page.locator(".toast")).toContainText("너무 깁니다");
  await expect(
    page.getByRole("button", { name: "실행 취소", exact: true }),
  ).toBeDisabled();
  expect((await saved(page)).slides[0].elements[1].text).toBe(
    "Alpha Beta Beta",
  );
});
