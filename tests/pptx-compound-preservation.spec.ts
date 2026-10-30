import { expect, test } from "@playwright/test";
import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import fs from "node:fs/promises";

for (const drawingOwner of ["data", "slide"] as const)
  test(`unmodified SmartArt with ${drawingOwner}-owned drawing relationship remains one native diagram after editing a neighboring title`, async ({
    page,
  }, info) => {
    const R =
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      D = "http://schemas.openxmlformats.org/drawingml/2006/diagram",
      A = "http://schemas.openxmlformats.org/drawingml/2006/main",
      DSP = "http://schemas.microsoft.com/office/drawing/2008/diagram";
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    const slide = pptx.addSlide();
    slide.addText("Outside title", {
      x: 1,
      y: 0.5,
      w: 8,
      h: 0.7,
      objectName: "Outside",
    });
    slide.addText("Stage A", { x: 1, y: 2, w: 3, h: 1, objectName: "Stage A" });
    slide.addText("Stage B", { x: 5, y: 2, w: 3, h: 1, objectName: "Stage B" });
    const zip = await JSZip.loadAsync(
        (await pptx.write({ outputType: "uint8array" })) as Uint8Array,
      ),
      path = "ppt/slides/slide1.xml";
    let xml = await zip.file(path)!.async("string");
    const shapes = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map(
      (m) => m[0],
    );
    const prefix = xml.match(
      /<p:spTree>(<p:nvGrpSpPr>[\s\S]*?<\/p:nvGrpSpPr><p:grpSpPr(?:\/>|>[\s\S]*?<\/p:grpSpPr>))/,
    )![1];
    for (const shape of shapes.slice(1)) xml = xml.replace(shape, "");
    const frame = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="140" name="Native SmartArt"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/></p:xfrm><a:graphic><a:graphicData uri="${D}"><dgm:relIds xmlns:dgm="${D}" r:dm="rIdDiagramData" r:lo="rIdDiagramLayout" r:qs="rIdDiagramStyle" r:cs="rIdDiagramColors"/></a:graphicData></a:graphic></p:graphicFrame>`;
    zip.file(path, xml.replace("</p:spTree>", frame + "</p:spTree>"));
    const diagram = `<dsp:drawing xmlns:dsp="${DSP}" xmlns:a="${A}" xmlns:r="${R}"><dsp:spTree>${(prefix + shapes.slice(1).join("")).replaceAll("p:", "dsp:")}</dsp:spTree></dsp:drawing>`;
    const data = `<dgm:dataModel xmlns:dgm="${D}" xmlns:a="${A}"><dgm:ptLst/><dgm:cxnLst/><dgm:extLst><a:ext uri="{C0AA5620-E08C-4F99-B645-0A3A96BFB24B}"><dsp:dataModelExt xmlns:dsp="${DSP}" relId="rIdDrawing"/></a:ext></dgm:extLst></dgm:dataModel>`;
    const parts = [
      [
        "data.xml",
        data,
        "application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml",
      ],
      [
        "drawing.xml",
        diagram,
        "application/vnd.ms-office.drawingml.diagramDrawing+xml",
      ],
      [
        "layout.xml",
        `<dgm:layoutDef xmlns:dgm="${D}"><dgm:layoutNode name="root"/></dgm:layoutDef>`,
        "application/vnd.openxmlformats-officedocument.drawingml.diagramLayout+xml",
      ],
      [
        "style.xml",
        `<dgm:styleDef xmlns:dgm="${D}"><dgm:styleLbl name="node0"/></dgm:styleDef>`,
        "application/vnd.openxmlformats-officedocument.drawingml.diagramStyle+xml",
      ],
      [
        "colors.xml",
        `<dgm:colorsDef xmlns:dgm="${D}"/>`,
        "application/vnd.openxmlformats-officedocument.drawingml.diagramColors+xml",
      ],
    ];
    for (const [name, text] of parts) zip.file("ppt/diagrams/" + name, text);
    const relPath = "ppt/slides/_rels/slide1.xml.rels";
    let rels = await zip.file(relPath)!.async("string");
    for (const [id, type, target] of [
      ["Data", "diagramData", "data"],
      ["Layout", "diagramLayout", "layout"],
      ["Style", "diagramQuickStyle", "style"],
      ["Colors", "diagramColors", "colors"],
    ])
      rels = rels.replace(
        "</Relationships>",
        `<Relationship Id="rIdDiagram${id}" Type="${R}/${type}" Target="../diagrams/${target}.xml"/></Relationships>`,
      );
    const drawingRelationship = `<Relationship Id="rIdDrawing" Type="http://schemas.microsoft.com/office/2007/relationships/diagramDrawing" Target="${drawingOwner === "slide" ? "../diagrams/" : ""}drawing.xml"/>`;
    zip.file(
      relPath,
      drawingOwner === "slide"
        ? rels.replace(
            "</Relationships>",
            drawingRelationship + "</Relationships>",
          )
        : rels,
    );
    if (drawingOwner === "data")
      zip.file(
        "ppt/diagrams/_rels/data.xml.rels",
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${drawingRelationship}</Relationships>`,
      );
    zip.file(
      "[Content_Types].xml",
      (await zip.file("[Content_Types].xml")!.async("string")).replace(
        "</Types>",
        parts
          .map(
            ([name, , type]) =>
              `<Override PartName="/ppt/diagrams/${name}" ContentType="${type}"/>`,
          )
          .join("") + "</Types>",
      ),
    );
    const input = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
    });
    await fs.writeFile(info.outputPath("smartart-source.pptx"), input);
    await page.goto("http://127.0.0.1:5190");
    const result = await page.evaluate(
      async (input) => {
        const { importPptx, exportPptx } = await import("/src/io.ts");
        const { editText } = await import("/src/text-layout.ts");
        const { default: JSZip } = await import(
          "/node_modules/.vite/deps/jszip.js"
        );
        let deck = (await importPptx(Uint8Array.from(input))).deck;
        const counts = [];
        let bytes: Uint8Array = new Uint8Array();
        for (let i = 0; i < 3; i++) {
          const title = deck.slides[0].elements.find(
            (e) => e.name === "Outside",
          )!;
          Object.assign(title, editText(title, "Edited outside " + i));
          const warnings: string[] = [];
          bytes = await exportPptx(deck, {
            onWarning: (s) => warnings.push(s),
          });
          const zip = await JSZip.loadAsync(bytes),
            xml = await zip.file("ppt/slides/slide1.xml")!.async("string"),
            types = await zip.file("[Content_Types].xml")!.async("string");
          counts.push({
            frames: (xml.match(/<p:graphicFrame>/g) ?? []).length,
            diagrams: (xml.match(/<dgm:relIds/g) ?? []).length,
            styleParts: (
              types.match(
                /ContentType="application\/vnd.openxmlformats-officedocument.drawingml.diagram/g,
              ) ?? []
            ).length,
            warnings,
            elements: deck.slides[0].elements.length,
          });
          deck = (await importPptx(bytes)).deck;
        }
        const { duplicateSlides } = await import("/src/slide-operations.ts");
        const { blankDeck } = await import("/src/model.ts");
        const { mergePptxSources } = await import("/src/pptx-preservation.ts");
        const duplicated = {
          ...deck,
          slides: [...deck.slides, ...duplicateSlides(deck.slides)],
        };
        const duplicateBytes = await exportPptx(duplicated),
          duplicateZip = await JSZip.loadAsync(duplicateBytes);
        const dataTargets = [];
        for (let i = 1; i <= 2; i++) {
          const rels = new DOMParser().parseFromString(
            await duplicateZip
              .file(`ppt/slides/_rels/slide${i}.xml.rels`)!
              .async("string"),
            "application/xml",
          );
          dataTargets.push(
            [...rels.getElementsByTagNameNS("*", "Relationship")]
              .find((r) => r.getAttribute("Type")?.endsWith("/diagramData"))
              ?.getAttribute("Target"),
          );
        }
        const duplicateText = (
          await importPptx(duplicateBytes)
        ).deck.slides.map((s) => s.elements.map((e) => e.text));
        const foreign = mergePptxSources(
          { ...blankDeck(), slides: duplicateSlides(deck.slides) },
          deck.pptxSources,
        );
        const foreignBytes = await exportPptx(foreign),
          foreignText = (
            await importPptx(foreignBytes)
          ).deck.slides[0].elements.map((e) => e.text);
        duplicated.slides[0] = {
          ...duplicated.slides[0],
          elements: duplicated.slides[0].elements.filter(
            (e) => !e.text?.startsWith("Stage "),
          ),
        };
        const deletedBytes = await exportPptx(duplicated),
          deletedText = (await importPptx(deletedBytes)).deck.slides.map((s) =>
            s.elements.map((e) => e.text),
          );
        return {
          counts,
          bytes: [...bytes],
          text: deck.slides[0].elements.map((e) => e.text),
          dataTargets,
          duplicateText,
          foreignText,
          deletedText,
          duplicateBytes: [...duplicateBytes],
          foreignBytes: [...foreignBytes],
          deletedBytes: [...deletedBytes],
        };
      },
      [...input],
    );
    await fs.writeFile(
      info.outputPath("smartart-roundtrip.pptx"),
      Buffer.from(result.bytes),
    );
    expect(result.counts).toEqual(
      Array(3).fill({
        frames: 1,
        diagrams: 1,
        styleParts: 4,
        warnings: [],
        elements: 3,
      }),
    );
    expect(result.text).toEqual(["Edited outside 2", "Stage A", "Stage B"]);
    expect(result.duplicateText).toEqual([result.text, result.text]);
    expect(result.dataTargets.every(Boolean)).toBe(true);
    expect(new Set(result.dataTargets).size).toBe(2);
    expect(result.foreignText).toEqual(result.text);
    expect(result.deletedText).toEqual([["Edited outside 2"], result.text]);
    for (const [name, bytes] of [
      ["duplicated", result.duplicateBytes],
      ["foreign", result.foreignBytes],
      ["deleted", result.deletedBytes],
    ] as const)
      await fs.writeFile(
        info.outputPath(`smartart-${name}.pptx`),
        Buffer.from(bytes),
      );
  });
