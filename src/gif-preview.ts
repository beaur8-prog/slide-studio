import { EMPTY_POSTER } from "./video";

const cache = new Map<string, string>();
const MAX_CACHE_CHARS = 32 * 1024 * 1024;
let cacheChars = 0;

// Retain the logical screen, color tables and first image's control/data
// blocks. This is a genuinely single-frame GIF, not an animated image hidden
// behind a canvas. The original source remains untouched in the document.
function firstFrame(source: string): string {
  const raw = atob(source.slice(source.indexOf(",") + 1));
  if (!/^GIF8[79]a/.test(raw) || raw.length < 13) throw Error("GIF header");
  const byte = (i: number) => {
    if (i >= raw.length) throw Error("Truncated GIF");
    return raw.charCodeAt(i);
  };
  const colorTableSize = (flags: number) =>
    flags & 0x80 ? 3 * 2 ** ((flags & 7) + 1) : 0;
  const screenEnd = 13 + colorTableSize(byte(10));
  if (screenEnd > raw.length) throw Error("GIF color table");
  const subBlocksEnd = (start: number) => {
    let end = start;
    while (true) {
      const length = byte(end++);
      if (!length) return end;
      end += length;
      if (end > raw.length) throw Error("GIF data block");
    }
  };
  let i = screenEnd;
  let control = "";
  while (i < raw.length) {
    const start = i;
    const marker = byte(i++);
    if (marker === 0x21) {
      const label = byte(i++);
      const end = subBlocksEnd(i);
      if (label === 0xf9) {
        if (byte(i) !== 4 || end !== i + 6) throw Error("GIF control block");
        control = raw.slice(start, end);
      } else if (label === 0x01) {
        // A plain-text rendering block consumes the preceding control block.
        control = "";
      }
      i = end;
    } else if (marker === 0x2c) {
      const flags = byte(start + 9);
      i = start + 10 + colorTableSize(flags);
      byte(i++); // LZW minimum code size precedes the image sub-blocks.
      const end = subBlocksEnd(i);
      return (
        "data:image/gif;base64," +
        btoa(raw.slice(0, screenEnd) + control + raw.slice(start, end) + "\x3b")
      );
    } else throw Error("Missing GIF image");
  }
  throw Error("Missing GIF frame");
}

export function stillImageSource(source: string | undefined) {
  if (!source || !/^data:image\/gif;base64,/i.test(source)) return source;
  const cached = cache.get(source);
  if (cached) {
    cache.delete(source);
    cache.set(source, cached);
    return cached;
  }
  let preview: string;
  try {
    // The importer allows at most 16 MiB per image. Bound decoding here too.
    if (source.length > 24 * 1024 * 1024) throw Error("GIF too large");
    preview = firstFrame(source);
  } catch {
    // Never fall back to animating a malformed GIF in a static view.
    preview = EMPTY_POSTER;
  }
  const size = source.length + preview.length;
  if (size <= MAX_CACHE_CHARS) {
    while (
      cache.size &&
      (cacheChars + size > MAX_CACHE_CHARS || cache.size >= 32)
    ) {
      const key = cache.keys().next().value!;
      cacheChars -= key.length + cache.get(key)!.length;
      cache.delete(key);
    }
    cache.set(source, preview);
    cacheChars += size;
  }
  return preview;
}
