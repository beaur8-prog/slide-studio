import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import JSZip from "jszip";
const require = createRequire(import.meta.url);
const { decodeRecoveryPayload } = require("../electron/recovery-save.cjs");
const base = process.env.QA_BASE_URL ?? "http://127.0.0.1:5190";
async function harness(page: Page) {
  await page.route("**/qa-recovery-download", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html><body>Isolated recovery download</body></html>",
    }),
  );
  await page.goto(base + "/qa-recovery-download");
}

test("unknown recovery envelope versions retain version metadata and every Blob byte in the archive", async ({
  page,
}) => {
  await harness(page);
  const result = await page.evaluate(async () => {
    const { recoveryDownload } = await import("/src/storage.ts");
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("slide-studio", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("documents");
      r.onsuccess = () => resolve(r.result);
    });
    const output = [];
    for (const version of [0, 2, "1", null]) {
      await new Promise<void>((resolve) => {
        const tx = db.transaction("documents", "readwrite");
        tx.objectStore("documents").put(
          {
            format: "slide-studio-recovery-json",
            version,
            data: new Blob([new Uint8Array([123, 255, 0, 125])], {
              type: "application/json",
            }),
          },
          "current",
        );
        tx.oncomplete = () => resolve();
      });
      const file = await recoveryDownload();
      output.push({
        version,
        name: file.name,
        bytes: [...new Uint8Array(await file.blob.arrayBuffer())],
      });
    }
    db.close();
    return output;
  });
  for (const file of result) {
    expect(file.name).toMatch(/\.zip$/);
    const zip = await JSZip.loadAsync(new Uint8Array(file.bytes));
    const manifest = JSON.parse(await zip.file("record.json")!.async("string"));
    expect(manifest.record.version).toBe(file.version);
    expect([...(await zip.file("blobs/0.bin")!.async("uint8array"))]).toEqual([
      123, 255, 0, 125,
    ]);
  }
});

test("known v1 and bare Blob records retain original damaged bytes without arrayBuffer re-encoding", async ({
  page,
}) => {
  await harness(page);
  const result = await page.evaluate(async () => {
    const { recoveryDownload } = await import("/src/storage.ts");
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("slide-studio", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("documents");
      r.onsuccess = () => resolve(r.result);
    });
    const rows = [];
    for (const type of ["envelope", "bare"]) {
      const original = new Blob([new Uint8Array([255, 123, 0, 125])], {
        type: "application/json",
      });
      await new Promise<void>((resolve) => {
        const tx = db.transaction("documents", "readwrite");
        tx.objectStore("documents").put(
          type === "envelope"
            ? {
                format: "slide-studio-recovery-json",
                version: 1,
                data: original,
              }
            : original,
          "current",
        );
        tx.oncomplete = () => resolve();
      });
      let reads = 0;
      const arrayBuffer = Blob.prototype.arrayBuffer;
      Blob.prototype.arrayBuffer = function () {
        reads++;
        return arrayBuffer.call(this);
      };
      let file;
      try {
        file = await recoveryDownload();
      } finally {
        Blob.prototype.arrayBuffer = arrayBuffer;
      }
      rows.push({
        name: file.name,
        reads,
        bytes: [...new Uint8Array(await file.blob.arrayBuffer())],
      });
    }
    db.close();
    return rows;
  });
  for (const file of result) {
    expect(file.name).toMatch(/\.json$/);
    expect(file.reads).toBe(0);
    expect(file.bytes).toEqual([255, 123, 0, 125]);
  }
});

test("oversized diagnostic Blob archives fail before reading any Blob and leave the raw record intact", async ({
  page,
}) => {
  await harness(page);
  const result = await page.evaluate(async () => {
    const { recoveryDownload } = await import("/src/storage.ts");
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("slide-studio", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("documents");
      r.onsuccess = () => resolve(r.result);
    });
    const type = "application/x-qa-oversized",
      original = {
        format: "slide-studio-recovery-json",
        version: 1,
        data: new Blob(["R"], { type }),
        extra: "keep",
      };
    await new Promise<void>((resolve) => {
      const tx = db.transaction("documents", "readwrite");
      tx.objectStore("documents").put(original, "current");
      tx.oncomplete = () => resolve();
    });
    const descriptor = Object.getOwnPropertyDescriptor(Blob.prototype, "size")!,
      arrayBuffer = Blob.prototype.arrayBuffer;
    let reads = 0,
      message = "";
    Object.defineProperty(Blob.prototype, "size", {
      ...descriptor,
      get() {
        return this.type === type
          ? 257 * 1024 * 1024
          : descriptor.get!.call(this);
      },
    });
    Blob.prototype.arrayBuffer = function () {
      reads++;
      throw Error("ArrayBuffer read should never start");
    };
    try {
      await recoveryDownload();
    } catch (error) {
      message = (error as Error).message;
    } finally {
      Object.defineProperty(Blob.prototype, "size", descriptor);
      Blob.prototype.arrayBuffer = arrayBuffer;
    }
    const raw = await new Promise<any>((resolve) => {
      const r = db
        .transaction("documents")
        .objectStore("documents")
        .get("current");
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return {
      reads,
      message,
      extra: raw.extra,
      blobBytes: await raw.data.text(),
    };
  });
  expect(result).toMatchObject({ reads: 0, extra: "keep", blobBytes: "R" });
  expect(result.message).toContain("256 MiB");
  expect(result.message).toContain("원본은 앱에 보관");
});

test("ZIP preflight includes the complete headers and UTF-8 manifest at the exact 256MiB boundary", async ({
  page,
}) => {
  await harness(page);
  const result = await page.evaluate(async () => {
    const { recoveryDownload } = await import("/src/storage.ts");
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("slide-studio", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("documents");
      r.onsuccess = () => resolve(r.result);
    });
    const type = "application/x-qa-boundary",
      raw = { blob: new Blob(["x"], { type }), tag: "경계😀" };
    await new Promise<void>((resolve) => {
      const tx = db.transaction("documents", "readwrite");
      tx.objectStore("documents").put(raw, "current");
      tx.oncomplete = () => resolve();
    });
    const maximum = 256 * 1024 * 1024,
      overhead =
        22 + (76 + 2 * "record.json".length) + (76 + 2 * "blobs/0.bin".length);
    const manifestSize = (size: number) =>
      new TextEncoder().encode(
        JSON.stringify({
          format: "slide-studio-raw-recovery-archive",
          version: 1,
          record: {
            blob: { recoveryBlob: "blobs/0.bin", type, size },
            tag: raw.tag,
          },
        }),
      ).byteLength;
    let exact = maximum - overhead;
    for (let i = 0; i < 4; i++)
      exact = maximum - overhead - manifestSize(exact);
    const descriptor = Object.getOwnPropertyDescriptor(Blob.prototype, "size")!,
      arrayBuffer = Blob.prototype.arrayBuffer;
    const rows = [];
    for (const value of [exact, exact + 1]) {
      const reads: number[] = [];
      Object.defineProperty(Blob.prototype, "size", {
        ...descriptor,
        get() {
          return this.type === type ? value : descriptor.get!.call(this);
        },
      });
      Blob.prototype.arrayBuffer = function () {
        reads.push(this.size);
        if (this.type === type)
          throw Error("BOUNDARY_PROBE before actual large allocation");
        return arrayBuffer.call(this);
      };
      let message = "";
      try {
        await recoveryDownload();
      } catch (error) {
        message = (error as Error).message;
      }
      rows.push({ value, reads, message });
      Object.defineProperty(Blob.prototype, "size", descriptor);
      Blob.prototype.arrayBuffer = arrayBuffer;
    }
    db.close();
    return {
      rows,
      exactTotal: exact + overhead + manifestSize(exact),
      maximum,
    };
  });
  expect(result.exactTotal).toBe(result.maximum);
  expect(result.rows[0].message).toContain("BOUNDARY_PROBE");
  expect(result.rows[0].reads).toHaveLength(2);
  expect(result.rows[1].message).toContain("256 MiB");
  expect(result.rows[1].reads).toEqual([]);
});

test("STORE ZIP overhead matches the preflight and does not add implicit folder entries", async ({
  page,
}) => {
  await harness(page);
  const result = await page.evaluate(async () => {
    const { recoveryDownload } = await import("/src/storage.ts");
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("slide-studio", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("documents");
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction("documents", "readwrite");
      tx.objectStore("documents").put(
        {
          first: new Blob(["A"], { type: "application/octet-stream" }),
          second: new Blob(["한글"], { type: "application/octet-stream" }),
          tag: "😀",
        },
        "current",
      );
      tx.oncomplete = () => resolve();
    });
    const file = await recoveryDownload();
    db.close();
    return {
      size: file.blob.size,
      bytes: [...new Uint8Array(await file.blob.arrayBuffer())],
    };
  });
  const zip = await JSZip.loadAsync(new Uint8Array(result.bytes));
  expect(Object.keys(zip.files)).toEqual([
    "record.json",
    "blobs/0.bin",
    "blobs/1.bin",
  ]);
  const names = Object.keys(zip.files);
  const bodyBytes = (
    await Promise.all(names.map((name) => zip.file(name)!.async("uint8array")))
  ).reduce((n, bytes) => n + bytes.length, 0);
  expect(result.size).toBe(
    bodyBytes + 22 + names.reduce((n, name) => n + 76 + 2 * name.length, 0),
  );
});

test("bounded JSON counts UTF-8, escape expansion and surrogate chunk boundaries before returning a Blob", async ({
  page,
}) => {
  await harness(page);
  const result = await page.evaluate(async () => {
    const { jsonBlob, JsonBlobSizeError } = await import(
      "/src/recovery-encoding.ts"
    );
    const data = {
      text: "A".repeat(262143) + '😀\ud800\u0000"\\\n한글',
      array: [undefined, null, true],
    };
    const full = jsonBlob(data);
    const exact = jsonBlob(data, full.size);
    let rejected = false;
    try {
      jsonBlob(data, full.size - 1);
    } catch (error) {
      rejected = error instanceof JsonBlobSizeError;
    }
    return {
      size: full.size,
      exactSize: exact.size,
      exact: (await full.text()) === (await exact.text()),
      rejected,
    };
  });
  expect(result.exactSize).toBe(result.size);
  expect(result.exact).toBe(true);
  expect(result.rejected).toBe(true);
});

test("65MiB original Blob recovery remains available above the old 64MiB boundary", async ({
  page,
}) => {
  await harness(page);
  const result = await page.evaluate(async () => {
    const { recoveryDownload } = await import("/src/storage.ts");
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("slide-studio", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("documents");
      r.onsuccess = () => resolve(r.result);
    });
    const chunk = new Blob(["A".repeat(1024 * 1024)]),
      data = new Blob(Array(65).fill(chunk), { type: "application/json" });
    await new Promise<void>((resolve) => {
      const tx = db.transaction("documents", "readwrite");
      tx.objectStore("documents").put(
        { format: "slide-studio-recovery-json", version: 1, data },
        "current",
      );
      tx.oncomplete = () => resolve();
    });
    const file = await recoveryDownload();
    db.close();
    return {
      size: file.blob.size,
      name: file.name,
      first: await file.blob.slice(0, 1).text(),
      last: await file.blob.slice(-1).text(),
    };
  });
  expect(result.size).toBe(65 * 1024 * 1024);
  expect(result.name).toMatch(/\.json$/);
  expect(result.first).toBe("A");
  expect(result.last).toBe("A");
});

test("native recovery payloads accept the real 65MiB and 256MiB boundaries and reject one byte more", () => {
  const maximum = 256 * 1024 * 1024,
    data = new Uint8Array(maximum);
  data[0] = 17;
  data[maximum - 1] = 29;
  const safe = (name: string, extension: string) => `${name}.${extension}`;
  const smaller = decodeRecoveryPayload(
    { name: "65", extension: "bin", data: data.subarray(0, 65 * 1024 * 1024) },
    safe,
  );
  expect(smaller.data.byteLength).toBe(65 * 1024 * 1024);
  const exact = decodeRecoveryPayload(
    { name: "256", extension: "bin", data },
    safe,
  );
  expect(exact.data.byteLength).toBe(maximum);
  expect(exact.data[maximum - 1]).toBe(29);
  expect(() =>
    decodeRecoveryPayload(
      {
        name: "too-large",
        extension: "bin",
        data: new Uint8Array(maximum + 1),
      },
      safe,
    ),
  ).toThrow("256 MiB");
});

test("cyclic raw records fail explicitly without deleting the retained source", async ({
  page,
}) => {
  await harness(page);
  const result = await page.evaluate(async () => {
    const { recoveryDownload } = await import("/src/storage.ts");
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("slide-studio", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("documents");
      r.onsuccess = () => resolve(r.result);
    });
    const raw: any = { label: "원문" };
    raw.self = raw;
    await new Promise<void>((resolve) => {
      const tx = db.transaction("documents", "readwrite");
      tx.objectStore("documents").put(raw, "current");
      tx.oncomplete = () => resolve();
    });
    let message = "";
    try {
      await recoveryDownload();
    } catch (error) {
      message = (error as Error).message;
    }
    const retained = await new Promise<any>((resolve) => {
      const r = db
        .transaction("documents")
        .objectStore("documents")
        .get("current");
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return {
      message,
      label: retained.label,
      cyclic: retained === retained.self,
    };
  });
  expect(result.message).toContain("복구 저장소에 유지");
  expect(result.label).toBe("원문");
  expect(result.cyclic).toBe(true);
});

test("too many Blob entries fail before ZIP2 overflows its entry count and preserve the raw record", async ({
  page,
}) => {
  await harness(page);
  const result = await page.evaluate(async () => {
    const { recoveryDownload } = await import("/src/storage.ts");
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("slide-studio", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("documents");
      r.onsuccess = () => resolve(r.result);
    });
    const blob = new Blob(["x"]);
    await new Promise<void>((resolve) => {
      const tx = db.transaction("documents", "readwrite");
      tx.objectStore("documents").put(Array(65534).fill(blob), "current");
      tx.oncomplete = () => resolve();
    });
    let message = "",
      reads = 0;
    const arrayBuffer = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = function () {
      reads++;
      return arrayBuffer.call(this);
    };
    try {
      await recoveryDownload();
    } catch (error) {
      message = (error as Error).message;
    } finally {
      Blob.prototype.arrayBuffer = arrayBuffer;
    }
    const raw = await new Promise<any[]>((resolve) => {
      const r = db
        .transaction("documents")
        .objectStore("documents")
        .get("current");
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return { message, reads, length: raw.length, first: await raw[0].text() };
  });
  expect(result.message).toContain("첨부 파일이 너무 많아");
  expect(result.message).toContain("원본은 앱에 보관");
  expect(result.reads).toBe(0);
  expect(result.length).toBe(65534);
  expect(result.first).toBe("x");
});
