import { expect, test } from "@playwright/test";

test("web and slide links, native slide numbers and generated footer fields survive PPTX round trips", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck, element, newSlide } = await import("/src/model.ts");
    const { applyFooters, resolveDeckFields } = await import(
      "/src/insert-fields.ts"
    );
    const { exportPptx, importPptx, serializeDeck, parseDeckJson } =
      await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    let deck = blankDeck();
    deck.slides = [newSlide("blank"), newSlide("blank")];
    deck.slides[0].elements = [
      element("text", {
        text: "웹 주소",
        hyperlink: { url: "https://example.com/path?a=1&b=2" },
        paragraphs: [
          {
            runs: [
              { text: "웹 ", bold: true },
              { text: "주소", italic: true },
            ],
          },
        ],
      }),
      element("shape", {
        x: 500,
        shape: "rect",
        hyperlink: { slideId: deck.slides[1].id },
      }),
    ];
    deck = applyFooters(
      deck,
      deck.slides[0].id,
      {
        date: true,
        automaticDate: false,
        dateText: "2030-01-02",
        footer: true,
        footerText: "회사 이름",
        number: true,
        skipTitle: false,
      },
      true,
    );
    const project = parseDeckJson(serializeDeck(deck));
    const bytes = await exportPptx(deck),
      zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    const imported = await importPptx(bytes);
    const first = imported.deck.slides[0];
    const reordered = resolveDeckFields({
      ...imported.deck,
      slides: [...imported.deck.slides].reverse(),
    });
    return {
      nativeNumber: xml.includes('type="slidenum"'),
      warnings: imported.warnings,
      projectFields: project.slides[0].elements
        .filter((el) => el.field)
        .map((el) => el.field),
      url: first.elements.find((el) => el.hyperlink?.url)?.hyperlink?.url,
      destination: first.elements.find((el) => el.hyperlink?.slideId)?.hyperlink
        ?.slideId,
      expectedDestination: imported.deck.slides[1].id,
      fields: first.elements
        .filter((el) => el.field)
        .map((el) => [el.field, el.text]),
      numbers: reordered.slides.map(
        (s) => s.elements.find((el) => el.field === "slideNumber")?.text,
      ),
    };
  });
  expect(result.nativeNumber).toBe(true);
  expect(result.url).toBe("https://example.com/path?a=1&b=2");
  expect(result.destination).toBe(result.expectedDestination);
  expect(result.projectFields).toEqual(["fixedDate", "footer", "slideNumber"]);
  expect(result.fields).toEqual([
    ["fixedDate", "2030-01-02"],
    ["footer", "회사 이름"],
    ["slideNumber", "1"],
  ]);
  expect(result.numbers).toEqual(["1", "2"]);
  expect(result.warnings).toEqual([]);
});

test("inserted custom shapes remain editable DrawingML and unsafe links are rejected", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { EXTRA_SHAPES } = await import("/src/shape-presets.ts");
    const { blankDeck, element, newSlide } = await import("/src/model.ts");
    const { exportPptx, importPptx, parseDeckJson } = await import(
      "/src/io.ts"
    );
    const { validateElementLink } = await import("/src/insert-fields.ts");
    const rejected = [
      "javascript:alert(1)",
      "file:///C:/Windows/system32/calc.exe",
      "https://user:password@example.com",
      "data:text/html,hello",
      "https://example.com\n",
    ].every((url) => {
      try {
        validateElementLink({ url });
        return false;
      } catch {
        return true;
      }
    });
    const deck = blankDeck();
    deck.slides = EXTRA_SHAPES.map((p) => ({
      ...newSlide("blank"),
      elements: [
        element("shape", {
          shape: "custom",
          paths: [
            { d: p.d, width: 100, height: 100, fill: true, stroke: false },
          ],
        }),
      ],
    }));
    parseDeckJson(JSON.stringify(deck));
    const roundtrip = await importPptx(await exportPptx(deck));
    return {
      rejected,
      count: roundtrip.deck.slides.length,
      custom: roundtrip.deck.slides.every(
        (s) => s.elements.length === 1 && !!s.elements[0].paths?.length,
      ),
      warnings: roundtrip.warnings,
    };
  });
  expect(result.rejected).toBe(true);
  expect(result.count).toBe(16);
  expect(result.custom).toBe(true);
  expect(result.warnings).toEqual([]);
});

test("native nondefault slide numbers preserve cached text even when app metadata remains", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck, element, newSlide } = await import("/src/model.ts");
    const { exportPptx, importPptx, serializeDeck } = await import(
      "/src/io.ts"
    );
    const { resolveDeckFields } = await import("/src/insert-fields.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const deck = blankDeck();
    deck.slides = [0, 1].map((index) => ({
      ...newSlide("blank"),
      elements: [
        element("text", { text: String(index + 1), field: "slideNumber" }),
      ],
    }));
    deck.slides[0].elements.push(
      element("text", { text: "Keep footer", field: "footer", y: 600 }),
    );
    const zip = await JSZip.loadAsync(await exportPptx(deck));
    const parser = new DOMParser(),
      writer = new XMLSerializer();
    const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
    const SS = "urn:slide-studio:insert-fields:v1";
    // The first slide retains app metadata, as when the numbering is changed in
    // PowerPoint. The second is a plain native slidenum field without metadata.
    const secondPath = "ppt/slides/slide2.xml";
    const second = parser.parseFromString(
      await zip.file(secondPath)!.async("string"),
      "application/xml",
    );
    for (const marker of Array.from(second.getElementsByTagNameNS(SS, "field")))
      marker.parentElement!.remove();
    zip.file(secondPath, writer.serializeToString(second));
    const nativeDefault = await importPptx(
      await zip.generateAsync({ type: "uint8array" }),
    );
    const presentation = parser.parseFromString(
      await zip.file("ppt/presentation.xml")!.async("string"),
      "application/xml",
    );
    presentation.documentElement.setAttribute("firstSlideNum", "7");
    zip.file("ppt/presentation.xml", writer.serializeToString(presentation));
    for (let i = 0; i < 2; i++) {
      const filename = `ppt/slides/slide${i + 1}.xml`;
      const doc = parser.parseFromString(
        await zip.file(filename)!.async("string"),
        "application/xml",
      );
      doc
        .getElementsByTagNameNS(A, "fld")[0]
        .getElementsByTagNameNS(A, "t")[0].textContent = String(7 + i);
      zip.file(filename, writer.serializeToString(doc));
    }
    const imported = await importPptx(
      await zip.generateAsync({ type: "uint8array" }),
    );
    const resolved = resolveDeckFields(imported.deck);
    const saved = JSON.parse(serializeDeck(resolved));
    const exportedAgain = await importPptx(await exportPptx(resolved));
    return {
      defaultFields: nativeDefault.deck.slides.map((s) => s.elements[0].field),
      defaultWarnings: nativeDefault.warnings,
      numbers: resolved.slides.map((s) => ({
        text: s.elements[0].text,
        field: s.elements[0].field,
      })),
      saved: saved.slides.map((s: any) => s.elements[0].text),
      exportedAgain: resolveDeckFields(exportedAgain.deck).slides.map((s) => s.elements[0].text),
      footer: resolved.slides[0].elements.find((e) => e.field === "footer")
        ?.text,
      warnings: imported.warnings,
    };
  });
  expect(result.defaultFields).toEqual(["slideNumber", "slideNumber"]);
  expect(result.defaultWarnings).toEqual([]);
  expect(result.numbers).toEqual([{ text: "7" }, { text: "8" }]);
  expect(result.saved).toEqual(["7", "8"]);
  expect(result.exportedAgain).toEqual(["7", "8"]);
  expect(result.footer).toBe("Keep footer");
  expect(result.warnings).toEqual([
    "1 이외의 시작 번호를 사용하는 슬라이드 번호는 표시된 텍스트로 유지했습니다.",
  ]);
});

test("native text links promote only complete matching runs and preserve partial or mixed targets", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck, element, newSlide } = await import("/src/model.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const deck = blankDeck();
    deck.slides = [newSlide("blank"), newSlide("blank")];
    const names = ["complete", "partial", "mixed", "internal"];
    deck.slides[0].elements = names.map((id, i) =>
      element("text", {
        id,
        text: `${id} A${id} B`,
        y: i * 100,
        hyperlink:
          id === "internal"
            ? { slideId: deck.slides[1].id }
            : { url: "https://example.com/native" },
        paragraphs: [
          {
            runs: [
              { text: `${id} A`, bold: true },
              { text: `${id} B`, italic: true },
            ],
          },
        ],
      }),
    );
    const zip = await JSZip.loadAsync(await exportPptx(deck));
    const parser = new DOMParser(),
      writer = new XMLSerializer();
    const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
    const R =
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const relationships = parser.parseFromString(
      await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string"),
      "application/xml",
    );
    const different = relationships.createElementNS(
      relationships.documentElement.namespaceURI,
      "Relationship",
    );
    different.setAttribute("Id", "rIdOtherTextLink");
    different.setAttribute("Type", R + "/hyperlink");
    different.setAttribute("Target", "https://example.com/different");
    different.setAttribute("TargetMode", "External");
    relationships.documentElement.appendChild(different);
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      writer.serializeToString(relationships),
    );
    const doc = parser.parseFromString(
      await zip.file("ppt/slides/slide1.xml")!.async("string"),
      "application/xml",
    );
    for (const id of names) {
      const props = Array.from(doc.getElementsByTagNameNS("*", "cNvPr")).find(
        (n) => n.getAttribute("name") === id,
      )!;
      const link = Array.from(props.children).find(
        (n) => n.localName === "hlinkClick",
      )!;
      const runProperties = Array.from(
        props.parentElement!.parentElement!.getElementsByTagNameNS(A, "rPr"),
      );
      runProperties.forEach((properties, i) => {
        if (id === "partial" && i === 1) return;
        const copy = link.cloneNode(true) as Element;
        if (id === "mixed" && i === 1)
          copy.setAttributeNS(R, "r:id", "rIdOtherTextLink");
        properties.appendChild(copy);
      });
      link.remove();
    }
    zip.file("ppt/slides/slide1.xml", writer.serializeToString(doc));
    const imported = await importPptx(
      await zip.generateAsync({ type: "uint8array" }),
    );
    const again = await importPptx(await exportPptx(imported.deck));
    return {
      elements: imported.deck.slides[0].elements.map((e) => ({
        text: e.text,
        hyperlink: e.hyperlink,
      })),
      runLinks: imported.deck.slides[0].elements.map((e) =>
        e.paragraphs?.flatMap((p) => p.runs.map((r) => r.hyperlink)),
      ),
      target: imported.deck.slides[1].id,
      secondUrl: again.deck.slides[0].elements[0].hyperlink?.url,
      secondTarget:
        again.deck.slides[0].elements[3].hyperlink?.slideId ===
        again.deck.slides[1].id,
      warnings: imported.warnings,
    };
  });
  expect(result.elements).toEqual([
    {
      text: "complete Acomplete B",
      hyperlink: { url: "https://example.com/native" },
    },
    { text: "partial Apartial B" },
    { text: "mixed Amixed B" },
    { text: "internal Ainternal B", hyperlink: { slideId: result.target } },
  ]);
  expect(result.secondUrl).toBe("https://example.com/native");
  expect(result.secondTarget).toBe(true);
  expect(result.warnings).toEqual([]);
  expect(result.runLinks[1]).toEqual([
    { url: "https://example.com/native" },
    undefined,
  ]);
  expect(result.runLinks[2]).toEqual([
    { url: "https://example.com/native" },
    { url: "https://example.com/different" },
  ]);
});
