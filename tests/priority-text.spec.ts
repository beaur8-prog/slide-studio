import { test, expect, type Page } from "@playwright/test";
const editor = (page: Page) =>
  page.getByRole("textbox", { name: "슬라이드 텍스트 편집", exact: true });
async function open(page: Page) {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { saveAutosave } = await import("/src/storage.ts");
    const d = blankDeck();
    d.slides[0].elements = [
      element("text", {
        text: "Alpha Beta\n다음 문단",
        fontSize: 30,
        x: 100,
        y: 100,
        width: 800,
        height: 300,
        paragraphs: [
          { spaceAfter: 12, runs: [{ text: "Alpha Beta", color: "#112233" }] },
          { spaceBefore: 9, runs: [{ text: "다음 문단", italic: true }] },
        ],
      }),
    ];
    await saveAutosave(d);
  });
  await page.reload();
  await page.getByTestId("slide-element").dblclick();
  await editor(page).evaluate((host) => {
    const n = document.createTreeWalker(host, NodeFilter.SHOW_TEXT).nextNode()!;
    getSelection()!.setBaseAndExtent(n, 6, n, 10);
  });
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const e = (await (await import("/src/storage.ts")).loadAutosave())!
      .slides[0].elements[0];
    return {
      paragraphs: e.paragraphs,
      chars: e.paragraphs!.flatMap((p) =>
        p.runs.flatMap((r) =>
          Array.from(r.text, (c) => ({
            c,
            font: r.fontFamily ?? e.fontFamily,
            size: r.fontSize ?? e.fontSize,
          })),
        ),
      ),
    };
  });
}

test("Home font family and size retain Beta selection, affect only Beta, undo/redo and persist", async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole("combobox", { name: "글꼴", exact: true })
    .selectOption("Courier New");
  await expect(editor(page)).toBeFocused();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe("Beta");
  await expect
    .poll(async () =>
      (await snapshot(page)).chars.slice(6, 10).map((c) => c.font),
    )
    .toEqual(Array(4).fill("Courier New"));
  const size = page.getByRole("spinbutton", { name: "글자 크기", exact: true });
  await size.fill("24");
  await size.press("Enter");
  await expect(editor(page)).toBeFocused();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe("Beta");
  await expect
    .poll(async () => (await snapshot(page)).chars.map((c) => c.size))
    .toEqual([
      ...Array(6).fill(30),
      ...Array(4).fill(24),
      ...Array(5).fill(30),
    ]);
  await editor(page).press("ControlOrMeta+z");
  await expect
    .poll(async () => (await snapshot(page)).chars.map((c) => c.size))
    .toEqual(Array(15).fill(30));
  await editor(page).press("ControlOrMeta+Shift+z");
  await expect
    .poll(async () =>
      (await snapshot(page)).chars.slice(6, 10).map((c) => c.size),
    )
    .toEqual(Array(4).fill(24));
  await editor(page).press("Escape");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.reload();
  const saved = await snapshot(page);
  expect(saved.chars.slice(0, 6).map((c) => c.font)).toEqual(
    Array(6).fill("Arial"),
  );
  expect(
    saved.paragraphs!.map((p) => [p.spaceBefore ?? 0, p.spaceAfter ?? 0]),
  ).toEqual([
    [0, 12],
    [9, 0],
  ]);
});

test("paragraph alignment keeps editing and aligns only the selected paragraph", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "가운데 정렬", exact: true }).click();
  await expect(editor(page)).toBeFocused();
  await expect
    .poll(async () =>
      (await snapshot(page)).paragraphs!.map((p) => p.align ?? "left"),
    )
    .toEqual(["center", "left"]);
  await editor(page).press("ControlOrMeta+z");
  await expect
    .poll(async () =>
      (await snapshot(page)).paragraphs!.map((p) => p.align ?? "left"),
    )
    .toEqual(["left", "left"]);
});

test("Shift+Enter is a soft break and does not duplicate paragraph spacing", async ({
  page,
}) => {
  await open(page);
  await editor(page).press("ArrowRight");
  await editor(page).press("Shift+Enter");
  await page.keyboard.insertText("Continued");
  await expect
    .poll(async () =>
      (await snapshot(page)).paragraphs![0].runs.map((r) => r.text).join(""),
    )
    .toBe("Alpha Beta\nContinued");
  expect((await snapshot(page)).paragraphs).toHaveLength(2);
  expect(
    (await snapshot(page)).paragraphs![0].runs.map((r) => r.text).join(""),
  ).toBe("Alpha Beta\nContinued");
});

test("bullet controls retain the selected paragraph, support native undo, exit empty items and remove a marker with Backspace", async ({
  page,
}) => {
  await open(page);
  const button = page.getByRole("button", {
    name: "• 글머리 기호",
    exact: true,
  });
  await button.click();
  await expect(editor(page)).toBeFocused();
  await expect
    .poll(async () =>
      (await snapshot(page)).paragraphs!.map((p) => p.bulletPrefix ?? ""),
    )
    .toEqual(["• ", ""]);
  expect(await page.evaluate(() => getSelection()?.toString())).toBe("Beta");
  await editor(page).press("ControlOrMeta+z");
  await expect
    .poll(async () =>
      (await snapshot(page)).paragraphs!.map((p) => p.bulletPrefix ?? ""),
    )
    .toEqual(["", ""]);
  await editor(page).press("ControlOrMeta+Shift+z");
  await expect
    .poll(async () =>
      (await snapshot(page)).paragraphs!.map((p) => p.bulletPrefix ?? ""),
    )
    .toEqual(["• ", ""]);
  await editor(page).press("ArrowRight");
  await editor(page).press("Enter");
  await expect
    .poll(async () => (await snapshot(page)).paragraphs!.length)
    .toBe(3);
  await editor(page).press("Enter");
  await page.keyboard.insertText("Plain");
  await expect
    .poll(async () =>
      (await snapshot(page)).paragraphs![1].runs.map((r) => r.text).join(""),
    )
    .toBe("Plain");
  expect((await snapshot(page)).paragraphs![1].bulletPrefix).toBeUndefined();
  await editor(page).press("ControlOrMeta+a");
  await button.click();
  await editor(page).press(
    process.platform === "darwin" ? "Meta+ArrowUp" : "Control+Home",
  );
  await editor(page).press("ArrowRight");
  await editor(page).press("ArrowRight");
  await editor(page).press("Backspace");
  await expect
    .poll(async () => (await snapshot(page)).paragraphs![0].bulletPrefix)
    .toBeUndefined();
  expect((await snapshot(page)).paragraphs![0].indent).toBe(0);
});

test("Tab and Shift+Tab indent a list without leaving the editor or changing its text", async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole("button", { name: "• 글머리 기호", exact: true })
    .click();
  await expect
    .poll(async () => (await snapshot(page)).paragraphs![0].bulletPrefix)
    .toBe("• ");
  const before = await snapshot(page);
  await editor(page).press("Tab");
  await expect(editor(page)).toBeFocused();
  await expect
    .poll(async () => (await snapshot(page)).paragraphs![0].marginLeft)
    .toBe(before.paragraphs![0].marginLeft! + 24);
  await editor(page).press("Shift+Tab");
  await expect
    .poll(async () => (await snapshot(page)).paragraphs![0].marginLeft)
    .toBe(before.paragraphs![0].marginLeft);
  expect((await snapshot(page)).chars.map((c) => c.c).join("")).toBe(
    before.chars.map((c) => c.c).join(""),
  );
});

test("Home color indicator follows the selected run and list separators never show zero font size", async ({
  page,
}) => {
  await open(page);
  await expect(page.locator(".color-bar")).toHaveCSS(
    "background-color",
    "rgb(17, 34, 51)",
  );
  await page
    .getByRole("button", { name: "• 글머리 기호", exact: true })
    .click();
  await editor(page).evaluate((host) => {
    const walker = document.createTreeWalker(
      host.querySelector("[data-bullet]")!,
      NodeFilter.SHOW_TEXT,
    );
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (getComputedStyle(node.parentElement!).fontSize === "0px") {
        getSelection()!.setBaseAndExtent(node, 0, node, 1);
        break;
      }
    }
  });
  await expect(
    page.getByRole("spinbutton", { name: "글자 크기", exact: true }),
  ).not.toHaveValue("0");
});
