import { expect, test } from "@playwright/test";
import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import fs from "node:fs/promises";

const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#224488"/><circle cx="80" cy="45" r="30" fill="#ff9922"/></svg>';
const ioModule = process.env.PPTX_PRESERVATION_IO ?? "/src/io.ts";

async function fixture(ole = false) {
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_WIDE";
  deck.title = "원본 요소 보존";
  for (let i = 0; i < 2; i++) {
    const slide = deck.addSlide();
    slide.addText(`원본 제목 ${i + 1}`, {
      x: 0.8,
      y: 0.6,
      w: 8,
      h: 0.7,
      fontFace: "Arial",
      fontSize: 28,
      objectName: "Title",
    });
    slide.addShape(deck.ShapeType.ellipse, {
      x: 1,
      y: 2,
      w: 2,
      h: 1.5,
      fill: { color: "DD8822" },
      objectName: "Pattern",
    });
    slide.addNotes("원본 발표자 노트");
  }
  const zip = await JSZip.loadAsync(
    (await deck.write({ outputType: "uint8array" })) as Uint8Array,
  );
  const path = "ppt/slides/slide1.xml";
  let xml = await zip.file(path)!.async("string");
  const titleId = xml.match(/<p:cNvPr[^>]*id="([^"]+)"[^>]*name="Title"/)![1];
  const pic = (id: number, rid: string, extension = "") =>
    `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Vector ${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}">${extension}</a:blip><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="6000000" y="${id === 90 ? 1000000 : 3000000}"/><a:ext cx="1600000" cy="900000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
  const ext =
    '<a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="rIdSVG"/></a:ext></a:extLst>';
  xml = xml.replace(
    "</p:spTree>",
    pic(90, "rIdSVG") +
      pic(91, "rIdPoster", ext) +
      (ole
        ? '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="95" name="OLE"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole"><p:oleObj r:id="rIdOLE" progId="Excel.Sheet.12"/></a:graphicData></a:graphic></p:graphicFrame>'
        : "") +
      "</p:spTree>",
  );
  xml = xml.replace(
    /<p:sp>(?:(?!<p:sp>)[\s\S])*?name="Pattern"[\s\S]*?<\/p:sp>/,
    (s) =>
      s.replace(
        /<a:solidFill>[\s\S]*?<\/a:solidFill>/,
        '<a:pattFill prst="diagCross"><a:fgClr><a:srgbClr val="DD8822"/></a:fgClr><a:bgClr><a:srgbClr val="FFFFFF"/></a:bgClr></a:pattFill>',
      ),
  );
  xml = xml.replace(
    "</p:sld>",
    `<p:transition advClick="1" advTm="4500"><p:wipe dir="r"/></p:transition><p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" nodeType="tmRoot"><p:childTnLst><p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="2" dur="500"/><p:tgtEl><p:spTgt spid="${titleId}"/></p:tgtEl></p:cBhvr></p:animEffect><p:audio><p:cMediaNode vol="70000"><p:cTn id="3" dur="indefinite" repeatCount="indefinite"/><p:tgtEl><p:sndTgt r:embed="rIdAudio" name="Original sound"/></p:tgtEl></p:cMediaNode></p:audio></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing></p:sld>`,
  );
  zip.file(path, xml);
  const rels = "ppt/slides/_rels/slide1.xml.rels";
  zip.file(
    rels,
    (await zip.file(rels)!.async("string")).replace(
      "</Relationships>",
      `<Relationship Id="rIdSVG" Type="${R}/image" Target="../media/original.svg"/><Relationship Id="rIdPoster" Type="${R}/image" Target="../media/poster.png"/><Relationship Id="rIdAudio" Type="${R}/audio" Target="../media/original.wav"/>${ole ? `<Relationship Id="rIdOLE" Type="${R}/oleObject" Target="../embeddings/oleObject1.bin"/>` : ""}</Relationships>`,
    ),
  );
  zip.file("ppt/media/original.svg", svg);
  zip.file("ppt/media/poster.png", png, { base64: true });
  const wav = Buffer.alloc(46);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(38, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(2, 40);
  wav[44] = wav[45] = 128;
  zip.file("ppt/media/original.wav", wav);
  if (ole)
    zip.file("ppt/embeddings/oleObject1.bin", new Uint8Array([1, 2, 3, 4]));
  zip.file(
    "[Content_Types].xml",
    (await zip.file("[Content_Types].xml")!.async("string")).replace(
      "</Types>",
      '<Default Extension="svg" ContentType="image/svg+xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="wav" ContentType="audio/wav"/>' +
        (ole
          ? '<Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/>'
          : "") +
        "</Types>",
    ),
  );
  return Buffer.from(
    await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
  );
}

test("native animations, audio, SVG originals, picture fallbacks and timed transitions survive three edited saves", async ({
  page,
}, info) => {
  const input = await fixture();
  await fs.writeFile(info.outputPath("source.pptx"), input);
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(
    async ({ input, ioModule }) => {
      const { importPptx, exportPptx, parseDeckJson, serializeDeck } =
        await import(ioModule);
      const { editText } = await import("/src/text-layout.ts");
      const { default: JSZip } = await import(
        "/node_modules/.vite/deps/jszip.js"
      );
      let deck = (await importPptx(Uint8Array.from(input))).deck;
      const originalCount = deck.slides[0].elements.length;
      const rounds = [];
      let bytes: Uint8Array = new Uint8Array();
      for (let i = 0; i < 3; i++) {
        deck = parseDeckJson(serializeDeck(deck));
        const s = deck.slides[0],
          title = s.elements.find((e: any) => e.name === "Title");
        Object.assign(title, editText(title, `수정한 제목 ${i + 1}`));
        s.elements.find((e: any) => e.name === "Pattern").x += 12;
        s.elements.find((e: any) => e.name === "Vector 91").y += 8;
        const warnings: string[] = [];
        bytes = await exportPptx(deck, {
          onWarning: (s: string) => warnings.push(s),
        });
        const zip = await JSZip.loadAsync(bytes),
          xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
        const doc = new DOMParser().parseFromString(xml, "application/xml");
        const all = (n: string) =>
          Array.from(doc.getElementsByTagNameNS("*", n));
        const paths = Object.keys(zip.files).filter((p) => !zip.files[p].dir);
        const audio = await Promise.all(
          paths
            .filter((p) => p.endsWith(".wav"))
            .map((p) => zip.file(p)!.async("base64")),
        );
        const vectors = await Promise.all(
          paths
            .filter((p) => p.endsWith(".svg"))
            .map((p) => zip.file(p)!.async("string")),
        );
        const ids = all("cNvPr").map((n) => n.getAttribute("id"));
        const target = all("spTgt")[0]?.getAttribute("spid");
        const targetName = all("cNvPr")
          .find((n) => n.getAttribute("id") === target)
          ?.getAttribute("name");
        rounds.push({
          animations: all("animEffect").length,
          audio: all("audio").length,
          svg: vectors,
          sound: audio,
          patterns: all("pattFill").length,
          svgExtensions: all("svgBlip").length,
          transition: all("transition")[0]?.getAttribute("advTm"),
          wipe: all("wipe").length,
          targetName,
          uniqueIds: new Set(ids).size === ids.length,
          allTargetsExist: all("spTgt").every((n) =>
            ids.includes(n.getAttribute("spid")),
          ),
          warnings,
          entries: paths.length,
          hasHiddenArchive: paths.some((p) =>
            /\.slide$|original\.pptx$|model\.json$/.test(p),
          ),
        });
        deck = (await importPptx(bytes)).deck;
      }
      return {
        rounds,
        output: [...bytes],
        originalCount,
        finalCount: deck.slides[0].elements.length,
        text: deck.slides[0].elements.find((e: any) => e.name === "Title")
          ?.text,
      };
    },
    { input: [...input], ioModule },
  );
  await fs.writeFile(
    info.outputPath("roundtrip.pptx"),
    Buffer.from(result.output),
  );
  await fs.writeFile(
    info.outputPath("results.json"),
    JSON.stringify({ ...result, output: undefined }, null, 2),
  );
  // SVG-only artwork now has a visible image instead of an opaque-only node.
  expect(result.originalCount).toBe(4);
  expect(result.finalCount).toBe(4);
  expect(result.text).toBe("수정한 제목 3");
  for (const round of result.rounds) {
    expect(round.animations).toBe(1);
    expect(round.audio).toBe(1);
    expect(round.svg).toEqual([svg]);
    expect(round.sound).toHaveLength(1);
    expect(round.patterns).toBe(1);
    expect(round.svgExtensions).toBe(1);
    expect(round.transition).toBe("4500");
    expect(round.wipe).toBe(1);
    expect(round.targetName).toBe("Title");
    expect(round.uniqueIds).toBe(true);
    expect(round.allTargetsExist).toBe(true);
    expect(round.warnings).toEqual([]);
    expect(round.hasHiddenArchive).toBe(false);
  }
  expect(result.rounds[1].sound).toEqual(result.rounds[0].sound);
  expect(result.rounds[2].sound).toEqual(result.rounds[0].sound);
  expect(result.rounds[2].entries).toBeLessThanOrEqual(
    result.rounds[0].entries + 2,
  );
});

test("deleting an animated object removes its animation without deleting audio or native vectors", async ({
  page,
}) => {
  const input = await fixture();
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(
    async (input) => {
      const { importPptx, exportPptx } = await import("/src/io.ts");
      const { default: JSZip } = await import(
        "/node_modules/.vite/deps/jszip.js"
      );
      const deck = (await importPptx(Uint8Array.from(input))).deck;
      deck.slides[0].elements = deck.slides[0].elements.filter(
        (e) => e.name !== "Title",
      );
      const warnings: string[] = [];
      const zip = await JSZip.loadAsync(
        await exportPptx(deck, { onWarning: (s) => warnings.push(s) }),
      );
      const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
      return {
        xml,
        warnings,
        media: Object.keys(zip.files).filter((p) => /\.(?:svg|wav)$/.test(p)),
      };
    },
    [...input],
  );
  expect(result.xml).not.toContain("<p:animEffect");
  expect(result.xml).toContain("<p:audio");
  expect(result.media.filter((p) => p.endsWith(".svg"))).toHaveLength(1);
  expect(result.media.filter((p) => p.endsWith(".wav"))).toHaveLength(1);
  expect(result.warnings).toEqual([]);
});

test("duplicate and reordered slides have independent native parts and valid animation targets", async ({
  page,
}, info) => {
  const input = await fixture();
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(
    async (input) => {
      const { importPptx, exportPptx } = await import("/src/io.ts");
      const { duplicateSlides } = await import("/src/slide-operations.ts");
      const { default: JSZip } = await import(
        "/node_modules/.vite/deps/jszip.js"
      );
      const deck = (await importPptx(Uint8Array.from(input))).deck;
      const original = deck.slides[0],
        copy = duplicateSlides([original])[0];
      deck.slides = [copy, deck.slides[1], original];
      const { editText } = await import("/src/text-layout.ts");
      const title = copy.elements.find((e) => e.name === "Title")!;
      Object.assign(title, editText(title, "복제한 제목"));
      const warnings: string[] = [];
      const bytes = await exportPptx(deck, {
          onWarning: (s) => warnings.push(s),
        }),
        zip = await JSZip.loadAsync(bytes);
      const slides = [];
      for (let i = 1; i <= 3; i++) {
        const xml = await zip.file(`ppt/slides/slide${i}.xml`)!.async("string"),
          doc = new DOMParser().parseFromString(xml, "application/xml");
        const all = (n: string) =>
          Array.from(doc.getElementsByTagNameNS("*", n));
        const ids = all("cNvPr").map((n) => n.getAttribute("id"));
        slides.push({
          audio: all("audio").length,
          animations: all("animEffect").length,
          targets: all("spTgt").every((n) =>
            ids.includes(n.getAttribute("spid")),
          ),
        });
      }
      return {
        slides,
        warnings,
        bytes: [...bytes],
        names: (await importPptx(bytes)).deck.slides.map(
          (s) => s.elements.find((e) => e.name === "Title")?.text,
        ),
      };
    },
    [...input],
  );
  await fs.writeFile(
    info.outputPath("duplicate.pptx"),
    Buffer.from(result.bytes),
  );
  expect(result.slides).toEqual([
    { audio: 1, animations: 1, targets: true },
    { audio: 0, animations: 0, targets: true },
    { audio: 1, animations: 1, targets: true },
  ]);
  expect(result.warnings).toEqual([]);
  expect(result.names[0]).toBe("복제한 제목");
});

test("save warns about actual excluded OLE content and cancellation never writes or marks the file saved", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__saved = 0;
    window.desktop = {
      platform: "darwin",
      windowSessionId: "preservation",
      onMenu: () => () => {},
      openFile: async () => null,
      saveFile: async () => {
        (window as any).__saved++;
        return "/tmp/saved.pptx";
      },
      exportPDF: async () => null,
      print: async () => false,
    };
  });
  await page.goto("http://127.0.0.1:5190");
  const input = await fixture(true);
  await page.locator('input[accept*=".pptx"]').setInputFiles({
    name: "source.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: input,
  });
  await expect(
    page.getByRole("textbox", { name: "프레젠테이션 이름", exact: true }),
  ).toHaveValue("원본 요소 보존");
  await page
    .getByRole("textbox", { name: "발표자 노트", exact: true })
    .fill("아직 저장하지 않은 메모");
  let message = "";
  page.once("dialog", async (d) => {
    message = d.message();
    await d.dismiss();
  });
  await page.getByRole("button", { name: "PPTX 저장", exact: true }).click();
  await expect(page.locator(".busy-backdrop")).toHaveCount(0);
  expect(message).toContain("OLE");
  expect(await page.evaluate(() => (window as any).__saved)).toBe(0);
  expect(
    await page.evaluate(() => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    }),
  ).toBe(true);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "PPTX 저장", exact: true }).click();
  await expect(page.locator(".busy-backdrop")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__saved)).toBe(1);
});

test("editing a grouped title retains opaque vector siblings and the group animation target", async ({
  page,
}, info) => {
  const zip = await JSZip.loadAsync(await fixture());
  let xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  const prefix = xml.match(
    /<p:spTree>(<p:nvGrpSpPr>[\s\S]*?<\/p:nvGrpSpPr><p:grpSpPr(?:\/>|>[\s\S]*?<\/p:grpSpPr>))/,
  )![1];
  const artwork = xml.slice(
    xml.indexOf(prefix) + prefix.length,
    xml.indexOf("</p:spTree>"),
  );
  const group =
    '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="110" name="Native group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/><a:chOff x="0" y="0"/><a:chExt cx="12192000" cy="6858000"/></a:xfrm></p:grpSpPr>' +
    artwork +
    "</p:grpSp>";
  xml = xml
    .replace(prefix + artwork, prefix + group)
    .replace(/<p:spTgt spid="\d+"\/>/, '<p:spTgt spid="110"/>');
  zip.file("ppt/slides/slide1.xml", xml);
  const input = await zip.generateAsync({ type: "uint8array" });
  await fs.writeFile(info.outputPath("group-source.pptx"), input);
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(
    async (input) => {
      const { importPptx, exportPptx } = await import("/src/io.ts");
      const { editText } = await import("/src/text-layout.ts");
      const { default: JSZip } = await import(
        "/node_modules/.vite/deps/jszip.js"
      );
      const deck = (await importPptx(Uint8Array.from(input))).deck,
        title = deck.slides[0].elements.find((e) => e.name === "Title")!;
      Object.assign(title, editText(title, "그룹 안에서 수정한 제목"));
      const warnings: string[] = [];
      const bytes = await exportPptx(deck, {
          onWarning: (s) => warnings.push(s),
        }),
        zip = await JSZip.loadAsync(bytes);
      const doc = new DOMParser().parseFromString(
        await zip.file("ppt/slides/slide1.xml")!.async("string"),
        "application/xml",
      );
      const all = (n: string) => Array.from(doc.getElementsByTagNameNS("*", n));
      const target = all("spTgt")[0].getAttribute("spid"),
        targetProps = all("cNvPr").find(
          (n) => n.getAttribute("id") === target,
        )!;
      return {
        warnings,
        bytes: [...bytes],
        pics: all("pic").length,
        groupTarget: targetProps.parentElement?.parentElement?.localName,
        text: (await importPptx(bytes)).deck.slides[0].elements.find(
          (e) => e.name === "Title",
        )?.text,
      };
    },
    [...input],
  );
  await fs.writeFile(
    info.outputPath("group-roundtrip.pptx"),
    Buffer.from(result.bytes),
  );
  expect(result.warnings).toEqual([]);
  expect(result.pics).toBe(2);
  expect(result.groupTarget).toBe("grpSp");
  expect(result.text).toBe("그룹 안에서 수정한 제목");
});

test("a duplicated shape placed before the original cannot steal its animation", async ({
  page,
}) => {
  const input = await fixture();
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(
    async (input) => {
      const { importPptx, exportPptx } = await import("/src/io.ts");
      const { copyElements } = await import("/src/object-groups.ts");
      const { editText } = await import("/src/text-layout.ts");
      const { default: JSZip } = await import(
        "/node_modules/.vite/deps/jszip.js"
      );
      const deck = (await importPptx(Uint8Array.from(input))).deck,
        s = deck.slides[0],
        title = s.elements.find((e) => e.name === "Title")!,
        copy = copyElements([title], 50, 50)[0];
      Object.assign(copy, editText(copy, "복사한 다른 글"));
      s.elements.unshift(copy);
      const zip = await JSZip.loadAsync(await exportPptx(deck));
      const doc = new DOMParser().parseFromString(
        await zip.file("ppt/slides/slide1.xml")!.async("string"),
        "application/xml",
      );
      const target = doc
        .getElementsByTagNameNS("*", "spTgt")[0]
        .getAttribute("spid");
      const p = Array.from(doc.getElementsByTagNameNS("*", "cNvPr")).find(
        (p) => p.getAttribute("id") === target,
      )!;
      return p.parentElement!.parentElement!.textContent;
    },
    [...input],
  );
  expect(result).toContain("원본 제목 1");
  expect(result).not.toContain("복사한 다른 글");
});

test("deleting the source slide removes its sound and vectors from the saved archive", async ({
  page,
}) => {
  const input = await fixture();
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(
    async (input) => {
      const { importPptx, exportPptx } = await import("/src/io.ts");
      const { default: JSZip } = await import(
        "/node_modules/.vite/deps/jszip.js"
      );
      const deck = (await importPptx(Uint8Array.from(input))).deck;
      deck.slides.shift();
      const zip = await JSZip.loadAsync(await exportPptx(deck));
      return Object.keys(zip.files).filter((p) => /\.(?:wav|svg)$/.test(p));
    },
    [...input],
  );
  expect(result).toEqual([]);
});

test("internal slide copy across documents retains its native package and supports undo and redo", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const input = await fixture();
  await page.locator('input[accept*=".pptx"]').setInputFiles({
    name: "source.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: input,
  });
  await expect(page.locator(".thumbnail-button")).toHaveCount(2);
  await page.locator(".thumbnail-button").first().click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "슬라이드 복사", exact: true })
    .click();
  const blank = await page.evaluate(async () =>
    JSON.stringify((await import("/src/model.ts")).blankDeck()),
  );
  await page.locator('input[accept*=".pptx"]').setInputFiles({
    name: "blank.slide",
    mimeType: "application/json",
    buffer: Buffer.from(blank),
  });
  await expect(page.locator(".thumbnail-button")).toHaveCount(1);
  await page.locator(".thumbnail-button").first().click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "슬라이드 붙여넣기", exact: true })
    .click();
  await expect(page.locator(".thumbnail-button")).toHaveCount(2);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".thumbnail-button")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.locator(".thumbnail-button")).toHaveCount(2);
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  const result = await page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts");
    const { exportPptx } = await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const deck = (await loadAutosave())!,
      warnings: string[] = [];
    const zip = await JSZip.loadAsync(
      await exportPptx(deck, { onWarning: (s) => warnings.push(s) }),
    );
    const xml = await zip.file("ppt/slides/slide2.xml")!.async("string");
    return {
      warnings,
      sources: deck.pptxSources?.length,
      audio: xml.includes("<p:audio"),
      svg: Object.keys(zip.files).filter((p) => p.endsWith(".svg")).length,
    };
  });
  expect(result).toEqual({ warnings: [], sources: 1, audio: true, svg: 1 });
});

test("source validation rejects dangling packages, fractional indexes, traversal, corrupt archives and hostile XML", async ({
  page,
}) => {
  const input = await fixture();
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(
    async (input) => {
      const { importPptx, exportPptx, validateDeck } = await import(
        "/src/io.ts"
      );
      const { default: JSZip } = await import(
        "/node_modules/.vite/deps/jszip.js"
      );
      const source = (await importPptx(Uint8Array.from(input))).deck;
      const results: boolean[] = [];
      for (let i = 0; i < 5; i++) {
        const deck = structuredClone(source);
        if (i === 0) delete deck.pptxSources;
        if (i === 1) deck.slides[0].elements[0].pptxRef!.index = 0.5;
        if (i === 2) deck.slides[0].pptxSource!.path = "../escape.xml";
        if (i === 3) deck.pptxSources![0].data = btoa("not a zip");
        if (i === 4) {
          const zip = await JSZip.loadAsync(Uint8Array.from(input));
          zip.file(
            "ppt/slides/slide1.xml",
            '<!DOCTYPE x [<!ENTITY injected SYSTEM "file:///etc/passwd">]><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">&injected;</p:sld>',
          );
          deck.pptxSources![0].data = await zip.generateAsync({
            type: "base64",
          });
        }
        try {
          const checked = validateDeck(deck);
          await exportPptx(checked);
          results.push(false);
        } catch {
          results.push(true);
        }
      }
      return results;
    },
    [...input],
  );
  expect(result).toEqual([true, true, true, true, true]);
});

test("changing video playback on a preserved timeline exports the new settings and keeps neighboring audio", async ({
  page,
}) => {
  const input = await fixture();
  const clip = await fs.readFile("tests/fixtures/media/animated.mp4");
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(
    async ({ input, clip }) => {
      const { importPptx, exportPptx } = await import("/src/io.ts");
      const { readVideo } = await import("/src/video.ts");
      const { element } = await import("/src/model.ts");
      const { default: JSZip } = await import(
        "/node_modules/.vite/deps/jszip.js"
      );
      let deck = (await importPptx(Uint8Array.from(input))).deck;
      const media = await readVideo(
        new File([Uint8Array.from(clip)], "movie.mp4", { type: "video/mp4" }),
      );
      deck.slides[0].elements.push(
        element("video", { ...media, autoPlay: true, loop: true, muted: true }),
      );
      deck = (await importPptx(await exportPptx(deck))).deck;
      const video = deck.slides[0].elements.find((e) => e.type === "video")!;
      Object.assign(video, { autoPlay: false, loop: false, muted: false });
      const warnings: string[] = [];
      const bytes = await exportPptx(deck, {
          onWarning: (s) => warnings.push(s),
        }),
        zip = await JSZip.loadAsync(bytes);
      const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
      const next = (await importPptx(bytes)).deck.slides[0].elements.find(
        (e) => e.type === "video",
      )!;
      return {
        warnings,
        audio: (xml.match(/<p:audio>/g) ?? []).length,
        videos: (xml.match(/<p:video>/g) ?? []).length,
        settings: {
          autoPlay: next.autoPlay,
          loop: next.loop,
          muted: next.muted,
        },
      };
    },
    { input: [...input], clip: [...clip] },
  );
  expect(result).toEqual({
    warnings: [],
    audio: 1,
    videos: 1,
    settings: { autoPlay: false, loop: false, muted: false },
  });
});

test("a PNG-backed SVG extension is preserved even when the file has no other unsupported content", async ({
  page,
}) => {
  const source = await fixture(),
    zip = await JSZip.loadAsync(source);
  let xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  xml = xml
    .replace(/<p:timing>[\s\S]*?<\/p:timing>/, "")
    .replace(/<p:transition[\s\S]*?<\/p:transition>/, "")
    .replace(
      /<p:pic>(?:(?!<p:pic>)[\s\S])*?name="Vector 90"[\s\S]*?<\/p:pic>/,
      "",
    )
    .replace(
      /<a:pattFill[\s\S]*?<\/a:pattFill>/,
      '<a:solidFill><a:srgbClr val="DD8822"/></a:solidFill>',
    );
  zip.file("ppt/slides/slide1.xml", xml);
  const input = await zip.generateAsync({ type: "uint8array" });
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(
    async (input) => {
      const { importPptx, exportPptx } = await import("/src/io.ts");
      const { default: JSZip } = await import(
        "/node_modules/.vite/deps/jszip.js"
      );
      const deck = (await importPptx(Uint8Array.from(input))).deck;
      const sourceCount = deck.pptxSources?.length;
      deck.slides[0].elements.find((e) => e.name === "Vector 91")!.rotation =
        15;
      const saved = await JSZip.loadAsync(await exportPptx(deck));
      return {
        sourceCount,
        svg: await Promise.all(
          Object.keys(saved.files)
            .filter((p) => p.endsWith(".svg"))
            .map((p) => saved.file(p)!.async("string")),
        ),
        xml: await saved.file("ppt/slides/slide1.xml")!.async("string"),
      };
    },
    [...input],
  );
  expect(result.sourceCount).toBe(1);
  expect(result.svg).toEqual([svg]);
  expect(result.xml).toContain("svgBlip");
});

test("native embedded-font bytes, custom shows and their reordered slide relationships remain intact", async ({
  page,
}, info) => {
  const zip = await JSZip.loadAsync(await fixture()),
    font = await fs.readFile("public/fonts/NanumBarunGothic.ttf");
  let xml = await zip.file("ppt/presentation.xml")!.async("string");
  const ids = [...xml.matchAll(/<p:sldId id="[^"]+" r:id="([^"]+)"/g)].map(
    (m) => m[1],
  );
  const additions = `<p:embeddedFontLst><p:embeddedFont><p:font typeface="NanumBarunGothic"/><p:regular r:id="rIdOriginalFont"/></p:embeddedFont></p:embeddedFontLst><p:custShowLst><p:custShow name="Original custom show" id="0"><p:sldLst><p:sld r:id="${ids[1]}"/><p:sld r:id="${ids[0]}"/></p:sldLst></p:custShow></p:custShowLst>`;
  xml = xml.replace("<p:defaultTextStyle>", additions + "<p:defaultTextStyle>");
  zip.file("ppt/presentation.xml", xml);
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    (
      await zip.file("ppt/_rels/presentation.xml.rels")!.async("string")
    ).replace(
      "</Relationships>",
      `<Relationship Id="rIdOriginalFont" Type="${R}/font" Target="fonts/original.fntdata"/></Relationships>`,
    ),
  );
  zip.file("ppt/fonts/original.fntdata", font);
  zip.file(
    "[Content_Types].xml",
    (await zip.file("[Content_Types].xml")!.async("string")).replace(
      "</Types>",
      '<Default Extension="fntdata" ContentType="application/x-fontdata"/></Types>',
    ),
  );
  const input = await zip.generateAsync({ type: "uint8array" });
  await fs.writeFile(info.outputPath("font-show-source.pptx"), input);
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(
    async (input) => {
      const { importPptx, exportPptx } = await import("/src/io.ts");
      const { default: JSZip } = await import(
        "/node_modules/.vite/deps/jszip.js"
      );
      const deck = (await importPptx(Uint8Array.from(input))).deck;
      deck.slides.reverse();
      const warnings: string[] = [];
      const bytes = await exportPptx(deck, {
          onWarning: (s) => warnings.push(s),
        }),
        zip = await JSZip.loadAsync(bytes);
      const parse = (s: string) =>
          new DOMParser().parseFromString(s, "application/xml"),
        doc = parse(await zip.file("ppt/presentation.xml")!.async("string")),
        rels = parse(
          await zip.file("ppt/_rels/presentation.xml.rels")!.async("string"),
        );
      const shows = Array.from(doc.getElementsByTagNameNS("*", "custShow")),
        rid = (n: Element) =>
          n.getAttributeNS(
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
            "id",
          );
      const targets = Array.from(
        shows[0].getElementsByTagNameNS("*", "sld"),
      ).map((n) =>
        Array.from(rels.getElementsByTagNameNS("*", "Relationship"))
          .find((r) => r.getAttribute("Id") === rid(n))!
          .getAttribute("Target"),
      );
      const fontPaths = Object.keys(zip.files).filter((p) =>
        p.endsWith(".fntdata"),
      );
      return {
        warnings,
        targets,
        font: await zip.file(fontPaths[0])!.async("base64"),
        fonts: doc.getElementsByTagNameNS("*", "embeddedFont").length,
        bytes: [...bytes],
      };
    },
    [...input],
  );
  await fs.writeFile(
    info.outputPath("font-show-roundtrip.pptx"),
    Buffer.from(result.bytes),
  );
  expect(result.warnings).toEqual([]);
  expect(result.font).toBe(font.toString("base64"));
  expect(result.fonts).toBe(1);
  expect(result.targets).toEqual([
    "/ppt/slides/slide1.xml",
    "/ppt/slides/slide2.xml",
  ]);
});

test("asymmetric text borders remain one editable object on a preserved animated slide", async ({
  page,
}) => {
  const input = await fixture();
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(
    async (input) => {
      const { importPptx, exportPptx } = await import("/src/io.ts");
      let deck = (await importPptx(Uint8Array.from(input))).deck;
      const title = deck.slides[0].elements.find((e) => e.name === "Title")!;
      title.borders = [1, 2, 3, 4].map((width) => ({
        width,
        color: "#224466",
      })) as any;
      let counts = [];
      for (let i = 0; i < 3; i++) {
        deck = (await importPptx(await exportPptx(deck))).deck;
        counts.push({
          elements: deck.slides[0].elements.length,
          borders: deck.slides[0].elements
            .find((e) => e.name === "Title")
            ?.borders?.map((b) => b.width),
        });
      }
      return counts;
    },
    [...input],
  );
  expect(result).toEqual(Array(3).fill({ elements: 4, borders: [1, 2, 3, 4] }));
});

test("external audio is never fetched and saving reports its exclusion without a dangling sound relationship", async ({
  page,
}, info) => {
  const zip = await JSZip.loadAsync(await fixture()),
    path = "ppt/slides/_rels/slide1.xml.rels";
  zip.file(
    path,
    (await zip.file(path)!.async("string")).replace(
      /Target="\.\.\/media\/original.wav"/,
      'Target="https://example.invalid/private.wav" TargetMode="External"',
    ),
  );
  const input = await zip.generateAsync({ type: "uint8array" });
  let fetched = 0;
  await page.route("https://example.invalid/**", (route) => {
    fetched++;
    return route.abort();
  });
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(
    async (input) => {
      const { importPptx, exportPptx } = await import("/src/io.ts");
      const { default: JSZip } = await import(
        "/node_modules/.vite/deps/jszip.js"
      );
      const deck = (await importPptx(Uint8Array.from(input))).deck,
        warnings: string[] = [];
      const bytes = await exportPptx(deck, {
          onWarning: (s) => warnings.push(s),
        }),
        zip = await JSZip.loadAsync(bytes);
      return {
        warnings,
        xml: await zip.file("ppt/slides/slide1.xml")!.async("string"),
        bytes: [...bytes],
      };
    },
    [...input],
  );
  await fs.writeFile(
    info.outputPath("external-audio.pptx"),
    Buffer.from(result.bytes),
  );
  expect(fetched).toBe(0);
  expect(result.warnings.join(" ")).toContain("외부 연결");
  expect(result.xml).not.toContain("<p:audio");
  expect(result.xml).toContain("animEffect");
});

test("choosing None explicitly removes a preserved unsupported timed transition", async ({
  page,
}) => {
  const input = await fixture();
  await page.goto("http://127.0.0.1:5190");
  await page.locator('input[accept*=".pptx"]').setInputFiles({
    name: "transition.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: input,
  });
  await page.getByRole("button", { name: "전환", exact: true }).click();
  await page.getByRole("button", { name: "없음", exact: true }).click();
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  const xml = await page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts");
    const { exportPptx } = await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const zip = await JSZip.loadAsync(
      await exportPptx((await loadAutosave())!),
    );
    return zip.file("ppt/slides/slide1.xml")!.async("string");
  });
  expect(xml).not.toContain("<p:transition");
  expect(xml).toContain("<p:audio");
  expect(xml).toContain("animEffect");
});

test("cropping a PNG-backed SVG keeps the vector bytes and writes srcRect before stretch", async ({
  page,
}, info) => {
  const input = await fixture();
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(
    async (input) => {
      const { importPptx, exportPptx } = await import("/src/io.ts");
      const { default: JSZip } = await import(
        "/node_modules/.vite/deps/jszip.js"
      );
      const deck = (await importPptx(Uint8Array.from(input))).deck;
      deck.slides[0].elements.find((e) => e.name === "Vector 91")!.crop = [
        0.1, 0.2, 0.1, 0.2,
      ];
      const warnings: string[] = [];
      const bytes = await exportPptx(deck, {
          onWarning: (s) => warnings.push(s),
        }),
        zip = await JSZip.loadAsync(bytes),
        doc = new DOMParser().parseFromString(
          await zip.file("ppt/slides/slide1.xml")!.async("string"),
          "application/xml",
        );
      const pic = Array.from(doc.getElementsByTagNameNS("*", "pic")).find((n) =>
          Array.from(n.getElementsByTagNameNS("*", "cNvPr")).some(
            (p) => p.getAttribute("name") === "Vector 91",
          ),
        )!,
        fill = pic.getElementsByTagNameNS("*", "blipFill")[0];
      return {
        warnings,
        children: Array.from(fill.children).map((n) => n.localName),
        svg: await Promise.all(
          Object.keys(zip.files)
            .filter((p) => p.endsWith(".svg"))
            .map((p) => zip.file(p)!.async("string")),
        ),
        bytes: [...bytes],
        crop: (await importPptx(bytes)).deck.slides[0].elements.find(
          (e) => e.name === "Vector 91",
        )?.crop,
      };
    },
    [...input],
  );
  await fs.writeFile(
    info.outputPath("cropped-vector.pptx"),
    Buffer.from(result.bytes),
  );
  expect(result.warnings).toEqual([]);
  expect(result.children).toEqual(["blip", "srcRect", "stretch"]);
  expect(result.svg).toEqual([svg]);
  expect(result.crop).toEqual([0.1, 0.2, 0.1, 0.2]);
});

test("moving unmodeled rich text preserves it, while editing its content reports the exact formatting limitation", async ({
  page,
}, info) => {
  const zip = await JSZip.loadAsync(await fixture()),
    path = "ppt/slides/slide1.xml";
  zip.file(
    path,
    (await zip.file(path)!.async("string")).replace(
      "<a:rPr ",
      '<a:rPr strike="sngStrike" ',
    ),
  );
  const input = await zip.generateAsync({ type: "uint8array" });
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(
    async (input) => {
      const { importPptx, exportPptx } = await import("/src/io.ts");
      const { editText } = await import("/src/text-layout.ts");
      const { default: JSZip } = await import(
        "/node_modules/.vite/deps/jszip.js"
      );
      const deck = (await importPptx(Uint8Array.from(input))).deck,
        title = deck.slides[0].elements.find((e) => e.name === "Title")!;
      title.x += 20;
      const before: string[] = [];
      let bytes = await exportPptx(deck, { onWarning: (s) => before.push(s) }),
        zip = await JSZip.loadAsync(bytes);
      const moved = await zip.file("ppt/slides/slide1.xml")!.async("string");
      Object.assign(title, editText(title, "수정한 특수 서식 제목"));
      const after: string[] = [];
      bytes = await exportPptx(deck, { onWarning: (s) => after.push(s) });
      return { before, after, moved, bytes: [...bytes] };
    },
    [...input],
  );
  await fs.writeFile(
    info.outputPath("edited-rich-text.pptx"),
    Buffer.from(result.bytes),
  );
  expect(result.before).toEqual([]);
  expect(result.moved).toContain('strike="sngStrike"');
  expect(result.after.join(" ")).toContain("취소선");
});

test("SVG is carried as opaque original bytes including its XML declaration without loading SVG resources", async ({
  page,
}, info) => {
  const zip = await JSZip.loadAsync(await fixture());
  const original = Buffer.from(
    '\ufeff<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><image href="https://example.invalid/not-loaded.png" width="1" height="1"/><rect width="160" height="90" fill="#224488"/></svg>',
    "utf8",
  );
  zip.file("ppt/media/original.svg", original);
  const input = await zip.generateAsync({ type: "uint8array" });
  let requests = 0;
  await page.route("https://example.invalid/**", (route) => {
    requests++;
    return route.abort();
  });
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(
    async (input) => {
      const { importPptx, exportPptx } = await import("/src/io.ts");
      const { default: JSZip } = await import(
        "/node_modules/.vite/deps/jszip.js"
      );
      const deck = (await importPptx(Uint8Array.from(input))).deck;
      deck.slides[0].elements.find((e) => e.name === "Vector 91")!.crop = [
        0.1, 0.1, 0.1, 0.1,
      ];
      const warnings: string[] = [];
      const bytes = await exportPptx(deck, {
          onWarning: (s) => warnings.push(s),
        }),
        zip = await JSZip.loadAsync(bytes);
      return {
        warnings,
        svg: await Promise.all(
          Object.keys(zip.files)
            .filter((p) => p.endsWith(".svg"))
            .map((p) => zip.file(p)!.async("base64")),
        ),
        bytes: [...bytes],
      };
    },
    [...input],
  );
  await fs.writeFile(
    info.outputPath("opaque-svg.pptx"),
    Buffer.from(result.bytes),
  );
  expect(result.warnings).toEqual([]);
  expect(result.svg).toEqual([original.toString("base64")]);
  expect(requests).toBe(0);
});
