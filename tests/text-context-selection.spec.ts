import { test, expect, type Page } from "@playwright/test";
const original = "앞부분 선택한 글자 뒷부분";
const editor = (page: Page) =>
  page.getByRole("textbox", { name: "슬라이드 텍스트 편집", exact: true });
const menu = (page: Page) =>
  page.getByRole("menu", { name: "텍스트 편집", exact: true });
const action = (page: Page, name: string) =>
  menu(page).getByRole("menuitem", { name, exact: true });
async function open(page: Page) {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { saveAutosave } = await import("/src/storage.ts");
    const deck = blankDeck();
    deck.slides[0].elements = [
      element("text", {
        x: 100,
        y: 100,
        width: 700,
        height: 200,
        text: "앞부분 선택한 글자 뒷부분",
      }),
    ];
    await saveAutosave(deck);
  });
  await page.reload();
  // Exercise the native bridge without changing the user's system clipboard.
  await page.evaluate(() => {
    (window as any).__clipboard = "붙인 글자";
    window.desktop = {
      onMenu: () => () => {},
      setChromeTheme: async () => {},
      editTextClipboard: async (action: string) => {
        (window as any).__clipboardSelection = getSelection()?.toString();
        if (action === "paste")
          document.execCommand(
            "insertText",
            false,
            (window as any).__clipboard,
          );
        else {
          (window as any).__clipboard = getSelection()?.toString();
          if (action === "cut") document.execCommand("delete");
        }
      },
    } as any;
  });
  await page.getByTestId("slide-element").dblclick();
  await expect(editor(page)).toBeFocused();
}
async function select(page: Page, start = 4, end = 10, backward = false) {
  await editor(page).evaluate(
    (host, args) => {
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      const node = walker.nextNode()!;
      const selection = getSelection()!;
      selection.setBaseAndExtent(
        node,
        args.backward ? args.end : args.start,
        node,
        args.backward ? args.start : args.end,
      );
    },
    { start, end, backward },
  );
}
async function rightClick(page: Page) {
  const box = (await editor(page).boundingBox())!;
  await editor(page).click({
    button: "right",
    position: { x: box.width - 6, y: box.height - 6 },
  });
  await expect(menu(page)).toBeVisible();
}
const selected = (page: Page) =>
  page.evaluate(() => getSelection()?.toString());

test("partial selection and visible highlight survive right-click outside the selected letters and Escape", async ({
  page,
}, info) => {
  await open(page);
  await select(page);
  const expected = original.slice(4, 10);
  await rightClick(page);
  await expect(editor(page)).toBeVisible();
  expect(await selected(page)).toBe(expected);
  expect(
    await page.evaluate(
      () => CSS.highlights.get("context-text-selection")?.size,
    ),
  ).toBe(1);
  await page.screenshot({ path: info.outputPath("preserved-selection.png") });
  await page.keyboard.press("Escape");
  await expect(editor(page)).toBeFocused();
  expect(await selected(page)).toBe(expected);
  expect(
    await page.evaluate(() => CSS.highlights.has("context-text-selection")),
  ).toBe(false);
  await page.keyboard.insertText("교체");
  await expect(editor(page)).toHaveText(
    original.slice(0, 4) + "교체" + original.slice(10),
  );
});

test("copy and cut affect only the selected characters; paste restores the same insertion point", async ({
  page,
}) => {
  await open(page);
  await select(page);
  await rightClick(page);
  await action(page, "복사").click();
  await expect(editor(page)).toBeFocused();
  expect(await page.evaluate(() => (window as any).__clipboard)).toBe(
    original.slice(4, 10),
  );
  await expect(editor(page)).toHaveText(original);
  await rightClick(page);
  await action(page, "잘라내기").click();
  await expect(editor(page)).toHaveText(
    original.slice(0, 4) + original.slice(10),
  );
  await rightClick(page);
  await expect(action(page, "복사")).toBeDisabled();
  await action(page, "붙여넣기").click();
  await expect(editor(page)).toHaveText(original);
  await page.getByRole("textbox", { name: "발표자 노트", exact: true }).click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("slide-element")).toHaveText(original);
});

test("keyboard menu preserves a backward selection; select all and deletion retain editing focus", async ({
  page,
}) => {
  await open(page);
  await select(page, 4, 10, true);
  await editor(page).press("Shift+F10");
  await expect(menu(page)).toBeVisible();
  expect(await selected(page)).toBe(original.slice(4, 10));
  await page.keyboard.press("ArrowDown");
  await expect(action(page, "복사")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(editor(page)).toBeFocused();
  expect(await selected(page)).toBe(original.slice(4, 10));
  expect(
    await page.evaluate(() => [
      getSelection()?.anchorOffset,
      getSelection()?.focusOffset,
    ]),
  ).toEqual([10, 4]);
  await rightClick(page);
  await action(page, "모두 선택").click();
  expect(await selected(page)).toBe(original);
  await rightClick(page);
  await action(page, "삭제").click();
  await expect(editor(page)).toBeEmpty();
  await expect(editor(page)).toBeFocused();
});

test("caret menu pastes at its position; outside click saves without stealing focus", async ({
  page,
}) => {
  await open(page);
  await select(page, 4, 4);
  await rightClick(page);
  await expect(action(page, "잘라내기")).toBeDisabled();
  await action(page, "붙여넣기").click();
  const expected = original.slice(0, 4) + "붙인 글자" + original.slice(4);
  await expect(editor(page)).toHaveText(expected);
  await rightClick(page);
  const notes = page.getByRole("textbox", { name: "발표자 노트", exact: true });
  await notes.click();
  await expect(notes).toBeFocused();
  await expect(menu(page)).toBeHidden();
  await expect(editor(page)).toBeHidden();
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.reload();
  await expect(page.getByTestId("slide-element")).toHaveText(expected);
});

test("selection across lines keeps its original editable DOM when opening and dismissing the menu", async ({
  page,
}) => {
  await open(page);
  await editor(page).fill("첫째 줄 한글\n둘째 줄 한글");
  const before = await editor(page).evaluate((host) => {
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT),
      nodes: Node[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    getSelection()!.setBaseAndExtent(nodes[0], 1, nodes.at(-1)!, 3);
    return { html: host.innerHTML, selected: getSelection()!.toString() };
  });
  await rightClick(page);
  expect(await selected(page)).toBe(before.selected);
  expect(await editor(page).evaluate((host) => host.innerHTML)).toBe(
    before.html,
  );
  await page.keyboard.press("Escape");
  await expect(editor(page)).toBeFocused();
  expect(await selected(page)).toBe(before.selected);
  expect(await editor(page).evaluate((host) => host.innerHTML)).toBe(
    before.html,
  );
});
