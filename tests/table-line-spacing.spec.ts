import { expect, test } from "@playwright/test";

test("table default line advance matches PowerPoint and preserves explicit spacing", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const { default: React } = await import(
      "/node_modules/.vite/deps/react.js"
    );
    const {
      default: { createRoot },
    } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { SlideVisual } = await import("/src/SlideCanvas.tsx");
    const deck = blankDeck();
    deck.slides[0].elements = [];
    const zip = await JSZip.loadAsync(await exportPptx(deck));
    const paragraph = (text: string, spacing = "") =>
      `<a:p><a:pPr>${spacing}<a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft></a:pPr><a:r><a:rPr lang="ko-KR" sz="1800"><a:latin typeface="Calibri"/><a:ea typeface="맑은 고딕"/></a:rPr><a:t>${text}</a:t></a:r></a:p>`;
    const cell = (paragraphs: string) =>
      `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</a:txBody><a:tcPr/></a:tc>`;
    // Native Windows PowerPoint gives two 18 pt Korean paragraphs a 21.6 pt
    // baseline advance in a 50.4 pt cell, including 3.6 pt top/bottom margins.
    const table = `<p:graphicFrame><p:xfrm><a:off x="952500" y="952500"/><a:ext cx="9525000" cy="640080"/></p:xfrm><a:graphic><a:graphicData><a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="4762500"/><a:gridCol w="2381250"/><a:gridCol w="2381250"/></a:tblGrid><a:tr h="640080">${cell(paragraph("사회복무요원, 자원봉사자") + paragraph("국가 근로 장학생"))}${cell(paragraph("비율 간격", '<a:lnSpc><a:spcPct val="150000"/></a:lnSpc>'))}${cell(paragraph("고정 간격", '<a:lnSpc><a:spcPts val="2300"/></a:lnSpc>'))}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
    const filename = "ppt/slides/slide1.xml";
    zip.file(
      filename,
      (await zip.file(filename)!.async("string")).replace(
        "</p:spTree>",
        `${table}</p:spTree>`,
      ),
    );
    const imported = (
      await importPptx(await zip.generateAsync({ type: "uint8array" }))
    ).deck;
    const roundTrip = (await importPptx(await exportPptx(imported))).deck;
    const host = document.createElement("div");
    host.id = "table-line-spacing-fixture";
    host.style.cssText = "position:fixed;inset:0;z-index:9999;background:white";
    document.body.append(host);
    createRoot(host).render(
      React.createElement(SlideVisual, {
        slide: imported.slides[0],
        width: imported.width,
        height: imported.height,
      }),
    );
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    await document.fonts.ready;
    const text = host.querySelector(".element-text")!;
    const range = document.createRange();
    range.selectNodeContents(text);
    const bounds = range.getBoundingClientRect();
    const box = text.getBoundingClientRect();
    return {
      paragraphs: imported.slides[0].elements.map((e) => e.paragraphs),
      exportedParagraphs: roundTrip.slides[0].elements.map((e) => e.paragraphs),
      bottomOverflow: bounds.bottom - box.bottom,
    };
  });
  expect(result.paragraphs[0]!.map((p) => p.lineHeight)).toEqual([1.2, 1.2]);
  expect(result.paragraphs[1]![0].lineHeight).toBeCloseTo(1.5 * 1.2);
  expect(result.paragraphs[2]![0].lineSpacing).toBeCloseTo(23 / 0.75);
  expect(result.paragraphs[2]![0].lineHeight).toBeUndefined();
  expect(result.exportedParagraphs[0]!.map((p) => p.lineHeight)).toEqual([
    1.2, 1.2,
  ]);
  expect(result.bottomOverflow).toBeLessThanOrEqual(1);
});
