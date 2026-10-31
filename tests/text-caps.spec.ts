import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

const URL = "http://127.0.0.1:5190";
const editor = (page: Page) =>
  page.getByRole("textbox", { name: "슬라이드 텍스트 편집", exact: true });
async function openFixture(page: Page) {
  await page.goto(URL);
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { saveAutosave } = await import("/src/storage.ts");
    const deck = blankDeck();
    deck.slides[0].elements = [
      element("text", {
        x: 100,
        y: 100,
        width: 900,
        height: 200,
        fontFamily: "Arial",
        fontSize: 30,
        text: "Alpha Beta 한글 Straße",
        paragraphs: [
          {
            runs: [
              { text: "Alpha ", caps: "none" },
              { text: "Beta", caps: "all" },
              { text: " 한글 Straße", caps: "small" },
            ],
          },
        ],
      }),
    ];
    await saveAutosave(deck);
  });
  await page.reload();
  await page.getByTestId("slide-element").dblclick();
  await expect(editor(page)).toBeFocused();
}
async function select(page: Page, start: number, end: number) {
  await editor(page).evaluate(
    async (host, { start, end }) =>
      (await import("/src/text-selection.ts")).restoreTextOffsets(
        host,
        start,
        end,
      ),
    { start, end },
  );
}
async function savedRuns(page: Page) {
  return page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts");
    const e = (await loadAutosave())!.slides[0].elements[0];
    return {
      text: e.text,
      caps: e.paragraphs!.flatMap((p) =>
        p.runs.flatMap((r) => Array(r.text.length).fill(r.caps ?? "none")),
      ),
      italic: e.paragraphs!.flatMap((p) =>
        p.runs.flatMap((r) =>
          Array(r.text.length).fill(r.italic ?? e.italic ?? false),
        ),
      ),
    };
  });
}

test("public themes 8/9/10 inherit all caps without changing original text through three edited PPTX saves", async ({
  page,
}) => {
  test.skip(
    !fs.existsSync("qa/samples/poi-themes.pptx"),
    "Fetch pinned public samples first.",
  );
  await page.goto(URL);
  const result = await page.evaluate(async () => {
    const { importPptx, exportPptx } = await import("/src/io.ts");
    const { editText } = await import("/src/text-layout.ts");
    let deck = (
      await importPptx(
        await (await fetch("/qa/samples/poi-themes.pptx")).arrayBuffer(),
      )
    ).deck;
    const originals = [
      "Treck theme is sandy",
      "Section header in the treck theme",
      "Trade show ",
    ];
    const ids = originals.map(
      (text, i) => deck.slides[i + 7].elements.find((e) => e.text === text)!.id,
    );
    const rounds = [];
    for (let round = 0; round < 4; round++) {
      rounds.push(
        originals.map((_text, i) => {
          const e = deck.slides[i + 7].elements.find(
            (e) => e.id === ids[i] || e.text?.startsWith(originals[i]),
          )!;
          return {
            text: e.text,
            caps: e.paragraphs!.flatMap((p) => p.runs.map((r) => r.caps)),
            fontSize: e.fontSize,
            width: e.width,
            height: e.height,
          };
        }),
      );
      if (round === 3) break;
      originals.forEach((text, i) => {
        const slide = deck.slides[i + 7],
          index = slide.elements.findIndex((e) => e.text?.startsWith(text));
        slide.elements[index] = editText(
          slide.elements[index],
          text + "X".repeat(round + 1),
        );
      });
      deck = (await importPptx(await exportPptx(deck))).deck;
    }
    return { rounds, originals };
  });
  for (const [round, elements] of result.rounds.entries())
    elements.forEach((e, i) => {
      expect(e.text).toBe(result.originals[i] + "X".repeat(round));
      expect(e.caps.every((c) => c === "all")).toBe(true);
      expect(e.fontSize).toBe(result.rounds[0][i].fontSize);
      expect(e.width).toBeCloseTo(result.rounds[0][i].width, 2);
      expect(e.height).toBeCloseTo(result.rounds[0][i].height, 2);
    });
});

test("explicit caps none clears inherited all, small is independent, and invalid JSON enum is rejected", async ({
  page,
}) => {
  await page.goto(URL);
  const result = await page.evaluate(async () => {
    const { readTextBody } = await import("/src/pptx-text.ts");
    const { validateParagraphs } = await import("/src/text-validation.ts");
    const { blankDeck } = await import("/src/model.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const A = "http://schemas.openxmlformats.org/drawingml/2006/main",
      P = "http://schemas.openxmlformats.org/presentationml/2006/main";
    const parse = (xml: string) =>
      new DOMParser().parseFromString(xml, "application/xml").documentElement;
    const defaults = parse(
      `<p:defaultTextStyle xmlns:a="${A}" xmlns:p="${P}"><a:lvl1pPr><a:defRPr cap="all"/></a:lvl1pPr></p:defaultTextStyle>`,
    );
    const shape = parse(
      `<p:sp xmlns:a="${A}" xmlns:p="${P}"><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>Inherited </a:t></a:r><a:r><a:rPr cap="none"/><a:t>MiXeD </a:t></a:r><a:r><a:rPr cap="small"/><a:t>Small 한글</a:t></a:r></a:p></p:txBody></p:sp>`,
    );
    const e = readTextBody(shape.getElementsByTagNameNS(P, "txBody")[0], {
      nodes: [shape],
      defaultStyle: defaults,
      font: (name) => name,
      defaultFont: "Arial",
      color: () => undefined,
      defaultColor: "#000000",
      geometry: { x: 0, y: 0, width: 400, height: 100, rotation: 0 },
      sx: 1,
      sy: 1,
    });
    let rejected = false;
    try {
      validateParagraphs([{ runs: [{ text: "bad", caps: "capitalize" }] }]);
    } catch {
      rejected = true;
    }
    let deck = blankDeck();
    deck.slides[0].elements = [e];
    const savedCaps = [];
    for (let i = 0; i < 3; i++) {
      deck = (await importPptx(await exportPptx(deck))).deck;
      savedCaps.push(
        deck.slides[0].elements[0].paragraphs![0].runs.map((r) => r.caps),
      );
    }
    return {
      text: e.text,
      caps: validateParagraphs(e.paragraphs)[0].runs.map((r) => r.caps),
      rejected,
      noObjectCap: !Object.hasOwn(e, "caps"),
      savedCaps,
    };
  });
  expect(result).toEqual({
    text: "Inherited MiXeD Small 한글",
    caps: ["all", "none", "small"],
    rejected: true,
    noObjectCap: true,
    savedCaps: Array.from({ length: 3 }, () => ["all", "none", "small"]),
  });
});

test("CSS capitals preserve Unicode source, logical selection/search offsets and small-cap font synthesis", async ({
  page,
}) => {
  await page.goto(URL);
  const result = await page.evaluate(async () => {
    const { default: React } = await import(
      "/node_modules/.vite/deps/react.js"
    );
    const {
      default: { renderToStaticMarkup },
    } = await import("/node_modules/.vite/deps/react-dom_server.js");
    const { TextContent } = await import("/src/TextContent.tsx");
    const { textStyle } = await import("/src/text-geometry.ts");
    const { textPointOffset, textRangeAtOffsets } = await import(
      "/src/text-selection.ts"
    );
    const { editableText } = await import("/src/text-layout.ts");
    const { blankDeck, element } = await import("/src/model.ts");
    const { findDocumentText, DEFAULT_SEARCH_OPTIONS } = await import(
      "/src/document-search.ts"
    );
    const e = element("text", {
      text: "Straße 한글 MiXeD",
      fontSize: 32,
      fontFamily: "Arial",
      paragraphs: [
        {
          runs: [
            { text: "Straße ", caps: "all" },
            { text: "한글 MiXeD", caps: "small" },
          ],
        },
      ],
    });
    const host = document.createElement("div");
    Object.assign(host.style, {
      ...textStyle(e),
      width: "600px",
      height: "100px",
    });
    host.innerHTML = renderToStaticMarkup(
      React.createElement(TextContent, { element: e }),
    );
    document.body.append(host);
    const spans = [...host.querySelectorAll("[data-text-line] > span")];
    const first = spans[0],
      range = textRangeAtOffsets(host, 0, 6);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const start = textPointOffset(
        host,
        range.startContainer,
        range.startOffset,
      ),
      end = textPointOffset(host, range.endContainer, range.endOffset);
    const small = spans[1];
    // OS Arial and mixed-script fallback can have different native shaping
    // behavior. Use the same shipped Latin font on every platform; Carlito's
    // GSUB has no smcp/c2sc feature, so this exercises actual glyph synthesis.
    const face = new FontFace(
      "Caps QA Latin",
      'url("/node_modules/@fontsource/carlito/files/carlito-latin-400-normal.woff2") format("woff2")',
    );
    await face.load();
    document.fonts.add(face);
    const probeElement = element("text", {
      fontSize: 32,
      fontFamily: "Caps QA Latin",
      text: "mixed alphabet",
      paragraphs: [{ runs: [{ text: "mixed alphabet", caps: "small" }] }],
    });
    const probe = document.createElement("div");
    Object.assign(probe.style, textStyle(probeElement));
    probe.innerHTML = renderToStaticMarkup(
      React.createElement(TextContent, { element: probeElement }),
    );
    document.body.append(probe);
    const probeSpan = probe.querySelector("[data-text-line] > span") as HTMLElement;
    const synthesisCss = getComputedStyle(probeSpan).fontSynthesis;
    const probeRange = document.createRange();
    probeRange.selectNodeContents(probeSpan);
    const smallWidth = probeRange.getBoundingClientRect().width;
    probeSpan.style.fontVariantCaps = "normal";
    const normalWidth = probeRange.getBoundingClientRect().width;
    const deck = blankDeck();
    deck.slides[0].elements = [e];
    const matches = findDocumentText(deck, "Straße", {
      ...DEFAULT_SEARCH_OPTIONS,
      caseSensitive: true,
    }).matches;
    return {
      source: e.text,
      raw: editableText(host),
      firstRaw: first.textContent,
      visibleSelection: selection.toString(),
      selectedRaw: range.toString(),
      start,
      end,
      matches: matches.map((m) => ({
        value: m.value,
        start: m.start,
        end: m.end,
      })),
      allCss: getComputedStyle(first).textTransform,
      smallCss: getComputedStyle(small).fontVariantCaps,
      probeFontStatus: face.status,
      synthesisCss,
      smallWidth,
      normalWidth,
    };
  });
  expect(result.raw).toBe(result.source);
  expect(result.firstRaw).toBe("Straße ");
  expect(result.selectedRaw).toBe("Straße");
  expect(result.visibleSelection).toBe("STRASSE");
  expect([result.start, result.end]).toEqual([0, 6]);
  expect(result.matches).toEqual([{ value: "Straße", start: 0, end: 6 }]);
  expect(result.allCss).toBe("uppercase");
  expect(result.smallCss).toBe("small-caps");
  expect(result.probeFontStatus).toBe("loaded");
  expect(result.synthesisCss).toBe("style small-caps");
  expect(Math.abs(result.smallWidth - result.normalWidth)).toBeGreaterThan(1);
});

test("partial italic changes only Beta while capitalization, raw text, Undo/Redo and PPTX survive", async ({
  page,
}) => {
  await openFixture(page);
  const before = await savedRuns(page);
  await select(page, 6, 10);
  await page.getByRole("button", { name: "기울임", exact: true }).click();
  const expected = [
    ...Array(6).fill(false),
    ...Array(4).fill(true),
    ...Array(before.text!.length - 10).fill(false),
  ];
  await expect
    .poll(async () => (await savedRuns(page)).italic)
    .toEqual(expected);
  expect((await savedRuns(page)).caps).toEqual(before.caps);
  await editor(page).press("ControlOrMeta+z");
  await expect
    .poll(async () => (await savedRuns(page)).italic)
    .toEqual(before.italic);
  await editor(page).press("ControlOrMeta+Shift+z");
  await expect
    .poll(async () => (await savedRuns(page)).italic)
    .toEqual(expected);
  await editor(page).press("Escape");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.reload();
  expect((await savedRuns(page)).caps).toEqual(before.caps);
  const reopened = await page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const e = (await importPptx(await exportPptx((await loadAutosave())!))).deck
      .slides[0].elements[0];
    return {
      text: e.text,
      caps: e.paragraphs![0].runs.flatMap((r) =>
        Array(r.text.length).fill(r.caps ?? "none"),
      ),
    };
  });
  expect(reopened).toEqual({ text: before.text, caps: before.caps });
});

test("external HTML caps are constrained to supported CSS and survive actual rich paste/Undo/Redo", async ({
  page,
}) => {
  await openFixture(page);
  const filtered = await page.evaluate(async () => {
    const { richClipboardHtml } = await import("/src/rich-clipboard.ts");
    const template = document.createElement("div");
    template.innerHTML = richClipboardHtml(
      '<span style="text-transform:uppercase;font-variant-caps:normal">MiXeD</span><span style="text-transform:none;font-variant-caps:small-caps">Abc</span><span style="text-transform:lowercase;font-variant-caps:all-small-caps">Unsupported</span><span onclick="alert(1)" style="text-transform:uppercase;background:url(https://evil.test/x)">Safe</span>',
    )!;
    return [...template.children].map((e) => ({
      text: e.textContent,
      transform: (e as HTMLElement).style.textTransform,
      caps: (e as HTMLElement).style.fontVariantCaps,
      html: e.outerHTML,
    }));
  });
  expect(filtered.map((r) => [r.transform, r.caps])).toEqual([
    ["uppercase", "normal"],
    ["none", "small-caps"],
    ["", ""],
    ["uppercase", ""],
  ]);
  expect(filtered.every((r) => !/onclick|url\(/i.test(r.html))).toBe(true);
  await select(page, 6, 10);
  await editor(page).evaluate((node) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData(
      "text/html",
      '<span style="text-transform:uppercase">MiXeD</span><span style="text-transform:none;font-variant-caps:small-caps">Abc한글</span>',
    );
    clipboardData.setData("text/plain", "MiXeDAbc한글");
    node.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect
    .poll(async () => (await savedRuns(page)).text)
    .toBe("Alpha MiXeDAbc한글 한글 Straße");
  const pasted = await savedRuns(page);
  expect(pasted.caps.slice(6, 11)).toEqual(Array(5).fill("all"));
  expect(pasted.caps.slice(11, 16)).toEqual(Array(5).fill("small"));
  expect(
    await editor(page).evaluate((host) =>
      [...host.querySelectorAll("span")]
        .filter((span) => span.textContent?.includes("Abc"))
        .some((span) =>
          getComputedStyle(span).fontSynthesis.includes("small-caps"),
        ),
    ),
  ).toBe(true);
  await editor(page).press("ControlOrMeta+z");
  await expect
    .poll(async () => (await savedRuns(page)).text)
    .toBe("Alpha Beta 한글 Straße");
  await editor(page).press("ControlOrMeta+Shift+z");
  await expect.poll(async () => (await savedRuns(page)).text).toBe(pasted.text);
  expect((await savedRuns(page)).caps).toEqual(pasted.caps);
});

test("native clipboard keeps original text and capitalization through partial copy, paste, Undo/Redo and three PPTX saves", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: URL,
  });
  await openFixture(page);
  const before = await savedRuns(page);
  await select(page, 6, 10);
  await editor(page).press("ControlOrMeta+c");
  const copied = await page.evaluate(async () => {
    let html = "";
    for (const item of await navigator.clipboard.read())
      if (item.types.includes("text/html"))
        html = await (await item.getType("text/html")).text();
    return { text: await navigator.clipboard.readText(), html };
  });
  expect(copied.text).toBe("Beta");
  expect(copied.html).toMatch(/text-transform:\s*uppercase/);
  await select(page, before.text!.length, before.text!.length);
  await editor(page).press("ControlOrMeta+v");
  await expect
    .poll(async () => (await savedRuns(page)).text)
    .toBe(before.text + "Beta");
  expect((await savedRuns(page)).caps).toEqual([
    ...before.caps,
    ...Array(4).fill("all"),
  ]);
  await editor(page).press("ControlOrMeta+z");
  await expect.poll(async () => (await savedRuns(page)).text).toBe(before.text);
  await editor(page).press("ControlOrMeta+Shift+z");
  await expect
    .poll(async () => (await savedRuns(page)).text)
    .toBe(before.text + "Beta");
  await editor(page).press("Escape");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  const rounds = await page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    let deck = (await loadAutosave())!;
    const rounds = [];
    for (let i = 0; i < 3; i++) {
      deck = (await importPptx(await exportPptx(deck))).deck;
      const e = deck.slides[0].elements[0];
      rounds.push({
        text: e.text,
        caps: e.paragraphs!.flatMap((p) =>
          p.runs.flatMap((r) => Array(r.text.length).fill(r.caps ?? "none")),
        ),
      });
    }
    return rounds;
  });
  for (const round of rounds)
    expect(round).toEqual({
      text: before.text + "Beta",
      caps: [...before.caps, ...Array(4).fill("all")],
    });
});
