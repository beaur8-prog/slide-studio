import { expect, test } from "@playwright/test";

test("typing at the list body starts with body formatting while marker edits keep marker formatting", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { element } = await import("/src/model.ts");
    const { editText } = await import("/src/text-layout.ts");
    const marker = {
      fontSize: 24,
      fontFamily: "Courier New",
      color: "#CC0000",
      bold: true,
    };
    const body = {
      fontSize: 32,
      fontFamily: "Arial",
      color: "#0000CC",
      italic: true,
    };
    const original = element("text", {
      text: "Heading\n1. Body",
      paragraphs: [
        { runs: [{ text: "Heading", fontSize: 40 }] },
        {
          bulletPrefix: "1. ",
          marginLeft: 24,
          indent: -24,
          fontSize: 32,
          runs: [
            { text: "1. ", ...marker },
            { text: "Body", ...body },
          ],
        },
      ],
    });
    const styleAt = (text: string) =>
      editText(original, text).paragraphs![1].runs.find((r) =>
        r.text.includes("X"),
      );
    return {
      body: styleAt("Heading\n1. XBody"),
      marker: styleAt("Heading\n1X. Body"),
    };
  });
  expect(result.body).toMatchObject({
    text: "XBody",
    fontSize: 32,
    fontFamily: "Arial",
    color: "#0000CC",
    italic: true,
  });
  expect(result.body!.bold).toBeUndefined();
  expect(result.marker).toMatchObject({
    text: "1X. ",
    fontSize: 24,
    fontFamily: "Courier New",
    color: "#CC0000",
    bold: true,
  });
  expect(result.marker!.italic).toBeUndefined();
});

test("inline formatting does not hide a break before a following run", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { editableText } = await import("/src/text-layout.ts");
    return [
      "<span>First<br></span><span>Second</span>",
      "<span>First<b><br></b></span><i>Second</i>",
      "<span>First<br></span><span><br></span>",
      "<div><span>First</span></div><div><span><br></span></div><div>Last</div>",
      "<span><br></span>",
      "<div data-text-line><span>First\n\n</span></div>",
      "<div data-text-line><span>First\n</span><span>Second</span></div>",
    ].map((html) => {
      const host = document.createElement("div");
      host.innerHTML = html;
      return editableText(host);
    });
  });
  expect(result).toEqual([
    "First\nSecond",
    "First\nSecond",
    "First\n",
    "First\n\nLast",
    "",
    "First\n",
    "First\nSecond",
  ]);
});

test("Shift+Enter and multiline paste retain exact lines across styled spans", async ({
  page,
}) => {
  test.setTimeout(60000);
  for (const scenario of [
    { action: "shift", position: "before", expected: "\nAB" },
    { action: "shift", position: "between", expected: "A\nB" },
    { action: "shift", position: "end", expected: "AB\n" },
    { action: "paste", position: "between", expected: "AX\nY\nB" },
    { action: "paste", position: "end", expected: "ABX\nY\n" },
  ]) {
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
          width: 500,
          height: 200,
          fontSize: 24,
          text: "AB",
          paragraphs: [
            {
              runs: [
                { text: "A", bold: true, fontSize: 24 },
                { text: "B", italic: true, fontSize: 24 },
              ],
            },
          ],
        }),
      ];
      await saveAutosave(deck);
    });
    await page.reload();
    await page.getByTestId("slide-element").dblclick();
    const input = page.getByRole("textbox", { name: "슬라이드 텍스트 편집" });
    if (scenario.position === "end") await input.press("ControlOrMeta+End");
    else
      await input.evaluate((node, position) => {
        const text = node.querySelector("span")!.firstChild!;
        const range = document.createRange();
        range.setStart(text, position === "before" ? 0 : 1);
        range.collapse(true);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(range);
      }, scenario.position);
    if (scenario.action === "shift") await input.press("Shift+Enter");
    else
      await input.evaluate((node) => {
        const clipboardData = new DataTransfer();
        clipboardData.setData("text/plain", "X\nY\n");
        node.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    expect(
      await input.evaluate(async (node) =>
        (await import("/src/text-layout.ts")).editableText(node),
      ),
    ).toBe(scenario.expected);
    let expected = scenario.expected;
    if (scenario.action === "shift" && scenario.position === "end") {
      await input.pressSequentially("Tail");
      expected += "Tail";
    }
    await page
      .getByRole("textbox", { name: "발표자 노트", exact: true })
      .click();
    await expect(page.locator(".save-indicator")).toHaveText("저장됨");
    expect(
      await page.evaluate(
        async () =>
          (await (await import("/src/storage.ts")).loadAutosave()).slides[0]
            .elements[0].text,
      ),
    ).toBe(expected);
    await page.reload();
    await page.getByTestId("slide-element").dblclick();
    expect(
      await input.evaluate(async (node) =>
        (await import("/src/text-layout.ts")).editableText(node),
      ),
    ).toBe(expected);
  }
});

test("editing imported lists retains blank lines, soft breaks and label separators through save and export", async ({
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
        text: "1. First\nContinuation\n\n2. Next",
        x: 100,
        y: 100,
        width: 700,
        height: 350,
        fontSize: 24,
        paragraphs: [
          {
            bulletPrefix: "1. ",
            marginLeft: 24,
            indent: -24,
            spaceAfter: 18,
            runs: [{ text: "1. First\nContinuation", fontSize: 24 }],
          },
          { runs: [{ text: "", fontSize: 9 }], fontSize: 9, lineHeight: 1.5 },
          {
            bulletPrefix: "2. ",
            marginLeft: 48,
            indent: -24,
            runs: [{ text: "2. Next", fontSize: 24 }],
          },
        ],
      }),
    ];
    await saveAutosave(deck);
  });
  await page.reload();
  const positions = () =>
    page
      .getByTestId("slide-element")
      .locator("[data-text-line]")
      .evaluateAll((lines) =>
        lines.map((line) => ({
          y: line.getBoundingClientRect().y,
          height: line.getBoundingClientRect().height,
        })),
      );
  const before = await positions();
  await page.getByTestId("slide-element").dblclick();
  const input = page.getByRole("textbox", { name: "슬라이드 텍스트 편집" });
  await input.press("ControlOrMeta+End");
  await input.pressSequentially("!");
  await page.getByRole("textbox", { name: "발표자 노트", exact: true }).click();
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  expect(await positions()).toEqual(before);
  await page.reload();
  const result = await page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts");
    const { exportPptx, importPptx, parseDeckJson, serializeDeck } =
      await import("/src/io.ts");
    const deck = await loadAutosave();
    return [
      deck,
      parseDeckJson(serializeDeck(deck)),
      (await importPptx(await exportPptx(deck))).deck,
    ].map((d) => d.slides[0].elements[0]);
  });
  for (const el of result) {
    expect(el.text).toBe("1. First\nContinuation\n\n2. Next!");
    expect(el.paragraphs).toHaveLength(3);
    expect(el.paragraphs![0].runs.map((r) => r.text).join("")).toBe(
      "1. First\nContinuation",
    );
    expect(el.paragraphs![1]).toMatchObject({
      fontSize: 9,
      lineHeight: 1.5,
      runs: [{ text: "", fontSize: 9 }],
    });
    expect(el.paragraphs![2]).toMatchObject({
      bulletPrefix: "2. ",
      marginLeft: 48,
    });
  }
  await page.getByTestId("slide-element").dblclick();
  await input.press("ControlOrMeta+End");
  await input.press("Enter");
  await input.press("Enter");
  await input.pressSequentially("Added");
  await page.getByRole("textbox", { name: "발표자 노트", exact: true }).click();
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  expect(
    await page.evaluate(
      async () =>
        (await (await import("/src/storage.ts")).loadAutosave()).slides[0]
          .elements[0].text,
    ),
  ).toBe("1. First\nContinuation\n\n2. Next!\n\nAdded");
  await page.getByTestId("slide-element").dblclick();
  await input.press("ControlOrMeta+Home");
  await input.press("Delete");
  await page.getByRole("textbox", { name: "발표자 노트", exact: true }).click();
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await expect(
    page.getByTestId("slide-element").locator("[data-bullet]"),
  ).toHaveCount(1);
  expect(
    await page.evaluate(
      async () =>
        (await (await import("/src/storage.ts")).loadAutosave()).slides[0]
          .elements[0].text,
    ),
  ).toBe(". First\nContinuation\n\n2. Next!\n\nAdded");
});

test("editing another paragraph preserves empty paragraphs and their line metrics", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { element } = await import("/src/model.ts");
    const { editText, paragraphText } = await import("/src/text-layout.ts");
    const original = element("text", {
      text: "First\n\n2. Next\n",
      paragraphs: [
        { runs: [{ text: "First", fontSize: 32 }], spaceAfter: 18 },
        {
          runs: [{ text: "", fontSize: 9 }],
          fontSize: 9,
          lineHeight: 1.5,
          spaceAfter: 7,
        },
        {
          runs: [{ text: "2. Next", fontSize: 20 }],
          bulletPrefix: "2. ",
          marginLeft: 24,
          indent: -24,
        },
        { runs: [{ text: "", fontSize: 11 }], fontSize: 11, lineSpacing: 13 },
      ],
    });
    const changed = editText(original, "First!\n\n2. Next\n");
    const changedAgain = editText(changed, "First!\n\n2. Next!\n");
    return [changed, changedAgain].map((e) => ({
      text: paragraphText(e.paragraphs!),
      blank: e.paragraphs!.filter((p) => !paragraphText([p])),
    }));
  });
  expect(result.map((e) => e.text)).toEqual([
    "First!\n\n2. Next\n",
    "First!\n\n2. Next!\n",
  ]);
  for (const resultItem of result) {
    expect(resultItem.blank).toEqual([
      {
        runs: [{ text: "", fontSize: 9 }],
        fontSize: 9,
        lineHeight: 1.5,
        spaceAfter: 7,
      },
      { runs: [{ text: "", fontSize: 11 }], fontSize: 11, lineSpacing: 13 },
    ]);
  }
});

test("text edits preserve soft breaks, paragraph boundaries and hanging-list styles", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { editText, paragraphBullet, paragraphText } = await import(
      "/src/text-layout.ts"
    );
    const { exportPptx, importPptx, parseDeckJson, serializeDeck } =
      await import("/src/io.ts");
    const original = element("text", {
      text: "1. First\nContinuation\n2. Next",
      paragraphs: [
        {
          bulletPrefix: "1. ",
          marginLeft: 24,
          indent: -24,
          spaceAfter: 18,
          runs: [
            { text: "1", fontSize: 20 },
            { text: ". First\n", fontSize: 20, bold: true },
            { text: "Continuation", fontSize: 20, italic: true },
          ],
        },
        {
          bulletPrefix: "2. ",
          marginLeft: 48,
          indent: -24,
          runs: [{ text: "2. Next", fontSize: 20, color: "#CC0000" }],
        },
      ],
    });
    const describe = (value: typeof original) => ({
      text: value.text,
      paragraphs: value.paragraphs!.map((p) => ({
        text: paragraphText([p]),
        marginLeft: p.marginLeft,
        indent: p.indent,
        spaceAfter: p.spaceAfter ?? 0,
        label: paragraphBullet(p)?.label,
      })),
    });
    const before = editText(
      original,
      original.text!.replace("First", "First!"),
    );
    const after = editText(
      before,
      before.text!.replace("Continuation", "Continuation!"),
    );
    const second = editText(after, after.text! + "!");
    const inserted = editText(
      original,
      original.text!.replace("Continuation", "New paragraph\nContinuation"),
    );
    const removedSoft = editText(
      original,
      original.text!.replace("First\n", "First "),
    );
    const removedHard = editText(
      original,
      original.text!.replace("Continuation\n", "Continuation "),
    );
    const deck = blankDeck();
    deck.slides[0].elements = [second];
    const saved = parseDeckJson(serializeDeck(deck)).slides[0].elements[0];
    const imported = (await importPptx(await exportPptx(deck))).deck.slides[0]
      .elements[0];
    return {
      unchanged: [before, after, second, saved, imported].map(describe),
      inserted: describe(inserted),
      removedSoft: describe(removedSoft),
      removedHard: describe(removedHard),
      styles: second
        .paragraphs!.flatMap((p) => p.runs)
        .filter(
          (r) => r.text.includes("Continuation") || r.text.includes("Next"),
        ),
    };
  });
  for (const item of result.unchanged) {
    expect(item.paragraphs).toHaveLength(2);
    expect(item.paragraphs[0]).toMatchObject({
      marginLeft: 24,
      indent: -24,
      spaceAfter: 18,
      label: "1.",
    });
    expect(item.paragraphs[0].text).toContain("\nContinuation");
    expect(item.paragraphs[1]).toMatchObject({
      marginLeft: 48,
      indent: -24,
      label: "2.",
    });
  }
  expect(result.unchanged.slice(2).map((item) => item.text)).toEqual(
    Array(3).fill("1. First!\nContinuation!\n2. Next!"),
  );
  expect(result.inserted.paragraphs.map((p) => p.text)).toEqual([
    "1. First\nNew paragraph",
    "Continuation",
    "2. Next",
  ]);
  expect(result.removedSoft.paragraphs.map((p) => p.text)).toEqual([
    "1. First Continuation",
    "2. Next",
  ]);
  expect(result.removedHard.paragraphs.map((p) => p.text)).toEqual([
    "1. First\nContinuation 2. Next",
  ]);
  expect(result.styles[0]).toMatchObject({ italic: true });
  expect(result.styles[1]).toMatchObject({ color: "#CC0000" });
});
