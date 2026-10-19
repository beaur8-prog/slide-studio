export const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
export const VIDEO_ACCEPT = ".mp4,.webm,video/mp4,video/webm";
export const EMPTY_POSTER =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfTYAAAAASUVORK5CYII=";

export function videoMime(
  bytes: Uint8Array,
): "video/mp4" | "video/webm" | undefined {
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(4, 8)) === "ftyp"
  )
    return "video/mp4";
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  )
    return "video/webm";
}
export function bytesDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return `data:${mime};base64,${btoa(binary)}`;
}
export function safeVideo(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil((MAX_VIDEO_BYTES * 4) / 3) + 100
  )
    throw Error("동영상은 20 MiB 이하의 내장 MP4 또는 WebM이어야 합니다.");
  const match =
    /^data:(video\/(?:mp4|webm));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4) throw Error("잘못된 동영상 데이터입니다.");
  const raw = atob(match[2]);
  if (
    raw.length > MAX_VIDEO_BYTES ||
    videoMime(Uint8Array.from(raw.slice(0, 16), (c) => c.charCodeAt(0))) !==
      match[1]
  )
    throw Error("동영상 형식과 데이터가 일치하지 않습니다.");
  return value;
}
export function isVideoFile(file: File): boolean {
  return (
    /^video\/(mp4|webm)$/i.test(file.type) || /\.(mp4|webm)$/i.test(file.name)
  );
}

/** Capture a separate still preview; keep the original movie byte-for-byte. */
export async function videoPreview(
  src: string,
): Promise<{ poster: string; width: number; height: number }> {
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => finish(Error("동영상 첫 화면을 읽는 시간이 초과되었습니다.")),
        10000,
      );
      const finish = (error?: Error) => {
        clearTimeout(timer);
        video.onloadeddata = video.onerror = null;
        error ? reject(error) : resolve();
      };
      video.onloadeddata = () => finish();
      video.onerror = () =>
        finish(
          Error(
            "이 동영상 코덱을 재생할 수 없습니다. H.264 MP4 또는 VP8/VP9 WebM을 사용하세요.",
          ),
        );
      video.src = src;
    });
    const width = video.videoWidth,
      height = video.videoHeight;
    if (!width || !height || width * height > 16000000)
      throw Error("동영상은 1,600만 화소 이하여야 합니다.");
    const scale = Math.min(1, 1280 / width, 720 / height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas
      .getContext("2d")!
      .drawImage(video, 0, 0, canvas.width, canvas.height);
    const poster = canvas.toDataURL("image/png");
    canvas.width = canvas.height = 0;
    return { poster, width, height };
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
}

export async function readVideo(file: File) {
  if (!isVideoFile(file) || file.size > MAX_VIDEO_BYTES)
    throw Error("20 MiB 이하의 MP4 또는 WebM 동영상을 선택하세요.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = videoMime(bytes);
  if (!mime) throw Error("올바른 MP4 또는 WebM 파일이 아닙니다.");
  const src = bytesDataUrl(bytes, mime);
  return { src, ...(await videoPreview(src)) };
}
