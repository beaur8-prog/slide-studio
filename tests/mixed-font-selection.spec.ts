import { test, expect } from "@playwright/test";

test("choosing the existing Latin font also changes the selected East Asian font and survives undo and reload", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { saveAutosave } = await import("/src/storage.ts");
    const deck = blankDeck();
    deck.slides[0].elements = [
      element("text", {
        text: "Alpha 한글",
        fontFamily: "Arial",
        width: 600,
        paragraphs: [
          {
            runs: [
              {
                text: "Alpha 한글",
                fontFamily: "Arial",
                fontFamilyEastAsian: "Malgun Gothic",
                italic: true,
              },
            ],
          },
        ],
      }),
    ];
    await saveAutosave(deck);
  });
  await page.reload();
  await page.getByTestId("slide-element").dblclick();
  const editor = page.getByRole("textbox", {
    name: "슬라이드 텍스트 편집",
    exact: true,
  });
  await editor.evaluate((host) => {
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode()))
      if (node.textContent === "한글") {
        getSelection()!.setBaseAndExtent(node, 0, node, 2);
        break;
      }
  });
  const fonts = () =>
    page.evaluate(async () => {
      const el = (await (await import("/src/storage.ts")).loadAutosave())!
        .slides[0].elements[0];
      return el
        .paragraphs![0].runs.flatMap((r) =>
          Array.from(r.text, (c) => ({
            c,
            font: r.fontFamilyEastAsian ?? r.fontFamily ?? el.fontFamily,
            latin: r.fontFamily ?? el.fontFamily,
            italic: r.italic,
          })),
        )
        .slice(-2);
    });
  await page
    .getByRole("combobox", { name: "글꼴", exact: true })
    .selectOption("Arial");
  await expect(editor).toBeFocused();
  await expect
    .poll(async () => (await fonts()).map((c) => c.font))
    .toEqual(["Arial", "Arial"]);
  await editor.press("ControlOrMeta+z");
  await expect
    .poll(async () => (await fonts()).map((c) => c.font))
    .toEqual(["Malgun Gothic", "Malgun Gothic"]);
  expect((await fonts()).map((c) => c.latin)).toEqual(["Arial", "Arial"]);
  await editor.press("ControlOrMeta+Shift+z");
  await expect
    .poll(async () => (await fonts()).map((c) => c.font))
    .toEqual(["Arial", "Arial"]);
  await editor.press("Escape");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.reload();
  expect(await fonts()).toEqual([
    { c: "한", font: "Arial", latin: "Arial", italic: true },
    { c: "글", font: "Arial", latin: "Arial", italic: true },
  ]);
});
