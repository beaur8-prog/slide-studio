import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import JSZip from "jszip";

const baseURL = process.env.JUSTIFY_BASE_URL || "http://127.0.0.1:5190";
const sourceBytes = Array.from(
  fs.readFileSync("tests/fixtures/justify/paragraph-justify-source.pptx"),
);
const editor = (page: Page) =>
  page.getByRole("textbox", { name: "슬라이드 텍스트 편집", exact: true });

async function openText(page: Page, paragraphs: unknown[], text: string) {
  await page.goto(baseURL);
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(
    async ({ paragraphs, text }) => {
      const { blankDeck, element } = await import("/src/model.ts");
      const { saveAutosave } = await import("/src/storage.ts");
      const deck = blankDeck();
      deck.slides[0].elements = [
        element("text", {
          x: 100,
          y: 100,
          width: 700,
          height: 350,
          fontFamily: "Arial",
          fontSize: 28,
          text,
          paragraphs,
        }),
      ];
      await saveAutosave(deck);
    },
    { paragraphs, text },
  );
  await page.reload();
  await expect(page.getByTestId("slide-element")).toHaveCount(1);
  await page.getByTestId("slide-element").dblclick();
  await expect(editor(page)).toBeFocused();
}

async function selectSubstring(page: Page, text: string) {
  await editor(page).evaluate((host, value) => {
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const offset = node.textContent!.indexOf(value);
      if (offset >= 0) {
        getSelection()!.setBaseAndExtent(
          node,
          offset,
          node,
          offset + value.length,
        );
        return;
      }
    }
    throw new Error(`Cannot find selection: ${value}`);
  }, text);
}

async function savedText(page: Page) {
  return page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts");
    return (await loadAutosave())!.slides[0].elements[0];
  });
}

test("PPTX imports direct and inherited justification with explicit left override", async ({
  page,
}, info) => {
  await page.goto(baseURL);
  const result = await page.evaluate(async (bytes) => {
    const { importPptx } = await import("/src/io.ts");
    const deck = (await importPptx(Uint8Array.from(bytes))).deck;
    return {
      english: deck.slides[0].elements
        .filter((e) => e.text?.startsWith("Alpha teams"))
        .map((e) => ({ align: e.align, paragraph: e.paragraphs?.[0].align })),
      korean: deck.slides[1].elements
        .filter((e) => e.text?.startsWith("한글 문단"))
        .map((e) => e.paragraphs?.[0].align),
      inherited: deck.slides[3].elements
        .filter((e) =>
          /^(List inherited|Layout inherited|Explicit left)/.test(e.text || ""),
        )
        .map((e) => ({ text: e.text, align: e.paragraphs?.[0].align })),
      soft: deck.slides[2].elements
        .filter((e) => e.text?.startsWith("Alpha Beta"))
        .map((e) => ({
          align: e.paragraphs?.[0].align,
          count: e.paragraphs?.length,
          text: e.paragraphs?.[0].runs.map((r) => r.text).join(""),
        })),
    };
  }, sourceBytes);
  await info.attach("import-alignment", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });
  expect(result.english).toEqual([
    { align: "left", paragraph: "left" },
    { align: "justify", paragraph: "justify" },
  ]);
  expect(result.korean).toEqual(["left", "justify"]);
  expect(result.inherited.map((e) => e.align)).toEqual([
    "justify",
    "justify",
    "left",
  ]);
  expect(result.soft.map((e) => e.align)).toEqual(["left", "justify"]);
  for (const item of result.soft) {
    expect(item.count).toBe(1);
    expect(item.text).toContain("Delta\nEpsilon");
  }
});

test("new whole-element justification exports valid just even when paragraphs inherit alignment", async ({
  page,
}, info) => {
  await page.goto(baseURL);
  const result = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { serializeDeck, parseDeckJson, exportPptx, importPptx } =
      await import("/src/io.ts");
    const { editText } = await import("/src/text-layout.ts");
    let deck = blankDeck();
    deck.slides[0].elements = [
      element("text", {
        text: "Alpha Beta Gamma",
        align: "justify",
        paragraphs: [{ runs: [{ text: "Alpha Beta Gamma" }] }],
      }),
      element("text", {
        text: "Plain text without paragraph metadata",
        align: "justify",
      }),
    ];
    deck = parseDeckJson(serializeDeck(deck));
    Object.assign(
      deck.slides[0].elements[0],
      editText(deck.slides[0].elements[0], "Alpha Beta Gamma Delta"),
    );
    const bytes = await exportPptx(deck);
    const reopenedElements = (await importPptx(bytes)).deck.slides[0].elements;
    const reopened = reopenedElements[0];
    return {
      bytes: Array.from(bytes),
      align: reopened.align,
      paragraph: reopened.paragraphs?.[0].align,
      text: reopened.text,
      plain: {
        align: reopenedElements[1].align,
        paragraph: reopenedElements[1].paragraphs?.[0].align,
        text: reopenedElements[1].text,
      },
    };
  });
  const zip = await JSZip.loadAsync(Uint8Array.from(result.bytes));
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  const alignments = [...xml.matchAll(/<a:pPr\b[^>]*\balgn="([^"]+)"/g)].map(
    (match) => match[1],
  );
  await info.attach("fresh-export", {
    body: JSON.stringify({ ...result, bytes: undefined, alignments }, null, 2),
    contentType: "application/json",
  });
  expect(alignments).toEqual(["just", "just"]);
  expect(result).toMatchObject({
    align: "justify",
    paragraph: "justify",
    text: "Alpha Beta Gamma Delta",
    plain: {
      align: "justify",
      paragraph: "justify",
      text: "Plain text without paragraph metadata",
    },
  });
});

test("three edited PPTX saves preserve mixed alignment and table clipboard justification", async ({
  page,
}, info) => {
  test.setTimeout(60000);
  await page.goto(baseURL);
  const result = await page.evaluate(async (bytes) => {
    const { exportPptx, importPptx, parseDeckJson, serializeDeck } =
      await import("/src/io.ts");
    const { editText } = await import("/src/text-layout.ts");
    const { copyStudioTable, readStudioTable, pasteStudioTable } = await import(
      "/src/table-exchange.ts"
    );
    const { createTable, tableCellStyle } = await import("/src/table.ts");
    const { element } = await import("/src/model.ts");
    let deck = (await importPptx(Uint8Array.from(bytes))).deck;
    const before = deck.slides[4].elements.find((e) => e.type === "table")!;
    const clipboard = copyStudioTable(before.table!);
    const copy = readStudioTable(clipboard.html)!;
    const pasted = pasteStudioTable(createTable(2, 2), 0, 0, copy);
    const clipboardAlignments = pasted.cells.map((row, r) =>
      row.map((_, c) => tableCellStyle(pasted, r, c).align),
    );
    deck.slides[4].elements = [
      element("table", {
        x: 60,
        y: 100,
        width: 1100,
        height: 500,
        table: pasted,
      }),
    ];
    const rounds = [];
    for (let round = 0; round < 4; round++) {
      const body = deck.slides[0].elements.find(
        (e) =>
          e.text?.startsWith("Alpha teams") &&
          e.paragraphs?.[0].align === "justify",
      );
      const table = deck.slides[4].elements.find(
        (e) => e.type === "table",
      )!.table!;
      rounds.push({
        align: body?.paragraphs?.[0].align,
        inherited: deck.slides[3].elements
          .filter((e) =>
            /^(List inherited|Layout inherited|Explicit left)/.test(
              e.text || "",
            ),
          )
          .map((e) => e.paragraphs?.[0].align),
        table: table.cells.map((row, r) =>
          row.map((_, c) => tableCellStyle(table, r, c).align),
        ),
      });
      if (round === 3) break;
      if (!body) throw new Error("Justified source text was lost on import");
      Object.assign(
        body,
        editText(
          body,
          body.text!.replace(/(?: edited \d+)?$/, ` edited ${round + 1}`),
        ),
      );
      body.x += 1;
      // A copy has no original OOXML to silently preserve: this exercises
      // Slide Studio's generated table/paragraph export in each cycle.
      deck = parseDeckJson(serializeDeck(deck));
      deck = (await importPptx(await exportPptx(deck))).deck;
    }
    return { clipboardAlignments, html: clipboard.html, rounds };
  }, sourceBytes);
  await info.attach("three-roundtrips", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });
  expect(result.clipboardAlignments).toEqual([
    ["left", "justify"],
    ["left", "justify"],
  ]);
  expect(result.html).toContain("text-align:justify");
  expect(result.rounds).toHaveLength(4);
  for (const round of result.rounds)
    expect(round).toEqual({
      align: "justify",
      inherited: ["justify", "justify", "left"],
      table: [
        ["left", "justify"],
        ["left", "justify"],
      ],
    });
});

test("Home justification on a partial selection changes its paragraph and supports native undo/redo", async ({
  page,
}, info) => {
  await openText(
    page,
    [
      { align: "left", runs: [{ text: "Alpha Beta Gamma" }] },
      { align: "right", runs: [{ text: "Second paragraph remains right" }] },
    ],
    "Alpha Beta Gamma\nSecond paragraph remains right",
  );
  await selectSubstring(page, "Beta");
  await page.getByRole("button", { name: "양쪽 맞춤", exact: true }).click();
  await expect(editor(page)).toBeFocused();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe("Beta");
  const alignments = async () =>
    (await savedText(page)).paragraphs?.map((p) => p.align);
  await expect.poll(alignments).toEqual(["justify", "right"]);
  await editor(page).press("ControlOrMeta+z");
  await expect.poll(alignments).toEqual(["left", "right"]);
  await editor(page).press("ControlOrMeta+Shift+z");
  await expect.poll(alignments).toEqual(["justify", "right"]);
  await editor(page).press("Escape");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.reload();
  await expect.poll(alignments).toEqual(["justify", "right"]);
  await page.screenshot({
    path: info.outputPath("partial-paragraph-justify.png"),
  });
});

test("Ctrl or Cmd plus J justifies the active paragraph without replacing its selected text", async ({
  page,
}) => {
  await openText(
    page,
    [{ align: "left", runs: [{ text: "Alpha Beta Gamma" }] }],
    "Alpha Beta Gamma",
  );
  await selectSubstring(page, "Beta");
  await editor(page).press("ControlOrMeta+j");
  await expect(editor(page)).toBeFocused();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe("Beta");
  await expect
    .poll(async () => (await savedText(page)).paragraphs?.[0].align)
    .toBe("justify");
  expect((await savedText(page)).text).toBe("Alpha Beta Gamma");
});

test("table cell justification applies only to the selected cell and survives undo, redo and reopen", async ({
  page,
}) => {
  await page.goto(baseURL);
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { createTable, createTableElement } = await import("/src/table.ts");
    const { saveAutosave } = await import("/src/storage.ts");
    const table = createTable(1, 2);
    table.header = false;
    table.cells = [["Alpha Beta Gamma Delta", "Other cell remains right"]];
    table.cellStyles = [
      [
        {
          align: "left",
          paragraphs: [{ align: "left", runs: [{ text: table.cells[0][0] }] }],
        },
        {
          align: "right",
          paragraphs: [{ align: "right", runs: [{ text: table.cells[0][1] }] }],
        },
      ],
    ];
    const deck = blankDeck();
    deck.slides[0].elements = [
      { ...createTableElement(table), x: 100, y: 100, width: 900, height: 300 },
    ];
    await saveAutosave(deck);
  });
  await page.reload();
  const firstCell = page.locator(
    '.editable-slide [data-type="table"] [data-row="0"][data-column="0"]',
  );
  await firstCell.dblclick();
  const dialog = page.getByRole("dialog", { name: "표 편집", exact: true });
  await dialog.getByLabel("서식 적용 대상").selectOption("selection");
  await dialog.getByLabel("표 가로 정렬").selectOption("justify");
  await dialog.getByRole("button", { name: "표 적용", exact: true }).click();
  const alignments = async () =>
    page.evaluate(async () => {
      const { loadAutosave } = await import("/src/storage.ts");
      const { tableCellStyle } = await import("/src/table.ts");
      const table = (await loadAutosave())!.slides[0].elements[0].table!;
      return [0, 1].map((c) => ({
        align: tableCellStyle(table, 0, c).align,
        paragraph: tableCellStyle(table, 0, c).paragraphs?.[0].align,
      }));
    });
  const expected = [
    { align: "justify", paragraph: "justify" },
    { align: "right", paragraph: "right" },
  ];
  await expect.poll(alignments).toEqual(expected);
  await expect(firstCell.locator("[data-text-paragraph]")).toHaveCSS(
    "text-align",
    "justify",
  );
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  await expect.poll(alignments).toEqual([
    { align: "left", paragraph: "left" },
    { align: "right", paragraph: "right" },
  ]);
  await page.getByRole("button", { name: "다시 실행", exact: true }).click();
  await expect.poll(alignments).toEqual(expected);
  await page.reload();
  await firstCell.dblclick();
  await expect(dialog.getByLabel("표 가로 정렬")).toHaveValue("justify");
});

for (const mode of ["dist", "justLow", "thaiDist"]) {
  test(`unsupported ${mode} keeps original OOXML until editing and warns before formatting loss`, async ({
    page,
  }) => {
    const zip = await JSZip.loadAsync(Uint8Array.from(sourceBytes));
    const sourceXML = await zip.file("ppt/slides/slide1.xml")!.async("string");
    zip.file(
      "ppt/slides/slide1.xml",
      sourceXML.replaceAll('algn="just"', `algn="${mode}"`),
    );
    const patched = await zip.generateAsync({ type: "uint8array" });
    await page.goto(baseURL);
    const result = await page.evaluate(async (bytes) => {
      const { exportPptx, importPptx } = await import("/src/io.ts");
      const { editText } = await import("/src/text-layout.ts");
      const deck = (await importPptx(Uint8Array.from(bytes))).deck;
      const target = deck.slides[0].elements.filter((e) =>
        e.text?.startsWith("Alpha teams"),
      )[1];
      const beforeWarnings: string[] = [];
      const before = await exportPptx(deck, {
        onWarning: (message) => beforeWarnings.push(message),
      });
      Object.assign(target, editText(target, target.text + " Edited."));
      const warnings: string[] = [];
      const after = await exportPptx(deck, {
        onWarning: (message) => warnings.push(message),
      });
      return {
        align: target.paragraphs?.[0].align,
        before: Array.from(before),
        after: Array.from(after),
        warnings,
        beforeWarnings,
      };
    }, Array.from(patched));
    const before = await (await JSZip.loadAsync(Uint8Array.from(result.before)))
      .file("ppt/slides/slide1.xml")!
      .async("string");
    const after = await (await JSZip.loadAsync(Uint8Array.from(result.after)))
      .file("ppt/slides/slide1.xml")!
      .async("string");
    expect(result.align).not.toBe("justify");
    expect(result.beforeWarnings).toEqual([]);
    expect(before).toContain(`algn="${mode}"`);
    expect(result.warnings.join("\n")).toContain("원본 서식");
    expect(after).not.toContain('algn="just"');
  });
}

test("Shift+Enter keeps a justified paragraph and text edits survive an exported reopen", async ({
  page,
}) => {
  await openText(
    page,
    [{ align: "justify", runs: [{ text: "Alpha Beta Gamma Delta" }] }],
    "Alpha Beta Gamma Delta",
  );
  // A macOS Meta+End scrolls without reliably collapsing the word selected
  // by double-click. Collapse that explicit text selection with ArrowRight.
  await selectSubstring(page, "Delta");
  await editor(page).press("ArrowRight");
  await editor(page).press("Shift+Enter");
  await editor(page).pressSequentially("Short final line");
  await expect
    .poll(async () => (await savedText(page)).text)
    .toContain("Short final line");
  await editor(page).press("Escape");
  const result = await page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const deck = (await loadAutosave())!;
    const before = deck.slides[0].elements[0];
    const after = (await importPptx(await exportPptx(deck))).deck.slides[0]
      .elements[0];
    return { before, after };
  });
  for (const item of [result.before, result.after]) {
    expect(item.paragraphs).toHaveLength(1);
    expect(item.paragraphs![0].align).toBe("justify");
    expect(item.paragraphs![0].runs.map((r) => r.text).join("")).toBe(
      "Alpha Beta Gamma Delta\nShort final line",
    );
  }
});

test("an empty paragraph can be justified before typing and repeated alignment adds no undo step", async ({
  page,
}) => {
  await openText(page, [{ align: "left", runs: [{ text: "" }] }], "");
  const justify = page.getByRole("button", { name: "양쪽 맞춤", exact: true });
  await justify.click();
  await expect(editor(page)).toBeFocused();
  await expect
    .poll(async () => (await savedText(page)).paragraphs?.[0].align)
    .toBe("justify");
  await justify.click();
  await editor(page).press("ControlOrMeta+z");
  await expect
    .poll(async () => (await savedText(page)).paragraphs?.[0].align)
    .toBe("left");
  await editor(page).press("ControlOrMeta+Shift+z");
  await expect
    .poll(async () => (await savedText(page)).paragraphs?.[0].align)
    .toBe("justify");
  await editor(page).pressSequentially("First words");
  await expect
    .poll(async () => (await savedText(page)).text)
    .toBe("First words");
  await expect
    .poll(async () => (await savedText(page)).paragraphs?.[0].align)
    .toBe("justify");
  for (const [name, align] of [
    ["왼쪽 정렬", "left"],
    ["오른쪽 정렬", "right"],
    ["양쪽 맞춤", "justify"],
  ]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect
      .poll(async () => (await savedText(page)).paragraphs?.[0].align)
      .toBe(align);
    const live = await editor(page).evaluate((host) => {
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      let typed: HTMLElement | null = null;
      while (walker.nextNode())
        if (walker.currentNode.textContent?.includes("First words"))
          typed = walker.currentNode.parentElement;
      return {
        align: typed ? getComputedStyle(typed).textAlign : null,
        paragraphs: host.querySelectorAll("[data-text-paragraph]").length,
        lines: host.querySelectorAll("[data-text-line]").length,
        nestedParagraphs: host.querySelectorAll(
          "[data-text-paragraph] [data-text-paragraph]",
        ).length,
      };
    });
    expect(live).toEqual({
      align,
      paragraphs: 1,
      lines: 1,
      nestedParagraphs: 0,
    });
  }
});

test("a blank middle paragraph receives alignment and typed text without changing adjacent paragraphs", async ({
  page,
}) => {
  await openText(
    page,
    [
      { align: "left", runs: [{ text: "First paragraph" }] },
      { align: "left", runs: [{ text: "" }] },
      { align: "right", runs: [{ text: "Third paragraph" }] },
    ],
    "First paragraph\n\nThird paragraph",
  );
  await editor(page).evaluate((host) => {
    const empty = host.querySelectorAll("[data-text-paragraph]")[1];
    const range = document.createRange();
    range.selectNodeContents(empty);
    range.collapse(true);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
  await page.getByRole("button", { name: "양쪽 맞춤", exact: true }).click();
  await expect(editor(page)).toBeFocused();
  await expect
    .poll(async () => (await savedText(page)).paragraphs?.map((p) => p.align))
    .toEqual(["left", "justify", "right"]);
  await editor(page).pressSequentially("Middle paragraph");
  await expect
    .poll(async () => (await savedText(page)).text)
    .toBe("First paragraph\nMiddle paragraph\nThird paragraph");
  await expect
    .poll(async () => (await savedText(page)).paragraphs?.map((p) => p.align))
    .toEqual(["left", "justify", "right"]);
  const live = await editor(page).evaluate((host) =>
    [...host.querySelectorAll<HTMLElement>("[data-text-paragraph]")].map(
      (p) => ({
        text: p.innerText,
        // Native justify commands style the line block. The paragraph wrapper
        // may retain its old inherited value, so inspect the painted line.
        align: getComputedStyle(p.querySelector("[data-text-line]") || p)
          .textAlign,
      }),
    ),
  );
  expect(live).toEqual([
    { text: "First paragraph", align: "left" },
    { text: "Middle paragraph", align: "justify" },
    { text: "Third paragraph", align: "right" },
  ]);
});

test("aligning the later soft-break segment changes its whole paragraph and undo restores it", async ({
  page,
}) => {
  await openText(
    page,
    [
      {
        align: "left",
        runs: [{ text: "Before soft break\nAfter soft break" }],
      },
      { align: "right", runs: [{ text: "Separate paragraph" }] },
    ],
    "Before soft break\nAfter soft break\nSeparate paragraph",
  );
  await selectSubstring(page, "After");
  await page.getByRole("button", { name: "양쪽 맞춤", exact: true }).click();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe("After");
  const alignments = async () =>
    (await savedText(page)).paragraphs?.map((p) => p.align);
  await expect.poll(alignments).toEqual(["justify", "right"]);
  const text = await savedText(page);
  expect(text.paragraphs?.[0].runs.map((r) => r.text).join("")).toBe(
    "Before soft break\nAfter soft break",
  );
  await editor(page).press("ControlOrMeta+z");
  await expect.poll(alignments).toEqual(["left", "right"]);
});

test("alignment remains consistent with the live paragraph after a long mixed typing and undo session", async ({ page }) => {
  test.setTimeout(90000);
  await openText(page, [{ align: "left", runs: [{ text: "Alpha" }] }], "Alpha");
  await editor(page).press("ArrowRight");
  for (let i = 0; i < 14; i++) {
    await editor(page).pressSequentially(` ${i}`);
    await page.getByRole("button", {
      name: i % 2 === 0 ? "양쪽 맞춤" : "왼쪽 정렬", exact: true,
    }).click();
  }
  for (let i = 0; i < 28; i++) {
    await editor(page).press("ControlOrMeta+z");
    const live = await editor(page).evaluate(host => {
      const line = host.querySelector("[data-text-line]") ?? host;
      return { align: getComputedStyle(line).textAlign, text: host.textContent };
    });
    await expect.poll(async () => (await savedText(page)).paragraphs?.[0].align,
      { message: `Undo ${i + 1} must save the alignment shown in the editor` }).toBe(live.align);
  }
});

test("justified wrapped lines reach the right edge while their final line keeps natural width", async ({
  page,
}, info) => {
  await page.goto(baseURL);
  const result = await page.evaluate(async () => {
    const { default: React } = await import(
      "/node_modules/.vite/deps/react.js"
    );
    const {
      default: { createRoot },
    } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { ElementVisual } = await import("/src/SlideCanvas.tsx");
    const { element } = await import("/src/model.ts");
    const text =
      "Alpha teams compare the spacing between words when a paragraph wraps across several lines. Short end.";
    const measurements = [];
    for (const align of ["left", "justify"]) {
      const source = element("text", {
        x: 0,
        y: 0,
        width: 360,
        height: 500,
        fontSize: 24,
        fontFamily: "Arial",
        text,
        align,
        paragraphs: [{ align, runs: [{ text }] }],
      });
      const host = document.createElement("div");
      host.style.cssText =
        "position:fixed;left:0;top:0;width:360px;height:500px;background:white;z-index:999999";
      document.body.append(host);
      const root = createRoot(host);
      root.render(React.createElement(ElementVisual, { element: source }));
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      await document.fonts.ready;
      const glyphs: { y: number; x: number; right: number; text: string }[] =
        [];
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        for (let index = 0; index < node.textContent!.length; index++) {
          if (/\s/u.test(node.textContent![index])) continue;
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + 1);
          const bounds = range.getBoundingClientRect();
          glyphs.push({
            y: Math.round(bounds.y * 10) / 10,
            x: bounds.x,
            right: bounds.right,
            text: node.textContent![index],
          });
        }
      }
      const lines = [...new Set(glyphs.map((g) => g.y))].map((y) => {
        const line = glyphs.filter((g) => g.y === y);
        return {
          left: Math.min(...line.map((g) => g.x)),
          right: Math.max(...line.map((g) => g.right)),
          text: line.map((g) => g.text).join(""),
        };
      });
      measurements.push({
        align,
        lines,
        width: host.getBoundingClientRect().width,
      });
      root.unmount();
      host.remove();
    }
    return measurements;
  });
  await info.attach("glyph-geometry", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });
  const [left, justified] = result;
  expect(justified.lines.length).toBeGreaterThan(2);
  expect(justified.lines.map((l) => l.text)).toEqual(
    left.lines.map((l) => l.text),
  );
  for (const line of justified.lines.slice(0, -1))
    expect(line.right).toBeCloseTo(justified.width, 0);
  expect(justified.lines.at(-1)!.right).toBeCloseTo(
    left.lines.at(-1)!.right,
    1,
  );
  expect(justified.lines.at(-1)!.right).toBeLessThan(justified.width - 20);
  expect(
    left.lines.some(
      (line, index) =>
        index < left.lines.length - 1 && line.right < left.width - 10,
    ),
  ).toBe(true);
});
