import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const MiB = 1024 * 1024;

async function prepareLibrary(page: Page) {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  const small = {
    version: 1,
    id: "memory-base",
    name: "Memory base",
    width: 1280,
    height: 720,
    theme: "forest",
    slides: [
      {
        id: "base-slide",
        background: "#FFFFFF",
        notes: "",
        elements: [],
        transition: "none",
      },
    ],
  };
  await page.locator('input[type="file"][accept*=".pptx"]').setInputFiles({
    name: "memory-base.slide",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(small)),
  });
  await expect(
    page.getByRole("textbox", { name: "프레젠테이션 이름" }),
  ).toHaveValue("Memory base");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("slide-studio", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    let bytes = 0;
    try {
      for (let index = 0; index < 12; index++) {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 512;
        const ctx = canvas.getContext("2d")!;
        const pixels = ctx.createImageData(512, 512);
        for (let offset = 0; offset < pixels.data.length; offset += 65536)
          crypto.getRandomValues(pixels.data.subarray(offset, offset + 65536));
        for (let offset = 3; offset < pixels.data.length; offset += 4)
          pixels.data[offset] = 255;
        ctx.putImageData(pixels, 0, 0);
        const src = canvas.toDataURL("image/png");
        bytes += src.length;
        canvas.width = canvas.height = 0;
        const deck = {
          version: 1,
          id: `memory-saved-${index}`,
          name: `Saved memory deck ${index}`,
          width: 1280,
          height: 720,
          theme: "forest",
          slides: [
            {
              id: `title-${index}`,
              background: "#FFFFFF",
              notes: "",
              elements: [],
              transition: "none",
            },
            // The preview never renders this image, so decoder caches cannot
            // account for the heap growth caused by retaining the full deck.
            {
              id: `image-${index}`,
              background: "#FFFFFF",
              notes: "",
              transition: "none",
              elements: [
                {
                  id: `img-${index}`,
                  type: "image",
                  x: 0,
                  y: 0,
                  width: 512,
                  height: 512,
                  rotation: 0,
                  opacity: 1,
                  src,
                },
              ],
            },
          ],
        };
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("documents", "readwrite");
          tx.objectStore("documents").put(deck, deck.id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      }
    } finally {
      db.close();
    }
    return bytes;
  });
}

async function heapAfterGC(page: Page, cdp: CDPSession) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  return (await cdp.send("Runtime.getHeapUsage")).usedSize;
}

test("closing the library releases saved image payloads through every dismissal path", async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  const encodedBytes = await prepareLibrary(page);
  expect(encodedBytes).toBeGreaterThan(13 * MiB);
  const cdp = await page.context().newCDPSession(page);
  const baseline = await heapAfterGC(page, cdp);
  const samples: { path: string; open: number; closed: number }[] = [];
  const paths = ["close", "escape", "backdrop", "select", "new"];
  for (const path of paths) {
    await page.getByTitle("내 프레젠테이션", { exact: true }).click();
    await expect(
      page
        .locator(".library-grid > button")
        .filter({ hasText: "Saved memory deck" }),
    ).toHaveCount(12);
    const open = await heapAfterGC(page, cdp);
    expect(open - baseline).toBeGreaterThan(10 * MiB);
    if (path === "close")
      await page.getByRole("button", { name: "대화상자 닫기" }).click();
    else if (path === "escape") await page.keyboard.press("Escape");
    else if (path === "backdrop")
      await page.locator(".modal-backdrop").click({ position: { x: 4, y: 4 } });
    else if (path === "select")
      await page
        .locator(".library-grid > button")
        .filter({ hasText: "Memory base" })
        .click();
    else {
      await page.locator(".library-new").click();
      await page.getByRole("button", { name: "만들기", exact: true }).click();
    }
    await expect(page.locator(".library-grid")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Clear React's previous-render alternate without retaining another deck.
    await page.getByRole("button", { name: "삽입", exact: true }).click();
    await page.getByRole("button", { name: "홈", exact: true }).click();
    await expect(page.locator(".save-indicator")).toHaveText("저장됨");
    const closed = await heapAfterGC(page, cdp);
    samples.push({ path, open, closed });
    expect(closed - baseline, `${path} retained library bytes`).toBeLessThan(
      5 * MiB,
    );
  }
  const metrics = testInfo.outputPath("library-heap.json");
  await writeFile(
    metrics,
    JSON.stringify({ encodedBytes, baseline, samples }, null, 2),
  );
  await testInfo.attach("library-heap.json", {
    path: metrics,
    contentType: "application/json",
  });
});

test("a library read completing after dismissal cannot restore its modal or retain its payload", async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  await prepareLibrary(page);
  const cdp = await page.context().newCDPSession(page);
  const baseline = await heapAfterGC(page, cdp);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.getAll;
    const pending: (() => void)[] = [];
    (window as any).__finishLibraryReads = () => {
      IDBObjectStore.prototype.getAll = original;
      for (const finish of pending.splice(0)) finish();
    };
    (window as any).__pendingLibraryReads = () => pending.length;
    IDBObjectStore.prototype.getAll = function (...args) {
      const request = original.apply(this, args);
      Object.defineProperty(request, "onsuccess", {
        set(callback: (event: Event) => void) {
          request.addEventListener(
            "success",
            (event) => {
              pending.push(() => callback.call(request, event));
            },
            { once: true },
          );
        },
      });
      return request;
    };
  });
  await page.getByTitle("내 프레젠테이션", { exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).__pendingLibraryReads()))
    .toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).__finishLibraryReads();
    delete (window as any).__finishLibraryReads;
    delete (window as any).__pendingLibraryReads;
  });
  await page.getByRole("button", { name: "삽입", exact: true }).click();
  await page.getByRole("button", { name: "홈", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const closed = await heapAfterGC(page, cdp);
  expect(closed - baseline).toBeLessThan(5 * MiB);
  const metrics = testInfo.outputPath("late-library-heap.json");
  await writeFile(metrics, JSON.stringify({ baseline, closed }, null, 2));
  await testInfo.attach("late-library-heap.json", {
    path: metrics,
    contentType: "application/json",
  });
});
