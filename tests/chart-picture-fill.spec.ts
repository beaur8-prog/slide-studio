import { test, expect, type Page } from "@playwright/test";
import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import sharp from "sharp";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";

async function png() {
  const bytes = Buffer.alloc(20 * 10 * 3);
  for (let y = 0; y < 10; y++)
    for (let x = 0; x < 20; x++) {
      const offset = (y * 20 + x) * 3;
      bytes[offset] = x < 10 ? 255 : 0;
      bytes[offset + 2] = x < 10 ? 0 : 255;
    }
  return sharp(bytes, { raw: { width: 20, height: 10, channels: 3 } })
    .png()
    .withMetadata({ density: 144 })
    .toBuffer();
}
async function fixture(
  image: Buffer,
  placement = "<a:stretch><a:fillRect/></a:stretch>",
  options: { plot?: boolean; alpha?: number; dpi?: number; mime?: string } = {},
) {
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
    ),
    chart = Object.keys(zip.files).find((path) =>
      /^ppt\/charts\/chart\d+\.xml$/.test(path),
    )!,
    name = chart.split("/").pop()!,
    relPath = `ppt/charts/_rels/${name}.rels`,
    imagePath = "ppt/media/chart-fill.bin";
  let xml = await zip.file(chart)!.async("string");
  const paint = `<c:spPr><a:blipFill${options.dpi ? ` dpi="${options.dpi}"` : ""}><a:blip r:embed="chartPicture">${options.alpha === undefined ? "" : `<a:alphaModFix amt="${options.alpha}"/>`}</a:blip>${placement}</a:blipFill></c:spPr>`;
  if (options.plot) {
    const end = xml.indexOf("</c:plotArea>"),
      start = Math.max(
        ...["valAx", "catAx", "dateAx"].map((axis) => {
          const value = xml.lastIndexOf(`</c:${axis}>`, end);
          return value < 0 ? 0 : value + `</c:${axis}>`.length;
        }),
      );
    xml =
      xml.slice(0, start) +
      xml.slice(start, end).replace(/<c:spPr>.*?<\/c:spPr>/s, "") +
      paint +
      xml.slice(end);
  } else {
    const start = xml.indexOf("</c:chart>") + "</c:chart>".length;
    xml =
      xml.slice(0, start) +
      paint +
      xml.slice(start).replace(/<c:spPr>.*?<\/c:spPr>/s, "");
  }
  zip.file(chart, xml);
  zip.file(imagePath, image);
  const rels = await zip.file(relPath)!.async("string");
  zip.file(
    relPath,
    rels.replace(
      "</Relationships>",
      '<Relationship Id="chartPicture" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="/ppt/media/chart-fill.bin"/></Relationships>',
    ),
  );
  zip.file(
    "[Content_Types].xml",
    (await zip.file("[Content_Types].xml")!.async("string")).replace(
      "</Types>",
      `<Override PartName="/${imagePath}" ContentType="${options.mime ?? "image/png"}"/></Types>`,
    ),
  );
  return zip.generateAsync({ type: "nodebuffer" });
}
async function open(page: Page, bytes: Buffer) {
  await page.goto("http://127.0.0.1:5190");
  await page.locator('input[accept*=".pptx"]').setInputFiles({
    name: "chart-image.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: bytes,
  });
  await expect(page.locator('.editable-slide [data-type="chart"]')).toHaveCount(
    1,
  );
  await expect(page.locator(".busy-backdrop")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { loadAutosave } = await import("/src/storage.ts");
        return (
          (await loadAutosave())?.slides[0].elements.some(
            (element) => element.type === "chart",
          ) ?? false
        );
      }),
    )
    .toBe(true);
}

test("chart area raster picture appears and crop is applied before stretch", async ({
  page,
}, info) => {
  await open(
    page,
    await fixture(
      await png(),
      '<a:srcRect l="50000"/><a:stretch><a:fillRect/></a:stretch>',
    ),
  );
  const fill = page.locator(
    '.editable-slide [data-chart-image-fill="stretch"]',
  );
  await expect(fill).toHaveCount(1);
  await expect(fill.locator("svg[viewBox]")).toHaveAttribute(
    "viewBox",
    "10 0 10 10",
  );
  const screenshot = await page
    .locator(".editable-slide .chart-visual")
    .screenshot();
  const metadata = await sharp(screenshot).metadata();
  const pixel = await sharp(screenshot)
    .extract({
      left: Math.floor(metadata.width! / 2),
      top: 3,
      width: 1,
      height: 1,
    })
    .removeAlpha()
    .raw()
    .toBuffer();
  expect([...pixel]).toEqual([0, 0, 255]);
  await fs.writeFile(info.outputPath("cropped-background.png"), screenshot);
});

test("plot area placement, alpha, tile scale, DPI, offsets and mirrored cells are preserved", async ({
  page,
}, info) => {
  await open(
    page,
    await fixture(
      await png(),
      '<a:srcRect l="50000"/><a:tile tx="9525" ty="19050" sx="200000" sy="100000" algn="tl" flip="xy"/>',
      { plot: true, alpha: 50000, dpi: 192 },
    ),
  );
  const fill = page.locator('.editable-slide [data-chart-image-fill="tile"]');
  await expect(fill).toHaveAttribute("opacity", "0.5");
  await expect(fill.locator("pattern")).toHaveAttribute("width", "20");
  await expect(fill.locator("pattern")).toHaveAttribute("height", "10");
  await expect(fill.locator("image")).toHaveCount(4);
  const result = await page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts"),
      { readChartModel } = await import("/src/chart.ts");
    const deck = (await loadAutosave())!;
    return readChartModel(
      deck.slides[0].elements.find((element) => element.type === "chart")!
        .chart!,
    ).plotImage;
  });
  expect(result).toMatchObject({
    width: 20,
    height: 10,
    dpi: 192,
    crop: [0, 0, 0, 0.5],
    opacity: 0.5,
    tile: {
      scaleX: 2,
      scaleY: 1,
      offsetX: 1,
      offsetY: 2,
      align: "tl",
      flip: "xy",
    },
  });
  await page
    .locator(".editable-slide .chart-visual")
    .screenshot({ path: info.outputPath("plot-tile.png") });
});

test("stretch fillRect, image header DPI and original picture bytes survive three saves and chart copy", async ({
  page,
}, info) => {
  const image = await png(),
    bytes = await fixture(
      image,
      '<a:stretch><a:fillRect t="10000" r="20000" b="10000" l="20000"/></a:stretch>',
    );
  await open(page, bytes);
  const result = await page.evaluate(
    async (data) => {
      const { importPptx, exportPptx } = await import("/src/io.ts"),
        { blankDeck, newSlide } = await import("/src/model.ts"),
        { copyElements } = await import("/src/object-groups.ts"),
        { readChartModel } = await import("/src/chart.ts");
      const original = (await importPptx(new Uint8Array(data))).deck,
        chart = original.slides[0].elements.find(
          (element) => element.type === "chart",
        )!;
      let deck = blankDeck();
      deck.pptxSources = original.pptxSources;
      deck.slides = [
        { ...newSlide("blank"), elements: [copyElements([chart], 0, 0)[0]] },
        original.slides[0],
      ];
      const snapshots = () =>
        deck.slides.map((slide) => {
          const chart = slide.elements.find(
            (element) => element.type === "chart",
          )!.chart!;
          return {
            model: readChartModel(chart),
            image: chart.parts.find((part) => part.contentType === "image/png")!
              .data,
          };
        });
      const before = snapshots(),
        rounds = [];
      let output = new Uint8Array();
      for (let round = 0; round < 3; round++) {
        output = await exportPptx(deck);
        deck = (await importPptx(output)).deck;
        rounds.push(snapshots());
      }
      return { before, rounds, output: [...output] };
    },
    [...bytes],
  );
  expect(result.before[0].image).toBe(image.toString("base64"));
  expect(result.before[0].model.backgroundImage!.dpi).toBeCloseTo(144, 1);
  expect(result.before[0].model.backgroundImage!.fill).toEqual([
    0.1, 0.2, 0.1, 0.2,
  ]);
  for (const round of result.rounds) expect(round).toEqual(result.before);
  await fs.writeFile(
    info.outputPath("picture-fill-roundtrip.pptx"),
    Buffer.from(result.output),
  );
});

test("public Apache POI flower photo fills the native chart and retains original JPEG bytes", async ({
  page,
}, info) => {
  const filename = "qa/samples/poi-chart-picture-bg.pptx";
  test.skip(
    !existsSync(filename),
    "Download the public Apache POI picture background sample first.",
  );
  const bytes = await fs.readFile(filename);
  await open(page, bytes);
  await expect(
    page.locator(".editable-slide [data-chart-image-fill] image"),
  ).toHaveCount(1);
  const result = await page.evaluate(
    async (data) => {
      const { importPptx, exportPptx } = await import("/src/io.ts"),
        { readChartModel } = await import("/src/chart.ts");
      let deck = (await importPptx(new Uint8Array(data))).deck;
      const snapshot = () => {
        const chart = deck.slides[0].elements.find(
          (element) => element.type === "chart",
        )!.chart!;
        return {
          model: readChartModel(chart),
          jpg: chart.parts.find((part) => part.contentType === "image/jpeg")!
            .data,
        };
      };
      const before = snapshot(),
        rounds = [];
      for (let round = 0; round < 3; round++) {
        deck = (await importPptx(await exportPptx(deck))).deck;
        rounds.push(snapshot());
      }
      return { before, rounds };
    },
    [...bytes],
  );
  expect(result.before.model.backgroundImage?.src).toBe(
    "data:image/jpeg;base64," + result.before.jpg,
  );
  for (const round of result.rounds) expect(round).toEqual(result.before);
  await page
    .locator(".editable-slide .chart-visual")
    .screenshot({ path: info.outputPath("poi-photo-background.png") });
});

test("malformed, active and oversized image fills do not become browser image sources", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const valid = "data:image/png;base64," + (await png()).toString("base64");
  const result = await page.evaluate(async (valid) => {
    const { readDrawingmlImageFill } = await import("/src/chart-image.ts");
    const node = new DOMParser().parseFromString(
      '<a:blipFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:blip/><a:stretch><a:fillRect/></a:stretch></a:blipFill>',
      "application/xml",
    ).documentElement;
    const oversized = Uint8Array.from(atob(valid.split(",")[1]), (value) =>
      value.charCodeAt(0),
    );
    new DataView(oversized.buffer).setUint32(16, 100000);
    new DataView(oversized.buffer).setUint32(20, 100000);
    const source =
      "data:image/png;base64," + btoa(String.fromCharCode(...oversized));
    const unsupported = [
      "https://example.test/image.png",
      "data:text/html;base64,PHNjcmlwdD4=",
      "data:image/svg+xml;base64," +
        btoa('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'),
      "data:image/png;base64,%%%%",
      "data:image/png;base64," + btoa("not a PNG"),
      source,
    ].map((source) => readDrawingmlImageFill(node, source));
    return { unsupported, valid: !!readDrawingmlImageFill(node, valid) };
  }, valid);
  expect(
    result.unsupported.every((value) => value === undefined || value === null),
  ).toBe(true);
  expect(result.valid).toBe(true);
});

test("animated chart pictures stay still in editor and use original GIF only in the active show", async ({
  page,
}) => {
  const gif = await fs.readFile("tests/fixtures/media/animated.gif"),
    source = "data:image/gif;base64," + gif.toString("base64");
  await open(
    page,
    await fixture(gif, "<a:stretch><a:fillRect/></a:stretch>", {
      mime: "image/gif",
    }),
  );
  const still = await page
    .locator(".editable-slide [data-chart-image-fill] image")
    .getAttribute("href");
  expect(still).not.toBe(source);
  expect(
    (
      await sharp(Buffer.from(still!.split(",")[1], "base64"), {
        animated: true,
      }).metadata()
    ).pages ?? 1,
  ).toBe(1);
  await page.getByRole("button", { name: "발표 모드", exact: true }).click();
  await expect(
    page.locator(".present-slide [data-chart-image-fill] image"),
  ).toHaveAttribute("href", source);
  await page.keyboard.press("b");
  await expect(
    page.locator(".present-slide [data-chart-image-fill] image"),
  ).toHaveAttribute("href", still!);
  await page.keyboard.press("Escape");
  await expect(
    page.locator(".editable-slide [data-chart-image-fill] image"),
  ).toHaveAttribute("href", still!);
});

test("invalid tile enums fall back safely and zero DPI uses the original image header", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(
    async (source) => {
      const { readDrawingmlImageFill } = await import("/src/chart-image.ts");
      const node = new DOMParser().parseFromString(
        '<a:blipFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" dpi="0"><a:blip/><a:tile algn="wrong" flip="wrong"/></a:blipFill>',
        "application/xml",
      ).documentElement;
      return readDrawingmlImageFill(node, source);
    },
    "data:image/png;base64," + (await png()).toString("base64"),
  );
  expect(result?.tile).toMatchObject({ align: "tl", flip: "none" });
  expect(result?.dpi).toBeCloseTo(144, 1);
});

test("all nine tile alignments anchor the original picture without confusing center and right", async ({
  page,
}) => {
  const image = await png();
  for (const align of ["ctr", "tl", "t", "tr", "l", "r", "bl", "b", "br"]) {
    await open(
      page,
      await fixture(image, `<a:tile algn="${align}"/>`, { dpi: 96 }),
    );
    const chart = page.locator(".editable-slide .chart-visual");
    const placement = await chart.evaluate((chart) => {
      const viewBox = chart.getAttribute("viewBox")!.split(" ").map(Number),
        pattern = chart.querySelector("pattern")!;
      return {
        width: viewBox[2],
        height: viewBox[3],
        x: Number(pattern.getAttribute("x")),
        y: Number(pattern.getAttribute("y")),
        tileWidth: Number(pattern.getAttribute("width")),
        tileHeight: Number(pattern.getAttribute("height")),
      };
    });
    const x = ["tr", "r", "br"].includes(align)
      ? placement.width - placement.tileWidth
      : ["t", "ctr", "b"].includes(align)
        ? (placement.width - placement.tileWidth) / 2
        : 0;
    const y = ["bl", "b", "br"].includes(align)
      ? placement.height - placement.tileHeight
      : ["l", "ctr", "r"].includes(align)
        ? (placement.height - placement.tileHeight) / 2
        : 0;
    expect(placement.x, `${align} horizontal anchor`).toBeCloseTo(x);
    expect(placement.y, `${align} vertical anchor`).toBeCloseTo(y);
  }
});
