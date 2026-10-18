import { test, expect, type Page } from "@playwright/test";

const editor = (page: Page) =>
  page.getByRole("textbox", { name: "슬라이드 텍스트 편집", exact: true });

async function open(
  page: Page,
  base: Partial<Record<"bold" | "italic" | "underline", boolean>> = {},
) {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async (base) => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { saveAutosave } = await import("/src/storage.ts");
    const deck = blankDeck();
    deck.slides[0].elements = [
      element("text", {
        text: "Alpha Beta",
        x: 100,
        y: 100,
        width: 900,
        height: 220,
        fontSize: 30,
        ...base,
      }),
    ];
    await saveAutosave(deck);
  }, base);
  await page.reload();
  await expect(page.getByTestId("slide-element")).toHaveCount(1);
  await page.getByTestId("slide-element").dblclick();
  await expect(editor(page)).toBeFocused();
}

async function select(page: Page, start = 6, end = 10) {
  await editor(page).evaluate(
    (host, { start, end }) => {
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      const nodes: Node[] = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      const point = (offset: number): [Node, number] => {
        for (const node of nodes) {
          if (offset <= node.textContent!.length) return [node, offset];
          offset -= node.textContent!.length;
        }
        throw new Error("Selection offset outside text");
      };
      getSelection()!.setBaseAndExtent(...point(start), ...point(end));
    },
    { start, end },
  );
}

async function styles(
  page: Page,
  key: "bold" | "italic" | "underline" = "italic",
) {
  return page.evaluate(async (key) => {
    const { loadAutosave } = await import("/src/storage.ts");
    const e = (await loadAutosave())!.slides[0].elements[0];
    return e.paragraphs
      ? e.paragraphs.flatMap((p) =>
          p.runs.flatMap((r) =>
            Array(r.text.length).fill(r[key] ?? e[key] ?? false),
          ),
        )
      : Array(e.text!.length).fill(e[key] ?? false);
  }, key);
}

test("Home italic preserves Beta selection, changes only Beta, and survives undo, redo and reload", async ({
  page,
}) => {
  await open(page);
  await select(page);
  await page.getByRole("button", { name: "기울임", exact: true }).click();
  await expect(editor(page)).toBeFocused();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe("Beta");
  const expected = [...Array(6).fill(false), ...Array(4).fill(true)];
  await expect.poll(() => styles(page)).toEqual(expected);
  await editor(page).press("ControlOrMeta+z");
  await expect.poll(() => styles(page)).toEqual(Array(10).fill(false));
  await editor(page).press("ControlOrMeta+Shift+z");
  await expect.poll(() => styles(page)).toEqual(expected);
  await editor(page).press("Escape");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.reload();
  await expect.poll(() => styles(page)).toEqual(expected);
  const roundTrip = await page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const deck = (await loadAutosave())!;
    const e = (await importPptx(await exportPptx(deck))).deck.slides[0]
      .elements[0];
    return {
      text: e.text,
      italic: e.paragraphs!.flatMap((p) =>
        p.runs.flatMap((r) =>
          Array(r.text.length).fill(r.italic ?? e.italic ?? false),
        ),
      ),
    };
  });
  expect(roundTrip).toEqual({ text: "Alpha Beta", italic: expected });
});

for (const [key, name] of [
  ["italic", "기울임"],
  ["bold", "굵게"],
  ["underline", "밑줄"],
] as const) {
  test(`${key}: remove inherited formatting from a backward selection and toggle it back`, async ({
    page,
  }) => {
    await open(page, { [key]: true });
    await select(page, 10, 6);
    const button = page.getByRole("button", { name, exact: true });
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await button.click();
    await expect(editor(page)).toBeFocused();
    expect(await page.evaluate(() => getSelection()?.toString())).toBe("Beta");
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await expect
      .poll(() => styles(page, key))
      .toEqual([...Array(6).fill(true), ...Array(4).fill(false)]);
    await button.click();
    await expect.poll(() => styles(page, key)).toEqual(Array(10).fill(true));
    await expect(button).toHaveAttribute("aria-pressed", "true");
  });
}

test("caret formatting affects newly typed text, not existing text", async ({
  page,
}) => {
  await open(page);
  await select(page, 10, 10);
  await page.getByRole("button", { name: "기울임", exact: true }).click();
  await expect(editor(page)).toBeFocused();
  await expect.poll(() => styles(page)).toEqual(Array(10).fill(false));
  await editor(page).pressSequentially("X");
  await expect
    .poll(() => styles(page))
    .toEqual([...Array(10).fill(false), true]);
  await editor(page).press("Escape");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.reload();
  await expect
    .poll(() => styles(page))
    .toEqual([...Array(10).fill(false), true]);
});

test("whole-object italic still formats the entire box and supports document undo", async ({
  page,
}) => {
  await open(page);
  await editor(page).press("Escape");
  await page.getByRole("button", { name: "기울임", exact: true }).click();
  await expect.poll(() => styles(page)).toEqual(Array(10).fill(true));
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => styles(page)).toEqual(Array(10).fill(false));
});

test("keyboard italic persists only selected letters", async ({ page }) => {
  await open(page);
  await select(page);
  await editor(page).press("ControlOrMeta+i");
  await expect
    .poll(() => styles(page))
    .toEqual([...Array(6).fill(false), ...Array(4).fill(true)]);
  await editor(page).press("Escape");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.reload();
  await expect
    .poll(() => styles(page))
    .toEqual([...Array(6).fill(false), ...Array(4).fill(true)]);
});

test("partial formatting preserves Korean text, paragraph spacing, run fonts and colors", async ({
  page,
}) => {
  await open(page);
  await editor(page).press("Escape");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async () => {
    const { loadAutosave, saveAutosave } = await import("/src/storage.ts");
    const deck = (await loadAutosave())!;
    const e = deck.slides[0].elements[0];
    e.text = "앞부분 선택한 글자 뒷부분\n둘째 줄";
    e.paragraphs = [
      {
        lineHeight: 1.4,
        spaceAfter: 12,
        runs: [
          {
            text: "앞부분 ",
            bold: true,
            fontFamily: "Arial",
            color: "#112233",
          },
          { text: "선택한 글자", fontSize: 28, color: "#223344" },
          { text: " 뒷부분", underline: true, color: "#334455" },
        ],
      },
      {
        lineHeight: 1.6,
        runs: [
          {
            text: "둘째 줄",
            italic: true,
            fontFamily: "Arial",
            color: "#445566",
          },
        ],
      },
    ];
    await saveAutosave(deck);
  });
  await page.reload();
  await expect(page.getByTestId("slide-canvas")).toContainText(
    "앞부분 선택한 글자 뒷부분",
  );
  await page.getByTestId("slide-element").dblclick();
  const snapshot = () =>
    page.evaluate(async () => {
      const { loadAutosave } = await import("/src/storage.ts");
      const e = (await loadAutosave())!.slides[0].elements[0];
      return {
        text: e.text,
        paragraphs: e.paragraphs!.map(({ runs, ...p }) => ({
          ...p,
          characters: runs.flatMap(({ text, italic: _italic, ...style }) =>
            Array.from(text, (char) => ({ char, ...style })),
          ),
        })),
      };
    });
  const before = await snapshot();
  await select(page, 4, 10);
  await page.getByRole("button", { name: "기울임", exact: true }).click();
  const expected = [
    ...Array(4).fill(false),
    ...Array(6).fill(true),
    ...Array(4).fill(false),
    ...Array(4).fill(true),
  ];
  await expect.poll(() => styles(page)).toEqual(expected);
  expect(await snapshot()).toEqual(before);
  // Color and italic share the same live DOM and native undo stack.
  await page.getByRole("button", { name: "글자 색", exact: true }).click();
  const palette = page.getByRole("dialog", { name: "글자 색", exact: true });
  await palette
    .getByRole("button", { name: "색상 #FF0000", exact: true })
    .click();
  await palette.getByRole("button", { name: "적용", exact: true }).click();
  await expect.poll(() => styles(page)).toEqual(expected);
  await editor(page).press("ControlOrMeta+z");
  await expect.poll(snapshot).toEqual(before);
  await expect.poll(() => styles(page)).toEqual(expected);
  await editor(page).press("ControlOrMeta+z");
  await expect
    .poll(() => styles(page))
    .toEqual([...Array(14).fill(false), ...Array(4).fill(true)]);
});
