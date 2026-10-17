import { test, expect } from "@playwright/test";

test("inherited hanging punctuation prevents a spurious last line without changing text or alignment", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { default: React } = await import(
      "/node_modules/.vite/deps/react.js"
    );
    const {
      default: { createRoot },
    } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { ElementVisual } = await import("/src/SlideCanvas.tsx");
    const { blankDeck, element } = await import("/src/model.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const text = "새로운 내용을 차례대로 정리합니다.";
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.font = '20px "Malgun Gothic"';
    ctx.fontKerning = "none";
    const width = ctx.measureText(text).width - 0.5;
    const deck = blankDeck();
    deck.slides[0].elements = [];
    const zip = await JSZip.loadAsync(await exportPptx(deck));
    const shape = `<p:sp><p:nvSpPr><p:cNvPr id="77" name="Hanging text"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(width * 9525)}" cy="1905000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr lIns="0" rIns="0" tIns="0" bIns="0"/><a:lstStyle><a:lvl1pPr hangingPunct="1" eaLnBrk="1"/></a:lstStyle><a:p><a:pPr><a:lnSpc><a:spcPts val="1800"/></a:lnSpc></a:pPr><a:r><a:rPr sz="1500"><a:latin typeface="Malgun Gothic"/><a:ea typeface="Malgun Gothic"/></a:rPr><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
    const name = "ppt/slides/slide1.xml";
    zip.file(
      name,
      (await zip.file(name)!.async("string")).replace(
        "</p:spTree>",
        shape + "</p:spTree>",
      ),
    );
    const imported = (
      await importPptx(await zip.generateAsync({ type: "uint8array" }))
    ).deck;
    const base = imported.slides[0].elements[0];
    const roundTrip = (await importPptx(await exportPptx(imported))).deck
      .slides[0].elements[0];
    const host = document.createElement("div");
    host.style.cssText =
      "position:fixed;inset:0;background:white;z-index:9999;";
    document.body.append(host);
    const variants = [
      { id: "hang", width, hanging: true, align: "left" },
      { id: "disabled", width, hanging: false, align: "left" },
      { id: "fits", width: width + 80, hanging: true, align: "right" },
      { id: "fits-control", width: width + 80, hanging: false, align: "right" },
    ];
    createRoot(host).render(
      React.createElement(
        React.Fragment,
        {},
        ...variants.map((v) =>
          React.createElement(
            "div",
            { id: v.id, key: v.id, style: { width: v.width, height: 100 } },
            React.createElement(ElementVisual, {
              element: {
                ...base,
                width: v.width,
                align: v.align,
                paragraphs: [
                  {
                    ...base.paragraphs![0],
                    align: v.align,
                    hangingPunctuation: v.hanging,
                  },
                ],
              },
            }),
          ),
        ),
      ),
    );
    await new Promise((r) => setTimeout(r, 100));
    const metrics = variants.map((v) => {
      const root = document.getElementById(v.id)!;
      const line = root.querySelector("[data-text-line]")!;
      const range = document.createRange();
      range.selectNodeContents(line);
      return {
        text: line.textContent,
        height: line.getBoundingClientRect().height,
        left: range.getBoundingClientRect().left,
        hanging:
          root.querySelector<HTMLElement>("[data-hanging-punctuation]")?.style
            .width || "",
      };
    });
    const resizable = document.getElementById("hang")!;
    const stop = resizable.querySelector<HTMLElement>(
      "[data-hanging-punctuation]",
    )!;
    resizable.style.width = `${width + 80}px`;
    await new Promise((r) => setTimeout(r, 80));
    const widened = stop.style.width;
    resizable.style.width = `${width}px`;
    await new Promise((r) => setTimeout(r, 80));
    const narrowed = stop.style.width;
    return {
      metrics,
      widened,
      narrowed,
      inherited: base.paragraphs![0].hangingPunctuation,
      restored: roundTrip.paragraphs![0].hangingPunctuation,
      text,
    };
  });
  expect(result.inherited).toBe(true);
  expect(result.restored).toBe(true);
  expect(result.widened).toBe("");
  expect(result.narrowed).toBe("0px");
  expect(result.metrics[0].height).toBe(24);
  expect(result.metrics[1].height).toBe(48);
  expect(result.metrics[0].hanging).toBe("0px");
  expect(result.metrics[2].hanging).toBe("");
  expect(result.metrics[2].left).toBeCloseTo(result.metrics[3].left, 2);
  for (const item of result.metrics) expect(item.text).toBe(result.text);
});
