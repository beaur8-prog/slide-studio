import { test, expect, type Page, type Locator } from "@playwright/test";
import fs from "node:fs/promises";
import sharp from "sharp";

const folder = "qa/results/shapes-media";
const clips: Record<string, Buffer> = {};
let gif: Buffer;

test.beforeAll(async ({ browser }) => {
  await fs.mkdir(folder, { recursive: true });
  const pixels = Buffer.alloc(32 * 64 * 4);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4;
      pixels[i + (y < 32 ? 0 : 2)] = 255;
      pixels[i + 3] = 255;
    }
  gif = await sharp(pixels, {
    raw: { width: 32, height: 64, channels: 4, pageHeight: 32 },
  })
    .gif({ loop: 0, delay: [200, 200] })
    .toBuffer();
  await fs.writeFile(`${folder}/animated.gif`, gif);
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5190");
  for (const [ext, mime] of [
    ["mp4", "video/mp4;codecs=avc1.42001e"],
    ["webm", "video/webm;codecs=vp8"],
  ]) {
    const bytes = await page.evaluate(async (mime) => {
      if (!MediaRecorder.isTypeSupported(mime))
        throw Error(`No fixture encoder: ${mime}`);
      const canvas = document.createElement("canvas");
      canvas.width = 96;
      canvas.height = 64;
      const context = canvas.getContext("2d")!;
      const stream = canvas.captureStream(10);
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      const chunks: Blob[] = [];
      const finished = new Promise<Blob>((resolve) => {
        recorder.ondataavailable = (event) => chunks.push(event.data);
        recorder.onstop = () => resolve(new Blob(chunks));
      });
      recorder.start();
      for (let frame = 0; frame < 12; frame++) {
        context.fillStyle = frame % 2 ? "#0000FF" : "#FF0000";
        context.fillRect(0, 0, 96, 64);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      recorder.stop();
      const blob = await finished;
      stream.getTracks().forEach((t) => t.stop());
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    }, mime);
    clips[ext] = Buffer.from(bytes);
    await fs.writeFile(`${folder}/animated.${ext}`, clips[ext]);
  }
  await page.close();
});

async function emptyDeck(page: Page) {
  await page.goto("http://127.0.0.1:5190");
  const json = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const d = blankDeck();
    d.slides[0].elements = [];
    return JSON.stringify(d);
  });
  await page.locator('input[accept*=".pptx"]').setInputFiles({
    name: "media.slide",
    mimeType: "application/json",
    buffer: Buffer.from(json),
  });
  await expect(page.locator(".editable-slide .slide-element")).toHaveCount(0);
}

async function visiblyAnimates(image: Locator) {
  const colors = new Set<string>();
  for (let i = 0; i < 8; i++) {
    const { data } = await sharp(await image.screenshot())
      .resize(1, 1)
      .raw()
      .toBuffer({ resolveWithObject: true });
    colors.add(data[0] > data[2] ? "red" : "blue");
    await new Promise((resolve) => setTimeout(resolve, 90));
  }
  expect([...colors].sort()).toEqual(["blue", "red"]);
}

test("GIF animates in editing and slide show and keeps original frames through save and PPTX", async ({
  page,
}) => {
  await emptyDeck(page);
  await page
    .locator('input[accept="image/png,image/jpeg,image/gif,image/webp"]')
    .setInputFiles({
      name: "animated.gif",
      mimeType: "image/gif",
      buffer: gif,
    });
  const image = page.locator(".editable-slide img.element-image");
  await expect(image).toBeVisible();
  await visiblyAnimates(image);
  const result = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { importPptx, exportPptx, serializeDeck, parseDeckJson } =
      await import("/src/io.ts");
    const src = document.querySelector<HTMLImageElement>(
      ".editable-slide img",
    )!.src;
    const d = blankDeck();
    d.slides[0].elements = [element("image", { src })];
    const saved = parseDeckJson(serializeDeck(d));
    const pptx = await exportPptx(saved);
    const imported = await importPptx(pptx);
    return {
      original: src,
      saved: saved.slides[0].elements[0].src,
      imported: imported.deck.slides[0].elements[0].src,
      warnings: imported.warnings,
      json: serializeDeck(imported.deck),
    };
  });
  expect(result.saved).toBe(result.original);
  expect(result.imported).toBe(result.original);
  expect(result.warnings).toEqual([]);
  await page.locator('input[accept*=".pptx"]').setInputFiles({
    name: "restored.slide",
    mimeType: "application/json",
    buffer: Buffer.from(result.json),
  });
  await page.getByRole("button", { name: "발표 모드", exact: true }).click();
  await visiblyAnimates(page.locator(".present-slide img.element-image"));
  await page.keyboard.press("Escape");
});

for (const ext of ["mp4", "webm"])
  test(`${ext} inserts, auto plays, loops, stops off-slide and preserves native PPTX media/settings`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await emptyDeck(page);
    await page.locator('input[accept*="video/mp4"]').setInputFiles({
      name: `animated.${ext}`,
      mimeType: `video/${ext}`,
      buffer: clips[ext],
    });
    await expect(
      page.locator('.editable-slide [data-type="video"]'),
    ).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: "슬라이드 쇼에서 자동 시작" }),
    ).toBeChecked();
    await expect(
      page.getByRole("checkbox", { name: "반복 재생", exact: true }),
    ).toBeChecked();
    await expect(page.locator(".editable-slide video")).toHaveCount(0);
    await page.getByRole("button", { name: "발표 모드", exact: true }).click();
    const video = page.locator(".present-slide video");
    await expect
      .poll(() =>
        video.evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0),
      )
      .toBe(true);
    await expect(video).toHaveJSProperty("loop", true);
    const duration = await video.evaluate((v: HTMLVideoElement) => v.duration);
    const times: number[] = [];
    for (let i = 0; i < 24; i++) {
      times.push(await video.evaluate((v: HTMLVideoElement) => v.currentTime));
      await page.waitForTimeout(120);
    }
    expect(times.some((time, i) => i && time < times[i - 1] - 0.2)).toBe(true);
    expect(duration).toBeGreaterThan(0.5);
    await page.keyboard.press("b");
    await expect(page.locator(".present-slide video")).toHaveCount(0);
    await page.keyboard.press("b");
    await expect(page.locator(".present-slide video")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator("video")).toHaveCount(0);
    const result = await page.evaluate(
      async ({ data, ext }) => {
        const { blankDeck, element } = await import("/src/model.ts");
        const { readVideo } = await import("/src/video.ts");
        const { importPptx, exportPptx, serializeDeck, parseDeckJson } =
          await import("/src/io.ts");
        const { default: JSZip } = await import(
          "/node_modules/.vite/deps/jszip.js"
        );
        const media = await readVideo(
          new File([new Uint8Array(data)], `movie.${ext}`, {
            type: `video/${ext}`,
          }),
        );
        const deck = blankDeck();
        deck.slides[0].transition = "fade";
        deck.slides[0].elements = [
          element("shape", { shape: "ellipse" }),
          ...[true, false].map((flag, i) =>
            element("video", {
              ...media,
              id: `v${i}`,
              autoPlay: flag,
              loop: flag,
              muted: flag,
              rotation: 15,
              flipH: true,
              alt: "한글 동영상",
            }),
          ),
        ];
        const saved = parseDeckJson(serializeDeck(deck));
        const bytes = await exportPptx(saved);
        const zip = await JSZip.loadAsync(bytes);
        const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
        const mediaFiles = await Promise.all(
          Object.keys(zip.files)
            .filter((n) => n.endsWith(`.${ext}`))
            .map((n) => zip.file(n)!.async("uint8array")),
        );
        const imported = await importPptx(bytes);
        const again = await importPptx(await exportPptx(imported.deck));
        const doc = new DOMParser().parseFromString(xml, "text/xml");
        const ids = Array.from(doc.getElementsByTagNameNS("*", "cNvPr")).map(
          (n) => n.getAttribute("id"),
        );
        let rejectsRemote = false;
        try {
          parseDeckJson(
            JSON.stringify({
              ...deck,
              slides: [
                {
                  ...deck.slides[0],
                  elements: [
                    {
                      ...deck.slides[0].elements[1],
                      src: "https://example.com/movie.mp4",
                    },
                  ],
                },
              ],
            }),
          );
        } catch {
          rejectsRemote = true;
        }
        return {
          saved: saved.slides[0].elements.filter((e) => e.type === "video"),
          imported: imported.deck.slides[0].elements.filter(
            (e) => e.type === "video",
          ),
          again: again.deck.slides[0].elements.filter(
            (e) => e.type === "video",
          ),
          warnings: imported.warnings,
          mediaFiles: mediaFiles.map((b) => Array.from(b)),
          ids,
          rejectsRemote,
          children: Array.from(doc.documentElement.children).map(
            (n) => n.localName,
          ),
          xml,
          bytes: Array.from(bytes),
        };
      },
      { data: [...clips[ext]], ext },
    );
    expect(result.mediaFiles.length).toBeGreaterThan(0);
    for (const bytes of result.mediaFiles)
      expect(Buffer.from(bytes)).toEqual(clips[ext]);
    expect(result.warnings).toEqual([]);
    expect(result.rejectsRemote).toBe(true);
    expect(new Set(result.ids).size).toBe(result.ids.length);
    expect(result.children.indexOf("transition")).toBeLessThan(
      result.children.indexOf("timing"),
    );
    for (const elements of [result.saved, result.imported, result.again]) {
      expect(elements).toHaveLength(2);
      for (const [i, e] of elements.entries()) {
        expect([e.autoPlay, e.loop, e.muted]).toEqual([
          i === 0,
          i === 0,
          i === 0,
        ]);
        expect(e.rotation).toBe(15);
        expect(e.flipH).toBe(true);
        expect(e.src).toBe(result.saved[i].src);
        expect(e.poster).toBe(result.saved[i].poster);
      }
    }
    await fs.writeFile(
      `${folder}/roundtrip-${ext}.pptx`,
      Buffer.from(result.bytes),
    );
  });

test("oversize embedded video falls back to its poster without rejecting the presentation", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(
    async (data) => {
      const { blankDeck, element } = await import("/src/model.ts");
      const { readVideo, MAX_VIDEO_BYTES } = await import("/src/video.ts");
      const { importPptx, exportPptx } = await import("/src/io.ts");
      const { default: JSZip } = await import(
        "/node_modules/.vite/deps/jszip.js"
      );
      const media = await readVideo(
        new File([new Uint8Array(data)], "movie.mp4", { type: "video/mp4" }),
      );
      const d = blankDeck();
      d.slides[0].elements = [element("video", media)];
      const zip = await JSZip.loadAsync(await exportPptx(d));
      const tooLarge = new Uint8Array(MAX_VIDEO_BYTES + 1);
      tooLarge.set(new Uint8Array(data).slice(0, 32));
      for (const name of Object.keys(zip.files).filter((n) =>
        n.endsWith(".mp4"),
      ))
        zip.file(name, tooLarge);
      const r = await importPptx(
        await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
      );
      return {
        type: r.deck.slides[0].elements[0].type,
        src: r.deck.slides[0].elements[0].src,
        poster: media.poster,
        warnings: r.warnings,
      };
    },
    [...clips.mp4],
  );
  expect(result.type).toBe("image");
  expect(result.src).toBe(result.poster);
  expect(result.warnings.join(" ")).toContain("크기 제한");
});

test("PowerPoint immediate mediacall starts automatically, while click and delayed commands remain manual", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { readVideoPlayback } = await import("/src/pptx-video.ts");
    return ["immediate", "click", "delayed"].map((mode) => {
      const doc = new DOMParser().parseFromString(
        `<sld><pic><nvPicPr><cNvPr id="5"/></nvPicPr></pic><timing><tnLst><par><cTn id="1"><childTnLst><video><cMediaNode mute="1"><cTn id="2" repeatCount="indefinite"><stCondLst><cond delay="indefinite"/></stCondLst></cTn><tgtEl><spTgt spid="5"/></tgtEl></cMediaNode></video><par><cTn id="3" nodeType="${mode === "click" ? "clickEffect" : "withEffect"}"><stCondLst><cond delay="${mode === "delayed" ? "500" : "0"}"/></stCondLst><childTnLst><cmd type="call" cmd="playFrom(0.0)"><cBhvr><cTn id="4"/><tgtEl><spTgt spid="5"/></tgtEl></cBhvr></cmd></childTnLst></cTn></par></childTnLst></cTn></par></tnLst></timing></sld>`,
        "text/xml",
      );
      return readVideoPlayback(doc, doc.querySelector("pic")!);
    });
  });
  expect(result.map((r) => r.autoPlay)).toEqual([true, false, false]);
  expect(result.every((r) => r.loop && r.muted)).toBe(true);
});
