import { rasterMime } from "./image-format";
import { vectorImage, vectorKind } from "./vector-image";
import { bytesDataUrl } from "./video";

// Shared by slide/master pictures, backgrounds, posters and direct insertion.
// The returned source is self-contained and independent of OS-installed tools.
export async function decodeEmbeddedImage(
  bytes: Uint8Array,
): Promise<string | undefined> {
  const mime = rasterMime(bytes);
  if (mime) return bytesDataUrl(bytes, mime);
  const vector = vectorKind(bytes);
  if (vector) return vectorImage(bytes, vector);
  if (
    !(
      (bytes[0] === 0x49 &&
        bytes[1] === 0x49 &&
        bytes[2] === 42 &&
        bytes[3] === 0) ||
      (bytes[0] === 0x4d &&
        bytes[1] === 0x4d &&
        bytes[2] === 0 &&
        bytes[3] === 42)
    )
  )
    return undefined;
  const { default: UTIF } = await import("utif");
  const buffer = new Uint8Array(bytes).buffer;
  const page = UTIF.decode(buffer)[0];
  const w = page?.t256?.[0],
    h = page?.t257?.[0];
  if (
    !Number.isInteger(w) ||
    !Number.isInteger(h) ||
    w <= 0 ||
    h <= 0 ||
    w * h > 16000000
  )
    throw Error("TIFF 그림이 너무 크거나 손상되었습니다.");
  UTIF.decodeImage(buffer, page);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  try {
    canvas
      .getContext("2d")!
      .putImageData(
        new ImageData(new Uint8ClampedArray(UTIF.toRGBA8(page)), w, h),
        0,
        0,
      );
    const source = canvas.toDataURL("image/png");
    if (source.length * 0.75 > 16 * 1024 * 1024)
      throw Error("변환한 TIFF 그림이 너무 큽니다.");
    return source;
  } finally {
    canvas.width = canvas.height = 0;
  }
}
