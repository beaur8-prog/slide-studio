import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

async function render(
  page: Page,
  options: {
    scale?: number;
    custom?: boolean;
    merged?: boolean;
    asymmetric?: boolean;
    overflow?: boolean;
    roundTrip?: boolean;
    opacity?: number;
  } = {},
) {
  await page.goto("http://127.0.0.1:5190");
  await page.evaluate(async (options) => {
    const { createTable, createTableElement } = await import("/src/table.ts");
    const { blankDeck } = await import("/src/model.ts");
    const { importPptx, exportPptx } = await import("/src/io.ts");
    const { default: React } = await import(
      "/node_modules/.vite/deps/react.js"
    );
    const {
      default: { createRoot },
    } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { SlideVisual } = await import("/src/SlideCanvas.tsx");
    const size = options.merged ? 3 : 2;
    const table = createTable(size, size);
    Object.assign(table, {
      header: false,
      striped: false,
      autoRows: false,
      padding: 0,
      fontSize: 16,
      fill: "#FFFFFF",
      borderColor: "#000000",
      borderWidth: options.custom === false ? 8 : 0,
      cells: table.cells.map((row) => row.map(() => "")),
    });
    if (options.custom !== false)
      table.cellStyles = table.cells.map((row) =>
        row.map(() => ({
          borders: options.asymmetric
            ? [
                { color: "#FF0000", width: 6 },
                { color: "#00AA00", width: 8 },
                { color: "#0000FF", width: 10 },
                { color: "#AA00AA", width: 12 },
              ]
            : (Array.from({ length: 4 }, () => ({
                color: "#000000",
                width: 8,
                opacity: options.opacity,
              })) as any),
        })),
      );
    if (options.merged)
      table.merges = [{ row: 0, column: 0, rowSpan: 2, columnSpan: 2 }];
    if (options.overflow) table.cells[0][0] = "클리핑 확인\n".repeat(20);
    const deck = blankDeck();
    deck.slides[0].background = "#FFFFFF";
    deck.slides[0].elements = [
      {
        ...createTableElement(table),
        x: 40,
        y: 40,
        width: 320,
        height: options.overflow ? 60 : 180,
      },
    ];
    const slide = options.roundTrip
      ? (await importPptx(await exportPptx(deck))).deck.slides[0]
      : deck.slides[0];
    const host = document.createElement("div");
    host.id = "border-fixture";
    host.style.cssText = "position:fixed;inset:0;background:white;z-index:9999";
    document.body.append(host);
    createRoot(host).render(
      React.createElement(SlideVisual, {
        slide,
        width: 640,
        height: 400,
        scale: options.scale ?? 1,
      }),
    );
    await document.fonts.ready;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  }, options);
  return page.locator("#border-fixture .inserted-table");
}

async function pixels(buffer: Buffer) {
  const { data, info } = await sharp(buffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgb = (x: number, y: number) =>
    Array.from(
      data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3),
    );
  const count = (points: [number, number][], color: number[]) =>
    points.filter(([x, y]) =>
      rgb(x, y).every((value, i) => Math.abs(value - color[i]) < 8),
    ).length;
  return { width: info.width, height: info.height, rgb, count };
}

for (const scale of [1, 0.5, 2])
  for (const custom of [true, false]) {
    test(`${custom ? "imported" : "base"} table borders keep full outer width and a single shared stroke at ${scale}x`, async ({
      page,
    }, info) => {
      const table = await render(page, { scale, custom });
      const image = await pixels(
        await table.screenshot({ path: info.outputPath("borders.png") }),
      );
      const { width, height, count } = image,
        black = [0, 0, 0];
      const range = (n: number) => Array.from({ length: n }, (_, i) => i);
      const band = Math.ceil(20 * scale),
        thickness = 8 * scale;
      expect(
        count(
          range(band).map((y) => [Math.floor(width / 4), y]),
          black,
        ),
      ).toBe(thickness);
      expect(
        count(
          range(band).map((y) => [Math.floor(width / 4), height - 1 - y]),
          black,
        ),
      ).toBe(thickness);
      expect(
        count(
          range(band).map((x) => [x, Math.floor(height / 4)]),
          black,
        ),
      ).toBe(thickness);
      expect(
        count(
          range(band).map((x) => [width - 1 - x, Math.floor(height / 4)]),
          black,
        ),
      ).toBe(thickness);
      expect(
        count(
          range(band * 2).map((y) => [
            Math.floor(width / 4),
            height / 2 - band + y,
          ]),
          black,
        ),
      ).toBe(thickness);
      expect(
        count(
          range(band * 2).map((x) => [
            width / 2 - band + x,
            Math.floor(height / 4),
          ]),
          black,
        ),
      ).toBe(thickness);
    });
  }

test("asymmetric native borders retain their full widths, colors and shared-edge weight after PPTX round trip", async ({
  page,
}, info) => {
  const table = await render(page, { asymmetric: true, roundTrip: true });
  const { width, height, count } = await pixels(
    await table.screenshot({ path: info.outputPath("asymmetric-borders.png") }),
  );
  const range = Array.from({ length: 20 }, (_, i) => i);
  expect(
    count(
      range.map((y) => [width / 4, y]),
      [255, 0, 0],
    ),
  ).toBe(6);
  expect(
    count(
      range.map((x) => [width - 1 - x, height / 4]),
      [0, 170, 0],
    ),
  ).toBe(8);
  expect(
    count(
      range.map((y) => [width / 4, height - 1 - y]),
      [0, 0, 255],
    ),
  ).toBe(10);
  expect(
    count(
      range.map((x) => [x, height / 4]),
      [170, 0, 170],
    ),
  ).toBe(12);
  expect(
    count(
      range.map((y) => [width / 4, height / 2 - 10 + y]),
      [0, 0, 255],
    ),
  ).toBe(10);
  expect(
    count(
      range.map((x) => [width / 2 - 10 + x, height / 4]),
      [170, 0, 170],
    ),
  ).toBe(12);
});

test("a shared semi-transparent border is painted once", async ({ page }) => {
  const table = await render(page, { opacity: 0.5 });
  const image = await pixels(await table.screenshot());
  for (const point of [
    [1, image.height / 4],
    [image.width / 2, image.height / 4],
    [image.width / 4, image.height / 2],
  ])
    for (const value of image.rgb(point[0], point[1]))
      expect(Math.abs(value - 128)).toBeLessThanOrEqual(1);
});

test("merged cells have no internal border and text remains clipped outside the table", async ({
  page,
}, info) => {
  const table = await render(page, { merged: true });
  const image = await pixels(
    await table.screenshot({ path: info.outputPath("merged-borders.png") }),
  );
  expect(image.rgb(Math.round(image.width / 3), 20)).toEqual([255, 255, 255]);
  expect(image.rgb(20, image.height / 3)).toEqual([255, 255, 255]);
  const clipped = await render(page, { overflow: true });
  const box = (await clipped.boundingBox())!;
  const viewport = await pixels(await page.screenshot());
  let overflowPixels = 0;
  for (let y = Math.ceil(box.y + box.height); y < box.y + box.height + 80; y++)
    for (let x = Math.ceil(box.x); x < box.x + box.width; x++)
      if (viewport.rgb(x, y).some((value) => value !== 255)) overflowPixels++;
  expect(overflowPixels).toBe(0);
});
