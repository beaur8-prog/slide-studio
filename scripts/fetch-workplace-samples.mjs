// CI-only acquisition of the public workplace files with committed hashes.
// The older general QA downloader also includes unpinned sources; do not run
// that wider downloader as part of the private editor-core verification job.
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MAX_BYTES = 16 * 1024 * 1024;
const HOSTS = new Set(["www.dickinson.edu", "cdn-dynmedia-1.microsoft.com"]);
function checkedUrl(input) {
  const url = new URL(input);
  if (url.protocol !== "https:" || !HOSTS.has(url.hostname) || url.port ||
      url.username || url.password || url.search || url.hash || !url.pathname.endsWith(".pptx"))
    throw Error("Workplace samples require an approved public HTTPS PPTX source.");
  return url;
}
export function validateSamples(manifest) {
  if (!Array.isArray(manifest) || !manifest.length || manifest.length > 20)
    throw Error("Invalid workplace sample manifest.");
  const ids = new Set();
  let total = 0;
  return manifest.map(sample => {
    if (typeof sample?.id !== "string" || !/^[a-z][a-z0-9-]{0,99}$/.test(sample.id) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(sample.id) || ids.has(sample.id) ||
        sample.kind !== "pptx" || !Number.isSafeInteger(sample.bytes) || sample.bytes < 4 || sample.bytes > MAX_BYTES ||
        !/^[a-f0-9]{64}$/.test(sample.sha256 ?? "")) throw Error("A workplace sample is missing pinned size or SHA-256 metadata.");
    ids.add(sample.id); total += sample.bytes;
    if (total > 100 * 1024 * 1024) throw Error("Workplace sample corpus exceeds 100 MiB.");
    return { ...sample, url: checkedUrl(sample.url).href, filename: `${sample.id}.pptx` };
  });
}
async function matches(filename, sample) {
  let file;
  try {
    file = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await file.stat();
    if (!stat.isFile()) throw Error("Sample destination must be a regular file.");
    if (stat.size !== sample.bytes) return false;
    const hash = createHash("sha256"); let bytes = 0;
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      bytes += chunk.byteLength;
      if (bytes > sample.bytes) return false;
      hash.update(chunk);
    }
    return bytes === sample.bytes && hash.digest("hex") === sample.sha256;
  } catch (error) { if (error.code === "ENOENT") return false; throw error; }
  finally { await file?.close(); }
}
export async function fetchWorkplaceSamples({ manifest, directory = path.join(ROOT, "qa/samples"), fetchImpl = globalThis.fetch, timeoutMs = 30_000 } = {}) {
  const samples = validateSamples(manifest), results = [];
  if (typeof fetchImpl !== "function" || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000)
    throw Error("Invalid sample download options.");
  await mkdir(directory, { recursive: true });
  for (const sample of samples) {
    const filename = path.join(directory, sample.filename);
    if (await matches(filename, sample)) { results.push({ filename: sample.filename, status: "reused", bytes: sample.bytes }); continue; }
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(Error("Sample download timed out.")), timeoutMs);
    const temporary = path.join(directory, `.${sample.filename}.${randomUUID()}.download`);
    let file, reader, response;
    try {
      let url = checkedUrl(sample.url);
      for (let redirects = 0; ; redirects++) {
        response = await fetchImpl(url.href, { redirect: "manual", signal: controller.signal,
          headers: { "User-Agent": "SlideStudio-QA/1.0", "Accept-Encoding": "identity" } });
        if (response.url) checkedUrl(response.url);
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location || redirects >= 5) throw Error("Invalid workplace sample redirect.");
        const next = checkedUrl(new URL(location, url).href);
        if (next.hostname !== url.hostname) throw Error("Workplace samples cannot redirect to a different host.");
        url = next;
      }
      if (response.status !== 200 || !response.body) throw Error(`Sample download returned HTTP ${response.status}.`);
      const length = response.headers.get("content-length");
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > sample.bytes)) throw Error("Sample Content-Length exceeds its pinned size.");
      file = await open(temporary, "wx", 0o600); reader = response.body.getReader();
      const hash = createHash("sha256"); let bytes = 0;
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > sample.bytes || bytes > MAX_BYTES) throw Error("Sample stream exceeds its pinned size.");
        hash.update(chunk.value); await file.writeFile(chunk.value);
      }
      if (bytes !== sample.bytes || hash.digest("hex") !== sample.sha256) throw Error("Public sample changed: pinned byte count or SHA-256 mismatch.");
      await file.sync(); await file.close(); file = undefined;
      await rename(temporary, filename);
      results.push({ filename: sample.filename, status: "downloaded", bytes });
    } finally {
      clearTimeout(timer); controller.abort();
      if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      else await response?.body?.cancel().catch(() => {});
      await file?.close();
      await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
    }
  }
  return results;
}
async function main(args) {
  if (args.length && (args.length !== 2 || args[0] !== "--output" || !args[1])) throw Error("Usage: node scripts/fetch-workplace-samples.mjs [--output <directory>]");
  const manifest = JSON.parse(await readFile(path.join(ROOT, "qa/workplace-samples.json"), "utf8"));
  for (const result of await fetchWorkplaceSamples({ manifest, directory: args[1] ? path.resolve(args[1]) : undefined }))
    console.log(`${result.status}: ${result.filename} (${result.bytes} bytes)`);
  console.log(`Verified ${manifest.length} pinned workplace samples.`);
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
