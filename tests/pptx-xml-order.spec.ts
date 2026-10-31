import { expect, test } from "@playwright/test";
import fs from "node:fs";

test("fresh native tables keep schema-valid border/fill order, transparent cells and notes through three saves", async ({ page }, info) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck, newSlide } = await import("/src/model.ts");
    const { createTable, createTableElement, tableCellStyle } = await import("/src/table.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const { default: JSZip } = await import("/node_modules/.vite/deps/jszip.js");
    const data = createTable(2, 2);
    data.header = false;
    data.striped = false;
    data.cells = [["대각선과 채우기", "채우기 없음"], ["Alpha Beta", "123"]];
    const borders = [1, 2, 3, 4].map(width => ({ width, color: "#123456", opacity: 0.75 }));
    data.cellStyles = [[
      { fill: "#AA8833", borders, diagonalBorders: { tlToBr: { width: 2, color: "#BB2244", opacity: 0.5 } } },
      { fill: "transparent", borders },
    ], [null, null]];
    let deck = blankDeck();
    deck.slides[0].elements = [createTableElement(data)];
    deck.slides[0].notes = "발표자 노트 원문";
    deck.slides.push(newSlide(), newSlide());
    const rounds = [];
    let bytes = new Uint8Array();
    for (let round = 0; round < 3; round++) {
      // Exercise reconstruction every time, rather than letting source XML
      // preservation conceal an invalid generated table.
      delete deck.pptxSources;
      for (const slide of deck.slides) {
        delete slide.pptxSource;
        for (const element of slide.elements) delete element.pptxRef;
      }
      bytes = await exportPptx(deck);
      const zip = await JSZip.loadAsync(bytes);
      const parse = (s: string) => new DOMParser().parseFromString(s, "application/xml");
      const contentTypes = parse(await zip.file("[Content_Types].xml")!.async("string"));
      const missingParts = [...contentTypes.getElementsByTagNameNS("*", "Override")]
        .map(node => node.getAttribute("PartName")!.replace(/^\//, ""))
        .filter(path => !zip.file(path));
      const p = parse(await zip.file("ppt/presentation.xml")!.async("string"));
      const slide = parse(await zip.file("ppt/slides/slide1.xml")!.async("string"));
      const props = [...slide.getElementsByTagNameNS("*", "tcPr")];
      const order = props.map(cp => [...cp.children].map(n => n.localName));
      // Inspect native XML again without private Studio table metadata.
      for (const marker of [...slide.getElementsByTagNameNS("urn:slide-studio:table:v1", "table")]) marker.remove();
      zip.file("ppt/slides/slide1.xml", new XMLSerializer().serializeToString(slide));
      deck = (await importPptx(await zip.generateAsync({ type: "uint8array" }))).deck;
      const table = deck.slides[0].elements.find(e => e.type === "table")!.table!;
      rounds.push({
        presentation: [...p.documentElement.children].map(n => n.localName),
        order, cells: table.cells, note: deck.slides[0].notes,
        missingParts, slideCount: deck.slides.length,
        first: tableCellStyle(table, 0, 0), second: tableCellStyle(table, 0, 1),
      });
    }
    return { rounds, bytes: Array.from(bytes) };
  });
  for (const round of result.rounds) {
    expect(round.presentation.indexOf("notesMasterIdLst")).toBeGreaterThan(round.presentation.indexOf("sldMasterIdLst"));
    // Keep the generator's PowerPoint-tested order. Moving this list ahead of
    // sldIdLst alone made otherwise identical native files require web repair.
    expect(round.presentation.indexOf("notesMasterIdLst")).toBeGreaterThan(round.presentation.indexOf("sldIdLst"));
    expect(round.presentation.indexOf("notesMasterIdLst")).toBeLessThan(round.presentation.indexOf("sldSz"));
    expect(round.missingParts).toEqual([]);
    expect(round.slideCount).toBe(3);
    // ECMA-376 CT_TableCellProperties: L,R,T,B,diagonals,cell3D,fill,headers,extLst.
    expect(round.order[0]).toEqual(["lnL", "lnR", "lnT", "lnB", "lnTlToBr", "solidFill"]);
    expect(round.order[1]).toEqual(["lnL", "lnR", "lnT", "lnB", "noFill"]);
    expect(round.cells).toEqual([["대각선과 채우기", "채우기 없음"], ["Alpha Beta", "123"]]);
    expect(round.note).toContain("발표자 노트 원문");
    expect(round.first.fill).toBe("#AA8833");
    expect(round.first.borders?.map(b => b.width)).toEqual([1, 2, 3, 4]);
    expect(round.first.diagonalBorders?.tlToBr).toMatchObject({ width: 2, color: "#BB2244", opacity: 0.5 });
    expect(round.second.fill).toBe("transparent");
  }
  fs.writeFileSync(info.outputPath("ordered-native-table.pptx"), Buffer.from(result.bytes));
});
