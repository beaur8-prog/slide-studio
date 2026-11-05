import { expect, test, _electron } from "@playwright/test";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import sharp from "sharp";

const png = sharp({
  create: { width: 8, height: 8, channels: 4, background: "#ff0000" },
})
  .png()
  .toBuffer();
let prepared: Promise<Buffer>;
function fixture() {
  return (prepared ??= (async () => {
    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: "QA", width: 8, height: 4 });
    pptx.layout = "QA";
    const slide = pptx.addSlide(),
      data = `data:image/png;base64,${(await png).toString("base64")}`;
    for (const [i, name] of [
      "width-only",
      "outline-solid",
      "outline-none",
      "outline-alpha",
    ].entries())
      slide.addImage({
        data,
        objectName: name,
        altText: name,
        x: 0.5 + i * 1.5,
        y: 1,
        w: 1,
        h: 1,
        transparency: i === 3 ? 75 : 0,
      });
    const zip = await JSZip.loadAsync(
      await pptx.write({ outputType: "uint8array" }),
    );
    let xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    xml = xml.replace(/<p:pic\b[\s\S]*?<\/p:pic>/g, (picture) => {
      const line = picture.includes('name="outline-solid"')
        ? '<a:ln w="12700" cap="rnd"><a:solidFill><a:schemeClr val="accent1"><a:alpha val="60000"/></a:schemeClr></a:solidFill><a:prstDash val="dash"/></a:ln>'
        : picture.includes('name="outline-alpha"')
          ? '<a:ln w="76200"><a:solidFill><a:srgbClr val="000000"><a:alpha val="75000"/></a:srgbClr></a:solidFill></a:ln>'
          : picture.includes('name="outline-none"')
            ? '<a:ln w="76200"><a:noFill/></a:ln>'
            : '<a:ln w="12700"><a:miter lim="400000"/></a:ln>';
      return picture
        .replace(/<a:ln\b[\s\S]*?<\/a:ln>/g, "")
        .replace("</p:spPr>", line + "</p:spPr>");
    });
    zip.file("ppt/slides/slide1.xml", xml);
    return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  })());
}

test("PPTX picture outlines retain explicit theme color, width, dash and independent alpha", async ({
  page,
}, info) => {
  await page.goto("http://127.0.0.1:5190");
  const bytes = await fixture();
  await fs.writeFile(info.outputPath("source.pptx"), bytes);
  const result = await page.evaluate(
    async (bytes) => {
      const { importPptx } = await import("/src/io.ts");
      return (await importPptx(Uint8Array.from(bytes))).deck.slides[0].elements;
    },
    [...bytes],
  );
  expect(result).toHaveLength(4);
  const solid = result.find((e) => e.name === "outline-solid")!;
  expect(solid.strokeWidth).toBeCloseTo(4 / 3, 5);
  expect(solid.stroke).toMatch(/^#[0-9A-F]{6}$/);
  expect(solid.strokeOpacity).toBeCloseTo(0.6);
  expect(solid.strokeDash).toEqual([16 / 3, 4]);
  expect(solid.strokeCap).toBe("round");
  const alpha = result.find((e) => e.name === "outline-alpha")!;
  expect(alpha).toMatchObject({
    opacity: 0.25,
    stroke: "#000000",
    strokeWidth: 8,
    strokeOpacity: 0.75,
  });
  for (const name of ["width-only", "outline-none"])
    expect(result.find((e) => e.name === name)?.strokeWidth ?? 0).toBe(0);
});

test("edited and replaced pictures retain outline and bitmap alpha through three PPTX saves", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(
    async (bytes) => {
      const { importPptx, exportPptx } = await import("/src/io.ts");
      let deck = (await importPptx(Uint8Array.from(bytes))).deck;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 8;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "blue";
      ctx.fillRect(0, 0, 8, 8);
      const rounds = [];
      for (let i = 0; i < 3; i++) {
        const image = deck.slides[0].elements.find(
          (e) => e.name === "outline-alpha",
        )!;
        Object.assign(image, {
          x: image.x + 1,
          crop: [0.1, 0.1, 0.1, 0.1],
          flipH: true,
          src: canvas.toDataURL(),
          stroke: "#1266AA",
          strokeWidth: 8,
          strokeOpacity: 0.75,
          strokeDash: [8, 8],
          strokeCap: "round",
        });
        deck = (await importPptx(await exportPptx(deck))).deck;
        rounds.push(
          deck.slides[0].elements.find((e) => e.name === "outline-alpha")!,
        );
      }
      return rounds;
    },
    [...(await fixture())],
  );
  for (const image of result) {
    expect(image).toMatchObject({
      type: "image",
      opacity: 0.25,
      stroke: "#1266AA",
      strokeWidth: 8,
      strokeOpacity: 0.75,
      strokeDash: [8, 8],
      strokeCap: "round",
      flipH: true,
    });
    expect(image.crop).toEqual([0.1, 0.1, 0.1, 0.1]);
  }
});

test("picture outline paints beyond the crop frame while bitmap transparency leaves the line independent", async ({
  page,
}, info) => {
  await page.goto("http://127.0.0.1:5190");
  const src = `data:image/png;base64,${(await png).toString("base64")}`;
  await page.evaluate(async (src) => {
    const { default: React } = await import(
      "/node_modules/.vite/deps/react.js"
    );
    const {
      default: { createRoot },
    } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { SlideVisual } = await import("/src/SlideCanvas.tsx");
    const { blankDeck, element } = await import("/src/model.ts");
    const slide = blankDeck().slides[0];
    slide.background = "#ffffff";
    slide.elements = [
      element("image", {
        src,
        x: 50,
        y: 50,
        width: 100,
        height: 100,
        opacity: 0.25,
        stroke: "#000000",
        strokeWidth: 8,
        strokeOpacity: 1,
        crop: [0.1, 0.1, 0.1, 0.1],
        flipH: true,
      }),
    ];
    const host = document.createElement("div");
    host.id = "outline-preview";
    host.style.cssText =
      "position:fixed;top:0;left:0;width:200px;height:200px;z-index:999999;background:white";
    document.body.append(host);
    createRoot(host).render(
      React.createElement(SlideVisual, { slide, width: 200, height: 200 }),
    );
  }, src);
  const host = page.locator("#outline-preview");
  await expect(host.locator("img")).toHaveCount(1);
  await host.locator("img").evaluate(async (image) => {
    await (image as HTMLImageElement).decode();
  });
  const screenshot = await host.screenshot();
  await fs.writeFile(info.outputPath("outline-pixels.png"), screenshot);
  const pixel = async (x: number, y: number) => [
    ...(await sharp(screenshot)
      .extract({ left: x, top: y, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer()),
  ];
  for (const [x, y] of [
    [48, 100],
    [152, 100],
    [100, 48],
    [100, 152],
  ])
    expect(await pixel(x, y)).toEqual([0, 0, 0]);
  const center = await pixel(100, 100);
  expect(center[0]).toBe(255);
  expect(Math.abs(center[1] - 191)).toBeLessThanOrEqual(1);
  expect(Math.abs(center[2] - 191)).toBeLessThanOrEqual(1);
});

test("public CMU page 75 retains the two plot outlines seen in the publisher's PowerPoint PDF", async ({
  page,
}) => {
  const source = path.resolve("qa/samples/cmu-lecture-3.pptx");
  test.skip(
    !existsSync(source),
    "Public CMU companion sample is a local extended-corpus check",
  );
  test.setTimeout(90000);
  await page.goto("http://127.0.0.1:5190");
  await page.locator('input[accept*=".pptx"]').setInputFiles(source);
  await expect(page.locator(".thumbnail-row")).toHaveCount(151);
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const { loadAutosave } = await import("/src/storage.ts");
          return (await loadAutosave())?.slides.length;
        }),
      { timeout: 15000 },
    )
    .toBe(151);
  const pictures = await page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts");
    return (await loadAutosave())!.slides[74].elements.filter(
      (e) => e.type === "image",
    );
  });
  expect(
    pictures.filter(
      (e) =>
        e.stroke === "#000000" &&
        Math.abs((e.strokeWidth ?? 0) - 4 / 3) < 0.001,
    ),
  ).toHaveLength(2);
});

test("picture background transparency is applied once when sharing the image renderer", async ({
  page,
}, info) => {
  await page.goto("http://127.0.0.1:5190");
  await page.evaluate(
    async (src) => {
      const { default: React } = await import(
        "/node_modules/.vite/deps/react.js"
      );
      const {
        default: { createRoot },
      } = await import("/node_modules/.vite/deps/react-dom_client.js");
      const { SlideVisual } = await import("/src/SlideCanvas.tsx");
      const { blankDeck } = await import("/src/model.ts");
      const slide = blankDeck().slides[0];
      slide.background = "#ffffff";
      slide.elements = [];
      slide.backgroundImage = { src, opacity: 0.25 };
      const host = document.createElement("div");
      host.id = "background-alpha-preview";
      host.style.cssText =
        "position:fixed;top:0;left:0;width:200px;height:200px;z-index:999999;background:white";
      document.body.append(host);
      createRoot(host).render(
        React.createElement(SlideVisual, { slide, width: 200, height: 200 }),
      );
    },
    `data:image/png;base64,${(await png).toString("base64")}`,
  );
  const host = page.locator("#background-alpha-preview");
  await expect(host.locator("img")).toHaveCount(1);
  await host.locator("img").evaluate(async (image) => {
    await (image as HTMLImageElement).decode();
  });
  const image = await host.screenshot({
    path: info.outputPath("background-alpha.png"),
  });
  const center = [
    ...(await sharp(image)
      .extract({ left: 100, top: 100, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer()),
  ];
  expect(center[0]).toBe(255);
  expect(Math.abs(center[1] - 191)).toBeLessThanOrEqual(1);
  expect(Math.abs(center[2] - 191)).toBeLessThanOrEqual(1);
});

test("native picture outline editing, three file saves and PDF preserve independent line alpha", async ({}, info) => {
  test.skip(
    process.platform === "linux" && !process.env.DISPLAY,
    "Native picture QA needs a desktop/Xvfb",
  );
  test.setTimeout(90000);
  const profile = await fs.mkdtemp(
    path.join(os.tmpdir(), "slide-picture-outline-"),
  );
  const source = info.outputPath("native-source.pptx");
  await fs.writeFile(source, await fixture());
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.SLIDE_STUDIO_DEV;
  let app: Awaited<ReturnType<typeof _electron.launch>> | undefined;
  try {
    app = await _electron.launch({
      args: [
        path.resolve("."),
        "--user-data-dir=" + profile,
        ...(process.platform === "linux" ? ["--no-sandbox"] : []),
      ],
      env,
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    await expect(page.locator(".save-indicator")).toHaveText("저장됨");
    await app.evaluate(({ dialog }, source) => {
      (globalThis as any).__pictureOpen = source;
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [(globalThis as any).__pictureOpen],
      });
    }, source);
    const menu = (label: string) =>
      app!.evaluate(({ Menu }, label) => {
        Menu.getApplicationMenu()!
          .items.flatMap((item) => item.submenu?.items || [])
          .find((item) => item.label === label)!
          .click();
      }, label);
    const open = async () => {
      const id = await page
        .locator(".editable-slide [data-element-id]")
        .first()
        .getAttribute("data-element-id");
      await menu("Open…");
      await expect(
        page.locator(".editable-slide [data-element-id]").first(),
      ).not.toHaveAttribute("data-element-id", id);
      await expect(
        page.locator('.editable-slide [data-type="image"]'),
      ).toHaveCount(4);
      await expect(
        page.locator(".editable-slide [data-picture-outline]"),
      ).toHaveCount(2);
    };
    await open();
    await page.locator('.editable-slide [data-type="image"]').last().click();
    await page.keyboard.press("ArrowRight");
    for (let round = 1; round <= 3; round++) {
      const file = info.outputPath(`native-round-${round}.pptx`);
      await app.evaluate(({ dialog }, file) => {
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: file,
        });
      }, file);
      await menu("Save PowerPoint As…");
      await expect
        .poll(async () => (await fs.stat(file).catch(() => null))?.size ?? 0)
        .toBeGreaterThan(1000);
      await expect(page.locator(".busy-backdrop")).toHaveCount(0);
      await app.evaluate((_, file) => {
        (globalThis as any).__pictureOpen = file;
      }, file);
      await open();
      const alpha = page.locator('.editable-slide [data-type="image"]').last();
      await expect(alpha.locator("img")).toHaveCSS("opacity", "0.25");
      await expect(
        alpha.locator("[data-picture-outline] rect"),
      ).toHaveAttribute("stroke-opacity", "0.75");
    }
    const pdf = info.outputPath("native-outline.pdf");
    await app.evaluate(({ dialog }, pdf) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: pdf });
    }, pdf);
    await menu("Export PDF…");
    await expect
      .poll(async () => (await fs.stat(pdf).catch(() => null))?.size ?? 0)
      .toBeGreaterThan(1000);
    expect((await fs.readFile(pdf)).subarray(0, 5).toString()).toBe("%PDF-");
    await page.screenshot({ path: info.outputPath("native-outlines.png") });
    expect(await fs.readFile(source)).toEqual(await fixture());
  } finally {
    await app?.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app?.close().catch(() => {});
    await fs.rm(profile, { recursive: true, force: true });
  }
});
