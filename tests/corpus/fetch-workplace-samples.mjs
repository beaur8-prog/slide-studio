import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  readFile,
  readdir,
  writeFile,
  rm,
  stat,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import {
  fetchWorkplaceSamples,
  validateSamples,
} from "../../scripts/fetch-workplace-samples.mjs";
const data = Buffer.from("PK\x03\x04sample pinned bytes");
const sample = {
  id: "public-fixture",
  url: "https://www.dickinson.edu/download/fixture.pptx",
  kind: "pptx",
  bytes: data.length,
  sha256: createHash("sha256").update(data).digest("hex"),
};
async function dir(t) {
  const target = await mkdtemp(path.join(os.tmpdir(), "slide-ci-workplace-"));
  t.after(() => rm(target, { recursive: true, force: true }));
  return target;
}
test("manifest only includes safe bounded hashed HTTPS public files", async (t) => {
  const target = await dir(t);
  let requests = 0;
  for (const bad of [
    { id: "../escape" },
    { id: "con" },
    { kind: "exe" },
    { bytes: 0 },
    { bytes: 16 * 1024 * 1024 + 1 },
    { sha256: undefined },
    { url: "http://www.dickinson.edu/x.pptx" },
    { url: "https://example.test/x.pptx" },
    { url: "https://www.dickinson.edu:444/x.pptx" },
    { url: "https://user:pass@www.dickinson.edu/x.pptx" },
  ])
    await assert.rejects(
      fetchWorkplaceSamples({
        manifest: [{ ...sample, ...bad }],
        directory: target,
        fetchImpl: () => {
          requests++;
          throw Error("unexpected fetch");
        },
      }),
    );
  assert.equal(requests, 0);
  assert.deepEqual(await readdir(target), []);
  assert.throws(() => validateSamples([sample, sample]));
});
test("verified cached fixture is reused without network or rewriting", async (t) => {
  const target = await dir(t),
    filename = path.join(target, sample.id + ".pptx");
  await writeFile(filename, data);
  const before = await stat(filename);
  assert.equal(
    (
      await fetchWorkplaceSamples({
        manifest: [sample],
        directory: target,
        fetchImpl: () => {
          throw Error("network");
        },
      })
    )[0].status,
    "reused",
  );
  assert.equal((await stat(filename)).mtimeMs, before.mtimeMs);
});
test("corrupt fixture is only replaced after exact size and SHA verification", async (t) => {
  const target = await dir(t),
    filename = path.join(target, sample.id + ".pptx");
  await writeFile(filename, Buffer.alloc(data.length, 9));
  const result = await fetchWorkplaceSamples({
    manifest: [sample],
    directory: target,
    fetchImpl: async () => new Response(data),
  });
  assert.equal(result[0].status, "downloaded");
  assert.deepEqual(await readFile(filename), data);
  assert.deepEqual(await readdir(target), [sample.id + ".pptx"]);
});
test("bad digest, truncated bytes and overflow preserve the old fixture and remove partial files", async (t) => {
  const target = await dir(t),
    filename = path.join(target, sample.id + ".pptx");
  for (const body of [
    Buffer.alloc(data.length),
    data.subarray(1),
    Buffer.concat([data, Buffer.from("overflow")]),
  ]) {
    await writeFile(filename, "old");
    await assert.rejects(
      fetchWorkplaceSamples({
        manifest: [sample],
        directory: target,
        fetchImpl: async () => new Response(body),
      }),
      /mismatch|pinned size/,
    );
    assert.equal(await readFile(filename, "utf8"), "old");
    assert.deepEqual(await readdir(target), [sample.id + ".pptx"]);
  }
});
test("oversized headers and HTTP failures cancel the response body", async (t) => {
  const target = await dir(t);
  for (const options of [
    { headers: { "content-length": String(sample.bytes + 1) } },
    { status: 503 },
  ]) {
    let cancelled = false;
    await assert.rejects(
      fetchWorkplaceSamples({
        manifest: [sample],
        directory: target,
        fetchImpl: async () =>
          new Response(
            new ReadableStream({
              cancel() {
                cancelled = true;
              },
            }),
            options,
          ),
      }),
    );
    assert.equal(cancelled, true);
    assert.deepEqual(await readdir(target), []);
  }
});
test("redirects cannot change hosts and final response URLs are revalidated", async (t) => {
  const target = await dir(t);
  let calls = 0;
  await assert.rejects(
    fetchWorkplaceSamples({
      manifest: [sample],
      directory: target,
      fetchImpl: async () => {
        calls++;
        return new Response(null, {
          status: 302,
          headers: {
            location: "https://cdn-dynmedia-1.microsoft.com/fixture.pptx",
          },
        });
      },
    }),
    /different host/,
  );
  assert.equal(calls, 1);
  const response = new Response(data);
  Object.defineProperty(response, "url", {
    value: "https://example.test/fixture.pptx",
  });
  await assert.rejects(
    fetchWorkplaceSamples({
      manifest: [sample],
      directory: target,
      fetchImpl: async () => response,
    }),
    /approved/,
  );
  assert.deepEqual(await readdir(target), []);
});
test("a same-host HTTPS redirect still needs pinned bytes", async (t) => {
  const target = await dir(t);
  let calls = 0;
  const result = await fetchWorkplaceSamples({
    manifest: [sample],
    directory: target,
    fetchImpl: async () =>
      ++calls === 1
        ? new Response(null, {
            status: 307,
            headers: { location: "./moved.pptx" },
          })
        : new Response(data),
  });
  assert.equal(calls, 2);
  assert.equal(result[0].status, "downloaded");
});
test("a stalled stream times out and does not replace old data", async (t) => {
  const target = await dir(t),
    filename = path.join(target, sample.id + ".pptx");
  await writeFile(filename, "old");
  await assert.rejects(
    fetchWorkplaceSamples({
      manifest: [sample],
      directory: target,
      timeoutMs: 20,
      fetchImpl: async (_url, { signal }) =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(data.subarray(0, 3));
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
  assert.deepEqual(await readdir(target), [sample.id + ".pptx"]);
});
