"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

/** Short-lived capabilities for paths the user actually opened or saved.
 * No renderer-supplied path can select an overwrite destination. A capability
 * belongs to this main process, is not saved in PPTX/recovery data and carries
 * the last on-disk digest for detecting an external edit. */
class FileContexts {
  constructor({ limit = 64, maxBytes = 256 * 1024 * 1024 } = {}) {
    this.limit = limit;
    this.maxBytes = maxBytes;
    this.files = new Map();
  }
  issue(filename, bytes) {
    if (
      typeof filename !== "string" ||
      !path.isAbsolute(filename) ||
      !/\.pptx$/i.test(filename)
    )
      throw new TypeError(
        "Only an opened or saved PPTX can have a file context.",
      );
    const token = randomUUID();
    this.files.set(token, {
      path: path.resolve(filename),
      digest: digest(bytes),
    });
    while (this.files.size > this.limit)
      this.files.delete(this.files.keys().next().value);
    return { token, path: path.resolve(filename) };
  }
  get(token) {
    if (token === undefined) return undefined;
    if (typeof token !== "string" || !UUID.test(token))
      throw new TypeError("Invalid presentation file context.");
    return this.files.get(token);
  }
  async inspect(file) {
    let handle;
    try {
      handle = await fs.open(file.path, "r");
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > this.maxBytes)
        return { status: "changed" };
      // Fingerprint large presentations without allocating another whole-file
      // buffer beside the renderer's exported document. Bound the actual read
      // too, in case another application grows the file after stat().
      const hash = createHash("sha256"),
        buffer = Buffer.allocUnsafe(256 * 1024);
      let position = 0;
      while (position <= this.maxBytes) {
        const { bytesRead } = await handle.read(
          buffer,
          0,
          Math.min(buffer.length, this.maxBytes + 1 - position),
          position,
        );
        if (!bytesRead) break;
        position += bytesRead;
        if (position > this.maxBytes) return { status: "changed" };
        hash.update(buffer.subarray(0, bytesRead));
      }
      const current = hash.digest("hex");
      return {
        status: current === file.digest ? "unchanged" : "changed",
        digest: current,
        mode: stat.mode & 0o777,
      };
    } catch (error) {
      if (error.code === "ENOENT") return { status: "missing" };
      throw error;
    } finally {
      await handle?.close();
    }
  }
  clear() {
    this.files.clear();
  }
}

module.exports = { FileContexts };
