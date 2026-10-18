import { test, expect } from "@playwright/test";

test("placeholder inheritance distinguishes missing indices by type and keeps footer styles", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const d = blankDeck();
    d.slides[0].elements = [];
    const zip = await JSZip.loadAsync(await exportPptx(d));
    const shape = (
      id: number,
      type: string,
      text: string,
      x?: number,
      size?: number,
    ) =>
      `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${type}"/><p:cNvSpPr txBox="1"/><p:nvPr><p:ph type="${type}"/></p:nvPr></p:nvSpPr><p:spPr>${x === undefined ? "" : `<a:xfrm><a:off x="${x * 9525}" y="952500"/><a:ext cx="3810000" cy="952500"/></a:xfrm>`}</p:spPr><p:txBody><a:bodyPr lIns="0" rIns="0" tIns="0" bIns="0"/><a:lstStyle/><a:p>${size ? `<a:pPr><a:defRPr sz="${size}"/></a:pPr>` : ""}<a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
    const replace = (xml: string, shapes: string) =>
      xml.replace(
        /<p:spTree[\s\S]*?<\/p:spTree>/,
        `<p:spTree>${shapes}</p:spTree>`,
      );
    const layout = "ppt/slideLayouts/slideLayout1.xml";
    zip.file(
      layout,
      replace(
        await zip.file(layout)!.async("string"),
        shape(11, "dt", "", 900, 1000) + shape(12, "title", "", 100, 3600),
      ),
    );
    const master = "ppt/slideMasters/slideMaster1.xml";
    let m = replace(await zip.file(master)!.async("string"), "");
    m = m.replace(/<p:txStyles[\s\S]*?<\/p:txStyles>/, "");
    zip.file(
      master,
      m.replace(
        "</p:sldMaster>",
        '<p:txStyles><p:bodyStyle><a:lvl1pPr><a:defRPr sz="4200"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1200"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>',
      ),
    );
    const path = "ppt/slides/slide1.xml";
    zip.file(
      path,
      replace(
        await zip.file(path)!.async("string"),
        shape(1, "title", "Title") + shape(2, "dt", "Date", 900),
      ),
    );
    return (
      await importPptx(await zip.generateAsync({ type: "uint8array" }))
    ).deck.slides[0].elements.map((e) => ({
      text: e.text,
      x: e.x,
      size: e.fontSize,
    }));
  });
  expect(result.find((e) => e.text === "Title")).toMatchObject({
    x: 100,
    size: 48,
  });
  expect(result.find((e) => e.text === "Date")).toMatchObject({
    x: 900,
    size: 1000 / 75,
  });
});

test("PPTX round trips preserve locking, automatic height, box insets, asymmetric borders, flips and line centers", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const results = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    let d = blankDeck();
    d.slides[0].elements = [
      element("text", {
        text: "Keep this box",
        x: 100,
        y: 80,
        width: 400,
        height: 130,
        locked: true,
        autoHeight: true,
        textInsets: [8, 12, 6, 20],
        borders: [
          { color: "#FF0000", width: 1 },
          { color: "#00FF00", width: 2 },
          { color: "#0000FF", width: 3 },
          { color: "transparent", width: 0 },
        ],
      }),
      element("shape", {
        shape: "triangle",
        x: 600,
        y: 100,
        width: 100,
        height: 70,
        flipV: true,
        flipH: true,
      }),
      element("shape", {
        shape: "line",
        x: 100,
        y: 400,
        width: 300,
        height: 1,
        rotation: 31,
        stroke: "#112233",
        strokeWidth: 2,
      }),
    ];
    const states = [];
    for (let i = 0; i < 3; i++) {
      states.push(
        d.slides[0].elements.map((e) => ({
          type: e.type,
          shape: e.shape,
          text: e.text,
          x: e.x,
          y: e.y,
          width: e.width,
          height: e.height,
          rotation: e.rotation,
          flipH: e.flipH,
          flipV: e.flipV,
          autoHeight: e.autoHeight,
          locked: e.locked,
          textInsets: e.textInsets,
          borders: e.borders,
        })),
      );
      d = (await importPptx(await exportPptx(d))).deck;
    }
    return states;
  });
  for (const state of results.slice(1)) {
    expect(state).toHaveLength(3);
    for (const key of ["x", "y", "width", "height", "rotation"] as const)
      for (let i = 0; i < 3; i++)
        expect(state[i][key]).toBeCloseTo(results[0][i][key], 3);
    expect(state[0]).toMatchObject({
      locked: true,
      autoHeight: true,
      textInsets: [8, 12, 6, 20],
      borders: results[0][0].borders,
    });
    expect(state[1]).toMatchObject({ flipV: true, flipH: true });
  }
});

test("zero-indent bullets stay native bullets and multi-character numbers export as automatic numbering", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const r = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const d = blankDeck();
    d.slides[0].elements = [
      element("text", {
        text: "• Zero\n10. Ten",
        paragraphs: [
          { bulletPrefix: "• ", indent: 0, runs: [{ text: "• Zero" }] },
          {
            bulletPrefix: "10. ",
            indent: -24,
            marginLeft: 24,
            runs: [{ text: "10. Ten" }],
          },
        ],
      }),
    ];
    const bytes = await exportPptx(d),
      zip = await JSZip.loadAsync(bytes);
    const xml = new DOMParser().parseFromString(
      await zip.file("ppt/slides/slide1.xml")!.async("string"),
      "application/xml",
    );
    return {
      chars: [...xml.getElementsByTagNameNS("*", "buChar")].map((n) =>
        n.getAttribute("char"),
      ),
      auto: [...xml.getElementsByTagNameNS("*", "buAutoNum")].map((n) => [
        n.getAttribute("type"),
        n.getAttribute("startAt"),
      ]),
      text: (await importPptx(bytes)).deck.slides[0].elements[0].text,
    };
  });
  expect(r.chars).toEqual(["•"]);
  expect(r.auto).toEqual([["arabicPeriod", "10"]]);
  expect(r.text).toBe("• Zero\n10. Ten");
});

test("rotated elliptical paths export without failing the deck and preserve their rendered curve", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const errors = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const d = blankDeck();
    const paths = [0, 1].flatMap((large) =>
      [0, 1].map(
        (sweep) =>
          `M 10000 20000 A 40000 15000 37 ${large} ${sweep} 80000 70000`,
      ),
    );
    d.slides[0].elements = paths.map((path) =>
      element("shape", {
        shape: "custom",
        x: 0,
        y: 0,
        width: 400,
        height: 400,
        paths: [
          { d: path, width: 100000, height: 100000, fill: false, stroke: true },
        ],
        stroke: "#112233",
        strokeWidth: 2,
      }),
    );
    const round = (await importPptx(await exportPptx(d))).deck;
    const path = (data: string) => {
      const node = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      node.setAttribute("d", data);
      return node;
    };
    return paths.map((data, i) => {
      const a = path(data),
        b = path(round.slides[0].elements[i].paths![0].d);
      let max = 0;
      for (let t = 0; t <= 20; t++) {
        const p = a.getPointAtLength((a.getTotalLength() * t) / 20),
          q = b.getPointAtLength((b.getTotalLength() * t) / 20);
        max = Math.max(max, (Math.hypot(p.x - q.x, p.y - q.y) * 400) / 100000);
      }
      return max;
    });
  });
  expect(errors).toHaveLength(4);
  for (const error of errors) expect(error).toBeLessThan(0.1);
});
