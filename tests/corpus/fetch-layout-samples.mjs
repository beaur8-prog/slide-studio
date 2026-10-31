import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  fetchLayoutSamples,
  MAX_SAMPLE_BYTES,
  MAX_TOTAL_BYTES,
  validateManifest,
} from "../../scripts/fetch-layout-samples.mjs";

const commit = "6327f056ba3cfdae326a0261a236460592b80f5c";
const bytes = Buffer.from("PK\x03\x04pinned public presentation fixture");
const sample = {
  id: "poi-fixture",
  filename: "poi-fixture.pptx",
  url: `https://raw.githubusercontent.com/apache/poi/${commit}/test-data/slideshow/fixture.pptx`,
  source: `https://github.com/apache/poi/blob/${commit}/test-data/slideshow/fixture.pptx`,
  bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  slides: 1,
};
const manifest = (samples = [sample]) => ({
  schemaVersion: 1,
  repository: "https://github.com/apache/poi",
  repositoryCommit: commit,
  samples: structuredClone(samples),
});
async function directory(t) {
  const name = await mkdtemp(path.join(os.tmpdir(), "slide-layout-fetch-"));
  t.after(() => rm(name, { recursive: true, force: true }));
  return name;
}

test("committed corpus is pinned, bounded and has no local file paths", async () => {
  const text = await readFile(
    new URL("../../qa/layout-samples-2026-10-31.json", import.meta.url),
    "utf8",
  );
  const parsed = JSON.parse(text),
    checked = validateManifest(parsed);
  assert.equal(checked.samples.length, 15);
  assert.equal(checked.commit, commit);
  assert.ok(checked.bytes < MAX_TOTAL_BYTES);
  assert.ok(checked.samples.every((s) => s.bytes <= MAX_SAMPLE_BYTES));
  assert.ok(checked.samples.every((s) => !Object.hasOwn(s, "path")));
  assert.doesNotMatch(text, /\/private\/|\/Users\/|[A-Za-z]:\\/);
});

test("unsafe filenames, unpinned URLs and invalid sizes are rejected before any fetch", async (t) => {
  const target = await directory(t);
  for (const change of [
    { id: "../escape", filename: "../escape.pptx" },
    { id: "con", filename: "con.pptx" },
    { id: 1, filename: "1.pptx" },
    { filename: "fixture.PPTX" },
    { bytes: 0 },
    { bytes: MAX_SAMPLE_BYTES + 1 },
    { bytes: 1.5 },
    { sha256: "unverified" },
    { slides: 0 },
    { url: sample.url.replace("https:", "http:") },
    {
      url: sample.url.replace(
        "raw.githubusercontent.com",
        "raw.githubusercontent.com.example.org",
      ),
    },
    { url: sample.url.replace(commit, "main") },
    { url: sample.url + "?download=true" },
    { url: sample.url.replace("fixture.pptx", "%2e%2e/fixture.pptx") },
    { source: "https://example.org/fixture.pptx" },
  ]) {
    await assert.rejects(
      fetchLayoutSamples({
        manifest: manifest([{ ...sample, ...change }]),
        directory: target,
        fetchImpl: () => {
          throw Error("Fetch must not run.");
        },
      }),
    );
  }
  assert.throws(() => validateManifest(manifest([sample, sample])), /metadata/);
  const tooMany = Array.from({ length: 7 }, (_, i) => ({
    ...sample,
    id: `fixture-${i}`,
    filename: `fixture-${i}.pptx`,
    bytes: MAX_SAMPLE_BYTES,
  }));
  assert.throws(() => validateManifest(manifest(tooMany)), /100 MiB/);
  assert.deepEqual(await readdir(target), []);
});

test("a matching existing file is hash-verified and reused without network or rewrite", async (t) => {
  const target = await directory(t),
    filename = path.join(target, sample.filename);
  await writeFile(filename, bytes);
  const before = await stat(filename);
  const results = await fetchLayoutSamples({
    manifest: manifest(),
    directory: target,
    fetchImpl: () => {
      throw Error("Network must not run.");
    },
  });
  assert.deepEqual(results, [
    { filename: sample.filename, status: "reused", bytes: bytes.length },
  ]);
  assert.equal((await stat(filename)).mtimeMs, before.mtimeMs);
  assert.deepEqual(await readFile(filename), bytes);
});

test("a corrupt same-size existing file is replaced only by a verified streamed download", async (t) => {
  const target = await directory(t),
    filename = path.join(target, sample.filename);
  await writeFile(filename, Buffer.alloc(bytes.length, 65));
  let requests = 0;
  const results = await fetchLayoutSamples({
    manifest: manifest(),
    directory: target,
    fetchImpl: async (url, options) => {
      requests++;
      assert.equal(url, sample.url);
      assert.equal(options.redirect, "manual");
      assert.ok(options.signal instanceof AbortSignal);
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.subarray(0, 8));
            controller.enqueue(bytes.subarray(8));
            controller.close();
          },
        }),
        { headers: { "content-length": String(bytes.length) } },
      );
    },
  });
  assert.equal(requests, 1);
  assert.equal(results[0].status, "downloaded");
  assert.deepEqual(await readFile(filename), bytes);
  assert.deepEqual(await readdir(target), [sample.filename]);
});

test("hash, byte-count and streamed-size failures preserve the old file and remove temporary files", async (t) => {
  const target = await directory(t),
    filename = path.join(target, sample.filename);
  const previous = Buffer.from("corrupt old file remains available");
  for (const body of [
    Buffer.alloc(bytes.length, 0),
    bytes.subarray(1),
    Buffer.concat([bytes, Buffer.from("extra")]),
  ]) {
    await writeFile(filename, previous);
    await assert.rejects(
      fetchLayoutSamples({
        manifest: manifest(),
        directory: target,
        fetchImpl: async () => new Response(body),
      }),
      /SHA-256|byte count|allowed size/,
    );
    assert.deepEqual(await readFile(filename), previous);
    assert.deepEqual(await readdir(target), [sample.filename]);
  }
});

test("announced oversized responses are canceled without writing a file", async (t) => {
  const target = await directory(t);
  let canceled = false;
  await assert.rejects(
    fetchLayoutSamples({
      manifest: manifest(),
      directory: target,
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            cancel() {
              canceled = true;
            },
          }),
          { headers: { "content-length": String(MAX_SAMPLE_BYTES + 1) } },
        ),
    }),
    /Content-Length/,
  );
  assert.equal(canceled, true);
  assert.deepEqual(await readdir(target), []);
});

test("redirects are validated before following and final response URLs are rechecked", async (t) => {
  const target = await directory(t);
  for (const location of [
    "https://example.org/fixture.pptx",
    sample.url.replace(commit, "main"),
    sample.url.replace("https:", "http:"),
  ]) {
    let requests = 0;
    await assert.rejects(
      fetchLayoutSamples({
        manifest: manifest(),
        directory: target,
        fetchImpl: async () => {
          requests++;
          return new Response(null, { status: 302, headers: { location } });
        },
      }),
      /pinned/,
    );
    assert.equal(requests, 1);
  }
  const final = new Response(bytes);
  Object.defineProperty(final, "url", {
    value: "https://example.org/fixture.pptx",
  });
  await assert.rejects(
    fetchLayoutSamples({
      manifest: manifest(),
      directory: target,
      fetchImpl: async () => final,
    }),
    /pinned/,
  );
  assert.deepEqual(await readdir(target), []);
  let requests = 0;
  const result = await fetchLayoutSamples({
    manifest: manifest(),
    directory: target,
    fetchImpl: async () =>
      ++requests === 1
        ? new Response(null, {
            status: 307,
            headers: { location: "./other-fixture.pptx" },
          })
        : new Response(bytes),
  });
  assert.equal(requests, 2);
  assert.equal(result[0].status, "downloaded");
});

test("redirect loops and HTTP failures stop with no partial files", async (t) => {
  const target = await directory(t);
  let requests = 0;
  await assert.rejects(
    fetchLayoutSamples({
      manifest: manifest(),
      directory: target,
      fetchImpl: async () => {
        requests++;
        return new Response(null, {
          status: 302,
          headers: { location: sample.url },
        });
      },
    }),
    /Too many/,
  );
  assert.equal(requests, 6);
  await assert.rejects(
    fetchLayoutSamples({
      manifest: manifest(),
      directory: target,
      fetchImpl: async () => new Response("not found", { status: 404 }),
    }),
    /HTTP 404/,
  );
  assert.deepEqual(await readdir(target), []);
});

test("a stalled fetch times out, preserves an old file and removes temporary files", async (t) => {
  const target = await directory(t),
    filename = path.join(target, sample.filename);
  await writeFile(filename, "old");
  await assert.rejects(
    fetchLayoutSamples({
      manifest: manifest(),
      directory: target,
      timeoutMs: 20,
      fetchImpl: (_url, { signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        ),
    }),
    /timed out/,
  );
  assert.equal(await readFile(filename, "utf8"), "old");
  assert.deepEqual(await readdir(target), [sample.filename]);
});

test("timeout during a streamed body removes its partial file without replacing old contents", async (t) => {
  const target = await directory(t),
    filename = path.join(target, sample.filename);
  await writeFile(filename, "old");
  await assert.rejects(
    fetchLayoutSamples({
      manifest: manifest(),
      directory: target,
      timeoutMs: 20,
      fetchImpl: async (_url, { signal }) =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(bytes.subarray(0, 8));
              signal.addEventListener(
                "abort",
                () => controller.error(signal.reason),
                { once: true },
              );
            },
          }),
        ),
    }),
    /timed out/,
  );
  assert.equal(await readFile(filename, "utf8"), "old");
  assert.deepEqual(await readdir(target), [sample.filename]);
});
