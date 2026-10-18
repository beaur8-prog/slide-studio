import { test, expect, type Page } from "@playwright/test";

const editor = (page: Page) =>
  page.getByRole("textbox", { name: "슬라이드 텍스트 편집", exact: true });
const bullets = (page: Page) =>
  page.getByRole("button", { name: "• 글머리 기호", exact: true });
const endKey = process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End";

async function open(page: Page, text = "One\nTwo") {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async (text) => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { saveAutosave } = await import("/src/storage.ts");
    const deck = blankDeck();
    deck.slides[0].elements = [
      element("text", {
        text,
        x: 100,
        y: 100,
        width: 800,
        height: 400,
        fontSize: 30,
      }),
    ];
    await saveAutosave(deck);
  }, text);
  await page.reload();
  await page.getByTestId("slide-element").click();
}

async function text(page: Page) {
  return page.evaluate(
    async () =>
      (await (await import("/src/storage.ts")).loadAutosave())!.slides[0]
        .elements[0].text,
  );
}

test("Enter continues bullets, and the whole-box button switches every paragraph together", async ({
  page,
}) => {
  await open(page);
  await bullets(page).click();
  await expect.poll(() => text(page)).toBe("• One\n• Two");
  await page.getByTestId("slide-element").dblclick();
  await editor(page).press(endKey);
  await editor(page).press("Enter");
  await editor(page).pressSequentially("Three");
  await expect.poll(() => text(page)).toBe("• One\n• Two\n• Three");
  await editor(page).press("Escape");
  await bullets(page).click();
  await expect.poll(() => text(page)).toBe("One\nTwo\nThree");
  await bullets(page).click();
  await expect.poll(() => text(page)).toBe("• One\n• Two\n• Three");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.reload();
  await expect.poll(() => text(page)).toBe("• One\n• Two\n• Three");
});

test("mixed legacy bullets normalize to all on, then all off, with document undo", async ({
  page,
}) => {
  await open(page, "• One\n• Two\nThree");
  await bullets(page).click();
  await expect.poll(() => text(page)).toBe("• One\n• Two\n• Three");
  await bullets(page).click();
  await expect.poll(() => text(page)).toBe("One\nTwo\nThree");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => text(page)).toBe("• One\n• Two\n• Three");
});

test("list continuation is a native undoable edit, keeps inline formatting, and survives PPTX", async ({
  page,
}) => {
  await open(page, "Alpha Beta");
  await page.getByTestId("slide-element").dblclick();
  await editor(page).press(endKey);
  await editor(page).press("Shift+ArrowLeft");
  await editor(page).press("Shift+ArrowLeft");
  await editor(page).press("Shift+ArrowLeft");
  await editor(page).press("Shift+ArrowLeft");
  await page.getByRole("button", { name: "기울임", exact: true }).click();
  // Click while editing: finish that transaction before the whole-box command.
  await bullets(page).click();
  await expect.poll(() => text(page)).toBe("• Alpha Beta");
  await page.getByTestId("slide-element").dblclick();
  await editor(page).press(endKey);
  await editor(page).press("Enter");
  await expect.poll(() => text(page)).toBe("• Alpha Beta\n• ");
  await editor(page).press("ControlOrMeta+z");
  await expect.poll(() => text(page)).toBe("• Alpha Beta");
  await editor(page).press("ControlOrMeta+Shift+z");
  await expect.poll(() => text(page)).toBe("• Alpha Beta\n• ");
  await page.keyboard.insertText("다음 항목");
  await expect.poll(() => text(page)).toBe("• Alpha Beta\n• 다음 항목");
  await page.screenshot({
    path: "qa/results/bullet-list/continued-editing.png",
  });
  await editor(page).press("Escape");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.reload();
  const values = await page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts");
    const { exportPptx, importPptx, serializeDeck, parseDeckJson } =
      await import("/src/io.ts");
    const { paragraphBullet } = await import("/src/text-layout.ts");
    const d = (await loadAutosave())!;
    return [
      d,
      parseDeckJson(serializeDeck(d)),
      (await importPptx(await exportPptx(d))).deck,
    ].map((deck) => {
      const e = deck.slides[0].elements[0];
      return {
        text: e.text,
        markers: e.paragraphs!.map((p) => paragraphBullet(p)?.label),
        body: e.paragraphs!.map((p) =>
          paragraphBullet(p)!.runs.flatMap((r) =>
            Array.from(r.text, (char) => ({
              char,
              italic: r.italic ?? e.italic ?? false,
            })),
          ),
        ),
      };
    });
  });
  for (const value of values) {
    expect(value.text).toBe("• Alpha Beta\n• 다음 항목");
    expect(value.markers).toEqual(["•", "•"]);
    expect(value.body[0].map((r) => r.italic)).toEqual([
      ...Array(6).fill(false),
      ...Array(4).fill(true),
    ]);
    expect(value.body[1].map((r) => r.italic)).toEqual(Array(5).fill(true));
  }
});

test("Enter splits a bullet in the middle, repeated entries continue, and Shift+Enter adds no marker", async ({
  page,
}) => {
  await open(page, "OneTwo");
  await bullets(page).click();
  await page.getByTestId("slide-element").dblclick();
  await editor(page).press(endKey);
  for (let i = 0; i < 3; i++) await editor(page).press("ArrowLeft");
  await editor(page).press("Enter");
  await expect.poll(() => text(page)).toBe("• One\n• Two");
  await editor(page).press(endKey);
  await editor(page).press("Enter");
  await editor(page).pressSequentially("Three");
  await editor(page).press("Enter");
  await editor(page).pressSequentially("Four");
  await editor(page).press("Shift+Enter");
  await page.keyboard.insertText("줄바꿈");
  await expect
    .poll(() => text(page))
    .toBe("• One\n• Two\n• Three\n• Four\n줄바꿈");
});

test("toggling imported lists preserves Korean runs, soft breaks, spacing and body styles", async ({
  page,
}) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const { element } = await import("/src/model.ts");
    const { toggleTextBullets } = await import("/src/text-bullets.ts");
    const { paragraphText } = await import("/src/text-layout.ts");
    const original = element("text", {
      text: "• 첫째\n이어진 줄\n둘째",
      fontSize: 30,
      paragraphs: [
        {
          bulletPrefix: "• ",
          indent: -24,
          marginLeft: 36,
          spaceAfter: 12,
          lineHeight: 1.6,
          runs: [
            { text: "•", fontSize: 20, color: "#CC0000" },
            { text: " ", fontSize: 20, color: "#CC0000" },
            {
              text: "첫째\n",
              fontSize: 30,
              bold: true,
              fontFamilyEastAsian: "Malgun Gothic",
            },
            { text: "이어진 줄", italic: true, color: "#0000CC" },
          ],
        },
        {
          spaceBefore: 8,
          runs: [{ text: "둘째", underline: true, fontSize: 24 }],
        },
      ],
    });
    const on = toggleTextBullets(original),
      off = toggleTextBullets(on),
      onAgain = toggleTextBullets(off);
    return {
      on,
      off,
      onAgain,
      originalBodies: original.paragraphs!.map((p, i) => ({
        ...p,
        runs: i ? p.runs : p.runs.slice(2),
      })),
      text: paragraphText(off.paragraphs!),
    };
  });
  expect(result.on.text).toBe("• 첫째\n이어진 줄\n• 둘째");
  expect(result.text).toBe("첫째\n이어진 줄\n둘째");
  expect(result.onAgain.text).toBe(result.on.text);
  expect(result.off.paragraphs).toHaveLength(2);
  for (let i = 0; i < 2; i++)
    expect(result.off.paragraphs![i].runs).toEqual(
      result.originalBodies[i].runs,
    );
  expect(result.off.paragraphs![0]).toMatchObject({
    marginLeft: 12,
    indent: 0,
    spaceAfter: 12,
    lineHeight: 1.6,
  });
  expect(result.off.paragraphs![1].spaceBefore).toBe(8);
});

test("a new empty bullet accepts visible text at its caret", async ({
  page,
}) => {
  await open(page, "");
  await bullets(page).click();
  await page.getByTestId("slide-element").dblclick();
  await editor(page).press(endKey);
  await editor(page).pressSequentially("One");
  await expect.poll(() => text(page)).toBe("• One");
  const visible = await editor(page).evaluate((host) => {
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()))
      if (node.textContent?.includes("One")) {
        const range = document.createRange();
        range.selectNodeContents(node);
        return {
          size: getComputedStyle(node.parentElement!).fontSize,
          width: range.getBoundingClientRect().width,
        };
      }
  });
  expect(Number.parseFloat(visible!.size)).toBeGreaterThan(0);
  expect(visible!.width).toBeGreaterThan(10);
});
