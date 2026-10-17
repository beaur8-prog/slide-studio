"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const MAX_FONT_BYTES = 2 * 1024 * 1024;

function isArialNovaLight(bytes) {
  try {
    if (
      bytes.length < 12 ||
      bytes.length > MAX_FONT_BYTES ||
      bytes.readUInt32BE(0) !== 0x00010000
    )
      return false;
    const count = bytes.readUInt16BE(4);
    if (count > 100 || 12 + count * 16 > bytes.length) return false;
    const tables = new Map();
    for (let i = 0; i < count; i++) {
      const entry = 12 + i * 16;
      const offset = bytes.readUInt32BE(entry + 8),
        length = bytes.readUInt32BE(entry + 12);
      if (offset + length > bytes.length) return false;
      tables.set(bytes.toString("ascii", entry, entry + 4), { offset, length });
    }
    const names = tables.get("name"),
      metrics = tables.get("OS/2");
    if (
      !names ||
      names.length < 6 ||
      !metrics ||
      metrics.length < 6 ||
      bytes.readUInt16BE(metrics.offset + 4) !== 300
    )
      return false;
    const records = bytes.readUInt16BE(names.offset + 2),
      storage = bytes.readUInt16BE(names.offset + 4);
    if (records > 1000 || 6 + records * 12 > names.length) return false;
    for (let i = 0; i < records; i++) {
      const entry = names.offset + 6 + i * 12;
      const platform = bytes.readUInt16BE(entry),
        id = bytes.readUInt16BE(entry + 6);
      const length = bytes.readUInt16BE(entry + 8),
        offset = bytes.readUInt16BE(entry + 10);
      if (
        id !== 6 ||
        ![0, 1, 3].includes(platform) ||
        storage + offset + length > names.length
      )
        continue;
      const data = bytes.subarray(
        names.offset + storage + offset,
        names.offset + storage + offset + length,
      );
      const name =
        platform === 1
          ? data.toString("latin1")
          : Buffer.from(data).swap16().toString("utf16le");
      if (name === "ArialNova-Light") return true;
    }
  } catch {}
  return false;
}

const inside = (root, target) => {
  const relative = path.relative(root, target);
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
};

async function readOfficeArialNovaLight({
  platform = process.platform,
  localAppData = process.env.LOCALAPPDATA,
} = {}) {
  if (platform !== "win32" || !localAppData) return null;
  // Office's private font cache is not registered with Chromium. Read only the
  // named light face from the standard cache; never install or redistribute it.
  try {
    const cache = await fs.realpath(
      path.join(localAppData, "Microsoft", "FontCache"),
    );
    const versions = (await fs.readdir(cache, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^\d{1,3}$/.test(entry.name))
      .sort((a, b) => Number(b.name) - Number(a.name))
      .slice(0, 8);
    for (const version of versions) {
      let directory;
      try {
        directory = await fs.realpath(
          path.join(cache, version.name, "CloudFonts", "Arial Nova"),
        );
      } catch {
        continue;
      }
      if (!inside(cache, directory)) continue;
      const files = (await fs.readdir(directory, { withFileTypes: true }))
        .filter(
          (entry) => entry.isFile() && /^[a-z0-9_. -]+\.ttf$/i.test(entry.name),
        )
        .slice(0, 16);
      for (const file of files) {
        let handle;
        try {
          const filename = await fs.realpath(path.join(directory, file.name));
          if (!inside(directory, filename)) continue;
          handle = await fs.open(filename, "r");
          const stat = await handle.stat();
          if (!stat.isFile() || stat.size < 12 || stat.size > MAX_FONT_BYTES)
            continue;
          const buffer = Buffer.alloc(MAX_FONT_BYTES + 1);
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
          const data = buffer.subarray(0, bytesRead);
          if (isArialNovaLight(data)) return new Uint8Array(data);
        } catch {
        } finally {
          await handle?.close().catch(() => {});
        }
      }
    }
  } catch {}
  return null;
}

module.exports = { readOfficeArialNovaLight, isArialNovaLight, MAX_FONT_BYTES };
