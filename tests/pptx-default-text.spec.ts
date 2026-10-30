import { test, expect } from "@playwright/test";
const cases = [
  { name: "empty text effect lists", xml: "<a:effectLst/>", loss: false },
  {
    name: "explicit no-fill text outline",
    xml: "<a:ln><a:noFill/></a:ln>",
    loss: false,
  },
  {
    name: "fully transparent text outline",
    xml: '<a:ln><a:solidFill><a:srgbClr val="FF0000"><a:alpha val="0"/></a:srgbClr></a:solidFill></a:ln>',
    loss: false,
  },
  {
    name: "visible semitransparent text outline",
    xml: '<a:ln><a:solidFill><a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr></a:solidFill></a:ln>',
    loss: true,
  },
  {
    name: "real text shadow",
    xml: '<a:effectLst><a:outerShdw blurRad="40000" dist="40000" dir="0"><a:srgbClr val="000000"/></a:outerShdw></a:effectLst>',
    loss: true,
  },
];
for (const scenario of cases)
  test(`editing ordinary PowerPoint text distinguishes ${scenario.name} from actual formatting loss`, async ({
    page,
  }, info) => {
    await page.goto("http://127.0.0.1:5190");
    const result = await page.evaluate(async (scenario) => {
      const { blankDeck, element } = await import("/src/model.ts"),
        { importPptx, exportPptx } = await import("/src/io.ts"),
        { editText } = await import("/src/text-layout.ts"),
        { default: JSZip } = await import("/node_modules/.vite/deps/jszip.js");
      const d = blankDeck();
      d.slides[0].elements = [
        element("text", {
          text: "PowerPoint title",
          x: 80,
          y: 100,
          width: 700,
          height: 120,
        }),
      ];
      const zip = await JSZip.loadAsync(await exportPptx(d)),
        part = "ppt/slides/slide1.xml";
      const doc = new DOMParser().parseFromString(
          await zip.file(part)!.async("string"),
          "application/xml",
        ),
        A = "http://schemas.openxmlformats.org/drawingml/2006/main";
      const run = doc.getElementsByTagNameNS(A, "rPr")[0];
      if (!run) throw Error("Text run missing");
      for (const old of [...run.children].filter((n) =>
        ["ln", "effectLst", "effectDag"].includes(n.localName),
      ))
        old.remove();
      const additions = new DOMParser().parseFromString(
        `<a:root xmlns:a="${A}">${scenario.xml}</a:root>`,
        "application/xml",
      );
      for (const node of [...additions.documentElement.children])
        run.insertBefore(doc.importNode(node, true), run.firstChild);
      zip.file(part, new XMLSerializer().serializeToString(doc));
      let deck = (
        await importPptx(await zip.generateAsync({ type: "uint8array" }))
      ).deck;
      const before: string[] = [];
      await exportPptx(deck, { onWarning: (m) => before.push(m) });
      Object.assign(
        deck.slides[0].elements[0],
        editText(deck.slides[0].elements[0], "Edited PowerPoint title"),
      );
      const after: string[] = [];
      const bytes = await exportPptx(deck, { onWarning: (m) => after.push(m) });
      const reopened = (await importPptx(bytes)).deck;
      return { before, after, text: reopened.slides[0].elements[0].text };
    }, scenario);
    expect(result.before).toEqual([]);
    expect(result.text).toBe("Edited PowerPoint title");
    if (scenario.loss) expect(result.after.join("\n")).toContain("원본 서식");
    else expect(result.after).toEqual([]);
  });
