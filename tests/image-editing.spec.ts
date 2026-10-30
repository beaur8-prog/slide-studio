import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import sharp from "sharp";

let wide: Buffer, tall: Buffer;
test.beforeAll(async () => {
  const pixels = Buffer.alloc(800 * 400 * 3);
  for (let y = 0; y < 400; y++)
    for (let x = 0; x < 800; x++) {
      const grid =
        x % 100 < 2 ||
        y % 100 < 2 ||
        Math.abs(Math.hypot(x - 400, y - 200) - 90) < 3;
      const color = grid
        ? [255, 255, 255]
        : x < 400
          ? [190, 75, 55]
          : [49, 85, 120];
      for (let c = 0; c < 3; c++) pixels[(y * 800 + x) * 3 + c] = color[c];
    }
  wide = await sharp(pixels, { raw: { width: 800, height: 400, channels: 3 } })
    .png()
    .toBuffer();
  tall = await sharp({
    create: { width: 200, height: 600, channels: 3, background: "#D96842" },
  })
    .png()
    .toBuffer();
});
const item = (page: Page) =>
  page.locator('.editable-slide [data-element-id="picture"]');
async function seed(page: Page, locked = false) {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(
    async ({ src, locked }) => {
      const { blankDeck, element } = await import("/src/model.ts");
      const { saveAutosave } = await import("/src/storage.ts");
      const deck = blankDeck();
      deck.slides[0].elements = [
        element("image", {
          id: "picture",
          src,
          alt: "원본 그림",
          x: 140,
          y: 160,
          width: 400,
          height: 400,
          rotation: 17,
          groups: ["qa-picture-group"],
          flipH: true,
          opacity: 0.8,
          locked,
        }),
      ];
      await saveAutosave(deck);
    },
    { src: `data:image/png;base64,${wide.toString("base64")}`, locked },
  );
  await page.reload();
  await item(page).click();
}
async function picture(page: Page) {
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  return page.evaluate(
    async () =>
      (await (await import("/src/storage.ts")).loadAutosave())!.slides[0]
        .elements[0],
  );
}
const geometry = {
  x: 140,
  y: 160,
  width: 400,
  height: 400,
  rotation: 17,
  flipH: true,
  opacity: 0.8,
};
async function replace(
  page: Page,
  bytes: Buffer,
  name = "교체 그림.PNG",
  mimeType = "image/png",
) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "그림 교체", exact: true }).click();
  await (await chooser).setFiles({ name, mimeType, buffer: bytes });
}

test("fit and fill preserve the frame and aspect ratio, and each action undoes independently", async ({
  page,
}) => {
  await seed(page);
  await page.getByRole("button", { name: "그림 채우기", exact: true }).click();
  await expect
    .poll(async () => (await picture(page)).crop)
    .toEqual([0, 0.25, 0, 0.25]);
  expect(await picture(page)).toMatchObject(geometry);
  await page.getByRole("button", { name: "그림 맞춤", exact: true }).click();
  await expect
    .poll(async () => (await picture(page)).crop)
    .toEqual([-0.5, 0, -0.5, 0]);
  expect(await picture(page)).toMatchObject(geometry);
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () => (await picture(page)).crop)
    .toEqual([0, 0.25, 0, 0.25]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await picture(page)).crop).toBeUndefined();
});

test("crop previews are drafts, cancel is a no-op and apply produces one undo step", async ({
  page,
}, testInfo) => {
  await seed(page);
  await page.getByRole("button", { name: "그림 자르기", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "그림 자르기", exact: true });
  await expect(
    dialog.getByRole("button", { name: "적용", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "채우기", exact: true }).click();
  await dialog.getByRole("slider", { name: "그림 확대 비율" }).fill("2");
  const frame = dialog.getByRole("img", {
    name: "자르기 미리보기",
    exact: true,
  });
  await frame.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await page.screenshot({ path: testInfo.outputPath("crop-preview.png") });
  expect((await picture(page)).crop).toBeUndefined();
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "실행 취소", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "그림 자르기", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "적용", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "채우기", exact: true }).click();
  await dialog.getByRole("button", { name: "적용", exact: true }).click();
  await expect
    .poll(async () => (await picture(page)).crop)
    .toEqual([0, 0.25, 0, 0.25]);
  expect(await picture(page)).toMatchObject(geometry);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await picture(page)).crop).toBeUndefined();
  await expect(
    page.getByRole("button", { name: "실행 취소", exact: true }),
  ).toBeDisabled();
});

test("crop can be reached from the context menu, Escape cancels and modal focus stays in the dialog", async ({
  page,
}) => {
  await seed(page);
  await item(page).click({ button: "right" });
  await page.getByRole("menuitem", { name: "자르기", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "그림 자르기", exact: true });
  await expect(
    dialog.getByRole("button", { name: "적용", exact: true }),
  ).toBeEnabled();
  await dialog
    .getByRole("button", { name: "자르기 닫기", exact: true })
    .focus();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "적용", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "실행 취소", exact: true }),
  ).toBeDisabled();
});

test("picture replacement keeps identity, geometry, flip, opacity and group while fitting its new aspect", async ({
  page,
}) => {
  await seed(page);
  const original = await picture(page);
  await replace(page, tall);
  await expect
    .poll(async () => (await picture(page)).src)
    .toBe(`data:image/png;base64,${tall.toString("base64")}`);
  const next = await picture(page);
  expect(next).toMatchObject({
    ...geometry,
    id: "picture",
    alt: "교체 그림.PNG",
  });
  expect(next.groups).toEqual(original.groups);
  expect(next.crop![0]).toBeCloseTo(1 / 3, 5);
  expect(next.crop![2]).toBeCloseTo(1 / 3, 5);
  await page.keyboard.press("ControlOrMeta+z");
  expect(await picture(page)).toEqual(original);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(async () => (await picture(page)).src).toBe(next.src);
});

test("GIF replacement and crop preserve original animated bytes through a PPTX round trip", async ({
  page,
}, testInfo) => {
  await seed(page);
  const gif = await fs.readFile("tests/fixtures/media/animated.gif");
  await replace(page, gif, "움직이는 그림.gif", "image/gif");
  await expect
    .poll(async () => (await picture(page)).src)
    .toBe(`data:image/gif;base64,${gif.toString("base64")}`);
  await page.getByRole("button", { name: "그림 자르기", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "그림 자르기", exact: true });
  await expect(
    dialog.getByRole("button", { name: "적용", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("slider", { name: "그림 확대 비율" }).fill("2");
  await dialog.getByRole("button", { name: "적용", exact: true }).click();
  await expect
    .poll(async () => (await picture(page)).crop)
    .toEqual([0.25, 0.25, 0.25, 0.25]);
  await picture(page);
  const result = await page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const input = (await loadAutosave())!;
    const bytes = await exportPptx(input);
    return {
      bytes: Array.from(bytes),
      before: input.slides[0].elements[0],
      after: (await importPptx(bytes)).deck.slides[0].elements.find(
        (e) => e.type === "image",
      )!,
    };
  });
  expect(result.after.src).toBe(result.before.src);
  expect(result.after).toMatchObject(geometry);
  result.before.crop!.forEach((value, i) =>
    expect(result.after.crop![i]).toBeCloseTo(value, 4),
  );
  await fs.writeFile(
    testInfo.outputPath("cropped-gif.pptx"),
    Buffer.from(result.bytes),
  );
});

test("invalid pictures and corrupt GIFs leave the existing picture and history intact", async ({
  page,
}) => {
  await seed(page);
  const original = await picture(page);
  await replace(page, Buffer.from("not an image"), "broken.png");
  await expect(page.locator(".toast")).toContainText("PNG, JPG, GIF, WebP");
  expect(await picture(page)).toEqual(original);
  await replace(
    page,
    Buffer.from("GIF89a" + "\x00".repeat(20)),
    "broken.gif",
    "image/gif",
  );
  await expect(page.locator(".toast")).toContainText("열 수 없습니다");
  expect(await picture(page)).toEqual(original);
  await expect(
    page.getByRole("button", { name: "실행 취소", exact: true }),
  ).toBeDisabled();
});

test("locked pictures disable editing controls and keep the source intact", async ({
  page,
}) => {
  await seed(page, true);
  for (const name of ["그림 자르기", "그림 교체", "그림 맞춤", "그림 채우기"])
    await expect(
      page.getByRole("button", { name, exact: true }),
    ).toBeDisabled();
  await item(page).click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "그림 교체", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  expect((await picture(page)).src).toBe(
    `data:image/png;base64,${wide.toString("base64")}`,
  );
});

test("late image decoding cannot replace a picture in a newly opened document", async ({
  page,
}) => {
  await seed(page);
  await page.evaluate(() => {
    const original = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = async function () {
      await new Promise<void>((resolve) => {
        (window as any).__resumeImageDecode = resolve;
      });
      try {
        return await original.call(this);
      } finally {
        (window as any).__imageDecodeFinished = true;
        HTMLImageElement.prototype.decode = original;
      }
    };
  });
  await replace(page, tall);
  await page.waitForFunction(() => !!(window as any).__resumeImageDecode);
  const empty = {
    version: 1,
    id: "new-picture-document",
    name: "새 문서",
    width: 1280,
    height: 720,
    theme: "paper",
    slides: [
      {
        id: "new-picture-slide",
        background: "#FFFFFF",
        notes: "",
        transition: "none",
        elements: [],
      },
    ],
  };
  await page.locator('input[accept*=".pptx"]').setInputFiles({
    name: "새 문서.slide",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(empty)),
  });
  await expect(
    page.getByRole("textbox", { name: "프레젠테이션 이름", exact: true }),
  ).toHaveValue("새 문서");
  await page.evaluate(() => (window as any).__resumeImageDecode());
  await page.waitForFunction(() => !!(window as any).__imageDecodeFinished);
  await expect(page.locator(".editable-slide .slide-element")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "실행 취소", exact: true }),
  ).toBeDisabled();
});

test("dragging a zoomed flipped image pans the crop and preserves document geometry", async ({
  page,
}) => {
  await seed(page);
  await page.getByRole("button", { name: "그림 자르기", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "그림 자르기", exact: true });
  await expect(
    dialog.getByRole("button", { name: "적용", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("slider", { name: "그림 확대 비율" }).fill("2");
  const bounds = (await dialog
    .getByRole("img", { name: "자르기 미리보기", exact: true })
    .boundingBox())!;
  const x = bounds.x + bounds.width / 2,
    y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + bounds.width * 0.1, y, { steps: 5 });
  await page.mouse.up();
  await dialog.getByRole("button", { name: "적용", exact: true }).click();
  const image = await picture(page);
  image.crop!.forEach((value, i) =>
    expect(value).toBeCloseTo([0.25, 0.35, 0.25, 0.4][i], 5),
  );
  expect(image).toMatchObject(geometry);
});

test("fitting an already matching image creates no change or undo history", async ({
  page,
}) => {
  await seed(page);
  await page.evaluate(async () => {
    const { loadAutosave, saveAutosave } = await import("/src/storage.ts");
    const deck = (await loadAutosave())!;
    deck.slides[0].elements[0].height = 200;
    await saveAutosave(deck);
  });
  await page.reload();
  await item(page).click();
  await page.getByRole("button", { name: "그림 자르기", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "그림 자르기", exact: true });
  await expect(
    dialog.getByRole("button", { name: "적용", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "맞춤", exact: true }).click();
  await dialog.getByRole("button", { name: "적용", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "실행 취소", exact: true }),
  ).toBeDisabled();
  expect((await picture(page)).crop).toBeUndefined();
});

test("crop geometry handles wide and tall frames without distortion and rejects invalid ranges", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const {
      frameImageCrop,
      panImageCrop,
      validateImageCrop,
      zoomImageCrop,
      assertImageCapacity,
    } = await import("/src/image-editing.ts");
    const { blankDeck, element } = await import("/src/model.ts");
    const frame = { width: 400, height: 400 },
      source = { width: 800, height: 400 };
    const fill = frameImageCrop(frame, source, "fill"),
      fit = frameImageCrop(frame, source, "fit");
    const zoom = zoomImageCrop(frame, source, 2, fill),
      pan = panImageCrop(zoom, 0.1, -0.1);
    const rejected = [
      [0.5, 0, 0.5, 0],
      [NaN, 0, 0, 0],
      [-11, 0, 0, 0],
    ].map((crop) => {
      try {
        validateImageCrop(crop as any);
        return false;
      } catch {
        return true;
      }
    });
    const deck = blankDeck(),
      src = "data:image/png;base64," + "a".repeat(8 * 1024 * 1024);
    deck.slides[0].elements = Array.from({ length: 16 }, () =>
      element("image", { src }),
    );
    let exceeds = false;
    try {
      assertImageCapacity(deck, src);
    } catch {
      exceeds = true;
    }
    assertImageCapacity(deck, src, {
      slideId: deck.slides[0].id,
      elementId: deck.slides[0].elements[0].id,
    });
    return { fill, fit, zoom, pan, rejected, exceeds };
  });
  expect(result.fill).toEqual([0, 0.25, 0, 0.25]);
  expect(result.fit).toEqual([-0.5, 0, -0.5, 0]);
  expect(result.zoom).toEqual([0.25, 0.375, 0.25, 0.375]);
  result.pan.forEach((value, i) =>
    expect(value).toBeCloseTo([0.3, 0.4, 0.2, 0.35][i], 6),
  );
  expect(result.rejected).toEqual([true, true, true]);
  expect(result.exceeds).toBe(true);
});
