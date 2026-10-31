import { expect, test } from "@playwright/test";
import fs from "node:fs";

// Font-family aliases are an availability issue, not a reason to change the
// document's authored point size, font name, or character spacing.
test("an available English-name Korean font is used before the Mac fallback", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { fontStack } = await import("/src/text-layout.ts");
    const { element, blankDeck } = await import("/src/model.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const { default: React } = await import(
      "/node_modules/.vite/deps/react.js"
    );
    const {
      default: { createRoot },
    } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { ElementVisual } = await import("/src/SlideCanvas.tsx");
    let nativeKoreanName = false;
    try {
      await new FontFace(
        "Korean name availability probe",
        'local("맑은 고딕")',
      ).load();
      nativeKoreanName = true;
    } catch {
      /* This is the platform configuration that needs the alias. */
    }
    const bytes = await (
      await fetch("/fonts/NanumBarunGothic.ttf")
    ).arrayBuffer();
    const face = new FontFace("Malgun Gothic", bytes, { weight: "400" });
    await face.load();
    document.fonts.add(face);
    const source = element("text", {
      x: 0,
      y: 0,
      width: 240,
      height: 160,
      text: "한글 줄바꿈 원본 글꼴 확인",
      fontFamily: "맑은 고딕",
      fontSize: 24,
      paragraphs: [
        {
          runs: [
            {
              text: "한글 줄바꿈 원본 글꼴 확인",
              fontFamily: "맑은 고딕",
              fontSize: 24,
            },
          ],
        },
      ],
    });
    const host = document.createElement("div");
    host.style.cssText =
      "position:fixed;inset:0;width:240px;height:160px;z-index:99999;background:white";
    document.body.append(host);
    const root = createRoot(host);
    root.render(React.createElement(ElementVisual, { element: source }));
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r)),
    );
    await document.fonts.ready;
    const text = host.querySelector("[data-text-line] span")!;
    const actual = text.getBoundingClientRect();
    const reference = document.createElement("span");
    reference.style.cssText =
      'font-family:"Malgun Gothic";font-size:24px;white-space:pre-wrap;line-height:1.2;';
    reference.textContent = source.text!;
    const referenceHost = document.createElement("div");
    referenceHost.style.cssText =
      "position:fixed;left:300px;top:0;width:240px;white-space:pre-wrap;";
    referenceHost.append(reference);
    document.body.append(referenceHost);
    const expected = reference.getBoundingClientRect();
    const deck = blankDeck();
    deck.slides[0].elements = [source];
    const restored = (await importPptx(await exportPptx(deck))).deck.slides[0]
      .elements[0];
    const stack = fontStack("맑은 고딕");
    root.unmount();
    host.remove();
    referenceHost.remove();
    document.fonts.delete(face);
    return {
      nativeKoreanName,
      actual: { width: actual.width, height: actual.height },
      expected: { width: expected.width, height: expected.height },
      stack,
      restored: {
        fontFamily: restored.fontFamily,
        fontSize: restored.fontSize,
        text: restored.text,
      },
    };
  });
  expect(result.stack.indexOf('"Malgun Gothic"')).toBeLessThan(
    result.stack.indexOf('"Apple SD Gothic Neo"'),
  );
  if (!result.nativeKoreanName) {
    expect(result.actual.width).toBeCloseTo(result.expected.width, 2);
    expect(result.actual.height).toBeCloseTo(result.expected.height, 2);
  }
  expect(result.restored).toEqual({
    fontFamily: "맑은 고딕",
    fontSize: 24,
    text: "한글 줄바꿈 원본 글꼴 확인",
  });
});

test("a locally added Korean-name font is also available to English-name source text", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { fontStack } = await import("/src/text-layout.ts");
    const { localFontAlias } = await import("/src/local-fonts.ts");
    const bytes = await (
      await fetch("/fonts/NanumBarunGothic.ttf")
    ).arrayBuffer();
    const face = new FontFace(localFontAlias("굴림체"), bytes, {
      weight: "400",
    });
    await face.load();
    document.fonts.add(face);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    const measure = (font: string) => {
      ctx.font = `24px ${font}`;
      return ctx.measureText("가나다라마바사 ABC 123").width;
    };
    let nativeEnglishName = false;
    try {
      await new FontFace(
        "English name availability probe",
        'local("GulimChe")',
      ).load();
      nativeEnglishName = true;
    } catch {
      /* Expected without Windows fonts. */
    }
    const actual = measure(fontStack("GulimChe"));
    const expected = measure(`"${localFontAlias("굴림체")}"`);
    const unrelated = fontStack("Custom Customer Font");
    document.fonts.delete(face);
    return { nativeEnglishName, actual, expected, unrelated };
  });
  if (!result.nativeEnglishName)
    expect(result.actual).toBeCloseTo(result.expected, 2);
  expect(
    result.unrelated.startsWith(
      '"Custom Customer Font", "Slide Studio Local Custom Customer Font"',
    ),
  ).toBe(true);
  expect(result.unrelated).not.toContain('"GulimChe"');
});

test("document font diagnosis counts visible text and cells without listing unused theme faces", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { createTable } = await import("/src/table.ts");
    const { documentFontUsage, diagnoseDocumentFonts } = await import(
      "/src/document-fonts.ts"
    );
    const deck = blankDeck();
    deck.theme = "Unused theme face";
    const table = createTable(2, 2);
    table.fontFamily = "Unused table default";
    table.cells = [
      ["표", "hidden merged cell"],
      ["Table", ""],
    ];
    table.merges = [{ row: 0, column: 0, rowSpan: 1, columnSpan: 2 }];
    table.cellStyles = [
      [
        {
          paragraphs: [
            {
              runs: [
                {
                  text: "표",
                  fontFamily: "Unused Latin face",
                  fontFamilyEastAsian: "Table Korean",
                },
              ],
            },
          ],
        },
        { fontFamily: "Hidden merged face" },
      ],
      [{ fontFamily: "Cell Latin" }, null],
    ];
    deck.slides[0].elements = [
      element("text", {
        text: "unused",
        fontFamily: "Unused element default",
        paragraphs: [
          {
            runs: [
              {
                text: "한글",
                fontFamily: "Unused Latin face",
                fontFamilyEastAsian: "Korean Body",
              },
            ],
          },
          {
            runs: [
              {
                text: "English",
                fontFamily: "Latin Body",
                fontFamilyEastAsian: "Unused EA face",
              },
            ],
          },
          { runs: [{ text: "", fontFamily: "Unused blank paragraph" }] },
        ],
      }),
      element("table", { table }),
    ];
    deck.slides.push({
      ...deck.slides[0],
      id: crypto.randomUUID(),
      elements: [element("text", { text: "Second", fontFamily: "Latin Body" })],
    });
    // This API intentionally reports true for missing names; the diagnosis
    // must not mistake that fallback-success result for an installed font.
    const check = document.fonts.check;
    document.fonts.check = () => true;
    try {
      return {
        usage: documentFontUsage(deck),
        missing: await diagnoseDocumentFonts([
          { family: "Definitely Missing Studio Font 9dc156", slides: 1 },
        ]),
      };
    } finally {
      document.fonts.check = check;
    }
  });
  expect(result.usage).toEqual([
    { family: "Cell Latin", slides: 1 },
    { family: "Korean Body", slides: 1 },
    { family: "Latin Body", slides: 2 },
    { family: "Table Korean", slides: 1 },
  ]);
  expect(result.missing[0]).toMatchObject({
    kind: "unknown",
    label: "원본 글꼴 확인 필요",
  });
});

test("font manager shows document fonts and updates diagnosis after adding and removing a face", async ({
  page,
}, info) => {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { saveAutosave } = await import("/src/storage.ts");
    const deck = blankDeck();
    deck.slides[0].elements = [
      element("text", {
        text: "한글 원본 글꼴 확인",
        fontFamily: "QA Source Face",
        fontSize: 24,
      }),
    ];
    await saveAutosave(deck);
  });
  await page.reload();
  await page.getByRole("button", { name: "파일", exact: true }).click();
  await page
    .getByRole("button", { name: "원본 글꼴 추가", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "원본 글꼴 추가" });
  const usage = dialog.getByRole("list", { name: "문서에 사용된 글꼴" });
  await expect(usage).toContainText("QA Source Face");
  await expect(usage).toContainText("원본 글꼴 확인 필요");
  const data = Buffer.from(
    fs.readFileSync("public/fonts/NanumBarunGothic.ttf"),
  );
  // Rename a bundled OFL test font to a deliberately absent family. This only
  // tests registration/status changes; it is not a metric reference font.
  for (let i = 0; i < data.readUInt16BE(4); i++) {
    const at = 12 + i * 16;
    if (data.toString("ascii", at, at + 4) !== "name") continue;
    const start = data.readUInt32BE(at + 8);
    const storage = start + data.readUInt16BE(start + 4);
    const text = Buffer.from("QA Source Face", "utf16le").swap16();
    for (let j = 0; j < data.readUInt16BE(start + 2); j++) {
      const record = start + 6 + j * 12;
      if (
        data.readUInt16BE(record) !== 3 ||
        ![1, 16].includes(data.readUInt16BE(record + 6)) ||
        text.length > data.readUInt16BE(record + 8)
      )
        continue;
      text.copy(data, storage + data.readUInt16BE(record + 10));
      data.writeUInt16BE(text.length, record + 8);
    }
  }
  await dialog.getByLabel("원본 글꼴 파일").setInputFiles({
    name: "qa-source-face.ttf",
    mimeType: "font/ttf",
    buffer: data,
  });
  await expect(usage).toContainText("직접 추가한 글꼴");
  await dialog.screenshot({
    path: info.outputPath("font-diagnosis-added.png"),
  });
  await dialog
    .getByRole("button", { name: "QA Source Face 400 normal 제거" })
    .click();
  await expect(usage).toContainText("원본 글꼴 확인 필요");
  await dialog.getByRole("button", { name: "다시 확인", exact: true }).click();
  await expect(usage).toContainText("원본 글꼴 확인 필요");
  await dialog.getByRole("button", { name: "글꼴 관리 닫기" }).click();
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
});

test("Dickinson list body uses its master hanging indent after import and three edited saves", async ({
  page,
}) => {
  test.skip(
    !fs.existsSync("qa/samples/dickinson-workplace.pptx"),
    "Fetch the pinned public sample first",
  );
  test.setTimeout(60000);
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { importPptx, exportPptx } = await import("/src/io.ts");
    const { default: React } = await import(
      "/node_modules/.vite/deps/react.js"
    );
    const {
      default: { createRoot },
    } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { ElementVisual } = await import("/src/SlideCanvas.tsx");
    let deck = (
      await importPptx(
        await (
          await fetch("/qa/samples/dickinson-workplace.pptx")
        ).arrayBuffer(),
      )
    ).deck;
    const rounds = [];
    for (let round = 0; round < 4; round++) {
      const body = deck.slides[5].elements.find((e) =>
        e.text?.startsWith("• Lorem"),
      )!;
      const host = document.createElement("div");
      host.style.cssText = `position:fixed;left:0;top:0;width:${body.width}px;height:${body.height}px;background:white;z-index:9999`;
      document.body.append(host);
      const root = createRoot(host);
      root.render(React.createElement(ElementVisual, { element: body }));
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      );
      await document.fonts.ready;
      const markers = [...host.querySelectorAll<HTMLElement>("[data-bullet]")];
      rounds.push({
        text: body.text,
        indents: body.paragraphs!.map((p) => [p.marginLeft, p.indent]),
        offsets: markers.map(
          (m) =>
            m.nextElementSibling!.getBoundingClientRect().x -
            m.getBoundingClientRect().x,
        ),
      });
      root.unmount();
      host.remove();
      if (round < 3) {
        body.x += 1;
        deck = (await importPptx(await exportPptx(deck))).deck;
      }
    }
    return rounds;
  });
  expect(result).toHaveLength(4);
  for (const round of result) {
    expect(round.indents).toEqual(Array.from({ length: 7 }, () => [36, -36]));
    expect(round.offsets).toHaveLength(7);
    for (const offset of round.offsets) expect(offset).toBeCloseTo(36, 2);
    expect(round.text).toBe(result[0].text);
  }
});

test("300-slide font diagnosis is bounded, asynchronous, and leaves document content unchanged", async ({
  page,
}, info) => {
  test.setTimeout(30000);
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck, element, newSlide } = await import("/src/model.ts");
    const { documentFontUsage, diagnoseDocumentFonts, refreshDocumentFonts } =
      await import("/src/document-fonts.ts");
    const names = Array.from(
      { length: 150 },
      (_, i) => `QA Missing Source ${String(i).padStart(3, "0")}`,
    );
    names[1] = `QA ${"long source family ".repeat(10)}`.slice(0, 200);
    names[2] = "맑은 고딕";
    names[3] = "Malgun Gothic";
    const deck = blankDeck();
    deck.slides = [];
    for (let i = 0; i < 300; i++) {
      const slide = newSlide("blank");
      const family = names[i % names.length];
      slide.elements = [
        element("text", {
          text: "한글 English 123",
          fontFamily: family,
          paragraphs: [
            {
              runs: [
                {
                  text: "한글 English 123",
                  fontFamily: family,
                  fontFamilyEastAsian: family,
                },
                { text: "", fontFamily: "Unused Empty Font" },
              ],
            },
          ],
        }),
      ];
      deck.slides.push(slide);
    }
    const before = JSON.stringify(deck);
    const start = performance.now();
    const usage = documentFontUsage(deck);
    const collectMs = performance.now() - start;
    const native = window.FontFace;
    let active = 0,
      maximumActive = 0,
      probes = 0;
    window.FontFace = new Proxy(native, {
      construct(target, args) {
        const face = Reflect.construct(target, args);
        if (args[0] === "Slide Studio font availability probe") {
          probes++;
          const load = face.load.bind(face);
          face.load = async () => {
            active++;
            maximumActive = Math.max(maximumActive, active);
            try {
              await new Promise((r) => setTimeout(r, 3));
              return await load();
            } finally {
              active--;
            }
          };
        }
        return face;
      },
    });
    refreshDocumentFonts();
    let timerRan = false;
    const pending = diagnoseDocumentFonts(usage);
    setTimeout(() => {
      timerRan = true;
    }, 0);
    try {
      const statuses = await pending;
      return {
        collectMs,
        totalMs: performance.now() - start,
        usage,
        statuses,
        maximumActive,
        probes,
        timerRan,
        unchanged: before === JSON.stringify(deck),
      };
    } finally {
      window.FontFace = native;
      refreshDocumentFonts();
    }
  });
  expect(result.usage).toHaveLength(150);
  expect(result.usage.every((f) => f.slides === 2)).toBe(true);
  expect(result.statuses).toHaveLength(150);
  expect(
    result.statuses
      .slice(128)
      .every((f) => f.label === "확인 필요 · 128개 확인 한도"),
  ).toBe(true);
  expect(result.maximumActive).toBeLessThanOrEqual(4);
  expect(result.probes).toBeLessThanOrEqual(132);
  expect(result.timerRan).toBe(true);
  expect(result.unchanged).toBe(true);
  expect(result.collectMs).toBeLessThan(2000);
  const metrics = info.outputPath("font-diagnosis-large.json");
  fs.writeFileSync(metrics, JSON.stringify(result, null, 2));
  await info.attach("font-diagnosis-large", {
    path: metrics,
    contentType: "application/json",
  });
});

test("closing, reopening and replacing a document during font diagnosis cannot display stale results", async ({
  page,
}, info) => {
  await page.goto("http://127.0.0.1:5190");
  await page.evaluate(async () => {
    const { default: React } = await import(
      "/node_modules/.vite/deps/react.js"
    );
    const {
      default: { createRoot },
    } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { default: FontManager } = await import("/src/FontManager.tsx");
    const { blankDeck, element } = await import("/src/model.ts");
    const { refreshDocumentFonts } = await import("/src/document-fonts.ts");
    const native = window.FontFace;
    let releaseOld!: () => void, oldSettled!: () => void;
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    const oldFinished = new Promise<void>((resolve) => {
      oldSettled = resolve;
    });
    window.FontFace = new Proxy(native, {
      construct(target, args) {
        const face = Reflect.construct(target, args);
        if (args[0] === "Slide Studio font availability probe") {
          const load = face.load.bind(face);
          face.load = async () => {
            if (!String(args[1]).includes("Old")) return load();
            await oldGate;
            try {
              return await load();
            } finally {
              oldSettled();
            }
          };
        }
        return face;
      },
    });
    refreshDocumentFonts();
    const host = document.createElement("div");
    host.id = "font-lifecycle-proof";
    document.body.append(host);
    const root = createRoot(host);
    const make = (name: string) => {
      const deck = blankDeck();
      deck.name = name;
      deck.slides[0].elements = [
        element("text", { text: "Source text", fontFamily: name }),
      ];
      return deck;
    };
    const decks = [
      make("Old Source Family"),
      make("Replacement Source Family"),
    ];
    const snapshots = decks.map((deck) => JSON.stringify(deck));
    const render = (index: number) =>
      root.render(
        React.createElement(FontManager, {
          deck: decks[index],
          onClose: () => root.render(null),
        }),
      );
    (window as any).fontLifecycle = {
      render,
      releaseOld,
      oldFinished,
      snapshots,
      unchanged: () =>
        decks.every((deck, i) => JSON.stringify(deck) === snapshots[i]),
      dispose: () => {
        releaseOld();
        root.unmount();
        host.remove();
        window.FontFace = native;
        refreshDocumentFonts();
      },
    };
    render(0);
  });
  const dialog = page.getByRole("dialog", { name: "원본 글꼴 추가" });
  await expect(dialog.getByText("이 기기의 글꼴 확인 중…")).toBeVisible();
  await dialog.getByRole("button", { name: "글꼴 관리 닫기" }).click();
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => (window as any).fontLifecycle.render(0));
  await expect(dialog.getByText("이 기기의 글꼴 확인 중…")).toBeVisible();
  await page.evaluate(() => (window as any).fontLifecycle.render(1));
  const list = dialog.getByRole("list", { name: "문서에 사용된 글꼴" });
  await expect(list).toContainText("Replacement Source Family");
  // Hold the shared original probe until after the replacement is visible.
  // Cached results may legitimately finish too quickly to expose a spinner;
  // a manual gate makes close/reopen and stale-result cleanup deterministic.
  await page.evaluate(async () => {
    (window as any).fontLifecycle.releaseOld();
    await (window as any).fontLifecycle.oldFinished;
  });
  await expect(list).not.toContainText("Old Source Family");
  expect(
    await page.evaluate(() => (window as any).fontLifecycle.unchanged()),
  ).toBe(true);
  await dialog.screenshot({
    path: info.outputPath("font-lifecycle-replacement.png"),
  });
  await page.evaluate(() => (window as any).fontLifecycle.dispose());
});

test("checking document fonts does not dirty a saved document or consume undo and redo", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.desktop = {
      platform: "darwin",
      windowSessionId: "font-diagnosis-document-state",
      onMenu: () => () => {},
      openFile: async () => null,
      exportPDF: async () => null,
      print: async () => false,
      saveFile: async () => "/tmp/font-diagnosis-document.pptx",
    };
  });
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  const source = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const deck = blankDeck();
    deck.slides[0].elements = [
      element("text", {
        id: "font-document-text",
        text: "Before",
        fontFamily: "QA Missing Font Source",
        x: 100,
        y: 100,
        width: 600,
        height: 100,
        fontSize: 24,
      }),
    ];
    return JSON.stringify(deck);
  });
  await page.locator('input[accept*=".pptx"]').setInputFiles({
    name: "font-source.slide",
    mimeType: "application/json",
    buffer: Buffer.from(source),
  });
  const item = page.locator(
    '.editable-slide [data-element-id="font-document-text"]',
  );
  await expect(item).toBeVisible();
  const dirty = () =>
    page.evaluate(() => sessionStorage.getItem("slide-studio-file-dirty"));
  const undo = page.getByRole("button", { name: "실행 취소", exact: true });
  const redo = page.getByRole("button", { name: "다시 실행", exact: true });
  const checkFonts = async () => {
    await page.getByRole("button", { name: "파일", exact: true }).click();
    await page
      .getByRole("button", { name: "원본 글꼴 추가", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "원본 글꼴 추가" });
    await expect(
      dialog.getByRole("list", { name: "문서에 사용된 글꼴" }),
    ).toContainText("QA Missing Font Source");
    await dialog.getByRole("button", { name: "글꼴 관리 닫기" }).click();
  };
  await expect.poll(dirty).toBe("false");
  await checkFonts();
  await expect.poll(dirty).toBe("false");
  await expect(undo).toBeDisabled();
  await item.dblclick();
  const editor = page.getByRole("textbox", {
    name: "슬라이드 텍스트 편집",
    exact: true,
  });
  await editor.press("ControlOrMeta+a");
  await editor.fill("After");
  await editor.press("Escape");
  await expect.poll(dirty).toBe("true");
  await checkFonts();
  await undo.click();
  await expect(item).toContainText("Before");
  await expect.poll(dirty).toBe("false");
  await checkFonts();
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect(item).toContainText("After");
  await expect.poll(dirty).toBe("true");
});

test("font diagnosis resolves the same Body and Headings names as the text renderer", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { diagnoseDocumentFonts } = await import("/src/document-fonts.ts");
    const { fontStack } = await import("/src/text-layout.ts");
    const names = [
      "Calibri (Body)",
      "Calibri Light (Headings)",
      "나눔바른고딕 (Body)",
    ];
    return {
      statuses: await diagnoseDocumentFonts(
        names.map((family) => ({ family, slides: 1 })),
      ),
      stacks: names.map((name) => fontStack(name)),
    };
  });
  expect(result.statuses.map((s) => s.family)).toEqual([
    "Calibri (Body)",
    "Calibri Light (Headings)",
    "나눔바른고딕 (Body)",
  ]);
  expect(result.statuses.every((s) => s.kind !== "unknown")).toBe(true);
  expect(result.stacks[0]).toContain('"Slide Studio Calibri"');
  expect(result.stacks[1]).toContain('"Slide Studio Calibri Light"');
  expect(result.stacks[2]).toContain('"Slide Studio Nanum Barun Gothic"');
});

test("a long document font list fits a small window and can be scrolled with the keyboard", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1024, height: 640 });
  await page.goto("http://127.0.0.1:5190");
  await page.evaluate(async () => {
    const { default: React } = await import(
      "/node_modules/.vite/deps/react.js"
    );
    const {
      default: { createRoot },
    } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { default: FontManager } = await import("/src/FontManager.tsx");
    const { blankDeck, element } = await import("/src/model.ts");
    const deck = blankDeck();
    deck.slides[0].elements = Array.from({ length: 40 }, (_, i) =>
      element("text", {
        text: "Sample",
        fontFamily:
          `QA ${String(i).padStart(2, "0")} ${"Long Font Family ".repeat(10)}`.slice(
            0,
            200,
          ),
      }),
    );
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    root.render(
      React.createElement(FontManager, { deck, onClose: () => root.unmount() }),
    );
  });
  const dialog = page.getByRole("dialog", { name: "원본 글꼴 추가" });
  const list = dialog.getByRole("list", { name: "문서에 사용된 글꼴" });
  await expect(list.getByRole("listitem")).toHaveCount(40);
  await list.focus();
  await list.press("End");
  await expect
    .poll(() => list.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  expect(
    await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1);
  expect((await dialog.boundingBox())!.height).toBeLessThanOrEqual(576);
  await dialog.screenshot({
    path: info.outputPath("font-list-keyboard-small-window.png"),
  });
  await dialog.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("cancelled font diagnosis stops its queued native lookups", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { diagnoseDocumentFonts, refreshDocumentFonts } = await import(
      "/src/document-fonts.ts"
    );
    refreshDocumentFonts();
    const native = window.FontFace;
    let probes = 0;
    window.FontFace = new Proxy(native, {
      construct(target, args) {
        const face = Reflect.construct(target, args);
        if (args[0] === "Slide Studio font availability probe") {
          probes++;
          const load = face.load.bind(face);
          face.load = async () => {
            await new Promise((r) => setTimeout(r, 40));
            return load();
          };
        }
        return face;
      },
    });
    try {
      const controller = new AbortController();
      const pending = diagnoseDocumentFonts(
        Array.from({ length: 100 }, (_, i) => ({
          family: `QA Cancelled Font ${i}`,
          slides: 1,
        })),
        controller.signal,
      );
      controller.abort();
      const statuses = await pending;
      const alreadyCancelled = await diagnoseDocumentFonts(
        [{ family: "Never started", slides: 1 }],
        controller.signal,
      );
      return { probes, statuses, alreadyCancelled };
    } finally {
      window.FontFace = native;
      refreshDocumentFonts();
    }
  });
  expect(result.probes).toBeLessThanOrEqual(4);
  expect(result.statuses).toEqual([]);
  expect(result.alreadyCancelled).toEqual([]);
});

test("an unresponsive local font lookup returns an unconfirmed result instead of hanging the dialog", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { diagnoseDocumentFonts, refreshDocumentFonts } = await import(
      "/src/document-fonts.ts"
    );
    refreshDocumentFonts();
    const native = window.FontFace;
    window.FontFace = new Proxy(native, {
      construct(target, args) {
        const face = Reflect.construct(target, args);
        if (args[0] === "Slide Studio font availability probe")
          face.load = () => new Promise(() => {});
        return face;
      },
    });
    try {
      const start = performance.now();
      const statuses = await diagnoseDocumentFonts(
        Array.from({ length: 12 }, (_, i) => ({
          family: `QA Unresponsive Native Font ${i}`,
          slides: 1,
        })),
      );
      return { statuses, elapsedMs: performance.now() - start };
    } finally {
      window.FontFace = native;
      refreshDocumentFonts();
    }
  });
  expect(result.statuses[0]).toMatchObject({
    kind: "unknown",
    label: "원본 글꼴 확인 필요",
  });
  expect(result.statuses).toHaveLength(12);
  expect(result.statuses.every((s) => s.kind === "unknown")).toBe(true);
  expect(result.statuses.some((s) => s.label.includes("조회 시간 초과"))).toBe(
    true,
  );
  expect(result.elapsedMs).toBeLessThan(7500);
});
