import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";

let server: Server;
let baseURL: string;
const dist = path.resolve("dist");

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      const file = path.resolve(
        dist,
        "." + (pathname === "/" ? "/index.html" : decodeURIComponent(pathname)),
      );
      if (!file.startsWith(dist + path.sep)) throw Error("outside dist");
      const mime: Record<string, string> = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
      };
      response.setHeader(
        "Content-Type",
        mime[path.extname(file)] ?? "application/octet-stream",
      );
      response.end(await readFile(file));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("missing test server");
  baseURL = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
});

test("production assets decode TIFF, load bundled fonts, restore Korean layout and export through UI", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  test.skip(
    !fs.existsSync(path.join(dist, "index.html")) ||
      !fs.existsSync("qa/samples/cmu-lecture-1.pptx"),
    "Build the app and download the public QA corpus first.",
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(baseURL);
  const open = async (file: string) => {
    await page
      .locator('input[type=file][accept*=".pptx"]')
      .setInputFiles(path.resolve(file));
    await page.waitForFunction(
      () =>
        document.querySelector(".warning-list") ||
        document
          .querySelector(".toast")
          ?.textContent?.includes("불러왔습니다") ||
        document
          .querySelector(".toast")
          ?.textContent?.includes("파일 열기 실패"),
    );
    await expect(
      page.locator(".toast").filter({ hasText: "파일 열기 실패" }),
    ).toHaveCount(0);
    if (await page.locator(".warning-list").count())
      await page
        .getByRole("button", { name: "편집 시작하기", exact: true })
        .click();
    await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  };
  await open("qa/samples/cmu-lecture-1.pptx");
  await expect(page.locator(".thumbnail-row")).toHaveCount(70);
  await expect(page.locator(".editable-slide img")).toHaveCount(1);
  expect(
    await page
      .locator(".editable-slide img")
      .evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth > 100,
      ),
  ).toBe(true);
  await open("qa/samples/dsu-korean.pptx");
  await expect(page.locator(".thumbnail-row")).toHaveCount(22);
  await page.locator(".thumbnail-button").nth(5).click();
  await expect(page.locator(".editable-slide")).toContainText("고충처리위원회");
  await page.locator(".thumbnail-button").nth(11).click();
  await expect(page.locator(".editable-slide .text-borders")).toHaveCount(4);
  const fonts = await page.evaluate(async () => {
    await document.fonts.load('24px "Carlito"');
    const korean = await document.fonts.load(
      '24px "Slide Studio Nanum Barun Gothic"',
      "한글",
    );
    if (!korean.some((font) => font.status === "loaded")) return false;
    return Array.from(document.fonts).some(
      (font) =>
        font.family.replaceAll('"', "") === "Carlito" &&
        font.status === "loaded",
    );
  });
  expect(fonts).toBe(true);
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "PPTX 내보내기", exact: true })
    .click();
  const download = await downloadPromise;
  const exported = testInfo.outputPath("production-roundtrip.pptx");
  await download.saveAs(exported);
  expect((await readFile(exported)).subarray(0, 2).toString()).toBe("PK");
  await open(exported);
  await expect(page.locator(".thumbnail-row")).toHaveCount(22);
  await page.locator(".thumbnail-button").nth(5).click();
  await expect(page.locator(".editable-slide")).toContainText("고충처리위원회");
  await page
    .getByTestId("canvas-frame")
    .screenshot({ path: testInfo.outputPath("production-diagram.png") });
  expect(errors).toEqual([]);
});
