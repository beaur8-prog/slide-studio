import { test, expect } from "@playwright/test";
import fs from "node:fs";

test("fragmented recovery JSON preserves escapes, Korean and surrogate pairs at chunk boundaries", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { jsonBlob } = await import("/src/recovery-encoding.ts");
    const values = [
      {
        text: "X".repeat(262143) + '😀\ud800\u0000"\\\n한글',
        omitted: undefined,
        array: [undefined, null, true, false, 0, -0, NaN],
      },
      { empty: "", nested: [{ text: "한글\r\n\t" }, {}, []] },
      Array.from({ length: 70 }, (_, i) => ({
        ["키" + i]: '"\\\udc00😀'.repeat(i),
      })),
    ];
    return await Promise.all(
      values.map(
        async (value) =>
          JSON.stringify(JSON.parse(await jsonBlob(value).text())) ===
          JSON.stringify(value),
      ),
    );
  });
  expect(result).toEqual([true, true, true]);
});

test("large recovery records commit atomically beyond the direct IndexedDB value limit", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { encodeRecovery, decodeRecovery } = await import(
      "/src/recovery-encoding.ts"
    );
    const original = {
      payload: "R".repeat(136 * 1024 * 1024),
      label: "대용량 😀",
    };
    const encoded = encodeRecovery(original);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("recovery-record-test", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("records");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const put = (value: unknown, abort = false) =>
      new Promise<boolean>((resolve, reject) => {
        const tx = db.transaction("records", "readwrite");
        tx.objectStore("records").put(value, "current");
        tx.oncomplete = () => resolve(true);
        tx.onabort = () => resolve(false);
        tx.onerror = (event) => {
          if (abort) event.preventDefault();
          else reject(tx.error || new Error("Recovery transaction failed"));
        };
        if (abort) tx.abort();
      });
    const get = () =>
      new Promise<unknown>((resolve, reject) => {
        const r = db
          .transaction("records")
          .objectStore("records")
          .get("current");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    try {
      await put({ prior: "preserved" });
      const aborted = await put(encoded, true);
      const prior = await get();
      await put(encoded);
      const restored = await decodeRecovery<typeof original>(await get());
      return {
        aborted,
        prior,
        length: restored.payload.length,
        exact: restored.payload === original.payload,
        label: restored.label,
        blob: "data" in encoded && encoded.data instanceof Blob,
      };
    } finally {
      db.close();
    }
  });
  expect(result).toEqual({
    aborted: false,
    prior: { prior: "preserved" },
    length: 136 * 1024 * 1024,
    exact: true,
    label: "대용량 😀",
    blob: true,
  });
});

test("ordinary and legacy recovery records keep the existing single current document", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  const result = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { saveAutosave, loadAutosave } = await import("/src/storage.ts");
    const d = blankDeck();
    d.name = "이전 복구 형식";
    await saveAutosave(d);
    const loaded = await loadAutosave();
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("slide-studio", 1);
      r.onsuccess = () => resolve(r.result);
    });
    const raw = await new Promise<any>((resolve) => {
      const r = db
        .transaction("documents")
        .objectStore("documents")
        .get("current");
      r.onsuccess = () => resolve(r.result);
    });
    const keys = await new Promise<IDBValidKey[]>((resolve) => {
      const r = db
        .transaction("documents")
        .objectStore("documents")
        .getAllKeys();
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return {
      name: loaded?.name,
      rawName: raw.name,
      version: raw.version,
      keys,
    };
  });
  expect(result).toEqual({
    name: "이전 복구 형식",
    rawName: "이전 복구 형식",
    version: 1,
    keys: ["current", "current-revision"],
  });
});

test("151-slide public presentation saves recovery above 127MiB and reloads edited notes twice", async ({
  page,
}) => {
  test.skip(
    !fs.existsSync("qa/samples/cmu-lecture-3.pptx"),
    "Optional public CMU fixture",
  );
  test.setTimeout(120000);
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page
    .locator('input[type="file"][accept*=".pptx"]')
    .setInputFiles("qa/samples/cmu-lecture-3.pptx");
  await expect(page.locator(".thumbnail-row")).toHaveCount(151);
  const notes = page.getByRole("textbox", { name: "발표자 노트", exact: true });
  await notes.fill("대용량 복구 노트 — 한글 😀");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨", {
    timeout: 30000,
  });
  const fingerprint = () =>
    page.evaluate(async () => {
      const { loadAutosave } = await import("/src/storage.ts");
      const d = (await loadAutosave())!;
      const data = d.pptxSources?.[0]?.data ?? "";
      const digest = Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data)),
        ),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      return {
        slides: d.slides.length,
        elements: d.slides.reduce((n, s) => n + s.elements.length, 0),
        notes: d.slides[0].notes,
        sourceChars: data.length,
        digest,
      };
    });
  const original = await fingerprint();
  expect(original.sourceChars).toBeGreaterThan(50 * 1024 * 1024);
  for (let i = 0; i < 2; i++) {
    await page.reload();
    await expect(page.locator(".thumbnail-row")).toHaveCount(151);
    await expect(notes).toHaveValue("대용량 복구 노트 — 한글 😀");
    await expect(page.locator(".save-indicator")).toHaveText("저장됨", {
      timeout: 30000,
    });
    expect(await fingerprint()).toEqual(original);
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("slide-studio-file-dirty"),
      ),
    ).toBe("true");
  }
});
