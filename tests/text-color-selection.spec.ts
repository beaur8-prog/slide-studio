import { test, expect, type Page } from "@playwright/test";
const original = "앞부분 선택한 글자 뒷부분";
const input = (page: Page) =>
  page.getByRole("textbox", { name: "슬라이드 텍스트 편집", exact: true });
const palette = (page: Page) =>
  page.getByRole("dialog", { name: "글자 색", exact: true });
const trigger = (page: Page) =>
  page.getByRole("button", { name: "글자 색", exact: true });
async function open(page: Page, multiline = false) {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async (multiline) => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { saveAutosave } = await import("/src/storage.ts");
    const deck = blankDeck();
    const paragraphs = [
      {
        align: "left" as const,
        lineHeight: 1.4,
        runs: [
          {
            text: "앞부분 ",
            color: "#112233",
            bold: true,
            fontFamily: "Arial",
          },
          { text: "선택한 글자", color: "#223344", italic: true, fontSize: 28 },
          { text: " 뒷부분", color: "#112233", underline: true },
        ],
      },
    ];
    if (multiline)
      paragraphs.push({
        align: "left",
        lineHeight: 1.4,
        runs: [
          {
            text: "둘째 줄",
            color: "#445566",
            bold: true,
            fontFamily: "Arial",
          },
        ],
      });
    deck.slides[0].elements = [
      element("text", {
        x: 100,
        y: 100,
        width: 900,
        height: 220,
        text: paragraphs
          .map((p) => p.runs.map((r) => r.text).join(""))
          .join("\n"),
        color: "#112233",
        fontSize: 30,
        paragraphs,
      }),
    ];
    await saveAutosave(deck);
  }, multiline);
  await page.reload();
  await expect(page.getByTestId("slide-element")).toHaveCount(1);
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.getByTestId("slide-element").dblclick();
  await expect(input(page)).toBeFocused();
}
async function select(page: Page, start = 4, end = 10) {
  await input(page).evaluate(
    (host, { start, end }) => {
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT),
        nodes: Node[] = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      const point = (offset: number) => {
        for (const node of nodes) {
          if (offset <= node.textContent!.length) return { node, offset };
          offset -= node.textContent!.length;
        }
        return {
          node: nodes.at(-1)!,
          offset: nodes.at(-1)!.textContent!.length,
        };
      };
      const a = point(start),
        b = point(end);
      getSelection()!.setBaseAndExtent(a.node, a.offset, b.node, b.offset);
    },
    { start, end },
  );
}
async function saved(page: Page) {
  return page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts");
    const deck = await loadAutosave(),
      element = deck!.slides[0].elements[0];
    return {
      text: element.text,
      colors: element.paragraphs!.flatMap((p, i) => [
        ...(i ? ["break"] : []),
        ...p.runs.flatMap((r) =>
          Array(r.text.length).fill((r.color ?? element.color).toUpperCase()),
        ),
      ]),
      paragraphs: element.paragraphs,
    };
  });
}
const baseColors = Array(4)
  .fill("#112233")
  .concat(Array(6).fill("#223344"), Array(4).fill("#112233"));

test("Home color palette preserves selection, changes nothing before Apply, and Cancel restores selection", async ({
  page,
}, info) => {
  await open(page);
  await select(page);
  await trigger(page).click();
  await expect(palette(page)).toContainText("선택한 글자에 적용합니다.");
  await expect(
    palette(page).getByRole("textbox", { name: "색상 코드", exact: true }),
  ).toHaveValue("#223344");
  await expect(input(page)).toBeVisible();
  expect(
    await page.evaluate(() => CSS.highlights.get("text-color-selection")?.size),
  ).toBe(1);
  await palette(page)
    .getByRole("button", { name: "색상 #FF0000", exact: true })
    .click();
  expect((await saved(page)).colors).toEqual(baseColors);
  await page.screenshot({
    path: info.outputPath("text-color-apply-palette.png"),
  });
  await palette(page)
    .getByRole("button", { name: "취소", exact: true })
    .click();
  await expect(input(page)).toBeFocused();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe(
    "선택한 글자",
  );
  expect((await saved(page)).colors).toEqual(baseColors);
});

test("Apply colors only selected letters, keeps other run formatting, and supports native undo/redo and persistence", async ({
  page,
}) => {
  await open(page);
  await select(page);
  const before = await saved(page);
  await trigger(page).click();
  await palette(page)
    .getByRole("textbox", { name: "색상 코드", exact: true })
    .fill("#ff0000");
  await palette(page)
    .getByRole("button", { name: "적용", exact: true })
    .click();
  await expect(input(page)).toBeFocused();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe(
    "선택한 글자",
  );
  const expected = baseColors.map((color, i) =>
    i >= 4 && i < 10 ? "#FF0000" : color,
  );
  await expect.poll(async () => (await saved(page)).colors).toEqual(expected);
  const after = await saved(page);
  expect(after.text).toBe(original);
  const attributes = (paragraphs: typeof after.paragraphs) =>
    paragraphs!.flatMap((p) =>
      p.runs.flatMap(({ text, color, ...style }) =>
        Array.from({ length: text.length }, () => style),
      ),
    );
  expect(attributes(after.paragraphs)).toEqual(attributes(before.paragraphs));
  expect(after.paragraphs![0].lineHeight).toBe(
    before.paragraphs![0].lineHeight,
  );
  expect(
    after.paragraphs![0].runs.find((r) => r.text.includes("선택"))?.italic,
  ).toBe(true);
  await input(page).press("ControlOrMeta+z");
  await expect.poll(async () => (await saved(page)).colors).toEqual(baseColors);
  await input(page).press("ControlOrMeta+Shift+z");
  await expect.poll(async () => (await saved(page)).colors).toEqual(expected);
  await page.getByRole("textbox", { name: "발표자 노트", exact: true }).click();
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.reload();
  await expect.poll(async () => (await saved(page)).colors).toEqual(expected);
  const restored = await page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const deck = await loadAutosave(),
      result = await importPptx(await exportPptx(deck!));
    const e = result.deck.slides[0].elements[0];
    return {
      text: e.text,
      colors: e.paragraphs!.flatMap((p) =>
        p.runs.flatMap((r) =>
          Array(r.text.length).fill((r.color ?? e.color).toUpperCase()),
        ),
      ),
    };
  });
  expect(restored).toEqual({ text: original, colors: expected });
});

test("text context menu includes color; both context-to-palette and context-to-Home preserve the range", async ({
  page,
}) => {
  await open(page);
  await select(page, 2, 8);
  await input(page).click({ button: "right" });
  const menu = page.getByRole("menu", { name: "텍스트 편집", exact: true });
  await menu.getByRole("menuitem", { name: "글자 색", exact: true }).click();
  await expect(palette(page)).toContainText("선택한 글자에");
  await palette(page)
    .getByRole("button", { name: "색상 #0070C0", exact: true })
    .click();
  await palette(page)
    .getByRole("button", { name: "적용", exact: true })
    .click();
  await expect
    .poll(async () => (await saved(page)).colors)
    .toEqual(baseColors.map((c, i) => (i >= 2 && i < 8 ? "#0070C0" : c)));
  await input(page).click({ button: "right" });
  await trigger(page).click();
  await expect(palette(page)).toBeVisible();
  await expect(input(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(input(page)).toBeFocused();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe(
    original.slice(2, 8),
  );
});

test("caret cannot recolor the entire text accidentally; object selection explicitly colors all text", async ({
  page,
}) => {
  await open(page);
  await select(page, 4, 4);
  await trigger(page).click();
  await expect(palette(page)).toContainText("글자를 먼저 선택해 주세요.");
  await expect(
    palette(page).getByRole("button", { name: "적용", exact: true }),
  ).toBeDisabled();
  await palette(page)
    .getByRole("textbox", { name: "색상 코드", exact: true })
    .fill("bad");
  await expect(
    palette(page).getByRole("button", { name: "적용", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await input(page).press("Escape");
  await trigger(page).click();
  await expect(palette(page)).toContainText("텍스트 상자 전체");
  await palette(page)
    .getByRole("button", { name: "색상 #00B050", exact: true })
    .click();
  await palette(page)
    .getByRole("button", { name: "적용", exact: true })
    .click();
  await expect
    .poll(async () => (await saved(page)).colors)
    .toEqual(Array(original.length).fill("#00B050"));
});

test("switching from another ribbon tab to Home keeps the text range for the palette", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "삽입", exact: true }).click();
  await expect(input(page)).toBeVisible();
  await select(page, 2, 8);
  await page.getByRole("button", { name: "홈", exact: true }).click();
  await expect(input(page)).toBeFocused();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe(
    original.slice(2, 8),
  );
  await trigger(page).click();
  await expect(palette(page)).toContainText("선택한 글자에");
  await palette(page)
    .getByRole("button", { name: "색상 #C00000", exact: true })
    .click();
  await palette(page)
    .getByRole("button", { name: "적용", exact: true })
    .click();
  await expect
    .poll(async () => (await saved(page)).colors)
    .toEqual(baseColors.map((c, i) => (i >= 2 && i < 8 ? "#C00000" : c)));
});

test("coloring a range across paragraphs keeps the other colors, line spacing and text", async ({
  page,
}) => {
  await open(page, true);
  await select(page, 8, 16);
  const expectedText = await input(page).innerText();
  const selectedText = await page.evaluate(() => getSelection()?.toString());
  await trigger(page).click();
  await palette(page)
    .getByRole("button", { name: "색상 #7030A0", exact: true })
    .click();
  await palette(page)
    .getByRole("button", { name: "적용", exact: true })
    .click();
  await expect(input(page)).toHaveText(expectedText, { useInnerText: true });
  expect(await page.evaluate(() => getSelection()?.toString())).toBe(
    selectedText,
  );
  const colors = baseColors
    .concat(["break"], Array(4).fill("#445566"))
    .map((c, i) => (i >= 8 && i < 17 && c !== "break" ? "#7030A0" : c));
  await expect.poll(async () => (await saved(page)).colors).toEqual(colors);
  expect((await saved(page)).paragraphs!.map((p) => p.lineHeight)).toEqual([
    1.4, 1.4,
  ]);
});

test("typing after Apply keeps the chosen color and persists the inserted character", async ({
  page,
}) => {
  await open(page);
  await select(page);
  await trigger(page).click();
  await palette(page)
    .getByRole("button", { name: "색상 #FF0000", exact: true })
    .click();
  await palette(page)
    .getByRole("button", { name: "적용", exact: true })
    .click();
  await input(page).press("ArrowRight");
  await page.keyboard.insertText("색");
  await expect(input(page)).toHaveText(
    original.slice(0, 10) + "색" + original.slice(10),
  );
  await expect
    .poll(async () => (await saved(page)).colors)
    .toEqual(
      Array(4)
        .fill("#112233")
        .concat(Array(7).fill("#FF0000"), Array(4).fill("#112233")),
    );
});

test("an outside click cancels the draft and preserves focus on the clicked field", async ({
  page,
}) => {
  await open(page);
  await select(page);
  await trigger(page).click();
  await palette(page)
    .getByRole("button", { name: "색상 #FF0000", exact: true })
    .click();
  const notes = page.getByRole("textbox", { name: "발표자 노트", exact: true });
  await notes.click();
  await expect(notes).toBeFocused();
  await expect(palette(page)).toBeHidden();
  expect((await saved(page)).colors).toEqual(baseColors);
});

test("context color opens even when the Home color trigger is not mounted", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "슬라이드 쇼", exact: true }).click();
  await select(page);
  await input(page).click({ button: "right" });
  await page
    .getByRole("menu", { name: "텍스트 편집", exact: true })
    .getByRole("menuitem", { name: "글자 색", exact: true })
    .click();
  await expect(palette(page)).toBeVisible();
  await palette(page)
    .getByRole("button", { name: "색상 #FF0000", exact: true })
    .click();
  await palette(page)
    .getByRole("button", { name: "적용", exact: true })
    .click();
  await expect
    .poll(async () => (await saved(page)).colors)
    .toEqual(baseColors.map((c, i) => (i >= 4 && i < 10 ? "#FF0000" : c)));
});

test("imported soft breaks and blank lines retain their text and paragraph metrics after partial color", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("textbox", { name: "발표자 노트", exact: true }).click();
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async () => {
    const { loadAutosave, saveAutosave } = await import("/src/storage.ts");
    const deck = await loadAutosave(),
      el = deck!.slides[0].elements[0];
    el.text = "첫 줄\n\n셋째 줄\n다음 단락";
    el.paragraphs = [
      {
        lineSpacing: 38,
        spaceAfter: 7,
        runs: [{ text: "첫 줄\n\n셋째 줄", color: "#112233" }],
      },
      { lineSpacing: 42, runs: [{ text: "다음 단락", color: "#445566" }] },
    ];
    await saveAutosave(deck!);
  });
  await page.reload();
  await page.getByTestId("slide-element").dblclick();
  const before = await input(page).evaluate((host) => {
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT),
      nodes: Node[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    getSelection()!.setBaseAndExtent(nodes[0], 1, nodes.at(-1)!, 2);
    return { text: host.innerText, selected: getSelection()!.toString() };
  });
  await trigger(page).click();
  await palette(page)
    .getByRole("button", { name: "색상 #FF0000", exact: true })
    .click();
  await palette(page)
    .getByRole("button", { name: "적용", exact: true })
    .click();
  await expect(input(page)).toHaveText(before.text, { useInnerText: true });
  expect(await page.evaluate(() => getSelection()?.toString())).toBe(
    before.selected,
  );
  await expect
    .poll(async () =>
      (await saved(page)).paragraphs?.some((p) =>
        p.runs.some((r) => r.color === "#FF0000"),
      ),
    )
    .toBe(true);
  const result = await saved(page);
  expect(result.text).toBe("첫 줄\n\n셋째 줄\n다음 단락");
  expect(result.paragraphs).toHaveLength(2);
  expect(result.paragraphs![0].lineSpacing).toBe(38);
  expect(result.paragraphs![0].spaceAfter).toBe(7);
  expect(result.paragraphs![0].runs.map((r) => r.text).join("")).toBe(
    "첫 줄\n\n셋째 줄",
  );
});
