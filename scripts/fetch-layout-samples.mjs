import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MAX_SAMPLE_BYTES = 16 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MANIFEST = path.join(ROOT, "qa/layout-samples-2026-10-31.json");
const DEFAULT_DIRECTORY = path.join(ROOT, "qa/samples");

function checkedUrl(input, commit) {
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "raw.githubusercontent.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !new RegExp(
      `^/apache/poi/${commit}/test-data/slideshow/[A-Za-z0-9_-]+\\.pptx$`,
    ).test(url.pathname)
  )
    throw Error("Sample URL must use the pinned Apache POI raw GitHub path.");
  return url;
}

export function validateManifest(manifest) {
  if (
    manifest?.schemaVersion !== 1 ||
    manifest.repository !== "https://github.com/apache/poi" ||
    !/^[a-f0-9]{40}$/.test(manifest.repositoryCommit ?? "") ||
    !Array.isArray(manifest.samples) ||
    !manifest.samples.length
  )
    throw Error("Invalid layout sample manifest.");
  const names = new Set();
  let total = 0;
  const samples = manifest.samples.map((sample) => {
    if (
      typeof sample?.id !== "string" ||
      !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(sample.id) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(sample.id) ||
      sample.filename !== `${sample.id}.pptx` ||
      names.has(sample.filename) ||
      !Number.isSafeInteger(sample.bytes) ||
      sample.bytes <= 0 ||
      sample.bytes > MAX_SAMPLE_BYTES ||
      !/^[a-f0-9]{64}$/.test(sample.sha256 ?? "") ||
      !Number.isSafeInteger(sample.slides) ||
      sample.slides <= 0 ||
      sample.slides > 10000
    )
      throw Error("Invalid layout sample metadata, filename or size.");
    const url = checkedUrl(sample.url, manifest.repositoryCommit);
    if (
      sample.source !==
      `https://github.com/apache/poi/blob/${manifest.repositoryCommit}/test-data/slideshow/${url.pathname.split("/").pop()}`
    )
      throw Error("Invalid pinned sample source URL.");
    names.add(sample.filename);
    total += sample.bytes;
    if (total > MAX_TOTAL_BYTES)
      throw Error("Layout sample corpus exceeds 100 MiB.");
    return { ...sample, url: url.href };
  });
  return { commit: manifest.repositoryCommit, samples, bytes: total };
}

async function reusableFile(filename, sample) {
  let file;
  try {
    file = await open(
      filename,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const stat = await file.stat();
    if (!stat.isFile())
      throw Error("Sample destination is not a regular file.");
    if (stat.size !== sample.bytes) return false;
    const hash = createHash("sha256");
    let bytes = 0;
    const stream = file.createReadStream({ autoClose: false });
    for await (const chunk of stream) {
      bytes += chunk.byteLength;
      if (bytes > sample.bytes) return false;
      hash.update(chunk);
    }
    return bytes === sample.bytes && hash.digest("hex") === sample.sha256;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  } finally {
    await file?.close();
  }
}

async function checkedResponse(initial, commit, fetchImpl, signal) {
  let url = checkedUrl(initial, commit);
  for (let redirects = 0; ; redirects++) {
    const response = await fetchImpl(url.href, {
      redirect: "manual",
      signal,
      headers: { "Accept-Encoding": "identity" },
    });
    try {
      if (response.url) checkedUrl(response.url, commit);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects >= MAX_REDIRECTS)
          throw Error("Too many sample redirects.");
        const location = response.headers.get("location");
        if (!location) throw Error("Sample redirect has no destination.");
        url = checkedUrl(new URL(location, url).href, commit);
        await response.body?.cancel();
        continue;
      }
      if (response.status !== 200)
        throw Error(`Sample download returned HTTP ${response.status}.`);
      return response;
    } catch (error) {
      await response.body?.cancel().catch(() => {});
      throw error;
    }
  }
}

async function downloadSample(
  sample,
  commit,
  filename,
  fetchImpl,
  budget,
  timeoutMs,
) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(Error("Sample download timed out.")),
    timeoutMs,
  );
  const temporary = path.join(
    path.dirname(filename),
    `.${sample.filename}.${randomUUID()}.download`,
  );
  let file, reader;
  try {
    const response = await checkedResponse(
      sample.url,
      commit,
      fetchImpl,
      controller.signal,
    );
    const length = response.headers.get("content-length");
    if (
      length !== null &&
      (!/^\d+$/.test(length) ||
        Number(length) > sample.bytes ||
        Number(length) > MAX_SAMPLE_BYTES)
    ) {
      await response.body?.cancel();
      throw Error("Sample Content-Length exceeds its allowed size.");
    }
    if (!response.body) throw Error("Sample response has no body.");
    reader = response.body.getReader();
    file = await open(temporary, "wx", 0o600);
    const hash = createHash("sha256");
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      budget.downloaded += value.byteLength;
      if (
        bytes > sample.bytes ||
        bytes > MAX_SAMPLE_BYTES ||
        budget.downloaded > MAX_TOTAL_BYTES
      )
        throw Error("Sample download exceeds its allowed size.");
      hash.update(value);
      await file.writeFile(value);
    }
    if (bytes !== sample.bytes)
      throw Error("Sample byte count does not match the manifest.");
    if (hash.digest("hex") !== sample.sha256)
      throw Error("Sample SHA-256 does not match the manifest.");
    await file.sync();
    await file.close();
    file = undefined;
    // Only a completely verified download can replace an existing file.
    await rename(temporary, filename);
  } finally {
    clearTimeout(timer);
    controller.abort();
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
    await file?.close();
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

/** Fetch only the pinned, hash-verified corpus. No external programs are used. */
export async function fetchLayoutSamples({
  manifest,
  directory = DEFAULT_DIRECTORY,
  fetchImpl = globalThis.fetch,
  timeoutMs = DOWNLOAD_TIMEOUT_MS,
  onProgress,
} = {}) {
  const validated = validateManifest(manifest);
  if (
    typeof fetchImpl !== "function" ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 120_000
  )
    throw Error("Invalid download options.");
  await mkdir(directory, { recursive: true });
  const results = [],
    budget = { downloaded: 0 };
  for (const sample of validated.samples) {
    const filename = path.join(directory, sample.filename);
    const status = (await reusableFile(filename, sample))
      ? "reused"
      : "downloaded";
    if (status === "downloaded")
      await downloadSample(
        sample,
        validated.commit,
        filename,
        fetchImpl,
        budget,
        timeoutMs,
      );
    const result = { filename: sample.filename, status, bytes: sample.bytes };
    results.push(result);
    onProgress?.(result);
  }
  return results;
}

async function main(args) {
  if (args.length === 1 && args[0] === "--help") {
    console.log(
      "Usage: node scripts/fetch-layout-samples.mjs [--output <directory>]\nDownloads the pinned layout corpus to qa/samples; verifies and reuses matching files.",
    );
    return;
  }
  if (args.length && (args.length !== 2 || args[0] !== "--output" || !args[1]))
    throw Error(
      "Usage: node scripts/fetch-layout-samples.mjs [--output <directory>]",
    );
  const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
  const results = await fetchLayoutSamples({
    manifest,
    directory: args[1] ? path.resolve(args[1]) : DEFAULT_DIRECTORY,
    onProgress: (result) =>
      console.log(
        `${result.status}: ${result.filename} (${result.bytes} bytes)`,
      ),
  });
  console.log(`Verified ${results.length} samples.`);
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
