// Public-corpus UI smoke test. Android identity is emulated; this is not an APK/device test.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chromium, expect } from "@playwright/test";

const root = process.cwd();
const sampleRoot = path.resolve(
  process.argv[2] || "qa/results/object-integrity-20261105/extra-public",
);
const output = path.resolve(
  process.argv[3] || "qa/results/android-ui-20261107/public-corpus",
);
if (!output.startsWith(path.join(root, "qa/results/")))
  throw new Error("Output must be inside qa/results");
await fs.mkdir(output, { recursive: true });
const manifest = JSON.parse(
  await fs.readFile("qa/object-presence-samples-2026-11-05.json", "utf8"),
);
const names = [
  "2411-Performance_Up.pptx",
  "51187.pptx",
  "bug54570.pptx",
  "54542_cropped_bitmap.pptx",
  "ArtisticEffectSample.pptx",
  "alterman_security.pptx",
  "bug62513.pptx",
  "table_test.pptx",
  "customGeo.pptx",
  "with_japanese.pptx",
  "EmbeddedAudio.pptx",
  "EmbeddedVideo.pptx",
];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
let server, browser;
const result = {
  environment:
    "Chromium, Android UA, 412×915 CSS px, touch emulation; no Android device",
  files: [],
  errors: [],
};
try {
  try {
    await fetch("http://127.0.0.1:5190");
  } catch {
    server = spawn(
      process.execPath,
      [
        "node_modules/vite/bin/vite.js",
        "--host",
        "127.0.0.1",
        "--port",
        "5190",
        "--strictPort",
      ],
      { cwd: root, stdio: "ignore" },
    );
    for (let i = 0; ; i++) {
      try {
        await fetch("http://127.0.0.1:5190");
        break;
      } catch {
        if (i >= 79) throw new Error("QA server did not start");
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }
  browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    hasTouch: true,
    isMobile: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:5190");
  await expect(page.getByTestId("android-reader")).toBeVisible();
  for (const name of names) {
    const entry = manifest.samples.find((item) => item.file === name);
    if (!entry) throw new Error(`Missing manifest entry: ${name}`);
    const file = path.join(sampleRoot, name),
      bytes = await fs.readFile(file);
    if (sha(bytes) !== entry.sha256)
      throw new Error(`Input hash mismatch: ${name}`);
    const expected = await page.evaluate(async (bytes) => {
      const { importPptx } = await import("/src/io.ts"),
        { isElementHidden } = await import("/src/layers.ts");
      const { deck } = await importPptx(new Uint8Array(bytes));
      return {
        name: deck.name,
        pages: deck.slides.map((slide) => ({
          objects: slide.elements.filter((element) => !isElementHidden(element))
            .length,
          tables: slide.elements.filter(
            (element) => !isElementHidden(element) && element.type === "table",
          ).length,
        })),
      };
    }, Array.from(bytes));
    await page.locator('input[accept*=".pptx"]').setInputFiles(file);
    await expect(page.locator(".android-topbar strong")).toHaveText(
      expected.name,
    );
    await expect(page.locator(".busy-backdrop")).toHaveCount(0);
    const indices = [
      ...new Set([
        0,
        Math.floor(expected.pages.length / 2),
        expected.pages.length - 1,
        ...(name === "2411-Performance_Up.pptx" ? [4] : []),
      ]),
    ];
    const record = {
      file: name,
      sha256: entry.sha256,
      slides: expected.pages.length,
      checked: [],
    };
    for (const index of indices) {
      await page.getByRole("button", { name: /^페이지로 이동 ·/ }).click();
      await page
        .getByRole("textbox", { name: "슬라이드 번호", exact: true })
        .fill(String(index + 1));
      await page.getByRole("button", { name: "이동", exact: true }).click();
      const artwork = page.locator(".android-slide-position");
      await expect(artwork.locator(".slide-element.static")).toHaveCount(
        expected.pages[index].objects,
      );
      const decoded = await artwork.evaluate(async (host) => {
        await document.fonts.ready;
        const images = [...host.querySelectorAll("img")];
        const failures = await Promise.all(
          images.map((image) =>
            image
              .decode()
              .then(() => null)
              .catch(() => image.alt || "image"),
          ),
        );
        const vectorImages = [
          ...new Set(
            [...host.querySelectorAll("image")]
              .map((image) => image.href.baseVal)
              .filter((src) => src?.startsWith("data:")),
          ),
        ];
        failures.push(
          ...(await Promise.all(
            vectorImages.map(async (src) => {
              const image = new Image();
              image.src = src;
              return image
                .decode()
                .then(() => null)
                .catch(() => "SVG image");
            }),
          )),
        );
        return {
          images: images.length,
          vectorImages: vectorImages.length,
          failures: failures.filter(Boolean),
        };
      });
      if (decoded.failures.length)
        throw new Error(
          `${name} page ${index + 1}: ${decoded.failures.join(", ")}`,
        );
      const tables = await artwork.getByRole("table").count();
      if (tables !== expected.pages[index].tables)
        throw new Error(
          `${name} page ${index + 1}: table count ${tables}, expected ${expected.pages[index].tables}`,
        );
      await page.screenshot({
        path: path.join(output, `${name}-${index + 1}.png`),
      });
      record.checked.push({
        page: index + 1,
        objects: expected.pages[index].objects,
        tables,
        ...decoded,
      });
    }
    if (
      (await page.evaluate(() =>
        sessionStorage.getItem("slide-studio-file-dirty"),
      )) !== "false"
    )
      throw new Error(`${name}: reader dirtied the document`);
    if (sha(await fs.readFile(file)) !== entry.sha256)
      throw new Error(`${name}: source changed`);
    result.files.push(record);
    console.log(
      `${name}: ${record.slides} slides; ${record.checked.length} pages checked`,
    );
  }
} catch (error) {
  result.errors.push(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
} finally {
  await browser?.close();
  server?.kill("SIGTERM");
  await fs.writeFile(
    path.join(output, "summary.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({
      files: result.files.length,
      checkedPages: result.files.reduce(
        (sum, file) => sum + file.checked.length,
        0,
      ),
      errors: result.errors,
    }),
  );
}
