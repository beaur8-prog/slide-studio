import { expect, test } from "@playwright/test";
import sharp from "sharp";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";

test("duotone maps dark, mid and light luminance in sRGB without coloring transparent pixels", async ({
  page,
}, info) => {
  await page.goto("http://127.0.0.1:5190");
  await page.evaluate(async () => {
    const { default: React } = await import("/node_modules/.vite/deps/react.js");
    const {
      default: { createRoot },
    } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { ChartImageFill } = await import("/src/ChartImageFill.tsx");
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 80;
    const ctx = canvas.getContext("2d")!;
    for (const [i, value] of [0, 128, 255].entries()) {
      ctx.fillStyle = `rgb(${value} ${value} ${value})`;
      ctx.fillRect(i * 80, 0, 80, 80);
    }
    const host = document.createElement("div");
    host.id = "duotone-preview";
    Object.assign(host.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: "320px",
      height: "80px",
      zIndex: "999999",
      background: "white",
    });
    document.body.append(host);
    createRoot(host).render(
      React.createElement(
        "svg",
        { width: 320, height: 80 },
        React.createElement(ChartImageFill, {
          width: 320,
          height: 80,
          fill: {
            src: canvas.toDataURL(),
            width: 320,
            height: 80,
            dpi: 96,
            crop: [0, 0, 0, 0],
            fill: [0, 0, 0, 0],
            opacity: 1,
            duotone: { colors: ["#204060", "#E0C0A0"], opacities: [1, 1] },
          },
        }),
      ),
    );
  });
  const host = page.locator("#duotone-preview");
  await expect(host.locator("filter")).toHaveCount(1);
  await expect(host.locator("image")).toBeVisible();
  await page.waitForFunction(() =>
    document
      .querySelector("#duotone-preview image")
      ?.getAttribute("href")
      ?.startsWith("data:image/png"),
  );
  const screenshot = await host.screenshot();
  const sample = async (x: number) => [
    ...(await sharp(screenshot)
      .extract({ left: x, top: 40, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer()),
  ];
  expect(await sample(40)).toEqual([32, 64, 96]);
  expect(await sample(120)).toEqual([128, 128, 128]);
  expect(await sample(200)).toEqual([224, 192, 160]);
  expect(await sample(280)).toEqual([255, 255, 255]);
  await fs.writeFile(info.outputPath("duotone-ramp.png"), screenshot);
});

test("duotone endpoint opacity multiplies source alpha and outer opacity exactly once", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  await page.evaluate(async () => {
    const { default: React } = await import("/node_modules/.vite/deps/react.js");
    const {
      default: { createRoot },
    } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { ChartImageFill } = await import("/src/ChartImageFill.tsx");
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 80;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, 80, 80);
    ctx.fillStyle = "white";
    ctx.fillRect(80, 0, 80, 80);
    const host = document.createElement("div");
    host.id = "alpha-duotone";
    Object.assign(host.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: "160px",
      height: "80px",
      zIndex: "999999",
      background: "white",
    });
    document.body.append(host);
    createRoot(host).render(
      React.createElement(
        "svg",
        { width: 160, height: 80 },
        React.createElement(ChartImageFill, {
          width: 160,
          height: 80,
          fill: {
            src: canvas.toDataURL(),
            width: 160,
            height: 80,
            dpi: 96,
            crop: [0, 0, 0, 0],
            fill: [0, 0, 0, 0],
            opacity: 0.5,
            duotone: { colors: ["#204060", "#E0C0A0"], opacities: [0.2, 0.8] },
          },
        }),
      ),
    );
  });
  const host = page.locator("#alpha-duotone");
  await expect(host.locator("feComposite")).toHaveCount(1);
  const screenshot = await host.screenshot();
  for (const [x, color, alpha] of [
    [40, [32, 64, 96], 0.5 * 0.2 * 0.5],
    [120, [224, 192, 160], 0.8 * 0.5],
  ] as const) {
    const pixel = [
      ...(await sharp(screenshot)
        .extract({ left: x, top: 40, width: 1, height: 1 })
        .removeAlpha()
        .raw()
        .toBuffer()),
    ];
    color.forEach((c, i) =>
      expect(
        Math.abs(pixel[i] - (c * alpha + 255 * (1 - alpha))),
      ).toBeLessThanOrEqual(2),
    );
  }
});

test("duotone parsing resolves theme colors and rejects unsupported combinations without partially applying them", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { readDrawingmlImageFill, unsupportedDrawingmlImageEffects } =
      await import("/src/chart-image.ts");
    const { applyDrawingmlColorTransforms } = await import(
      "/src/drawingml-color.ts"
    );
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const src = canvas.toDataURL();
    const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
    const read = (xml: string, resolver?: any) => {
      const node = new DOMParser().parseFromString(
        `<a:blipFill xmlns:a="${A}"><a:blip>${xml}</a:blip><a:stretch><a:fillRect/></a:stretch></a:blipFill>`,
        "application/xml",
      ).documentElement;
      return {
        duotone: readDrawingmlImageFill(node, src, resolver)?.duotone,
        unsupported: unsupportedDrawingmlImageEffects(node),
      };
    };
    const effect =
      '<a:duotone><a:schemeClr val="accent1"><a:shade val="30000"/></a:schemeClr><a:srgbClr val="FBEEC9"><a:tint val="95000"/><a:satMod val="120000"/></a:srgbClr></a:duotone>';
    const resolver = (node: Element) =>
      applyDrawingmlColorTransforms(
        node.localName === "schemeClr"
          ? "#FBEEC9"
          : "#" + node.getAttribute("val"),
        Array.from(node.children),
      );
    return {
      valid: read(effect, resolver),
      missingTheme: read(effect),
      unknown: read(effect + '<a:blur rad="1"/>', resolver),
      duplicate: read(effect + effect, resolver),
      invalid: read(
        '<a:duotone><a:srgbClr val="url(x)"/><a:srgbClr val="FFFFFF"/></a:duotone>',
      ),
      unknownTransform: read(
        '<a:duotone><a:srgbClr val="000000"><a:inv/></a:srgbClr><a:srgbClr val="FFFFFF"/></a:duotone>',
      ),
      explicit: read(
        '<a:duotone><a:srgbClr val="000000"><a:alpha val="25000"/></a:srgbClr><a:srgbClr val="FFFFFF"/></a:duotone>',
      ),
    };
  });
  expect(result.valid.duotone?.colors).toEqual(["#928B74", "#FFF1C8"]);
  expect(result.explicit.duotone).toEqual({
    colors: ["#000000", "#FFFFFF"],
    opacities: [0.25, 1],
  });
  for (const key of [
    "missingTheme",
    "unknown",
    "duplicate",
    "invalid",
    "unknownTransform",
  ] as const)
    expect(result[key].duotone).toBeUndefined();
  expect(result.unknown.unsupported).toBe(true);
  expect(result.duplicate.unsupported).toBe(true);
});

test("native background duotone, source bytes, crop and tile survive recovery JSON, edits and three PPTX saves", async ({
  page,
}, info) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck, newSlide } = await import("/src/model.ts");
    const { exportPptx, importPptx, serializeDeck, parseDeckJson } =
      await import("/src/io.ts");
    const { default: JSZip } = await import("/node_modules/.vite/deps/jszip.js");
    const deck = blankDeck();
    deck.slides = [newSlide(), newSlide()];
    const zip = await JSZip.loadAsync(await exportPptx(deck));
    const canvas = document.createElement("canvas");
    canvas.width = 12;
    canvas.height = 8;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#888888";
    ctx.fillRect(0, 0, 12, 8);
    const src = canvas.toDataURL();
    zip.file("ppt/media/duotone.png", src.split(",")[1], { base64: true });
    zip.file(
      "[Content_Types].xml",
      (await zip.file("[Content_Types].xml")!.async("string")).replace(
        "</Types>",
        '<Default Extension="png" ContentType="image/png"/></Types>',
      ),
    );
    const effect =
      '<a:duotone><a:srgbClr val="204060"><a:alpha val="25000"/></a:srgbClr><a:srgbClr val="E0C0A0"/></a:duotone>';
    for (let i = 1; i <= 2; i++) {
      const path = `ppt/slides/slide${i}.xml`;
      let xml = await zip.file(path)!.async("string");
      xml = xml.replace(/<p:bg>[\s\S]*?<\/p:bg>/, "");
      xml = xml.replace(
        /(<p:cSld[^>]*>)/,
        '$1<p:bg><p:bgPr><a:blipFill><a:blip r:embed="duo">' +
          effect +
          '<a:alphaModFix amt="60000"/></a:blip><a:srcRect l="12500"/>' +
          (i === 1
            ? "<a:stretch><a:fillRect/></a:stretch>"
            : '<a:tile sx="200000" sy="150000" algn="ctr" flip="xy"/>') +
          "</a:blipFill><a:effectLst/></p:bgPr></p:bg>",
      );
      zip.file(path, xml);
      const rel = `ppt/slides/_rels/slide${i}.xml.rels`;
      zip.file(
        rel,
        (await zip.file(rel)!.async("string")).replace(
          "</Relationships>",
          '<Relationship Id="duo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/duotone.png"/></Relationships>',
        ),
      );
    }
    let imported = await importPptx(
      await zip.generateAsync({ type: "uint8array" }),
    );
    const rounds = [];
    const native = [];
    for (let i = 0; i < 4; i++) {
      const current = parseDeckJson(serializeDeck(imported.deck));
      rounds.push(current.slides.map((s) => s.backgroundImage));
      if (i === 3) break;
      // Editing forces native writer instead of copying the original raw bg.
      for (const slide of current.slides)
        slide.backgroundImage!.opacity = 0.6 - i * 0.1;
      const bytes = await exportPptx(current);
      const saved = await JSZip.loadAsync(bytes);
      native.push(await saved.file("ppt/slides/slide1.xml")!.async("string"));
      imported = await importPptx(bytes);
    }
    const invalid = [
      { colors: ["url(x)", "#FFFFFF"], opacities: [1, 1] },
      { colors: ["#FFFFFF"], opacities: [1, 1] },
      { colors: ["#FFFFFF", "#000000"], opacities: [-1, 1] },
      { colors: ["#FFFFFF", "#000000"], opacities: [1] },
    ].map((duotone) => {
      const d = structuredClone(imported.deck);
      d.slides[0].backgroundImage!.placement!.duotone = duotone as any;
      try {
        parseDeckJson(JSON.stringify(d));
        return false;
      } catch {
        return true;
      }
    });
    return { rounds, native, src, invalid };
  });
  expect(result.invalid.every(Boolean)).toBe(true);
  for (const rounds of result.rounds)
    for (const bg of rounds) {
      expect(bg?.src).toBe(result.src);
      expect(bg?.crop).toEqual([0, 0, 0, 0.125]);
      expect(bg?.placement?.duotone).toEqual({
        colors: ["#204060", "#E0C0A0"],
        opacities: [0.25, 1],
      });
    }
  expect(result.rounds[0][0]?.placement?.fill).toEqual([0, 0, 0, 0]);
  expect(result.rounds[3][1]?.placement?.tile).toMatchObject({
    align: "ctr",
    flip: "xy",
    scaleX: 2,
    scaleY: 1.5,
  });
  for (const xml of result.native) {
    expect(xml.match(/<a:duotone>/g)).toHaveLength(1);
    expect(xml).toContain('<a:alpha val="25000"');
    expect(xml.indexOf("a:duotone")).toBeLessThan(xml.indexOf("a:alphaModFix"));
  }
  await fs.writeFile(
    info.outputPath("native-duotone-background.xml"),
    result.native[2],
  );
});

test("POI Trek texture resolves placeholder transforms to gold while original JPEG stays byte identical", async ({
  page,
}, info) => {
  const path = "qa/samples/poi-themes.pptx";
  test.skip(!existsSync(path), "Optional public Apache POI fixture.");
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { importPptx, exportPptx } = await import("/src/io.ts");
    const { default: JSZip } = await import("/node_modules/.vite/deps/jszip.js");
    const bytes = await (
      await fetch("/qa/samples/poi-themes.pptx")
    ).arrayBuffer();
    let { deck } = await importPptx(bytes);
    const source = deck.slides[7].backgroundImage!.src;
    const original = structuredClone(deck.slides[7].backgroundImage);
    const rounds = [];
    for (let i = 0; i < 3; i++) {
      deck.slides[7].backgroundImage!.opacity = 0.9 - i * 0.1;
      deck = (await importPptx(await exportPptx(deck))).deck;
      rounds.push(deck.slides[7].backgroundImage);
    }
    return { source, original, rounds };
  });
  expect(result.original.placement?.duotone).toEqual({
    colors: ["#C8A43E", "#FFF1C8"],
    opacities: [1, 1],
  });
  for (const bg of result.rounds) {
    expect(bg?.src).toBe(result.source);
    expect(bg?.placement?.duotone).toEqual(result.original.placement?.duotone);
  }
  await page.locator('input[accept*=".pptx"]').setInputFiles(path);
  await expect(page.locator(".thumbnail-row")).toHaveCount(10);
  await expect(page.locator(".busy-backdrop")).toHaveCount(0);
  await page.locator(".thumbnail-row").nth(7).click();
  await expect(page.locator(".editable-slide filter")).toHaveCount(1);
  await page
    .locator(".editable-slide")
    .screenshot({ path: info.outputPath("poi-trek-gold.png") });
});

async function chartDuotone(image: Buffer, mime: string) {
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_WIDE";
  deck
    .addSlide()
    .addChart("bar", [{ name: "Values", labels: ["A", "B"], values: [2, 3] }], {
      x: 1,
      y: 1,
      w: 10,
      h: 5,
      showLegend: false,
    });
  const zip = await JSZip.loadAsync(
    (await deck.write({
      outputType: "uint8array",
      compression: true,
    })) as Uint8Array,
  );
  const path = Object.keys(zip.files).find((path) =>
    /^ppt\/charts\/chart\d+\.xml$/.test(path),
  )!;
  const xml = await zip.file(path)!.async("string");
  const start = xml.indexOf("</c:chart>") + "</c:chart>".length;
  const paint =
    '<c:spPr><a:blipFill><a:blip r:embed="duotoneImage"><a:duotone><a:schemeClr val="accent2"><a:shade val="30000"/></a:schemeClr><a:srgbClr val="FFF1C8"/></a:duotone></a:blip><a:stretch><a:fillRect/></a:stretch></a:blipFill></c:spPr>';
  zip.file(
    path,
    xml.slice(0, start) +
      paint +
      xml.slice(start).replace(/<c:spPr>.*?<\/c:spPr>/s, ""),
  );
  zip.file("ppt/media/duotone-chart.bin", image);
  const name = path.split("/").pop()!,
    rel = `ppt/charts/_rels/${name}.rels`;
  zip.file(
    rel,
    (await zip.file(rel)!.async("string")).replace(
      "</Relationships>",
      '<Relationship Id="duotoneImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/duotone-chart.bin"/></Relationships>',
    ),
  );
  zip.file(
    "[Content_Types].xml",
    (await zip.file("[Content_Types].xml")!.async("string")).replace(
      "</Types>",
      `<Override PartName="/ppt/media/duotone-chart.bin" ContentType="${mime}"/></Types>`,
    ),
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

test("chart duotone source theme, native effects, workbook and image survive cross-deck copy and three saves", async ({
  page,
}) => {
  const image = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "#888888" },
  })
    .png()
    .toBuffer();
  const bytes = await chartDuotone(image, "image/png");
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(
    async (data) => {
      const { importPptx, exportPptx } = await import("/src/io.ts");
      const { blankDeck, newSlide } = await import("/src/model.ts");
      const { copyElements } = await import("/src/object-groups.ts");
      const { readChartModel, chartPartText } = await import("/src/chart.ts");
      const original = (await importPptx(new Uint8Array(data))).deck;
      const chart = original.slides[0].elements.find(
        (e) => e.type === "chart",
      )!;
      let deck = blankDeck();
      deck.pptxSources = original.pptxSources;
      deck.slides = [
        { ...newSlide("blank"), elements: copyElements([chart], 0, 0) },
        original.slides[0],
      ];
      const snapshots = () =>
        deck.slides.map((s) => {
          const data = s.elements.find((e) => e.type === "chart")!.chart!;
          return {
            fill: readChartModel(data).backgroundImage,
            images: data.parts
              .filter((p) => p.contentType.startsWith("image/"))
              .map((p) => p.data),
            workbooks: data.parts
              .filter((p) => p.contentType.includes("spreadsheetml"))
              .map((p) => p.data),
            effect: chartPartText(
              data.parts.find((p) => p.path === data.root)!.data,
            ).includes("duotone"),
          };
        });
      const rounds = [snapshots()];
      for (let i = 0; i < 3; i++) {
        deck = (await importPptx(await exportPptx(deck))).deck;
        rounds.push(snapshots());
      }
      return rounds;
    },
    [...bytes],
  );
  const initial = result[0][0];
  expect(initial.fill?.duotone?.colors[0]).toMatch(/^#[A-F0-9]{6}$/);
  expect(initial.fill?.duotone?.colors[0]).not.toBe("#ED7D31");
  expect(initial.workbooks).toHaveLength(1);
  for (const round of result)
    for (const chart of round) {
      expect(chart).toEqual(initial);
      expect(chart.images).toContain(image.toString("base64"));
    }
});

test("duotone GIF stays still while editing and retains animation only in the active show", async ({
  page,
}) => {
  const image = await fs.readFile("tests/fixtures/media/animated.gif");
  const bytes = await chartDuotone(image, "image/gif");
  const source = "data:image/gif;base64," + image.toString("base64");
  await page.goto("http://127.0.0.1:5190");
  await page.locator('input[accept*=".pptx"]').setInputFiles({
    name: "duotone-gif.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: bytes,
  });
  const imageView = page.locator(
    ".editable-slide [data-chart-image-fill] image",
  );
  await expect(imageView).toHaveCount(1);
  await expect(page.locator(".busy-backdrop")).toHaveCount(0);
  await expect(
    page.locator(".editable-slide [data-chart-image-fill] filter"),
  ).toHaveCount(1);
  const still = await imageView.getAttribute("href");
  expect(still).not.toBe(source);
  await page.getByRole("button", { name: "발표 모드", exact: true }).click();
  await expect(
    page.locator(".present-slide [data-chart-image-fill] image"),
  ).toHaveAttribute("href", source);
  await expect(
    page.locator(".present-slide [data-chart-image-fill] filter"),
  ).toHaveCount(1);
  await page.keyboard.press("b");
  await expect(
    page.locator(".present-slide [data-chart-image-fill] image"),
  ).toHaveAttribute("href", still!);
  await page.keyboard.press("Escape");
  await expect(imageView).toHaveAttribute("href", still!);
});

test("duotone filter is shared by mirrored tile cells without moving or clipping the source", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  await page.evaluate(async () => {
    const { default: React } = await import("/node_modules/.vite/deps/react.js");
    const {
      default: { createRoot },
    } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { ChartImageFill } = await import("/src/ChartImageFill.tsx");
    const canvas = document.createElement("canvas");
    canvas.width = 80;
    canvas.height = 40;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, 40, 40);
    ctx.fillStyle = "white";
    ctx.fillRect(40, 0, 40, 40);
    const host = document.createElement("div");
    host.id = "duotone-tile";
    Object.assign(host.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: "160px",
      height: "40px",
      zIndex: "999999",
      background: "white",
    });
    document.body.append(host);
    createRoot(host).render(
      React.createElement(
        "svg",
        { width: 160, height: 40 },
        React.createElement(ChartImageFill, {
          width: 160,
          height: 40,
          fill: {
            src: canvas.toDataURL(),
            width: 80,
            height: 40,
            dpi: 96,
            crop: [0, 0, 0, 0],
            fill: [0, 0, 0, 0],
            opacity: 1,
            tile: {
              scaleX: 1,
              scaleY: 1,
              offsetX: 0,
              offsetY: 0,
              align: "tl",
              flip: "x",
            },
            duotone: { colors: ["#204060", "#E0C0A0"], opacities: [1, 1] },
          },
        }),
      ),
    );
  });
  const host = page.locator("#duotone-tile");
  await expect(host.locator("image")).toHaveCount(2);
  await expect(host.locator("filter")).toHaveCount(1);
  const screenshot = await host.screenshot();
  for (const [x, color] of [
    [20, [32, 64, 96]],
    [60, [224, 192, 160]],
    [100, [224, 192, 160]],
    [140, [32, 64, 96]],
  ] as const)
    expect([
      ...(await sharp(screenshot)
        .extract({ left: x, top: 20, width: 1, height: 1 })
        .removeAlpha()
        .raw()
        .toBuffer()),
    ]).toEqual(color);
});

test("unsupported picture effects keep native XML, warn about the preview, and never partially apply duotone", async ({
  page,
}) => {
  const png = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "#888888" },
  })
    .png()
    .toBuffer();
  const zip = await JSZip.loadAsync(await chartDuotone(png, "image/png"));
  const chart = Object.keys(zip.files).find((path) =>
    /^ppt\/charts\/chart\d+\.xml$/.test(path),
  )!;
  zip.file(
    chart,
    (await zip.file(chart)!.async("string")).replace(
      "</a:blip>",
      '<a:blur rad="20000"/></a:blip>',
    ),
  );
  zip.file(
    "ppt/slides/slide1.xml",
    (await zip.file("ppt/slides/slide1.xml")!.async("string"))
      .replace(/<p:bg>[\s\S]*?<\/p:bg>/, "")
      .replace(
        /(<p:cSld[^>]*>)/,
        '$1<p:bg><p:bgPr><a:blipFill><a:blip r:embed="unknownEffect"><a:duotone><a:srgbClr val="204060"/><a:srgbClr val="E0C0A0"/></a:duotone><a:blur rad="20000"/></a:blip><a:stretch><a:fillRect/></a:stretch></a:blipFill></p:bgPr></p:bg>',
      ),
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    (
      await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string")
    ).replace(
      "</Relationships>",
      '<Relationship Id="unknownEffect" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/duotone-chart.bin"/></Relationships>',
    ),
  );
  const bytes = await zip.generateAsync({ type: "nodebuffer" });
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(
    async (data) => {
      const { importPptx, exportPptx } = await import("/src/io.ts");
      const { readChartModel, chartPartText } = await import("/src/chart.ts");
      const { default: JSZip } = await import("/node_modules/.vite/deps/jszip.js");
      let imported = await importPptx(new Uint8Array(data));
      const warnings = imported.warnings;
      const rounds = [];
      for (let i = 0; i < 4; i++) {
        const chart = imported.deck.slides[0].elements.find(
          (e) => e.type === "chart",
        )!.chart!;
        const model = readChartModel(chart);
        const native = chartPartText(
          chart.parts.find((p) => p.path === chart.root)!.data,
        );
        rounds.push({
          approximate: model.approximate,
          duotone: model.backgroundImage?.duotone,
          bgDuotone:
            imported.deck.slides[0].backgroundImage?.placement?.duotone,
          native: native.includes("duotone") && native.includes("blur"),
        });
        if (i < 3) imported = await importPptx(await exportPptx(imported.deck));
      }
      return { warnings, rounds };
    },
    [...bytes],
  );
  expect(result.warnings).toContain(
    "일부 그림 배경 효과는 화면에 표시되지 않지만 원본 PPTX에는 보존됩니다.",
  );
  expect(
    result.warnings.some((w) => w.includes("차트") && w.includes("제한")),
  ).toBe(true);
  for (const round of result.rounds) {
    expect(round).toMatchObject({ approximate: true, native: true });
    expect(round.duotone).toBeUndefined();
    expect(round.bgDuotone).toBeUndefined();
  }
});
