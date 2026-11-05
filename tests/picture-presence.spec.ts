import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";

test("a Mac picture uses its embedded PNG fallback, including crop and edited PPTX saves", async ({
  page,
}, info) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 24;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#1666AA";
    ctx.fillRect(0, 0, 24, 24);
    const src = canvas.toDataURL(),
      d = blankDeck();
    d.slides[0].elements = [
      element("image", { src, x: 80, y: 60, width: 240, height: 120 }),
    ];
    const zip = await JSZip.loadAsync(await exportPptx(d));
    const part = "ppt/slides/slide1.xml",
      doc = new DOMParser().parseFromString(
        await zip.file(part)!.async("string"),
        "application/xml",
      );
    const picture = doc.getElementsByTagNameNS("*", "pic")[0],
      fill = Array.from(picture.children).find(
        (n) => n.localName === "blipFill",
      )!;
    const fallback = new XMLSerializer()
      .serializeToString(fill)
      .replace(
        /<a:stretch/,
        '<a:srcRect l="10000" r="20000" t="10000" b="10000"/><a:stretch',
      );
    const wrapper = new DOMParser().parseFromString(
      `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><mc:Choice xmlns:ma="http://schemas.microsoft.com/office/mac/drawingml/2008/main" Requires="ma"><p:blipFill><a:blip r:embed="rIdMacPDF"/><a:stretch><a:fillRect/></a:stretch></p:blipFill></mc:Choice><mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent>`,
      "application/xml",
    );
    fill.replaceWith(doc.importNode(wrapper.documentElement, true));
    zip.file(part, new XMLSerializer().serializeToString(doc));
    zip.file("ppt/media/original.pdf", "%PDF-1.4\n%%EOF");
    const relpath = "ppt/slides/_rels/slide1.xml.rels";
    zip.file(
      relpath,
      (await zip.file(relpath)!.async("string")).replace(
        "</Relationships>",
        '<Relationship Id="rIdMacPDF" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/original.pdf"/></Relationships>',
      ),
    );
    zip.file(
      "[Content_Types].xml",
      (await zip.file("[Content_Types].xml")!.async("string")).replace(
        "</Types>",
        '<Default Extension="pdf" ContentType="application/pdf"/></Types>',
      ),
    );
    const original = await zip.generateAsync({ type: "uint8array" });
    let deck = (await importPptx(original)).deck;
    const rounds = [];
    let output: number[] | undefined;
    for (let round = 0; round < 4; round++) {
      const image = deck.slides[0].elements.find((e) => e.type === "image");
      rounds.push(
        image ? { src: image.src === src, x: image.x, crop: image.crop } : null,
      );
      if (!image || round === 3) break;
      image.x += 1;
      const bytes = await exportPptx(deck);
      output = Array.from(bytes);
      deck = (await importPptx(bytes)).deck;
    }
    return { rounds, original: Array.from(original), output };
  });
  await fs.writeFile(
    info.outputPath("mac-picture-fallback.pptx"),
    Buffer.from(result.original),
  );
  if (result.output)
    await fs.writeFile(
      info.outputPath("mac-picture-fallback-saved.pptx"),
      Buffer.from(result.output),
    );
  expect(result.rounds).toHaveLength(4);
  for (const [round, image] of result.rounds.entries()) {
    expect(image).toEqual({
      src: true,
      x: 80 + round,
      crop: [0.1, 0.2, 0.1, 0.1],
    });
  }
});

for (const owner of [
  "slide",
  "layout",
  "master",
  "group",
  "frame-only",
] as const) {
  test(`an OLE ${owner} object retains its cached picture through edited saves without carrying the active attachment`, async ({
    page,
  }, info) => {
    await page.goto("http://127.0.0.1:5190");
    const result = await page.evaluate(async (owner) => {
      const { blankDeck, element } = await import("/src/model.ts");
      const { exportPptx, importPptx } = await import("/src/io.ts");
      const { default: JSZip } = await import(
        "/node_modules/.vite/deps/jszip.js"
      );
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 24;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#AA3311";
      ctx.fillRect(0, 0, 24, 24);
      const src = canvas.toDataURL(),
        d = blankDeck();
      d.slides[0].elements = [
        element("image", { src, x: 80, y: 60, width: 240, height: 120 }),
      ];
      const zip = await JSZip.loadAsync(await exportPptx(d));
      const slidePart = "ppt/slides/slide1.xml",
        slideDoc = new DOMParser().parseFromString(
          await zip.file(slidePart)!.async("string"),
          "application/xml",
        );
      const pic = slideDoc.getElementsByTagNameNS("*", "pic")[0];
      if (owner === "frame-only")
        pic.getElementsByTagNameNS("*", "xfrm")[0].remove();
      const bitmap = new XMLSerializer().serializeToString(pic),
        imageRel = pic
          .getElementsByTagNameNS("*", "blip")[0]
          .getAttributeNS(
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
            "embed",
          )!;
      const frame = `<p:graphicFrame xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><p:nvGraphicFramePr><p:cNvPr id="90" name="Cached worksheet"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="762000" y="571500"/><a:ext cx="2286000" cy="1143000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole"><mc:AlternateContent><mc:Choice xmlns:v="urn:schemas-microsoft-com:vml" Requires="v"><p:oleObj r:id="rIdAttachment" progId="Excel.Sheet.12"><p:embed/></p:oleObj></mc:Choice><mc:Fallback><p:oleObj r:id="rIdAttachment" progId="Excel.Sheet.12"><p:embed/>${bitmap}</p:oleObj></mc:Fallback></mc:AlternateContent></a:graphicData></a:graphic></p:graphicFrame>`;
      let ownerPart = slidePart;
      if (owner === "layout") ownerPart = "ppt/slideLayouts/slideLayout1.xml";
      if (owner === "master") ownerPart = "ppt/slideMasters/slideMaster1.xml";
      let frameNode = new DOMParser().parseFromString(
        frame,
        "application/xml",
      ).documentElement;
      if (owner === "group") {
        const group = new DOMParser().parseFromString(
          `<p:grpSp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:nvGrpSpPr><p:cNvPr id="91" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="5143500"/><a:chOff x="0" y="0"/><a:chExt cx="9144000" cy="5143500"/></a:xfrm></p:grpSpPr></p:grpSp>`,
          "application/xml",
        ).documentElement;
        group.append(group.ownerDocument.importNode(frameNode, true));
        frameNode = group;
      }
      pic.remove();
      zip.file(slidePart, new XMLSerializer().serializeToString(slideDoc));
      const ownerDoc =
        ownerPart === slidePart
          ? slideDoc
          : new DOMParser().parseFromString(
              await zip.file(ownerPart)!.async("string"),
              "application/xml",
            );
      ownerDoc
        .getElementsByTagNameNS("*", "spTree")[0]
        .append(ownerDoc.importNode(frameNode, true));
      zip.file(ownerPart, new XMLSerializer().serializeToString(ownerDoc));
      const slideRels = "ppt/slides/_rels/slide1.xml.rels",
        imageRelsDoc = new DOMParser().parseFromString(
          await zip.file(slideRels)!.async("string"),
          "application/xml",
        );
      const sourceRel = Array.from(imageRelsDoc.documentElement.children).find(
        (e) => e.getAttribute("Id") === imageRel,
      )!;
      const parts = ownerPart.split("/"),
        name = parts.pop()!,
        relPart = [...parts, "_rels", name + ".rels"].join("/");
      const ownerRels = new DOMParser().parseFromString(
        await zip.file(relPart)!.async("string"),
        "application/xml",
      );
      if (ownerPart !== slidePart)
        ownerRels.documentElement.append(ownerRels.importNode(sourceRel, true));
      const attached = ownerRels.createElementNS(
        "http://schemas.openxmlformats.org/package/2006/relationships",
        "Relationship",
      );
      for (const [k, v] of Object.entries({
        Id: "rIdAttachment",
        Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject",
        Target: "../embeddings/oleObject1.bin",
      }))
        attached.setAttribute(k, v);
      ownerRels.documentElement.append(attached);
      zip.file(relPart, new XMLSerializer().serializeToString(ownerRels));
      zip.file("ppt/embeddings/oleObject1.bin", "unexecuted test attachment");
      zip.file(
        "[Content_Types].xml",
        (await zip.file("[Content_Types].xml")!.async("string")).replace(
          "</Types>",
          '<Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/></Types>',
        ),
      );
      const original = await zip.generateAsync({ type: "uint8array" });
      let deck = (await importPptx(original)).deck;
      let lastOutput: number[] | undefined;
      const rounds = [],
        saved = [];
      for (let round = 0; round < 4; round++) {
        const image = deck.slides[0].elements.find((e) => e.type === "image");
        rounds.push(
          image
            ? {
                src: image.src === src,
                x: image.x,
                y: image.y,
                width: image.width,
                height: image.height,
              }
            : null,
        );
        if (!image || round === 3) break;
        if (round === 1) image.x += 1;
        const bytes = await exportPptx(deck),
          output = await JSZip.loadAsync(bytes);
        lastOutput = Array.from(bytes);
        saved.push({
          activeParts: Object.keys(output.files).filter(
            (p) => /oleObject|embeddings\//.test(p) && !output.files[p].dir,
          ),
          activeXml: (
            await Promise.all(
              Object.keys(output.files)
                .filter((p) => /\.xml$|\.rels$/.test(p))
                .map((p) => output.file(p)!.async("string")),
            )
          ).some((s) => /<\w+:oleObj\b|relationships\/oleObject/.test(s)),
        });
        deck = (await importPptx(bytes)).deck;
      }
      return { rounds, saved, original: Array.from(original), lastOutput };
    }, owner);
    await fs.writeFile(
      info.outputPath(`ole-${owner}-preview.pptx`),
      Buffer.from(result.original),
    );
    if (result.lastOutput)
      await fs.writeFile(
        info.outputPath(`ole-${owner}-preview-saved.pptx`),
        Buffer.from(result.lastOutput),
      );
    expect(result.rounds).toHaveLength(4);
    for (const [round, image] of result.rounds.entries())
      expect(image).toEqual({
        src: true,
        x: round < 2 ? 80 : 81,
        y: 60,
        width: 240,
        height: 120,
      });
    for (const saved of result.saved)
      expect(saved).toEqual({ activeParts: [], activeXml: false });
  });
}

test("an unsupported local bookmark cannot prevent saving the rest of the presentation", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts"),
      { exportPptx, importPptx } = await import("/src/io.ts"),
      { default: JSZip } = await import("/node_modules/.vite/deps/jszip.js");
    const d = blankDeck();
    d.slides[0].elements = [
      element("text", {
        text: "日本語の脚注を含む資料",
        x: 40,
        y: 40,
        width: 400,
        height: 80,
      }),
    ];
    const zip = await JSZip.loadAsync(await exportPptx(d)),
      part = "ppt/slides/slide1.xml";
    const doc = new DOMParser().parseFromString(
        await zip.file(part)!.async("string"),
        "application/xml",
      ),
      props = doc.getElementsByTagNameNS("*", "cNvPr")[1];
    const click = doc.createElementNS(
      "http://schemas.openxmlformats.org/drawingml/2006/main",
      "a:hlinkClick",
    );
    click.setAttributeNS(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "r:id",
      "rIdFootnote",
    );
    props.append(click);
    zip.file(part, new XMLSerializer().serializeToString(doc));
    const rels = "ppt/slides/_rels/slide1.xml.rels";
    zip.file(
      rels,
      (await zip.file(rels)!.async("string")).replace(
        "</Relationships>",
        '<Relationship Id="rIdFootnote" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="#_ftn1"/></Relationships>',
      ),
    );
    let deck = (
      await importPptx(await zip.generateAsync({ type: "uint8array" }))
    ).deck;
    const rounds = [];
    for (let i = 0; i < 3; i++) {
      const warnings: string[] = [];
      deck = (
        await importPptx(
          await exportPptx(deck, { onWarning: (w) => warnings.push(w) }),
        )
      ).deck;
      rounds.push(deck.slides[0].elements.find((e) => e.type === "text")?.text);
    }
    return rounds;
  });
  expect(result).toEqual(Array(3).fill("日本語の脚注を含む資料"));
});
