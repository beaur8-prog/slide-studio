import { expect, test } from "@playwright/test";

test("rounded rectangle adjustments survive import, project save and PPTX export", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { exportPptx, importPptx, parseDeckJson, serializeDeck } =
      await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const deck = blankDeck();
    deck.slides[0].elements = [];
    const zip = await JSZip.loadAsync(await exportPptx(deck));
    const cases = [
      [224, 56, "8000"],
      [528, 106.6666666667, "8000"],
      [80, 40, null],
      [100, 40, "0"],
      [100, 40, "75000"],
      [100, 40, "-5000"],
    ] as const;
    const shapes = cases
      .map(
        ([w, h, adj], i) =>
          `<p:sp><p:nvSpPr><p:cNvPr id="${i + 10}" name="corner-${i}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${i * 100 * 9525}" y="0"/><a:ext cx="${Math.round(w * 9525)}" cy="${Math.round(h * 9525)}"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst>${adj === null ? "" : `<a:gd name="adj" fmla="val ${adj}"/>`}</a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="223344"/></a:solidFill></p:spPr></p:sp>`,
      )
      .join("");
    const name = "ppt/slides/slide1.xml";
    zip.file(
      name,
      (await zip.file(name)!.async("string")).replace(
        "</p:spTree>",
        shapes + "</p:spTree>",
      ),
    );
    const imported = (
      await importPptx(await zip.generateAsync({ type: "uint8array" }))
    ).deck;
    const restored = parseDeckJson(serializeDeck(imported));
    const output = await exportPptx(restored);
    const roundTrip = (await importPptx(output)).deck;
    const exportedZip = await JSZip.loadAsync(output);
    const xml = new DOMParser().parseFromString(
      await exportedZip.file(name)!.async("string"),
      "application/xml",
    );
    return {
      imported: imported.slides[0].elements.map((e) => e.cornerRadius),
      restored: restored.slides[0].elements.map((e) => e.cornerRadius),
      roundTrip: roundTrip.slides[0].elements.map((e) => e.cornerRadius),
      adjustments: Array.from(xml.getElementsByTagNameNS("*", "gd")).map((n) =>
        n.getAttribute("fmla"),
      ),
    };
  });
  const expected = [4.48, 8.5333333333, 6.6668, 0, 20, 0];
  expect(result.imported).toHaveLength(expected.length);
  for (const key of ["imported", "restored", "roundTrip"] as const)
    result[key].forEach((radius, index) =>
      expect(radius).toBeCloseTo(expected[index], 3),
    );
  expect(result.adjustments).toEqual([
    "val 8000",
    "val 8000",
    "val 16667",
    "val 0",
    "val 50000",
    "val 0",
  ]);
});

test("project input rejects invalid corner radius values", async ({ page }) => {
  await page.goto("http://127.0.0.1:5190");
  const rejected = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { parseDeckJson } = await import("/src/io.ts");
    return [-1, 100001, "4", null, Infinity, NaN].map((cornerRadius) => {
      const deck = blankDeck();
      deck.slides[0].elements = [
        { ...element("shape", { shape: "roundRect" }), cornerRadius } as any,
      ];
      try {
        parseDeckJson(JSON.stringify(deck));
        return false;
      } catch {
        return true;
      }
    });
  });
  expect(rejected).toEqual([true, true, true, true, true, true]);
});

test("paragraph hanging punctuation survives project validation and PPTX export", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { exportPptx, parseDeckJson, serializeDeck } = await import(
      "/src/io.ts"
    );
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const deck = blankDeck();
    deck.slides[0].elements = [
      element("text", {
        text: "문장입니다.\n다음 문장입니다.",
        paragraphs: [
          { runs: [{ text: "문장입니다." }], hangingPunctuation: true },
          { runs: [{ text: "다음 문장입니다." }], hangingPunctuation: false },
        ],
      }),
    ];
    const restored = parseDeckJson(serializeDeck(deck));
    const zip = await JSZip.loadAsync(await exportPptx(restored));
    const xml = new DOMParser().parseFromString(
      await zip.file("ppt/slides/slide1.xml")!.async("string"),
      "application/xml",
    );
    const flags = Array.from(xml.getElementsByTagNameNS("*", "pPr")).map((n) =>
      n.getAttribute("hangingPunct"),
    );
    (deck.slides[0].elements[0].paragraphs![0] as any).hangingPunctuation =
      "true";
    let invalidRejected = false;
    try {
      parseDeckJson(JSON.stringify(deck));
    } catch {
      invalidRejected = true;
    }
    return {
      flags,
      values: restored.slides[0].elements[0].paragraphs!.map(
        (p) => p.hangingPunctuation,
      ),
      invalidRejected,
    };
  });
  expect(result).toEqual({
    flags: ["1", "0"],
    values: [true, false],
    invalidRejected: true,
  });
});
