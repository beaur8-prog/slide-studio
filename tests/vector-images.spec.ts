import { expect, test } from "@playwright/test";
import JSZip from "jszip";
import fs from "node:fs/promises";
import sharp from "sharp";
import {
  SVG_ART,
  vectorFixture,
  emfFixture,
  wmfFixture,
} from "./vector-fixtures";

test.beforeEach(async ({ page }) => {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
});

test("SVG and metafile pictures display and retain original bytes after repeated edited saves", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const input = await vectorFixture();
  await fs.writeFile(info.outputPath("source.pptx"), input);
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(
    async ({ data, ioModule }) => {
      const { importPptx, exportPptx, serializeDeck, parseDeckJson } =
        await import(ioModule);
      const { imageSize } = await import("/src/image-editing.ts");
      let imported = await importPptx(new Uint8Array(data)),
        deck = imported.deck;
      const initial = deck.slides[0].elements.filter(
        (e: any) => e.type === "image",
      );
      const sizes = await Promise.all(
        initial.map((e: any) => imageSize(e.src)),
      );
      let saved: any;
      const rounds: any[] = [];
      for (let i = 0; i < 3; i++) {
        deck = parseDeckJson(serializeDeck(deck));
        const text = deck.slides[0].elements.find(
          (e: any) => e.type === "text",
        );
        if (text) text.x += 1;
        const image = deck.slides[0].elements.find(
          (e: any) => e.type === "image",
        );
        if (image) image.x += 2;
        saved = await exportPptx(deck);
        const after = await importPptx(saved);
        deck = after.deck;
        rounds.push({
          images: deck.slides[0].elements.filter((e: any) => e.type === "image")
            .length,
          warnings: after.warnings,
        });
      }
      return {
        initial: initial.map((e: any) => ({
          src: e.src,
          name: e.name,
          crop: e.crop,
          rotation: e.rotation,
          flipH: e.flipH,
        })),
        sizes,
        warnings: imported.warnings,
        rounds,
        saved: Array.from(saved as Uint8Array),
      };
    },
    {
      data: Array.from(input),
      ioModule: process.env.VECTOR_IO ?? "/src/io.ts",
    },
  );
  expect(result.initial).toHaveLength(4);
  expect(
    result.initial.every((e: any) =>
      e.src.startsWith("data:image/svg+xml;base64,"),
    ),
  ).toBe(true);
  expect(result.initial[0]).toMatchObject({
    crop: [0.05, 0.1, 0.05, 0.1],
    rotation: 15,
    flipH: true,
  });
  expect(result.sizes.every((s: any) => s.width > 0 && s.height > 0)).toBe(
    true,
  );
  expect(
    result.warnings.filter((s: string) => /제외|변환할 수 없/.test(s)),
  ).toEqual([]);
  expect(result.rounds.map((r: any) => r.images)).toEqual([4, 4, 4]);
  const saved = Buffer.from(result.saved as number[]);
  await fs.writeFile(info.outputPath("saved.pptx"), saved);
  const source = await JSZip.loadAsync(input),
    output = await JSZip.loadAsync(saved);
  for (const kind of ["svg", "emf", "wmf"]) {
    const original = await source
      .file(`ppt/media/vector.${kind}`)!
      .async("nodebuffer");
    const members = await Promise.all(
      Object.values(output.files)
        .filter((f) => !f.dir && f.name.endsWith("." + kind))
        .map((f) => f.async("nodebuffer")),
    );
    expect(members.some((b) => b.equals(original))).toBe(true);
  }
});

for (const kind of ["svg", "emf", "wmf", "wmf-plain"] as const) {
  test(`insert ${kind} as a visible vector and preserve it without source-package metadata`, async ({
    page,
  }) => {
    await page.goto("http://127.0.0.1:5190");
    const data =
      kind === "svg"
        ? Buffer.from(SVG_ART)
        : kind === "emf"
          ? emfFixture()
          : wmfFixture(kind !== "wmf-plain");
    const result = await page.evaluate(
      async ({ data, name }) => {
        const { readImageFile } = await import("/src/image-editing.ts");
        const { blankDeck, element } = await import("/src/model.ts");
        const { exportPptx, importPptx } = await import("/src/io.ts");
        const file = new File([new Uint8Array(data)], name);
        const image = await readImageFile(file),
          deck = blankDeck();
        deck.slides[0].elements = [
          element("image", {
            ...image,
            x: 80,
            y: 80,
            width: 640,
            height: 360,
            alt: "벡터 그림",
          }),
        ];
        const saved = await exportPptx(deck),
          after = await importPptx(saved);
        const src = after.deck.slides[0].elements[0].src!;
        const img = new Image();
        img.src = src;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 180;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, 320, 180);
        const pixels = ctx.getImageData(0, 0, 320, 180).data;
        let colored = 0;
        for (let i = 0; i < pixels.length; i += 4)
          if (
            pixels[i + 3] > 128 &&
            (pixels[i] < 220 || pixels[i + 1] < 220 || pixels[i + 2] < 220)
          )
            colored++;
        return {
          src,
          original: image.src,
          size: { width: image.width, height: image.height },
          colored,
          warnings: after.warnings,
        };
      },
      { data: Array.from(data), name: "vector." + kind.split("-")[0] },
    );
    expect(result.src).toBe(result.original);
    expect(result.src).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(result.colored).toBeGreaterThan(10000);
  });
}

for (const owner of ["slide", "layout", "master"] as const) {
  test(`vector pictures and background resolve ${owner} relationships`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    const input = await vectorFixture({ owner, background: true });
    await page.goto("http://127.0.0.1:5190");
    const result = await page.evaluate(async (data) => {
      const { importPptx, exportPptx } = await import("/src/io.ts");
      const first = await importPptx(new Uint8Array(data)),
        second = await importPptx(await exportPptx(first.deck));
      return [first, second].map((r) => ({
        pictures: r.deck.slides[0].elements.filter((e) => e.type === "image")
          .length,
        background: r.deck.slides[0].backgroundImage?.src,
        warnings: r.warnings,
      }));
    }, Array.from(input));
    for (const round of result) {
      expect(round.pictures).toBe(4);
      expect(round.background).toMatch(/^data:image\/svg\+xml;base64,/);
    }
  });
}

test("a broken SVG extension uses its Office raster fallback", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(
    async (data) => {
      const { importPptx } = await import("/src/io.ts");
      const r = await importPptx(new Uint8Array(data));
      return {
        sources: r.deck.slides[0].elements
          .filter((e) => e.type === "image")
          .map((e) => e.src),
        warnings: r.warnings,
      };
    },
    Array.from(await vectorFixture({ invalidSvg: true })),
  );
  expect(result.sources).toHaveLength(3);
  expect(
    result.sources.filter((s) => s?.startsWith("data:image/png")),
  ).toHaveLength(1);
  expect(result.warnings.join(" ")).toContain("대체 그림");
});

test("an SVG containing only unsupported foreign HTML uses its visible raster fallback", async ({
  page,
}) => {
  const input = await vectorFixture({
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><foreignObject width="320" height="180"><div xmlns="http://www.w3.org/1999/xhtml">HTML-only diagram</div></foreignObject></svg>',
  });
  const result = await page.evaluate(async (data) => {
    const { importPptx } = await import("/src/io.ts");
    const r = await importPptx(new Uint8Array(data));
    return {
      sources: r.deck.slides[0].elements
        .filter((e) => e.type === "image")
        .map((e) => e.src),
      warnings: r.warnings,
    };
  }, Array.from(input));
  expect(result.sources).toHaveLength(3);
  expect(
    result.sources.filter((s) => s?.startsWith("data:image/png")),
  ).toHaveLength(1);
  expect(result.warnings.join(" ")).toContain("대체 그림");
});

test("SVG sanitization retains gradients, clipping, local styles and Korean text but loads no external resources", async ({
  page,
}) => {
  const remote: string[] = [];
  page.on("request", (r) => {
    if (
      !r.url().startsWith("http://127.0.0.1:5190") &&
      !r.url().startsWith("data:")
    )
      remote.push(r.url());
  });
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async (text) => {
    const { svgImage, safeSvgImage } = await import("/src/svg-image.ts");
    const bad = text
      .replace(
        "<defs>",
        "<style>.caption{fill:#fff;font-style:italic}</style><defs>",
      )
      .replace("<text ", '<text class="caption" ')
      .replace(
        "<defs>",
        '<script>window.__vectorPwned=true</script><foreignObject><iframe src="https://example.invalid/evil"/></foreignObject><image href="https://example.invalid/tracker.png"/><use href="file:///etc/passwd"/><style>@import "https://example.invalid/a.css";</style><defs>',
      )
      .replace(
        "<g clip-path",
        '<g onload="window.__vectorPwned=true" clip-path',
      );
    const source = svgImage(new TextEncoder().encode(bad)),
      normalized = safeSvgImage(source);
    const img = new Image();
    img.src = source;
    document.body.append(img);
    await img.decode();
    return {
      text: new TextDecoder().decode(
        Uint8Array.from(atob(source.split(",")[1]), (c) => c.charCodeAt(0)),
      ),
      stable: source === normalized,
      pwned: (window as any).__vectorPwned ?? false,
    };
  }, SVG_ART);
  expect(result.text).toContain("linearGradient");
  expect(result.text).toContain("clipPath");
  expect(result.text).toContain("url(#g)");
  expect(result.text).toContain(".caption");
  expect(result.text).toContain("벡터 그림");
  expect(result.text).not.toMatch(
    /<script|foreignObject|iframe|https:\/\/example|file:\/|onload/,
  );
  expect(result.stable).toBe(true);
  expect(result.pwned).toBe(false);
  expect(remote).toEqual([]);
});

test("SVG dimensions and viewBox-only images remain bounded and malformed metafiles fail promptly", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async (data) => {
    const { svgImage } = await import("/src/svg-image.ts"),
      { vectorImage } = await import("/src/vector-image.ts"),
      { imageSize } = await import("/src/image-editing.ts");
    const sources = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><path d="M0 0h640v360H0z"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="1000000" height="500000"><rect width="1000000" height="500000"/></svg>',
    ].map((s) => svgImage(new TextEncoder().encode(s)));
    const sizes = await Promise.all(sources.map((s) => imageSize(s)));
    let rejected = false;
    const start = performance.now();
    try {
      await vectorImage(new Uint8Array(data.slice(0, -5)), "emf");
    } catch {
      rejected = true;
    }
    return { sizes, rejected, time: performance.now() - start };
  }, Array.from(emfFixture()));
  expect(result.sizes[0]).toEqual({ width: 640, height: 360 });
  expect(result.sizes[1]).toEqual({ width: 2048, height: 1024 });
  expect(result.rejected).toBe(true);
  expect(result.time).toBeLessThan(1000);
});

test("public EMF and WMF samples retain visible gradients, clipped artwork, shapes and bitmaps", async ({
  page,
}, info) => {
  test.setTimeout(60000);
  const names = [
    "sample-gradient-clip.emf",
    "sample-clip-gdi.emf",
    "wmf-shapes-twips.wmf",
    "wmf-bitmaps.wmf",
  ];
  const pictures = [];
  for (const name of names) {
    const bytes = await fs.readFile(
      new URL("./fixtures/vector/" + name, import.meta.url),
    );
    const picture = await page.evaluate(
      async ({ data, name }) => {
        const { readImageFile } = await import("/src/image-editing.ts");
        const image = await readImageFile(
          new File([new Uint8Array(data)], name),
        );
        const img = new Image();
        img.src = image.src;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#fff";
        context.fillRect(0, 0, 640, 360);
        context.drawImage(img, 0, 0, 640, 360);
        const rgba = context.getImageData(0, 0, 640, 360).data;
        let colored = 0;
        for (let i = 0; i < rgba.length; i += 4)
          if (rgba[i] < 225 || rgba[i + 1] < 225 || rgba[i + 2] < 225)
            colored++;
        return { name, src: image.src, preview: canvas.toDataURL(), colored };
      },
      { data: Array.from(bytes), name },
    );
    expect(picture.colored, name).toBeGreaterThan(200);
    pictures.push(picture);
    await fs.writeFile(
      info.outputPath(name + ".png"),
      Buffer.from(picture.preview.split(",")[1], "base64"),
    );
  }
  await fs.writeFile(
    info.outputPath("public-samples.json"),
    JSON.stringify(
      pictures.map(({ src, preview, ...p }) => p),
      null,
      2,
    ),
  );
});

test("imported vector pictures remain visible while editing, presenting, saving and reopening", async ({
  page,
}, info) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator('input[accept*=".pptx"]').setInputFiles({
    name: "벡터 테스트.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: await vectorFixture(),
  });
  const images = page.locator('.editable-slide [data-type="image"] img');
  await expect(images).toHaveCount(4);
  await expect
    .poll(() =>
      images.evaluateAll((nodes) =>
        nodes.every(
          (n) =>
            (n as HTMLImageElement).complete &&
            (n as HTMLImageElement).naturalWidth > 0,
        ),
      ),
    )
    .toBe(true);
  const edit = await page
    .locator(".editable-slide")
    .screenshot({ path: info.outputPath("editor.png") });
  const { data, info: meta } = await sharp(edit)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let blue = 0,
    orange = 0;
  for (let i = 0; i < data.length; i += meta.channels) {
    if (data[i] < 70 && data[i + 1] > 45 && data[i + 2] > 100) blue++;
    if (
      data[i] > 200 &&
      data[i + 1] > 60 &&
      data[i + 1] < 190 &&
      data[i + 2] < 100
    )
      orange++;
  }
  expect(blue).toBeGreaterThan(3000);
  expect(orange).toBeGreaterThan(3000);
  await page.keyboard.press("F5");
  const show = page.locator(".presentation-view");
  await expect(show).toBeVisible();
  await expect(show.locator(".slide-visual img")).toHaveCount(4);
  await page.screenshot({ path: info.outputPath("presentation.png") });
  await page.keyboard.press("Escape");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "PPTX 저장", exact: true }).click();
  const file = await download,
    saved = info.outputPath("ui-saved.pptx");
  await file.saveAs(saved);
  await page.locator('input[accept*=".pptx"]').setInputFiles(saved);
  await expect(images).toHaveCount(4);
  await expect
    .poll(() =>
      images.evaluateAll((nodes) =>
        nodes.every((n) => (n as HTMLImageElement).naturalWidth > 0),
      ),
    )
    .toBe(true);
  expect(errors).toEqual([]);
});

test("100 slides with repeated vector media reopen without repeated per-slide conversion", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const zip = await JSZip.loadAsync(await vectorFixture());
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  const rels = await zip
    .file("ppt/slides/_rels/slide1.xml.rels")!
    .async("string");
  let types = await zip.file("[Content_Types].xml")!.async("string");
  for (let i = 2; i <= 100; i++) {
    zip.file(`ppt/slides/slide${i}.xml`, xml);
    zip.file(`ppt/slides/_rels/slide${i}.xml.rels`, rels);
    types = types.replace(
      "</Types>",
      `<Override PartName="/ppt/slides/slide${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`,
    );
  }
  zip.file("[Content_Types].xml", types);
  zip.file(
    "ppt/presentation.xml",
    (await zip.file("ppt/presentation.xml")!.async("string")).replace(
      /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/,
      `<p:sldIdLst>${Array.from({ length: 100 }, (_, i) => `<p:sldId id="${256 + i}" r:id="rIdVector${i + 1}"/>`).join("")}</p:sldIdLst>`,
    ),
  );
  const R =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    (await zip.file("ppt/_rels/presentation.xml.rels")!.async("string"))
      .replace(/<Relationship\b[^>]*Type="[^"]*\/slide"[^>]*\/>/g, "")
      .replace(
        "</Relationships>",
        Array.from(
          { length: 100 },
          (_, i) =>
            `<Relationship Id="rIdVector${i + 1}" Type="${R}/slide" Target="slides/slide${i + 1}.xml"/>`,
        ).join("") + "</Relationships>",
      ),
  );
  const input = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
  });
  const metrics = await page.evaluate(async (data) => {
    const NativeWorker = window.Worker;
    let workers = 0;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        workers++;
      }
    };
    try {
      const { importPptx, exportPptx } = await import("/src/io.ts");
      const start = performance.now(),
        first = await importPptx(new Uint8Array(data)),
        opened = performance.now();
      const beforeWorkers = workers;
      const saved = await exportPptx(first.deck),
        exported = performance.now();
      const second = await importPptx(saved),
        reopened = performance.now();
      return {
        slides: second.deck.slides.length,
        images: second.deck.slides
          .flatMap((s) => s.elements)
          .filter((e) => e.type === "image").length,
        beforeWorkers,
        workers,
        warnings: second.warnings,
        openMs: opened - start,
        saveMs: exported - opened,
        reopenMs: reopened - exported,
        sourceBytes: data.length,
        savedBytes: saved.length,
      };
    } finally {
      window.Worker = NativeWorker;
    }
  }, Array.from(input));
  expect(metrics.slides).toBe(100);
  expect(metrics.images).toBe(400);
  expect(metrics.beforeWorkers).toBe(2);
  expect(metrics.workers).toBe(4);
  expect(metrics.warnings.filter((s) => /제외|변환할 수 없/.test(s))).toEqual(
    [],
  );
  await fs.writeFile(
    info.outputPath("100-vector-slides-metrics.json"),
    JSON.stringify(metrics, null, 2),
  );
});
