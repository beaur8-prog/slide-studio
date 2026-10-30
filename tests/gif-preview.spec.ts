import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import sharp from "sharp";

test("GIF previews retain first-frame pixels, transparency, offsets, local palettes and interlacing", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const fixture = await fs.readFile("tests/fixtures/media/animated.gif");
  const start = fixture.indexOf(
    Buffer.from([0x2c, 0, 0, 0, 0, 32, 0, 32, 0, 0]),
  );
  expect(start).toBeGreaterThan(19);
  const header = Buffer.from(fixture.subarray(0, 13));
  header[10] &= 0x7f;
  const descriptor = Buffer.from(fixture.subarray(start, start + 10));
  descriptor[9] |= 0x80;
  const localPalette = Buffer.concat([
    header,
    fixture.subarray(19, start),
    descriptor,
    fixture.subarray(13, 19),
    fixture.subarray(start + 10),
  ]);
  const interlaced = Buffer.from(fixture);
  interlaced[start + 9] |= 0x40; // Uniform-color rows have identical interlaced pixels.
  const offset = Buffer.from(fixture);
  offset.writeUInt16LE(64, 6);
  offset.writeUInt16LE(64, 8);
  offset.writeUInt16LE(8, start + 1);
  offset.writeUInt16LE(16, start + 3);
  const pixels = Buffer.alloc(16 * 32 * 4);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 16; x++) {
      const i = (y * 16 + x) * 4;
      pixels[i + (y < 16 ? 0 : 2)] = 255;
      pixels[i + 3] = x < 5 && y < 16 ? 0 : 255;
    }
  const transparent = await sharp(pixels, {
    raw: { width: 16, height: 32, channels: 4, pageHeight: 16 },
  })
    .gif({ loop: 0, delay: [200, 200] })
    .toBuffer();
  for (const [name, bytes] of Object.entries({
    fixture,
    localPalette,
    interlaced,
    offset,
    transparent,
  })) {
    const src = `data:image/gif;base64,${bytes.toString("base64")}`;
    const preview = await page.evaluate(async (src) => {
      const { stillImageSource } = await import("/src/gif-preview.ts");
      return stillImageSource(src)!;
    }, src);
    const decoded = Buffer.from(preview.split(",")[1], "base64");
    const metadata = await sharp(decoded, { animated: true }).metadata();
    expect(metadata.pages ?? 1, name).toBe(1);
    const expected = await sharp(bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const actual = await sharp(decoded)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(actual.info, name).toEqual(expected.info);
    expect(actual.data.equals(expected.data), name).toBe(true);
    expect(preview, name).not.toBe(src);
  }
});

test("truncated and malformed GIFs cannot fall back to playback in static views; normal images are unchanged", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const fixture = await fs.readFile("tests/fixtures/media/animated.gif");
  const sources = [0, 6, 12, 20, 45, 56, 80].map(
    (end) =>
      `data:image/gif;base64,${fixture.subarray(0, end).toString("base64")}`,
  );
  sources.push("data:image/gif;base64,not-valid!");
  const result = await page.evaluate(async (sources) => {
    const { stillImageSource } = await import("/src/gif-preview.ts");
    const { EMPTY_POSTER } = await import("/src/video.ts");
    return {
      previews: sources.map(stillImageSource),
      fallback: EMPTY_POSTER,
      normal: stillImageSource(EMPTY_POSTER),
      empty: stillImageSource(undefined),
    };
  }, sources);
  expect(result.previews).toEqual(sources.map(() => result.fallback));
  expect(result.normal).toBe(result.fallback);
  expect(result.empty).toBeUndefined();
});

test("static server rendering and multiple GIF slides never mount animated originals outside the current slideshow", async ({
  page,
}, info) => {
  await page.goto("http://127.0.0.1:5190");
  const original = `data:image/gif;base64,${(await fs.readFile("tests/fixtures/media/animated.gif")).toString("base64")}`;
  const fixture = await page.evaluate(async (src) => {
    const { blankDeck, element, uid } = await import("/src/model.ts");
    const { serializeDeck } = await import("/src/io.ts");
    const { stillImageSource } = await import("/src/gif-preview.ts");
    const { SlideVisual } = await import("/src/SlideCanvas.tsx");
    const { VideoVisual } = await import("/src/VideoVisual.tsx");
    const { default: React } = await import(
      "/node_modules/.vite/deps/react.js"
    );
    const { default: ReactDOMServer } = await import(
      "/node_modules/.vite/deps/react-dom_server.js"
    );
    const deck = blankDeck();
    deck.slides[0].elements = [
      element("image", {
        src,
        x: 200,
        y: 100,
        width: 320,
        height: 320,
        crop: [0.1, 0.2, 0.1, 0],
        flipH: true,
      }),
    ];
    deck.slides.push(
      ...Array.from({ length: 39 }, () => ({ ...deck.slides[0], id: uid() })),
    );
    deck.slides.push({ ...deck.slides[0], id: uid(), elements: [] });
    const preview = stillImageSource(src)!;
    const markup = ReactDOMServer.renderToStaticMarkup(
      React.createElement(SlideVisual, {
        slide: deck.slides[0],
        width: deck.width,
        height: deck.height,
      }),
    );
    const doc = new DOMParser().parseFromString(markup, "text/html");
    const videoPreview = (playing: boolean) =>
      new DOMParser().parseFromString(
        ReactDOMServer.renderToStaticMarkup(
          React.createElement(VideoVisual, {
            element: element("video", { poster: src }),
            playing,
          }),
        ),
        "text/html",
      );
    return {
      json: serializeDeck(deck),
      preview,
      ssrSource: doc.querySelector("img")!.getAttribute("src"),
      videoStill: videoPreview(false).querySelector("img")!.getAttribute("src"),
      videoPoster: videoPreview(true)
        .querySelector("video")!
        .getAttribute("poster"),
    };
  }, original);
  expect(fixture.ssrSource).toBe(fixture.preview);
  expect(fixture.videoStill).toBe(fixture.preview);
  expect(fixture.videoPoster).toBe(fixture.preview);
  await page.locator('input[accept*=".pptx"]').setInputFiles({
    name: "many-gifs.slide",
    mimeType: "application/json",
    buffer: Buffer.from(fixture.json),
  });
  await expect.poll(() => page.locator(".thumbnail-list img.element-image").count()).toBeGreaterThan(0);
  expect(await page.locator(".thumbnail-list img.element-image").count()).toBeLessThan(40);
  const originals = page.locator(`img[src="${original}"]`);
  await expect(originals).toHaveCount(0);
  const stills = await page
    .locator("img.element-image")
    .evaluateAll((images) => images.map((i) => i.getAttribute("src")));
  expect(stills.every((src) => src === fixture.preview)).toBe(true);
  await page.getByRole("button", { name: "발표 모드", exact: true }).click();
  await expect(originals).toHaveCount(1);
  await expect(page.locator(".present-slide img")).toHaveAttribute(
    "src",
    original,
  );
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("presentation-view")).toHaveAttribute(
    "aria-label",
    "발표 슬라이드 2 / 41",
  );
  await expect(originals).toHaveCount(1);
  await page.keyboard.press("End");
  await expect(page.getByTestId("presentation-view")).toHaveAttribute(
    "aria-label",
    "발표 슬라이드 41 / 41",
  );
  await expect(originals).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(originals).toHaveCount(0);
  await info.attach("gif-preview-deck", {
    body: fixture.json,
    contentType: "application/json",
  });
});

test("photo album previews stay still through reordering and insertion preserves the original GIF", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const original = await fs.readFile("tests/fixtures/media/animated.gif");
  const dataUrl = `data:image/gif;base64,${original.toString("base64")}`;
  const preview = await page.evaluate(async (src) => {
    const { stillImageSource } = await import("/src/gif-preview.ts");
    return stillImageSource(src)!;
  }, dataUrl);
  await page.getByRole("button", { name: "삽입", exact: true }).click();
  await page.getByRole("button", { name: "사진 앨범", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "사진 앨범", exact: true });
  await dialog.getByLabel("사진 앨범 파일").setInputFiles([
    { name: "first.gif", mimeType: "image/gif", buffer: original },
    { name: "second.gif", mimeType: "image/gif", buffer: original },
  ]);
  await expect(dialog.locator("img")).toHaveCount(2);
  for (const image of await dialog.locator("img").all())
    await expect(image).toHaveAttribute("src", preview);
  await dialog
    .getByRole("button", { name: "사진 2 위로", exact: true })
    .click();
  await expect(dialog.locator(".album-item").first()).toContainText(
    "second.gif",
  );
  for (const image of await dialog.locator("img").all())
    await expect(image).toHaveAttribute("src", preview);
  await dialog
    .getByRole("button", { name: "앨범 만들기", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(`img[src="${dataUrl}"]`)).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { loadAutosave } = await import("/src/storage.ts");
        return (await loadAutosave())?.slides
          .flatMap((s) => s.elements)
          .filter((e) => e.alt === "first.gif" || e.alt === "second.gif")
          .map((e) => e.src);
      }),
    )
    .toEqual([dataUrl, dataUrl]);
});
