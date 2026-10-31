import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

test("theme style matrix references resolve colors and transforms without mutating original XML", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { resolveTableStyleReferences } = await import(
      "/src/pptx-table-style.ts"
    );
    const { applyDrawingmlColorTransforms } = await import(
      "/src/drawingml-color.ts"
    );
    const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
    const parse = (xml: string) =>
      new DOMParser().parseFromString(
        `<a:root xmlns:a="${A}">${xml}</a:root>`,
        "application/xml",
      ).documentElement;
    const scheme = parse(
      '<a:fmtScheme><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"><a:tint val="40000"/></a:schemeClr></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"><a:shade val="50000"/></a:schemeClr></a:solidFill></a:ln></a:lnStyleLst><a:bgFillStyleLst><a:solidFill><a:srgbClr val="123456"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>',
    ).firstElementChild!;
    const style = parse(
      '<a:tblStyle><a:wholeTbl><a:tcStyle><a:fillRef idx="1"><a:srgbClr val="C00000"/></a:fillRef><a:tcBdr><a:left><a:lnRef idx="1"><a:srgbClr val="4472C4"><a:alpha val="40000"/></a:srgbClr></a:lnRef></a:left><a:right><a:lnRef idx="0"><a:srgbClr val="000000"/></a:lnRef></a:right></a:tcBdr></a:tcStyle></a:wholeTbl><a:firstRow><a:tcStyle><a:fillRef idx="1001"><a:srgbClr val="ABCDEF"/></a:fillRef></a:tcStyle></a:firstRow></a:tblStyle>',
    ).firstElementChild!;
    const read = (node: Element | undefined) => {
      const rgb =
        node?.localName === "srgbClr"
          ? node
          : Array.from(node?.children ?? []).find(
              (n) => n.localName === "srgbClr",
            );
      return rgb
        ? applyDrawingmlColorTransforms(
            "#" + rgb.getAttribute("val"),
            rgb.children,
          )
        : undefined;
    };
    const original = new XMLSerializer().serializeToString(style);
    const resolved = resolveTableStyleReferences(style, scheme, read);
    const colors = Array.from(
      resolved.getElementsByTagNameNS("*", "solidFill"),
    ).map((n) => read(n));
    return {
      colors,
      unchanged: original === new XMLSerializer().serializeToString(style),
      refs:
        resolved.getElementsByTagNameNS("*", "fillRef").length +
        resolved.getElementsByTagNameNS("*", "lnRef").length,
      lineWidth: resolved
        .getElementsByTagNameNS("*", "ln")[0]
        .getAttribute("w"),
      none: resolved.getElementsByTagNameNS("*", "noFill").length,
    };
  });
  expect(result.unchanged).toBe(true);
  expect(result.refs).toBe(0);
  expect(result.lineWidth).toBe("6350");
  expect(result.none).toBe(1);
  expect(result.colors).toEqual([
    { color: "#E8CBCB", opacity: 1 },
    { color: "#2F528F", opacity: 0.4 },
    { color: "#123456", opacity: 1 },
  ]);
});

for (const [name, slide] of [
  ["poi-table-with-theme", 0],
  ["poi-table-with-no-theme", 0],
  ["poi-table-with-different-font-colors", 1],
] as const) {
  test(`public ${name} retains theme fills, grid lines or first-column band colors`, async ({
    page,
  }, info) => {
    const filename = path.resolve("qa/samples", name + ".pptx");
    test.skip(
      !fs.existsSync(filename),
      "Download Apache POI public table fixtures.",
    );
    await page.goto("http://127.0.0.1:5190");
    const result = await page.evaluate(
      async ({ bytes, slide }) => {
        const { importPptx, exportPptx } = await import("/src/io.ts");
        const { tableCellStyle } = await import("/src/table.ts");
        let deck = (await importPptx(new Uint8Array(bytes))).deck;
        const rounds = [];
        for (let i = 0; i < 3; i++) {
          const table = deck.slides[slide].elements.find(
            (e) => e.type === "table",
          )!.table!;
          rounds.push(
            table.cells.map((row, r) =>
              row.map((text, c) => {
                const style = tableCellStyle(table, r, c);
                return {
                  text,
                  fill: style.fill,
                  color: style.color,
                  bold: style.bold,
                  italic: style.italic,
                  borders: style.borders,
                  paragraphs: style.paragraphs,
                };
              }),
            ),
          );
          // Native table content changes on every save, not just unchanged source passthrough.
          table.cells[table.cells.length - 1][0] += " ";
          deck = (await importPptx(await exportPptx(deck))).deck;
        }
        const { default: React } = await import(
          "/node_modules/.vite/deps/react.js"
        );
        const {
          default: { createRoot },
        } = await import("/node_modules/.vite/deps/react-dom_client.js");
        const { SlideVisual } = await import("/src/SlideCanvas.tsx");
        const host = document.createElement("div");
        host.id = "theme-table-fixture";
        host.style.cssText =
          "position:fixed;left:0;top:0;background:white;z-index:100000";
        document.body.append(host);
        createRoot(host).render(
          React.createElement(SlideVisual, {
            slide: deck.slides[slide],
            width: deck.width,
            height: deck.height,
            scale: 1,
          }),
        );
        await document.fonts.ready;
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        return rounds;
      },
      { bytes: [...fs.readFileSync(filename)], slide },
    );
    for (const round of result) {
      if (name === "poi-table-with-theme") {
        expect(round[0][0].fill).toBe("#4472C4");
        expect(round[0][0].color).toBe("#FFFFFF");
        expect(
          round[0][0].borders!.every(
            (b) => b.width > 0 && b.color === "#4472C4",
          ),
        ).toBe(true);
        const text = round[0][0]
          .paragraphs!.flatMap((p) => p.runs)
          .find((r) => r.text === "def");
        expect(text?.color).toBe("#FF0000");
        const body = round[1][0];
        const bodyRuns = body.paragraphs!.flatMap((p) => p.runs);
        for (const run of bodyRuns.filter((run) =>
          ["hij", "klm", "nop"].includes(run.text),
        ))
          expect(run.bold ?? body.bold, `normal body run ${run.text}`).toBe(
            false,
          );
        expect(
          bodyRuns.find((run) => run.text === "hij")?.italic ?? body.italic,
        ).toBe(true);
      } else if (name === "poi-table-with-no-theme")
        for (const row of round)
          for (const cell of row)
            expect(
              cell.borders!.every(
                (b) =>
                  Math.abs(b.width - 12700 / 9525) < 0.0001 &&
                  b.color === "#000000",
              ),
            ).toBe(true);
      else
        expect(round[0].map((cell) => cell.color)).toEqual([
          "#00FF00",
          "#777777",
          "#00FFFF",
          "#FF0000",
        ]);
    }
    await page
      .locator("#theme-table-fixture .slide-visual")
      .screenshot({ path: info.outputPath(name + ".png") });
  });
}

test("mixed table runs keep explicit normal weight, original color and paragraph-specific sizes through three edits and saves", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { createTable, createTableElement, tableCellStyle } = await import(
      "/src/table.ts"
    );
    const { inheritTableCellStyle } = await import("/src/pptx-table-style.ts");
    const { blankDeck } = await import("/src/model.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const table = createTable(1, 1);
    table.header = false;
    table.fontSize = 20;
    table.color = "#112233";
    table.padding = 0;
    table.cells = [["ABC"]];
    const native = {
      bold: true,
      fontSize: 30,
      color: "#445566",
      paragraphs: [
        {
          fontSize: 40,
          runs: [
            { text: "A", bold: false, fontSize: 20, color: "#112233" },
            { text: "B", bold: true, fontSize: 30, color: "#445566" },
            { text: "C", bold: true, fontSize: 40, color: "#445566" },
          ],
        },
      ],
    };
    const trimmed = inheritTableCellStyle(native, tableCellStyle(table, 0, 0));
    table.cellStyles = [[trimmed]];
    let deck = blankDeck();
    deck.slides[0].elements = [
      { ...createTableElement(table), width: 500, height: 150 },
    ];
    const rounds = [];
    for (let i = 0; i < 3; i++) {
      deck.slides[0].notes = `실제 수정 ${i}`;
      deck = (await importPptx(await exportPptx(deck))).deck;
      const cell = tableCellStyle(deck.slides[0].elements[0].table!, 0, 0);
      rounds.push(
        cell.paragraphs!.flatMap((p) =>
          p.runs.map((run) => ({
            text: run.text,
            bold: run.bold ?? cell.bold,
            size: run.fontSize ?? p.fontSize ?? cell.fontSize,
            color: run.color ?? cell.color,
          })),
        ),
      );
    }
    return { trimmed, rounds };
  });
  expect(result.trimmed.paragraphs![0].runs[0]).toMatchObject({
    bold: false,
    fontSize: 20,
    color: "#112233",
  });
  for (const round of result.rounds)
    expect(round).toEqual([
      { text: "A", bold: false, size: 20, color: "#112233" },
      { text: "B", bold: true, size: 30, color: "#445566" },
      { text: "C", bold: true, size: 40, color: "#445566" },
    ]);
});
