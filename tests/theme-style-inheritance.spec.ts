import { expect, test } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

test("line inheritance keeps explicit fill, dash and join choices and does not mutate source XML", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { inheritDrawingmlLine, resolveThemeStyleReference } = await import(
      "/src/drawingml-style.ts"
    );
    const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
    const parse = (xml: string) =>
      new DOMParser().parseFromString(
        `<a:root xmlns:a="${A}">${xml}</a:root>`,
        "application/xml",
      ).firstElementChild!.firstElementChild!;
    const own = parse(
      '<a:ln w="0" cap="sq"><a:solidFill><a:srgbClr val="123456"/></a:solidFill><a:prstDash val="solid"/><a:round/></a:ln>',
    );
    const inherited = parse(
      '<a:ln w="38100" cap="rnd"><a:noFill/><a:custDash><a:ds d="100000" sp="200000"/></a:custDash><a:miter lim="800000"/><a:headEnd type="oval"/></a:ln>',
    );
    const before = [own.outerHTML, inherited.outerHTML];
    const merged = inheritDrawingmlLine(own, inherited)!;
    const zero = resolveThemeStyleReference(
      parse('<a:lnRef idx="0"><a:srgbClr val="FF0000"/></a:lnRef>'),
      undefined,
      () => ({ color: "#FF0000", opacity: 1 }),
      "line",
    )!;
    const stopped = inheritDrawingmlLine(zero, inherited)!;
    return {
      unchanged: [own.outerHTML, inherited.outerHTML].every(
        (s, i) => s === before[i],
      ),
      width: merged.getAttribute("w"),
      cap: merged.getAttribute("cap"),
      children: Array.from(merged.children).map((n) => n.localName),
      stopWidth: stopped.getAttribute("w"),
      stopFill: stopped.getElementsByTagNameNS("*", "noFill").length,
    };
  });
  expect(result).toEqual({
    unchanged: true,
    width: "0",
    cap: "sq",
    children: ["solidFill", "prstDash", "round", "headEnd"],
    stopWidth: "0",
    stopFill: 1,
  });
});

test("fill indices zero and one thousand suppress referenced colors in native backgrounds and shapes", async ({
  page,
}, info) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck, newSlide, element } = await import("/src/model.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const A = "http://schemas.openxmlformats.org/drawingml/2006/main",
      P = "http://schemas.openxmlformats.org/presentationml/2006/main";
    const deck = blankDeck();
    deck.slides = [0, 1000].map((idx) => ({
      ...newSlide(),
      elements: [
        element("shape", {
          shape: "triangle",
          text: "Boundary " + idx,
          fill: "#FF0000",
          stroke: "transparent",
          strokeWidth: 0,
        }),
      ],
    }));
    const zip = await JSZip.loadAsync(await exportPptx(deck));
    for (const [i, index] of [0, 1000].entries()) {
      const part = `ppt/slides/slide${i + 1}.xml`;
      const doc = new DOMParser().parseFromString(
        await zip.file(part)!.async("string"),
        "application/xml",
      );
      const cs = doc.getElementsByTagNameNS(P, "cSld")[0];
      for (const bg of Array.from(cs.children).filter(
        (n) => n.localName === "bg",
      ))
        bg.remove();
      const background = doc.createElementNS(P, "p:bg");
      background.innerHTML = `<p:bgRef idx="${index}"><a:srgbClr val="FF0000"/></p:bgRef>`;
      cs.insertBefore(background, cs.firstChild);
      const shape = doc.getElementsByTagNameNS(P, "sp")[0],
        properties = Array.from(shape.children).find(
          (n) => n.localName === "spPr",
        )!;
      for (const fill of Array.from(properties.children).filter((n) =>
        [
          "noFill",
          "solidFill",
          "gradFill",
          "pattFill",
          "blipFill",
          "grpFill",
        ].includes(n.localName),
      ))
        fill.remove();
      for (const old of Array.from(shape.children).filter(
        (n) => n.localName === "style",
      ))
        old.remove();
      const style = doc.createElementNS(P, "p:style");
      style.innerHTML = `<a:lnRef idx="0"><a:srgbClr val="000000"/></a:lnRef><a:fillRef idx="${index}"><a:srgbClr val="FF0000"/></a:fillRef><a:effectRef idx="0"><a:srgbClr val="000000"/></a:effectRef><a:fontRef idx="minor"><a:srgbClr val="000000"/></a:fontRef>`;
      shape.insertBefore(
        style,
        Array.from(shape.children).find((n) => n.localName === "txBody") ??
          null,
      );
      zip.file(part, new XMLSerializer().serializeToString(doc));
    }
    // An explicit no-fill reference must stop both inherited and reference colors.
    const layoutPath = "ppt/slideLayouts/slideLayout1.xml",
      layout = new DOMParser().parseFromString(
        await zip.file(layoutPath)!.async("string"),
        "application/xml",
      );
    const cs = layout.getElementsByTagNameNS(P, "cSld")[0],
      bg = layout.createElementNS(P, "p:bg");
    bg.innerHTML =
      '<p:bgPr><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></p:bgPr>';
    for (const old of Array.from(cs.children).filter(
      (n) => n.localName === "bg",
    ))
      old.remove();
    cs.insertBefore(bg, cs.firstChild);
    zip.file(layoutPath, new XMLSerializer().serializeToString(layout));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const { deck: imported, warnings } = await importPptx(bytes);
    return {
      fixture: await zip.generateAsync({ type: "base64" }),
      warnings,
      slides: imported.slides.map((slide) => ({
        background: slide.background,
        gradient: slide.backgroundGradient,
        image: slide.backgroundImage,
        shapes: slide.elements.map((e) => ({
          text: e.text,
          fill: e.fill,
          stroke: e.stroke,
          strokeWidth: e.strokeWidth,
        })),
      })),
    };
  });
  writeFileSync(
    info.outputPath("native-no-fill-boundaries.pptx"),
    Buffer.from(result.fixture, "base64"),
  );
  expect(result.slides).toHaveLength(2);
  for (const [i, slide] of result.slides.entries()) {
    expect(slide).toMatchObject({
      background: "#FFFFFF",
      shapes: [
        {
          text: "Boundary " + [0, 1000][i],
          fill: "transparent",
          stroke: "transparent",
          strokeWidth: 0,
        },
      ],
    });
    expect(slide.gradient).toBeUndefined();
    expect(slide.image).toBeUndefined();
  }
  expect(result.warnings).not.toContain(
    "일부 배경의 그라데이션·이미지·효과는 단색 배경으로 대체되었습니다.",
  );
});

test("native shapes resolve matrix styles and partial placeholder lines through three edited saves", async ({
  page,
}, info) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const A = "http://schemas.openxmlformats.org/drawingml/2006/main",
      P = "http://schemas.openxmlformats.org/presentationml/2006/main";
    const initial = blankDeck();
    initial.slides[0].elements = [];
    const zip = await JSZip.loadAsync(await exportPptx(initial));
    const parse = (xml: string) =>
      new DOMParser().parseFromString(xml, "application/xml");
    const serialize = (xml: Document) =>
      new XMLSerializer().serializeToString(xml);
    const children = (n: Element, name: string) =>
      Array.from(n.children).filter((c) => c.localName === name);
    const append = (doc: Document, host: Element, xml: string) =>
      host.append(
        doc.importNode(
          parse(
            `<p:root xmlns:p="${P}" xmlns:a="${A}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${xml}</p:root>`,
          ).documentElement.firstElementChild!,
          true,
        ),
      );
    const load = async (path: string) =>
      parse(await zip.file(path)!.async("string"));
    const paths = {
      slide: "ppt/slides/slide1.xml",
      layout: "ppt/slideLayouts/slideLayout1.xml",
      master: "ppt/slideMasters/slideMaster1.xml",
      theme: "ppt/theme/theme1.xml",
    };
    const docs = {
      slide: await load(paths.slide),
      layout: await load(paths.layout),
      master: await load(paths.master),
      theme: await load(paths.theme),
    };
    const trees = Object.fromEntries(
      ["slide", "layout", "master"].map((key) => {
        const tree = docs[key as "slide"].getElementsByTagNameNS(
          "*",
          "spTree",
        )[0];
        for (const node of Array.from(tree.children))
          if (!["nvGrpSpPr", "grpSpPr"].includes(node.localName)) node.remove();
        return [key, tree];
      }),
    ) as Record<"slide" | "layout" | "master", Element>;
    const format = docs.theme.getElementsByTagNameNS("*", "fmtScheme")[0];
    format.replaceChildren();
    append(
      docs.theme,
      format,
      '<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"><a:tint val="40000"/></a:schemeClr></a:solidFill><a:pattFill prst="pct50"><a:fgClr><a:schemeClr val="phClr"/></a:fgClr><a:bgClr><a:srgbClr val="FFFFFF"/></a:bgClr></a:pattFill><a:blipFill><a:blip r:embed="unusedThemePicture"/><a:stretch><a:fillRect/></a:stretch></a:blipFill></a:fillStyleLst>',
    );
    append(
      docs.theme,
      format,
      '<a:lnStyleLst><a:ln w="38100" cap="rnd"><a:solidFill><a:schemeClr val="phClr"><a:shade val="50000"/></a:schemeClr></a:solidFill><a:custDash><a:ds d="100000" sp="200000"/></a:custDash><a:miter lim="800000"/></a:ln></a:lnStyleLst>',
    );
    append(docs.theme, format, "<a:effectStyleLst/>");
    append(docs.theme, format, "<a:bgFillStyleLst/>");
    const ref = (fill = 1, line = 1, fillAlpha = 1, lineAlpha = 1) =>
      `<p:style><a:lnRef idx="${line}"><a:srgbClr val="4472C4"><a:alpha val="${lineAlpha * 100000}"/></a:srgbClr></a:lnRef><a:fillRef idx="${fill}"><a:srgbClr val="C00000"><a:alpha val="${fillAlpha * 100000}"/></a:srgbClr></a:fillRef><a:effectRef idx="0"><a:srgbClr val="000000"/></a:effectRef><a:fontRef idx="minor"><a:srgbClr val="000000"/></a:fontRef></p:style>`;
    const shape = (
      id: number,
      name: string,
      own: string,
      style = "",
      ph?: number,
      line = false,
    ) =>
      `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr>${ph === undefined ? "" : `<p:ph type="body" idx="${ph}"/>`}</p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="${(30 + (id % 5) * 180) * 9525}" y="${(60 + Math.floor(id / 5) * 200) * 9525}"/><a:ext cx="1333500" cy="${line ? 0 : 1143000}"/></a:xfrm><a:prstGeom prst="${line ? "line" : "triangle"}"><a:avLst/></a:prstGeom>${own}</p:spPr>${style}<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:buNone/></a:pPr><a:r><a:rPr sz="1200"/><a:t>${name}</a:t></a:r></a:p></p:txBody></p:sp>`;
    append(
      docs.master,
      trees.master,
      shape(
        90,
        "Master",
        '<a:ln w="95250"><a:solidFill><a:srgbClr val="00AA00"/></a:solidFill><a:headEnd type="oval"/></a:ln>',
        "",
        0,
      ),
    );
    for (const idx of [1, 2, 3, 4])
      append(
        docs.layout,
        trees.layout,
        shape(90 + idx, "Layout", '<a:ln w="57150"/>', ref(), idx),
      );
    const cases = [
      shape(1, "Matrix", "", ref(1, 1, 0.3, 0.6)),
      shape(
        2,
        "Partial",
        '<a:ln cap="sq"><a:prstDash val="solid"/><a:round/></a:ln>',
        "",
        1,
      ),
      shape(3, "NoFill", "<a:noFill/><a:ln><a:noFill/></a:ln>", "", 2),
      shape(4, "ZeroRef", "", ref(0, 0), 3),
      shape(5, "ZeroWidth", '<a:ln w="0"/>', "", 4),
      shape(
        6,
        "Own",
        '<a:solidFill><a:srgbClr val="12AB34"/></a:solidFill><a:ln w="19050" cap="flat"><a:solidFill><a:srgbClr val="FF6600"><a:alpha val="50000"/></a:srgbClr></a:solidFill><a:prstDash val="dash"/><a:bevel/></a:ln>',
        ref(),
      ),
      shape(7, "Pattern", "", ref(2, 1)),
      shape(8, "Picture", "", ref(3, 1)),
      shape(9, "Flat", "", ref(0, 1, 1, 0.4), undefined, true).replace(
        "<p:cNvSpPr/>",
        '<p:cNvSpPr><a:spLocks noMove="1" noResize="1" noRot="1"/></p:cNvSpPr>',
      ),
      shape(10, "FlatHidden", "", ref(0, 0), undefined, true),
      shape(11, "FlatAlphaZero", "", ref(0, 1, 1, 0), undefined, true),
    ];
    for (const entry of cases) append(docs.slide, trees.slide, entry);
    for (const key of ["slide", "layout", "master", "theme"] as const)
      zip.file(paths[key], serialize(docs[key]));
    const fixture = await zip.generateAsync({ type: "base64" });
    let imported = await importPptx(
      Uint8Array.from(atob(fixture), (c) => c.charCodeAt(0)),
    );
    const warnings = imported.warnings,
      rounds = [],
      native = [],
      saved: string[] = [];
    for (let round = 0; round < 4; round++) {
      const deck = imported.deck;
      rounds.push(
        deck.slides[0].elements.map((e) => ({
          text: e.text,
          type: e.type,
          shape: e.shape,
          fill: e.fill,
          fillOpacity: e.fillOpacity,
          stroke: e.stroke,
          strokeOpacity: e.strokeOpacity,
          strokeWidth: e.strokeWidth,
          strokeDash: e.strokeDash,
          strokeCap: e.strokeCap,
          locked: e.locked,
          width: e.width,
          height: e.height,
        })),
      );
      if (round === 3) break;
      delete deck.pptxSources;
      delete deck.slides[0].pptxSource;
      for (const e of deck.slides[0].elements) {
        delete e.pptxRef;
        if (!e.locked) e.x += round + 1;
        if (round === 0 && e.text === "Matrix") e.opacity = 0.5;
      }
      deck.slides[0].notes = `Edited native save ${round + 1}`;
      const bytes = await exportPptx(deck),
        savedZip = await JSZip.loadAsync(bytes);
      saved.push(await savedZip.generateAsync({ type: "base64" }));
      const xml = parse(await savedZip.file(paths.slide)!.async("string"));
      native.push(
        Array.from(xml.getElementsByTagNameNS(P, "sp")).map((sp) => {
          const props = children(sp, "spPr")[0],
            line = children(props, "ln")[0];
          return {
            text: sp.getElementsByTagNameNS(A, "t")[0]?.textContent,
            width: line?.getAttribute("w"),
            noFill: !!line?.getElementsByTagNameNS(A, "noFill").length,
            customDash: !!line?.getElementsByTagNameNS(A, "custDash").length,
          };
        }),
      );
      imported = await importPptx(bytes);
    }
    return { fixture, rounds, native, warnings, saved };
  });
  writeFileSync(
    info.outputPath("native-theme-style-fixture.pptx"),
    Buffer.from(result.fixture, "base64"),
  );
  result.saved.forEach((file, i) =>
    writeFileSync(
      info.outputPath(`edited-${i + 1}.pptx`),
      Buffer.from(file, "base64"),
    ),
  );
  writeFileSync(
    info.outputPath("states.json"),
    JSON.stringify(
      {
        rounds: result.rounds,
        native: result.native,
        warnings: result.warnings,
      },
      null,
      2,
    ),
  );
  expect(result.warnings).toContain(
    "도형의 패턴·그림 채우기는 가져오지 않습니다.",
  );
  for (const [index, round] of result.rounds.entries()) {
    expect(round).toHaveLength(11);
    const named = (name: string) => round.find((e) => e.text === name)!;
    expect(named("Matrix")).toMatchObject({
      type: "shape",
      fill: "#E8CBCB",
      stroke: "#2F528F",
      strokeWidth: 4,
      strokeDash: [4, 8],
      strokeCap: "round",
      fillOpacity: index === 0 ? 0.3 : 0.15,
      strokeOpacity: index === 0 ? 0.6 : 0.3,
    });
    expect(named("Partial")).toMatchObject({
      fill: "#E8CBCB",
      stroke: "#2F528F",
      strokeWidth: 6,
      strokeCap: "square",
    });
    expect(named("Partial").strokeDash).toBeUndefined();
    for (const name of ["NoFill", "ZeroRef", "FlatHidden"])
      expect(named(name)).toMatchObject({
        fill: "transparent",
        stroke: "transparent",
        strokeWidth: 0,
      });
    expect(named("ZeroWidth").strokeWidth).toBe(0);
    expect(named("ZeroWidth").stroke).toBe("#2F528F");
    expect(named("Own")).toMatchObject({
      fill: "#12AB34",
      stroke: "#FF6600",
      strokeOpacity: 0.5,
      strokeWidth: 2,
      strokeDash: [8, 6],
      strokeCap: "butt",
    });
    expect(named("Pattern").fill).toBe("#C00000");
    expect(named("Picture").fill).toBe("#C00000");
    expect(named("Flat")).toMatchObject({
      shape: "line",
      strokeWidth: 4,
      height: 1,
      strokeOpacity: 0.4,
      locked: true,
    });
    expect(named("FlatAlphaZero").stroke).toBe("transparent");
  }
  for (const round of result.native) {
    expect(round.find((e) => e.text === "Matrix")).toMatchObject({
      width: "38100",
      noFill: false,
      customDash: true,
    });
    expect(round.find((e) => e.text === "Partial")).toMatchObject({
      width: "57150",
      noFill: false,
      customDash: false,
    });
  }
});

test("public POI theme-referenced shape outlines stay visible after native editing", async ({
  page,
}, info) => {
  const file = "qa/samples/poi-shapes.pptx";
  test.skip(!existsSync(file), "Optional Apache POI public fixture.");
  const bytes = readFileSync(file),
    sourceHash = createHash("sha256").update(bytes).digest("hex");
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async (bytes) => {
    const { importPptx, exportPptx } = await import("/src/io.ts");
    let deck = (await importPptx(new Uint8Array(bytes))).deck;
    const rounds = [];
    for (let round = 0; round < 4; round++) {
      rounds.push(
        [0, 2, 5].map((index) =>
          deck.slides[index].elements
            .filter((e) => e.type === "shape")
            .map((e) => ({
              shape: e.shape,
              width: e.width,
              height: e.height,
              stroke: e.stroke,
              strokeWidth: e.strokeWidth,
            })),
        ),
      );
      if (round === 3) break;
      delete deck.pptxSources;
      for (const slide of deck.slides) {
        delete slide.pptxSource;
        for (const e of slide.elements) {
          delete e.pptxRef;
          e.x += 1;
        }
      }
      deck = (await importPptx(await exportPptx(deck))).deck;
    }
    return rounds;
  }, Array.from(bytes));
  writeFileSync(
    info.outputPath("poi-shape-outlines.json"),
    JSON.stringify({ file, sourceHash, result }, null, 2),
  );
  for (const round of result)
    for (const slide of round)
      expect(
        slide.some((e) => e.stroke !== "transparent" && e.strokeWidth! > 0),
      ).toBe(true);
});
