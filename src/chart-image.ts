import type { ChartData, PictureFillPlacement } from "./types";
import { rasterMime } from "./image-format";
import { applyDrawingmlColorTransforms } from "./drawingml-color";
import type { DrawingmlColorReader } from "./drawingml-style";

export interface ChartImageFill extends PictureFillPlacement {
  src: string;
  opacity: number;
  crop: [number, number, number, number];
}
const MAX_PIXELS = 16_000_000;
const MAX_BYTES = 16 * 1024 * 1024;
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const child = (node: Element | undefined, name: string) =>
  Array.from(node?.children ?? []).find((child) => child.localName === name);
const number = (node: Element | undefined, name: string, fallback = 0) => {
  const value = Number(node?.getAttribute(name) ?? fallback);
  return Number.isFinite(value) ? value : fallback;
};
function dimensions(
  bytes: Uint8Array,
  mime: string,
): { width: number; height: number; dpi: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = (width: number, height: number, dpi = 96) =>
    width > 0 &&
    height > 0 &&
    width <= 32768 &&
    height <= 32768 &&
    width * height <= MAX_PIXELS
      ? { width, height, dpi: dpi > 0 && dpi <= 10000 ? Math.max(1, dpi) : 96 }
      : undefined;
  if (mime === "image/png" && bytes.length >= 24) {
    let dpi = 96,
      offset = 8;
    for (let chunks = 0; offset + 12 <= bytes.length && chunks < 64; chunks++) {
      const size = view.getUint32(offset),
        type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (size > bytes.length - offset - 12 || type === "IDAT") break;
      if (type === "pHYs" && size === 9 && bytes[offset + 16] === 1)
        dpi = view.getUint32(offset + 8) * 0.0254;
      offset += size + 12;
    }
    return result(view.getUint32(16), view.getUint32(20), dpi);
  }
  if (mime === "image/gif" && bytes.length >= 10)
    return result(view.getUint16(6, true), view.getUint16(8, true));
  if (mime === "image/webp" && bytes.length >= 30) {
    const kind = String.fromCharCode(...bytes.subarray(12, 16));
    if (kind === "VP8X")
      return result(
        1 + bytes[24] + bytes[25] * 256 + bytes[26] * 65536,
        1 + bytes[27] + bytes[28] * 256 + bytes[29] * 65536,
      );
    if (kind === "VP8L" && bytes[20] === 47) {
      const bits = view.getUint32(21, true);
      return result((bits & 16383) + 1, ((bits >>> 14) & 16383) + 1);
    }
    if (
      kind === "VP8 " &&
      bytes[23] === 157 &&
      bytes[24] === 1 &&
      bytes[25] === 42
    )
      return result(
        view.getUint16(26, true) & 16383,
        view.getUint16(28, true) & 16383,
      );
  }
  if (mime === "image/jpeg") {
    let offset = 2,
      dpi = 96;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) continue;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 218 || marker === 217) break;
      if (marker === 1 || (marker >= 208 && marker <= 216)) continue;
      if (offset + 2 > bytes.length) break;
      const size = view.getUint16(offset);
      if (size < 2 || offset + size > bytes.length) break;
      if (
        marker === 224 &&
        size >= 16 &&
        String.fromCharCode(...bytes.subarray(offset + 2, offset + 7)) ===
          "JFIF\0"
      ) {
        const density = view.getUint16(offset + 10);
        if (bytes[offset + 9] === 1) dpi = density;
        else if (bytes[offset + 9] === 2) dpi = density * 2.54;
      }
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker) &&
        size >= 7
      )
        return result(
          view.getUint16(offset + 5),
          view.getUint16(offset + 3),
          dpi,
        );
      offset += size;
    }
  }
}

/** Embedded raster only. Reject external links, SVG/active payloads, oversized
 * decoded canvases and degenerate crop/tile geometry before browser decoding.
 * Unsupported assets remain untouched in the original chart package. */
export function readChartImageFill(
  node: Element | undefined,
  chart: ChartData,
  readColor?: DrawingmlColorReader,
): ChartImageFill | undefined {
  if (!node) return;
  const blip = child(node, "blip"),
    id = blip?.getAttributeNS(R, "embed"),
    root = chart.parts.find((part) => part.path === chart.root),
    relationship = root?.relationships.find(
      (relationship) =>
        relationship.id === id &&
        relationship.type.endsWith("/image") &&
        !relationship.external,
    ),
    part = chart.parts.find((part) => part.path === relationship?.target);
  if (!part || part.data.length * 0.75 > MAX_BYTES) return;
  const mime = rasterMime(
    Uint8Array.from(atob(part.data.slice(0, 64)), (character) =>
      character.charCodeAt(0),
    ),
  );
  if (!mime) return;
  return readDrawingmlImageFill(
    node,
    `data:${mime};base64,${part.data}`,
    readColor,
  );
}

export function readDrawingmlImageFill(
  node: Element | undefined,
  source: string,
  readColor: DrawingmlColorReader = explicitColor,
): ChartImageFill | undefined {
  if (!node || source.length > Math.ceil((MAX_BYTES * 4) / 3) + 100) return;
  const match =
    /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(
      source,
    );
  if (!match || match[2].length % 4) return;
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(match[2]), (character) =>
      character.charCodeAt(0),
    );
  } catch {
    return;
  }
  const mime = rasterMime(bytes);
  if (!mime || mime !== match[1].toLowerCase() || bytes.length > MAX_BYTES)
    return;
  const size = dimensions(bytes, mime);
  if (!size) return;
  const percentages = (node: Element | undefined) =>
    ["t", "r", "b", "l"].map((name) =>
      Math.max(-10, Math.min(10, number(node, name) / 100000)),
    ) as [number, number, number, number];
  const crop = percentages(child(node, "srcRect")),
    fill = percentages(child(child(node, "stretch"), "fillRect"));
  if (
    1 - crop[1] - crop[3] < 0.001 ||
    1 - crop[0] - crop[2] < 0.001 ||
    1 - fill[1] - fill[3] < 0.001 ||
    1 - fill[0] - fill[2] < 0.001
  )
    return;
  const tile = child(node, "tile"),
    dpi =
      number(node, "dpi") > 0
        ? Math.max(1, Math.min(10000, number(node, "dpi")))
        : size.dpi;
  const duotone = readDuotone(node, readColor);
  return {
    ...(duotone ? { duotone } : {}),
    src: source,
    ...size,
    dpi,
    crop,
    fill,
    opacity: Math.max(
      0,
      Math.min(
        1,
        number(child(child(node, "blip"), "alphaModFix"), "amt", 100000) /
          100000,
      ),
    ),
    ...(tile
      ? {
          tile: {
            scaleX: Math.max(
              0.001,
              Math.min(1000, number(tile, "sx", 100000) / 100000),
            ),
            scaleY: Math.max(
              0.001,
              Math.min(1000, number(tile, "sy", 100000) / 100000),
            ),
            offsetX: Math.max(-1e6, Math.min(1e6, number(tile, "tx") / 9525)),
            offsetY: Math.max(-1e6, Math.min(1e6, number(tile, "ty") / 9525)),
            align: ["tl", "t", "tr", "l", "ctr", "r", "bl", "b", "br"].includes(
              tile.getAttribute("algn") ?? "",
            )
              ? tile.getAttribute("algn")!
              : "tl",
            flip: ["x", "y", "xy"].includes(tile.getAttribute("flip") ?? "")
              ? tile.getAttribute("flip")!
              : "none",
          },
        }
      : {}),
  };
}

const COLOR_NAMES = [
  "srgbClr",
  "schemeClr",
  "sysClr",
  "scrgbClr",
  "hslClr",
  "prstClr",
];
const COLOR_TRANSFORMS =
  /^(?:tint|shade|alpha(?:Mod|Off)?|(?:lum|sat|hue)(?:Mod|Off)?)$/;
function explicitColor(node: Element | undefined) {
  if (!node) return;
  const color =
    node.localName === "srgbClr"
      ? node.getAttribute("val")
      : node.localName === "sysClr"
        ? node.getAttribute("lastClr")
        : undefined;
  if (!color || !/^[0-9a-f]{6}$/i.test(color)) return;
  return applyDrawingmlColorTransforms("#" + color, Array.from(node.children));
}

/** Effects outside this deliberately small supported set are preserved in the
 * native package, never partially combined into a misleading duotone preview. */
export function unsupportedDrawingmlImageEffects(
  node: Element | undefined,
): boolean {
  const effects = Array.from(child(node, "blip")?.children ?? []);
  return (
    effects.some(
      (effect) =>
        !["duotone", "alphaModFix", "extLst"].includes(effect.localName),
    ) ||
    effects.filter((effect) => effect.localName === "duotone").length > 1 ||
    effects.filter((effect) => effect.localName === "alphaModFix").length > 1
  );
}
function readDuotone(
  node: Element,
  readColor: DrawingmlColorReader,
): PictureFillPlacement["duotone"] {
  if (unsupportedDrawingmlImageEffects(node)) return;
  const effect = child(child(node, "blip"), "duotone");
  if (!effect || effect.children.length !== 2) return;
  const colors = Array.from(effect.children);
  if (
    colors.some(
      (color) =>
        !COLOR_NAMES.includes(color.localName) ||
        Array.from(color.children).some(
          (transform) =>
            !COLOR_TRANSFORMS.test(transform.localName) ||
            !transform.hasAttribute("val") ||
            !Number.isFinite(Number(transform.getAttribute("val"))),
        ),
    )
  )
    return;
  const endpoints = colors.map(readColor);
  if (
    endpoints.some(
      (color) =>
        !color ||
        !/^#[0-9a-f]{6}$/i.test(color.color) ||
        !Number.isFinite(color.opacity) ||
        color.opacity < 0 ||
        color.opacity > 1,
    )
  )
    return;
  return {
    colors: endpoints.map((color) => color!.color.toUpperCase()) as [
      string,
      string,
    ],
    opacities: endpoints.map((color) => color!.opacity) as [number, number],
  };
}
