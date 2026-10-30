import type { Deck, SlideElement } from "./types";
import { chartBytes } from "./chart";
import { bytesDataUrl } from "./video";
import { stillImageSource } from "./gif-preview";

export type ImageCrop = NonNullable<SlideElement["crop"]>;
export type ImageSize = { width: number; height: number };
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp";
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MIN_VISIBLE = 0.00101;

export function rasterMime(bytes: Uint8Array): string | undefined {
  if (
    bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)
  )
    return "image/png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return "image/jpeg";
  if (
    bytes.length >= 6 &&
    /^GIF8[79]a$/.test(String.fromCharCode(...bytes.subarray(0, 6)))
  )
    return "image/gif";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  )
    return "image/webp";
}
export async function imageSize(
  src: string,
  original = false,
): Promise<ImageSize> {
  const image = new Image();
  image.src = original ? src : (stillImageSource(src) ?? src);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      image.decode(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("그림을 읽는 시간이 초과되었습니다.")),
          10000,
        );
      }),
    ]);
    if (!image.naturalWidth || !image.naturalHeight)
      throw new Error("그림 크기를 읽지 못했습니다.");
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    clearTimeout(timer);
    image.removeAttribute("src");
  }
}
export async function readImageFile(file: File) {
  if (file.size > MAX_IMAGE_BYTES)
    throw new Error("15MB 이하의 이미지를 선택해 주세요.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = rasterMime(bytes);
  if (!mime) throw new Error("PNG, JPG, GIF, WebP 이미지를 선택해 주세요.");
  // Preserve GIF frames and all other source bytes. A still preview is used
  // only for measuring/editing, never as the saved replacement image.
  const src = bytesDataUrl(bytes, mime);
  try {
    return { src, ...(await imageSize(src, true)) };
  } catch {
    throw new Error("이 이미지를 열 수 없습니다. 다른 파일을 선택해 주세요.");
  }
}
export function assertImageCapacity(
  deck: Deck,
  source: string,
  replacing?: { slideId: string; elementId: string },
) {
  let bytes = source.length * 0.75;
  for (const slide of deck.slides) {
    if (slide.backgroundImage) bytes += slide.backgroundImage.src.length * 0.75;
    for (const element of slide.elements) {
      if (slide.id === replacing?.slideId && element.id === replacing.elementId)
        continue;
      if (element.src) bytes += element.src.length * 0.75;
      if (element.poster) bytes += element.poster.length * 0.75;
      if (element.chart) bytes += chartBytes(element.chart);
    }
  }
  if (bytes > 100 * 1024 * 1024)
    throw new Error("내장 그림·동영상·차트의 합계가 100MB를 초과합니다.");
}
export function validateImageCrop(crop: ImageCrop): ImageCrop {
  if (
    crop.some(
      (value) => !Number.isFinite(value) || value < -10 || value > 10,
    ) ||
    1 - crop[3] - crop[1] < MIN_VISIBLE ||
    1 - crop[0] - crop[2] < MIN_VISIBLE
  )
    throw new Error(
      "잘라낼 범위가 너무 큽니다. 그림이 남도록 범위를 줄여 주세요.",
    );
  return crop;
}
function cropFromVisible(
  width: number,
  height: number,
  x = 0.5,
  y = 0.5,
): ImageCrop {
  const clamp = (value: number, visible: number) =>
    Math.max(
      Math.min(0, 1 - visible),
      Math.min(Math.max(0, 1 - visible), value),
    );
  const left = clamp(x - width / 2, width),
    top = clamp(y - height / 2, height);
  return validateImageCrop([top, 1 - left - width, 1 - top - height, left]);
}
export function frameImageCrop(
  frame: ImageSize,
  source: ImageSize,
  mode: "fit" | "fill",
  center = { x: 0.5, y: 0.5 },
): ImageCrop {
  if (
    [frame.width, frame.height, source.width, source.height].some(
      (value) => !Number.isFinite(value) || value <= 0,
    )
  )
    throw new Error("너비와 높이가 있는 그림을 선택해 주세요.");
  const scale = (mode === "fit" ? Math.min : Math.max)(
    frame.width / source.width,
    frame.height / source.height,
  );
  return cropFromVisible(
    frame.width / (scale * source.width),
    frame.height / (scale * source.height),
    center.x,
    center.y,
  );
}
export function zoomImageCrop(
  frame: ImageSize,
  source: ImageSize,
  zoom: number,
  current: ImageCrop,
): ImageCrop {
  const fill = frameImageCrop(frame, source, "fill");
  const visibleX = (1 - fill[3] - fill[1]) / zoom,
    visibleY = (1 - fill[0] - fill[2]) / zoom;
  return cropFromVisible(
    visibleX,
    visibleY,
    (current[3] + 1 - current[1]) / 2,
    (current[0] + 1 - current[2]) / 2,
  );
}
export function panImageCrop(
  crop: ImageCrop,
  dx: number,
  dy: number,
): ImageCrop {
  const width = 1 - crop[3] - crop[1],
    height = 1 - crop[0] - crop[2];
  return cropFromVisible(
    width,
    height,
    crop[3] + width / 2 - dx * width,
    crop[0] + height / 2 - dy * height,
  );
}
