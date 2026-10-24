import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const cases = [
  {
    name: "all zero rows",
    rows: [0, 0, 0],
    frame: 120,
    expected: [40, 40, 40],
  },
  {
    name: "all zero rows with Studio metadata",
    rows: [0, 0, 0],
    frame: 120,
    metadata: true,
    expected: [40, 40, 40],
  },
  {
    name: "mixed explicit and zero rows",
    rows: [32, 0, 32],
    frame: 96,
    expected: [32, 32, 32],
  },
  {
    name: "wrapped Korean text expands a small frame",
    rows: [32, 0, 32],
    frame: 72,
    long: true,
    narrow: true,
  },
  {
    name: "wrapped text with Studio metadata",
    rows: [32, 0, 32],
    frame: 72,
    long: true,
    narrow: true,
    metadata: true,
  },
  { name: "zero frame and zero rows", rows: [0, 0, 0], frame: 0, long: true },
  {
    name: "merged cell across automatic rows",
    rows: [0, 0, 32],
    frame: 48,
    long: true,
    narrow: true,
    merged: true,
  },
  {
    name: "empty automatic cells",
    rows: [0, 0, 0],
    frame: 120,
    empty: true,
    expected: [40, 40, 40],
  },
  {
    name: "automatic rows in a scaled group",
    rows: [32, 0, 32],
    frame: 96,
    scaleY: 1.5,
    expected: [48, 48, 48],
  },
  {
    name: "tall styled cell in another column",
    rows: [0, 0, 0],
    frame: 60,
    styled: true,
  },
  {
    name: "merged cell grows only its automatic row",
    rows: [32, 0, 32],
    frame: 48,
    long: true,
    narrow: true,
    merged: true,
  },
  {
    name: "negative row heights remain invalid",
    rows: [32, -1, 32],
    frame: 96,
    invalid: true,
  },
  {
    name: "positive rows grow for wrapped Korean text",
    rows: [32, 32, 32],
    frame: 96,
    long: true,
    narrow: true,
    grow: true,
  },
  {
    name: "positive rows with Studio metadata wrap at the cell width",
    rows: [32, 32, 32],
    frame: 96,
    long: true,
    narrow: true,
    grow: true,
    metadata: true,
    shortcut: true,
  },
  {
    name: "positive rows use spare frame height before expanding",
    rows: [32, 32, 32],
    frame: 600,
    long: true,
    narrow: true,
    grow: true,
    keepFrame: true,
  },
  {
    name: "positive rows account for larger font and padding",
    rows: [32, 32, 32],
    frame: 96,
    long: true,
    widthPt: 144,
    fontPt: 24,
    paddingPt: 12,
    grow: true,
  },
  {
    name: "positive rows account for a tall styled cell in another column",
    rows: [32, 32, 32],
    frame: 96,
    styled: true,
    grow: true,
  },
  {
    name: "merged cell can grow positive rows",
    rows: [32, 32, 32],
    frame: 96,
    long: true,
    narrow: true,
    merged: true,
    grow: true,
  },
];

for (const scenario of cases) {
  test(`PPTX automatic table rows: ${scenario.name}`, async ({
    page,
  }, testInfo) => {
    await page.goto("http://127.0.0.1:5190");
    const result = await page.evaluate(async (scenario) => {
      const { blankDeck } = await import("/src/model.ts");
      const { createTable, createTableElement, tableSizes, tableCellStyle } =
        await import("/src/table.ts");
      const { exportPptx, importPptx, parseDeckJson, serializeDeck } =
        await import("/src/io.ts");
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
      const long =
        "긴 한글 문장은 좁은 셀 너비에 맞추어 여러 줄로 자동 줄바꿈되어야 합니다.\n두 번째 문단도 온전히 보여야 합니다.";
      const texts = scenario.rows.map((_, r) =>
        scenario.empty
          ? ""
          : scenario.long && r === (scenario.merged ? 0 : 1)
            ? long
            : `한글 ${r + 1}행`,
      );
      const data = createTable(scenario.rows.length, 1);
      Object.assign(data, {
        header: false,
        striped: false,
        autoRows: false,
        borderWidth: 0,
        fontSize: (scenario.fontPt ?? 18) / 0.75,
        padding: (scenario.paddingPt ?? 3.6) / 0.75,
        verticalAlign: "top",
        cells: texts.map((text) => [text]),
        rowHeights: scenario.rows.map(() => 1),
      });
      if (scenario.styled) {
        data.cells = data.cells.map((row) => [...row, "추가 셀"]);
        data.cells[0][1] = "큰 글꼴\n두 번째 줄";
        data.cellStyles = [
          [null, { fontSize: 32 / 0.75, padding: 10 / 0.75 }],
          [null, null],
          [null, null],
        ];
      }
      if (scenario.merged) {
        data.merges = [{ row: 0, column: 0, rowSpan: 2, columnSpan: 1 }];
        texts[1] = data.cells[1][0] = "";
      }
      const deck = blankDeck();
      deck.slides[0].elements = [
        {
          ...createTableElement(data),
          x: 48,
          y: 48,
          width: (scenario.widthPt ?? (scenario.narrow ? 72 : 288)) / 0.75,
          height: 120 / 0.75,
          opacity: scenario.metadata ? 0.65 : 1,
        },
      ];
      const zip = await JSZip.loadAsync(await exportPptx(deck));
      const filename = "ppt/slides/slide1.xml";
      const xml = new DOMParser().parseFromString(
        await zip.file(filename)!.async("string"),
        "application/xml",
      );
      const frame = xml.getElementsByTagNameNS("*", "graphicFrame")[0];
      const xfrm = Array.from(frame.children).find(
        (n) => n.localName === "xfrm",
      )!;
      xfrm
        .getElementsByTagNameNS("*", "ext")[0]
        .setAttribute("cy", String(scenario.frame * 12700));
      Array.from(frame.getElementsByTagNameNS("*", "tr")).forEach((row, r) =>
        row.setAttribute("h", String(scenario.rows[r] * 12700)),
      );
      if (!scenario.metadata)
        for (const marker of Array.from(
          xml.getElementsByTagNameNS("urn:slide-studio:table:v1", "table"),
        ))
          marker.parentElement?.remove();
      if (scenario.scaleY) {
        const group = xml.createElementNS(
          "http://schemas.openxmlformats.org/presentationml/2006/main",
          "p:grpSp",
        );
        frame.replaceWith(group);
        group.innerHTML = `<p:nvGrpSpPr><p:cNvPr id="99" name="Scaled table"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="6096000" cy="${3429000 * scenario.scaleY}"/><a:chOff x="0" y="0"/><a:chExt cx="6096000" cy="3429000"/></a:xfrm></p:grpSpPr>`;
        group.append(frame);
      }
      zip.file(filename, new XMLSerializer().serializeToString(xml));
      const fixture = await zip.generateAsync({ type: "uint8array" });
      const imported = await importPptx(fixture);
      if (!imported.deck.slides[0].elements.some((el) => el.table))
        return {
          missing: true,
          warnings: imported.warnings,
          fixture: Array.from(fixture),
        };
      const project = parseDeckJson(serializeDeck(imported.deck));
      const roundTrip = await importPptx(await exportPptx(project));
      const summarize = (value: typeof deck) => {
        const el = value.slides[0].elements.find((el) => el.table)!;
        const style = tableCellStyle(el.table!, 0, 0);
        return {
          heightPt: el.height * 0.75,
          rowsPt: tableSizes(
            el.table!.rowHeights,
            scenario.rows.length,
            el.height,
          ).map((h) => h * 0.75),
          cells: el.table!.cells,
          opacity:
            el.opacity *
            (style.paragraphs?.[0]?.runs[0]?.opacity ?? style.textOpacity ?? 1),
          merges: el.table!.merges ?? [],
          cellStyleOverrides: !!el.table!.cellStyles,
        };
      };
      const host = document.createElement("div");
      host.style.cssText =
        "position:fixed;inset:0;background:white;z-index:9999";
      document.body.append(host);
      createRoot(host).render(
        React.createElement(SlideVisual, {
          slide: imported.deck.slides[0],
          width: deck.width,
          height: deck.height,
        }),
      );
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      await document.fonts.ready;
      const overflow = Array.from(
        host.querySelectorAll(".table-cell-text"),
      ).map((text) => {
        const range = document.createRange();
        range.selectNodeContents(text);
        const box = text.parentElement!.getBoundingClientRect(),
          content = range.getBoundingClientRect();
        return text.textContent
          ? Math.max(box.top - content.top, content.bottom - box.bottom)
          : 0;
      });
      return {
        missing: false,
        fixture: Array.from(fixture),
        texts,
        cells: data.cells,
        imported: summarize(imported.deck),
        project: summarize(project),
        roundTrip: summarize(roundTrip.deck),
        overflow,
        warnings: [...imported.warnings, ...roundTrip.warnings],
      };
    }, scenario);
    await writeFile(
      testInfo.outputPath("input.pptx"),
      Buffer.from(result.fixture),
    );
    if (scenario.invalid) {
      expect(result.missing).toBe(true);
      expect(result.warnings).toContain("표의 행·열 크기를 읽을 수 없습니다.");
      return;
    }
    expect(result.missing, result.warnings.join("\n")).toBe(false);
    if (result.missing) return;
    for (const value of [
      result.imported!,
      result.project!,
      result.roundTrip!,
    ]) {
      expect(value.cells).toEqual(result.cells);
      expect(value.opacity).toBeCloseTo(scenario.metadata ? 0.65 : 1);
      expect(value.heightPt).toBeGreaterThanOrEqual(
        scenario.frame * (scenario.scaleY ?? 1),
      );
      expect(value.rowsPt.reduce((a, b) => a + b, 0)).toBeCloseTo(
        value.heightPt,
      );
      value.rowsPt.forEach((height, r) => {
        expect(Number.isFinite(height)).toBe(true);
        expect(height).toBeGreaterThan(0);
        if (scenario.expected)
          expect(height).toBeCloseTo(scenario.expected[r], 2);
        else if (scenario.rows[r]) {
          const saved = scenario.rows[r] * (scenario.scaleY ?? 1);
          if (scenario.grow) expect(height).toBeGreaterThanOrEqual(saved);
          else expect(height).toBeCloseTo(saved);
        }
      });
      if (scenario.keepFrame)
        expect(value.heightPt).toBeCloseTo(scenario.frame, 2);
      else if (scenario.long)
        expect(value.heightPt).toBeGreaterThan(scenario.frame);
      if (scenario.merged)
        expect(value.merges).toEqual([
          { row: 0, column: 0, rowSpan: 2, columnSpan: 1 },
        ]);
    }
    expect(result.roundTrip!.heightPt).toBeCloseTo(
      result.imported!.heightPt,
      2,
    );
    if (scenario.shortcut)
      expect(result.imported!.cellStyleOverrides).toBe(false);
    result.overflow!.forEach((value) => expect(value).toBeLessThanOrEqual(1));
    expect(result.warnings).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("automatic-table-rows.png"),
    });
  });
}
