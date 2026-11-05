import { expect, test } from "@playwright/test";
import sharp from "sharp";
import fs from "node:fs/promises";

for (const owner of ["slide", "layout", "master", "theme", "group"] as const) {
  test(`a ${owner} picture fill stays inside its shape and survives native and regenerated PPTX saves`, async ({
    page,
  }, info) => {
    await page.goto("http://127.0.0.1:5190");
    const result = await page.evaluate(async (owner) => {
      const { blankDeck, element } = await import("/src/model.ts");
      const { exportPptx, importPptx, serializeDeck, parseDeckJson } =
        await import("/src/io.ts");
      const { default: JSZip } = await import(
        "/node_modules/.vite/deps/jszip.js"
      );
      const canvas = document.createElement("canvas");
      canvas.width = 32;
      canvas.height = 16;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#0055AA";
      ctx.fillRect(0, 0, 16, 16);
      ctx.fillStyle = "#CC2200";
      ctx.fillRect(16, 0, 16, 16);
      const src = canvas.toDataURL(),
        d = blankDeck();
      d.width = 480;
      d.height = 270;
      d.slides[0].background = "#FFFFFF";
      d.slides[0].elements = [
        element("shape", {
          id: "filled-shape",
          shape: owner === "group" ? "custom" : "ellipse",
          x: 80,
          y: 60,
          width: 240,
          height: 160,
          fill: "transparent",
          stroke: "#112233",
          strokeWidth: 3,
          ...(owner === "group"
            ? {
                groups: ["test-group"],
                paths: [
                  {
                    d: "M 1200000 0 L 2400000 1600000 L 0 1600000 Z",
                    width: 2400000,
                    height: 1600000,
                    fill: true,
                    stroke: true,
                  },
                ],
              }
            : {}),
        }),
        element("image", { src, x: 0, y: 0, width: 32, height: 16 }),
      ];
      const zip = await JSZip.loadAsync(await exportPptx(d)),
        parse = (s: string) =>
          new DOMParser().parseFromString(s, "application/xml"),
        serial = (n: Node) => new XMLSerializer().serializeToString(n);
      const P = "http://schemas.openxmlformats.org/presentationml/2006/main",
        A = "http://schemas.openxmlformats.org/drawingml/2006/main",
        R =
          "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
      const slidePart = "ppt/slides/slide1.xml",
        doc = parse(await zip.file(slidePart)!.async("string"));
      const shape = doc.getElementsByTagNameNS(P, "sp")[0],
        pic = doc.getElementsByTagNameNS(P, "pic")[0],
        blip = pic.getElementsByTagNameNS(A, "blip")[0];
      const relId = blip.getAttributeNS(R, "embed"),
        fill = Array.from(pic.children).find(
          (n) => n.localName === "blipFill",
        )!;
      const imageRel = Array.from(
        parse(
          await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string"),
        ).documentElement.children,
      ).find((r) => r.getAttribute("Id") === relId)!;
      const native = doc.createElementNS(A, "a:blipFill");
      for (const child of Array.from(fill.children))
        native.append(child.cloneNode(true));
      native
        .getElementsByTagNameNS(A, "blip")[0]
        .setAttributeNS(R, "r:embed", "rIdFillFixture");
      const props = Array.from(shape.children).find(
        (n) => n.localName === "spPr",
      )!;
      for (const n of Array.from(props.children))
        if (["noFill", "solidFill", "gradFill"].includes(n.localName))
          n.remove();
      pic.remove();
      let ownerPart = slidePart;
      if (owner === "layout") ownerPart = "ppt/slideLayouts/slideLayout1.xml";
      if (owner === "master") ownerPart = "ppt/slideMasters/slideMaster1.xml";
      if (owner === "theme") {
        const masterRels = parse(
          await zip
            .file("ppt/slideMasters/_rels/slideMaster1.xml.rels")!
            .async("string"),
        );
        const target = Array.from(masterRels.documentElement.children)
          .find((n) => n.getAttribute("Type")?.endsWith("/theme"))!
          .getAttribute("Target")!;
        ownerPart = new URL(
          target,
          "https://package.test/ppt/slideMasters/slideMaster1.xml",
        ).pathname.slice(1);
      }
      if (owner === "layout" || owner === "master") {
        const nv = Array.from(shape.children).find(
            (n) => n.localName === "nvSpPr",
          )!,
          nvPr = Array.from(nv.children).find((n) => n.localName === "nvPr")!;
        const ph = doc.createElementNS(P, "p:ph");
        ph.setAttribute("type", "body");
        ph.setAttribute("idx", "3");
        nvPr.append(ph);
        const inherited = shape.cloneNode(true) as Element;
        const inheritedProps = Array.from(inherited.children).find(
          (n) => n.localName === "spPr",
        )!;
        inheritedProps.insertBefore(
          native,
          Array.from(inheritedProps.children).find(
            (n) => n.localName === "ln",
          ) ?? null,
        );
        const ownerDoc = parse(await zip.file(ownerPart)!.async("string"));
        ownerDoc
          .getElementsByTagNameNS(P, "spTree")[0]
          .append(ownerDoc.importNode(inherited, true));
        zip.file(ownerPart, serial(ownerDoc));
      } else if (owner === "theme") {
        const style = Array.from(shape.children).find(
          (n) => n.localName === "style",
        );
        style?.remove();
        const node = parse(
          `<p:style xmlns:p="${P}" xmlns:a="${A}"><a:lnRef idx="0"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="tx1"/></a:fontRef></p:style>`,
        ).documentElement;
        shape.append(doc.importNode(node, true));
        const ownerDoc = parse(await zip.file(ownerPart)!.async("string"));
        const list = ownerDoc.getElementsByTagNameNS(A, "fillStyleLst")[0];
        list.firstElementChild!.replaceWith(ownerDoc.importNode(native, true));
        zip.file(ownerPart, serial(ownerDoc));
      } else
        props.insertBefore(
          native,
          Array.from(props.children).find((n) => n.localName === "ln") ?? null,
        );
      zip.file(slidePart, serial(doc));
      const parts = ownerPart.split("/"),
        name = parts.pop()!,
        relPart = [...parts, "_rels", name + ".rels"].join("/");
      const relDoc = parse(
        (await zip.file(relPart)?.async("string")) ??
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
      );
      imageRel.setAttribute("Id", "rIdFillFixture");
      relDoc.documentElement.append(relDoc.importNode(imageRel, true));
      zip.file(relPart, serial(relDoc));
      const input = await zip.generateAsync({ type: "uint8array" });
      let deck = parseDeckJson(serializeDeck((await importPptx(input)).deck));
      const rounds = [],
        outputs = [];
      for (let round = 0; round < 4; round++) {
        const e = deck.slides[0].elements.find(
          (e) => e.type === "shape" && e.imageFill,
        );
        rounds.push(
          e
            ? {
                src: e.imageFill!.src === src,
                shape: e.shape,
                text: e.text,
                x: e.x,
              }
            : null,
        );
        if (!e || round === 3) break;
        if (round === 1) {
          e.stroke = "#556677";
          e.x += 1;
        }
        if (round === 2) {
          delete deck.pptxSources;
          for (const s of deck.slides) {
            delete s.pptxSource;
            for (const e of s.elements) delete e.pptxRef;
          }
        }
        const bytes = await exportPptx(deck);
        outputs.push(Array.from(bytes));
        deck = (await importPptx(bytes)).deck;
      }
      const { default: React } = await import(
          "/node_modules/.vite/deps/react.js"
        ),
        {
          default: { createRoot },
        } = await import("/node_modules/.vite/deps/react-dom_client.js"),
        { SlideVisual } = await import("/src/SlideCanvas.tsx");
      const host = document.createElement("div");
      host.id = "shape-picture-preview";
      host.style.cssText =
        "position:fixed;left:0;top:0;z-index:999999;background:white";
      document.body.append(host);
      createRoot(host).render(
        React.createElement(SlideVisual, {
          slide: deck.slides[0],
          width: deck.width,
          height: deck.height,
        }),
      );
      return { rounds, input: Array.from(input), output: outputs.at(-1) };
    }, owner);
    await fs.writeFile(
      info.outputPath(`${owner}-picture-fill.pptx`),
      Buffer.from(result.input),
    );
    if (result.output)
      await fs.writeFile(
        info.outputPath(`${owner}-picture-fill-regenerated.pptx`),
        Buffer.from(result.output),
      );
    expect(result.rounds).toHaveLength(4);
    for (const [round, e] of result.rounds.entries()) {
      expect(e?.src).toBe(true);
      expect(e?.x).toBeCloseTo(round < 2 ? 80 : 81, 4);
    }
    await expect(
      page.locator("#shape-picture-preview pattern image"),
    ).toHaveCount(1);
    const image = await page.locator("#shape-picture-preview").screenshot();
    await fs.writeFile(info.outputPath("picture-fill.png"), image);
    const pixel = async (x: number, y: number) => [
      ...(await sharp(image)
        .extract({ left: x, top: y, width: 1, height: 1 })
        .removeAlpha()
        .raw()
        .toBuffer()),
    ];
    expect(await pixel(151, 170)).toEqual([0, 85, 170]);
    expect(await pixel(251, 170)).toEqual([204, 34, 0]);
    expect(await pixel(85, 65)).toEqual([255, 255, 255]);
    if (owner === "slide") {
      await page.evaluate(() =>
        document.querySelector("#shape-picture-preview")?.remove(),
      );
      await page
        .locator('input[type=file][accept*=".pptx"]')
        .setInputFiles({
          name: "picture-fill.pptx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          buffer: Buffer.from(result.input),
        });
      const shape = page.locator('.editable-slide [data-type="shape"]').first();
      await expect(shape.locator("pattern image")).toHaveCount(1);
      await shape.click();
      await expect(
        page.getByLabel("도형 채우기 없음", { exact: true }),
      ).not.toBeChecked();
      await page.getByLabel("도형 채우기 색", { exact: true }).fill("#00cc66");
      await expect(shape.locator("pattern image")).toHaveCount(0);
      await page
        .getByRole("button", { name: "실행 취소", exact: true })
        .click();
      await expect(shape.locator("pattern image")).toHaveCount(1);
    }
  });
}

test("picture alpha remains independent of a translucent outline through three saves", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts"),
      { exportPptx, importPptx } = await import("/src/io.ts");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#0055AA";
    ctx.fillRect(0, 0, 16, 16);
    let d = blankDeck();
    d.slides[0].elements = [
      element("shape", {
        shape: "ellipse",
        x: 80,
        y: 60,
        width: 240,
        height: 160,
        fill: "transparent",
        stroke: "#000000",
        strokeWidth: 3,
        strokeOpacity: 0.25,
        imageFill: { src: canvas.toDataURL(), opacity: 0.6 },
      }),
    ];
    const rounds = [];
    for (let i = 0; i < 3; i++) {
      d = (await importPptx(await exportPptx(d))).deck;
      const e = d.slides[0].elements.find((e) => e.imageFill)!;
      rounds.push({
        opacity: e.opacity,
        stroke: e.strokeOpacity,
        fill: e.imageFill!.opacity,
      });
    }
    return rounds;
  });
  for (const r of result) {
    expect(r.opacity).toBe(1);
    expect(r.stroke).toBeCloseTo(0.25, 5);
    expect(r.fill).toBeCloseTo(0.6, 5);
  }
});
