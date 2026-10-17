import { expect, test } from "@playwright/test";
import fs from "node:fs";

test("free text uses presentation defaults while placeholders keep master styles", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const deck = blankDeck();
    deck.slides[0].elements = [];
    const zip = await JSZip.loadAsync(await exportPptx(deck));
    const style = (name: string, size: number) =>
      `<p:${name}><a:lvl1pPr><a:defRPr sz="${size}"/></a:lvl1pPr></p:${name}>`;
    const masterPath = "ppt/slideMasters/slideMaster1.xml";
    const master = new DOMParser().parseFromString(
      await zip.file(masterPath).async("string"),
      "application/xml",
    );
    for (const node of [...master.getElementsByTagNameNS("*", "sp")])
      node.remove();
    for (const node of [...master.getElementsByTagNameNS("*", "txStyles")])
      node.remove();
    zip.file(
      masterPath,
      new XMLSerializer()
        .serializeToString(master)
        .replace(
          "</p:sldMaster>",
          `<p:txStyles>${style("titleStyle", 4000)}${style("bodyStyle", 2800)}${style("otherStyle", 1800)}</p:txStyles></p:sldMaster>`,
        ),
    );
    const presentationPath = "ppt/presentation.xml";
    const presentation = new DOMParser().parseFromString(
      await zip.file(presentationPath).async("string"),
      "application/xml",
    );
    for (const node of [
      ...presentation.getElementsByTagNameNS("*", "defaultTextStyle"),
    ])
      node.remove();
    zip.file(
      presentationPath,
      new XMLSerializer()
        .serializeToString(presentation)
        .replace(
          "</p:presentation>",
          `${style("defaultTextStyle", 3600)}</p:presentation>`,
        ),
    );
    const shape = (id: number, text: string, ph = "", run = "", list = "") =>
      `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${text}"/><p:cNvSpPr txBox="1"/><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="952500" y="${id * 800000}"/><a:ext cx="5715000" cy="600000"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr><p:txBody><a:bodyPr lIns="0" tIns="0" rIns="0" bIns="0"/><a:lstStyle>${list}</a:lstStyle><a:p><a:r>${run}<a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
    const path = "ppt/slides/slide1.xml";
    zip.file(
      path,
      (await zip.file(path).async("string")).replace(
        "</p:spTree>",
        shape(1, "free") +
          shape(2, "explicit", "", '<a:rPr sz="2400"/>') +
          shape(3, "title", '<p:ph type="title" idx="77"/>') +
          shape(4, "body", '<p:ph type="body" idx="78"/>') +
          shape(
            5,
            "list",
            "",
            "",
            '<a:lvl1pPr><a:defRPr sz="2000"/></a:lvl1pPr>',
          ) +
          "</p:spTree>",
      ),
    );
    const imported = (
      await importPptx(await zip.generateAsync({ type: "uint8array" }))
    ).deck;
    const roundtrip = (await importPptx(await exportPptx(imported))).deck;
    const sizes = (d: typeof imported) =>
      Object.fromEntries(
        d.slides[0].elements
          .filter((e) => e.type === "text")
          .map((e) => [e.text, e.fontSize]),
      );
    return { imported: sizes(imported), roundtrip: sizes(roundtrip) };
  });
  expect(result.imported.free).toBe(48);
  expect(result.imported.explicit).toBe(32);
  expect(result.imported.title).toBeCloseTo(4000 / 75);
  expect(result.imported.body).toBeCloseTo(2800 / 75);
  expect(result.imported.list).toBeCloseTo(2000 / 75);
  expect(result.roundtrip).toEqual(result.imported);
});

test("nested group reflections and rotations move centers and directed connector endpoints", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const deck = blankDeck();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    deck.slides[0].elements = [
      {
        id: "image-probe",
        type: "image",
        x: 10,
        y: 70,
        width: 20,
        height: 10,
        rotation: 0,
        opacity: 1,
        src: canvas.toDataURL(),
        flipV: true,
      },
    ];
    const zip = await JSZip.loadAsync(await exportPptx(deck));
    const path = "ppt/slides/slide1.xml";
    let xml = await zip.file(path).async("string");
    const picture = xml.match(/<p:pic\b[\s\S]*?<\/p:pic>/)![0];
    xml = xml.replace(picture, "");
    const xf = (x: number, y: number, w: number, h: number, attrs = "") =>
      `<a:xfrm ${attrs}><a:off x="${x * 9525}" y="${y * 9525}"/><a:ext cx="${w * 9525}" cy="${h * 9525}"/></a:xfrm>`;
    const line = (id: number, attrs = "") =>
      `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="line-${id}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xf(20, 10, 60, 30, attrs)}<a:prstGeom prst="line"/><a:ln><a:solidFill><a:srgbClr val="112233"/></a:solidFill><a:tailEnd type="triangle"/></a:ln></p:spPr></p:cxnSp>`;
    const shape = (
      id: number,
      preset: string,
      x: number,
      y: number,
      w: number,
      h: number,
      text = "",
    ) =>
      `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="shape-${id}"/><p:cNvSpPr ${text ? 'txBox="1"' : ""}/><p:nvPr/></p:nvSpPr><p:spPr>${xf(x, y, w, h)}<a:prstGeom prst="${preset}"/><a:solidFill><a:srgbClr val="445566"/></a:solidFill></p:spPr>${text ? `<p:txBody><a:bodyPr lIns="0" tIns="0" rIns="0" bIns="0"/><a:p><a:r><a:rPr sz="1500"/><a:t>${text}</a:t></a:r></a:p></p:txBody>` : ""}</p:sp>`;
    const group = (
      id: number,
      attrs: string,
      off: number[],
      ext: number[],
      childOff: number[],
      childExt: number[],
      content: string,
    ) =>
      `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="group-${id}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm ${attrs}><a:off x="${off[0] * 9525}" y="${off[1] * 9525}"/><a:ext cx="${ext[0] * 9525}" cy="${ext[1] * 9525}"/><a:chOff x="${childOff[0] * 9525}" y="${childOff[1] * 9525}"/><a:chExt cx="${childExt[0] * 9525}" cy="${childExt[1] * 9525}"/></a:xfrm></p:grpSpPr>${content}</p:grpSp>`;
    const content =
      group(
        100,
        'flipV="1"',
        [100, 100],
        [200, 100],
        [0, 0],
        [200, 100],
        line(101, 'flipH="1" flipV="1"') +
          shape(102, "rect", 100, 10, 80, 20, "readable") +
          picture +
          shape(103, "rightArrow", 20, 50, 40, 20),
      ) +
      group(
        200,
        'rot="5400000"',
        [400, 100],
        [100, 100],
        [0, 0],
        [100, 100],
        shape(201, "rect", 10, 20, 20, 10),
      ) +
      group(
        300,
        'flipH="1"',
        [100, 300],
        [200, 200],
        [10, 20],
        [100, 100],
        group(
          301,
          'flipV="1"',
          [10, 20],
          [100, 100],
          [0, 0],
          [100, 100],
          line(302),
        ),
      );
    zip.file(path, xml.replace("</p:spTree>", content + "</p:spTree>"));
    const imported = (
      await importPptx(await zip.generateAsync({ type: "uint8array" }))
    ).deck;
    const roundtrip = (await importPptx(await exportPptx(imported))).deck;
    const extract = (d: typeof imported) =>
      d.slides[0].elements.map((e) => {
        const { id, src, ...rest } = e;
        return rest;
      });
    return { imported: extract(imported), roundtrip: extract(roundtrip) };
  });
  const [line, text, image, custom, rotated, nested] = result.imported;
  const endpoints = (e: typeof line) => {
    const radians = (e.rotation * Math.PI) / 180;
    const cx = e.x + e.width / 2,
      cy = e.y + e.height / 2;
    return [
      cx - (Math.cos(radians) * e.width) / 2,
      cy - (Math.sin(radians) * e.width) / 2,
      cx + (Math.cos(radians) * e.width) / 2,
      cy + (Math.sin(radians) * e.width) / 2,
    ];
  };
  endpoints(line).forEach((value, i) =>
    expect(value).toBeCloseTo([180, 160, 120, 190][i], 4),
  );
  expect(text).toMatchObject({
    text: "readable",
    x: 200,
    y: 170,
    width: 80,
    height: 20,
    rotation: 0,
    fontSize: 20,
  });
  expect(image).toMatchObject({
    type: "image",
    x: 110,
    y: 120,
    width: 20,
    height: 10,
    flipV: false,
  });
  expect(custom).toMatchObject({
    shape: "custom",
    x: 120,
    y: 130,
    flipV: true,
  });
  expect(rotated).toMatchObject({
    shape: "rect",
    x: 465,
    y: 115,
    width: 20,
    height: 10,
    rotation: 90,
  });
  endpoints(nested).forEach((value, i) =>
    expect(value).toBeCloseTo([260, 480, 140, 420][i], 4),
  );
  expect(result.roundtrip).toHaveLength(result.imported.length);
  for (const [index, e] of result.roundtrip.entries()) {
    const original = result.imported[index];
    if (e.shape === "line" || e.shape === "arrow") {
      // Exported connectors have zero height; compare their actual centerline.
      endpoints(e).forEach((value, i) =>
        expect(value).toBeCloseTo(endpoints(original)[i], 2),
      );
      expect(e.lineStart).toEqual(original.lineStart);
      expect(e.lineEnd).toEqual(original.lineEnd);
    } else {
      expect(e.x).toBeCloseTo(original.x, 2);
      expect(e.y).toBeCloseTo(original.y, 2);
      expect(e.width).toBeCloseTo(original.width, 2);
      expect(e.height).toBeCloseTo(original.height, 2);
    }
    expect(e.rotation).toBeCloseTo(
      (result.imported[index].rotation + 360) % 360,
      2,
    );
  }
});

test("public CMU defaults and flipped annotation match native reference geometry", async ({
  page,
}) => {
  test.skip(
    !fs.existsSync("qa/samples/cmu-lecture-2.pptx") ||
      !fs.existsSync("qa/samples/cmu-lecture-4.pptx"),
    "public sample corpus is optional",
  );
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { importPptx } = await import("/src/io.ts");
    const cmu2 = (
      await importPptx(
        await (await fetch("/qa/samples/cmu-lecture-2.pptx")).arrayBuffer(),
      )
    ).deck;
    const cmu4 = (
      await importPptx(
        await (await fetch("/qa/samples/cmu-lecture-4.pptx")).arrayBuffer(),
      )
    ).deck;
    const label = cmu2.slides[51].elements.find(
      (e) => e.text === "notice the flip",
    )!;
    const note = cmu4.slides[69].elements.find((e) =>
      e.text?.startsWith("NOTE:"),
    )!;
    const arrow = cmu2.slides[51].elements.find(
      (e) =>
        (e.shape === "arrow" || e.shape === "line") &&
        e.x > 800 &&
        e.x < 900 &&
        e.y < 230,
    )!;
    return {
      label: { x: label.x, y: label.y, fontSize: label.fontSize },
      noteSize: note.fontSize,
      arrow: { rotation: arrow.rotation, y: arrow.y },
    };
  });
  expect(result.noteSize).toBe(48);
  expect(result.label.y).toBeCloseTo(1547086 / 9525 + 4.8, 3);
  expect(result.label.fontSize).toBe(32);
  expect(result.arrow.rotation).toBeGreaterThan(150);
  expect(result.arrow.rotation).toBeLessThan(160);
  expect(result.arrow.y).toBeGreaterThan(198);
});
