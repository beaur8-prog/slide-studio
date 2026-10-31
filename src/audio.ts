import { bytesDataUrl } from "./video";

export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
export const AUDIO_ACCEPT = ".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4";
export type AudioMime = "audio/mpeg" | "audio/wav" | "audio/mp4";

/** Inspect source bytes; a renamed image or external URL is never media. */
export function audioMime(bytes: Uint8Array): AudioMime | undefined {
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE")
    return "audio/wav";
  if (
    bytes.length >= 10 &&
    (ascii(0, 3) === "ID3" ||
      (bytes[0] === 0xff &&
        (bytes[1] & 0xe0) === 0xe0 &&
        (bytes[1] & 6) !== 0 &&
        (bytes[2] & 0xf0) !== 0xf0 &&
        (bytes[2] & 0xf0) !== 0))
  )
    return "audio/mpeg";
  if (bytes.length >= 12 && ascii(4, 8) === "ftyp") return "audio/mp4";
}
export function safeAudio(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil((MAX_AUDIO_BYTES * 4) / 3) + 100
  )
    throw Error("오디오는 20 MiB 이하의 내장 MP3·WAV·M4A여야 합니다.");
  const match =
    /^data:(audio\/(?:mpeg|wav|mp4));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      value,
    );
  if (!match || match[2].length % 4) throw Error("잘못된 오디오 데이터입니다.");
  // The full payload alphabet/padding and quartet length were checked above.
  // Preserve noncanonical pad bits accepted by atob; only the MIME header
  // needs decoding. Exact decoded size follows from quartet count and padding.
  const raw = atob(match[2].slice(0, 24));
  if (
    (match[2].length / 4) * 3 -
      (match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0) >
      MAX_AUDIO_BYTES ||
    audioMime(Uint8Array.from(raw.slice(0, 16), (c) => c.charCodeAt(0))) !==
      match[1]
  )
    throw Error("오디오 형식과 데이터가 일치하지 않습니다.");
  return value;
}
export const audioExtension = (source: string) =>
  source.startsWith("data:audio/wav")
    ? "wav"
    : source.startsWith("data:audio/mp4")
      ? "m4a"
      : "mp3";
export function isAudioFile(file: File) {
  return (
    /^audio\/(mpeg|mp3|wav|x-wav|mp4|x-m4a)$/i.test(file.type) ||
    /\.(mp3|wav|m4a)$/i.test(file.name)
  );
}
export async function audioDuration(source: string): Promise<number> {
  const audio = document.createElement("audio");
  audio.preload = "metadata";
  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        audio.onloadedmetadata = audio.onerror = null;
        error ? reject(error) : resolve();
      };
      const timer = setTimeout(
        () => finish(Error("오디오를 읽는 시간이 초과되었습니다.")),
        10000,
      );
      audio.onloadedmetadata = () => finish();
      audio.onerror = () =>
        finish(
          Error(
            "이 오디오 코덱을 재생할 수 없습니다. MP3·PCM WAV·AAC M4A를 사용하세요.",
          ),
        );
      audio.src = source;
    });
    if (!Number.isFinite(audio.duration) || audio.duration <= 0)
      throw Error("오디오 재생 시간을 읽지 못했습니다.");
    return audio.duration;
  } finally {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
}
export async function readAudio(file: File) {
  if (!isAudioFile(file) || file.size > MAX_AUDIO_BYTES)
    throw Error("20 MiB 이하의 MP3·WAV·M4A 파일을 선택하세요.");
  const bytes = new Uint8Array(await file.arrayBuffer()),
    mime = audioMime(bytes);
  if (!mime) throw Error("올바른 MP3·WAV·M4A 파일이 아닙니다.");
  const src = bytesDataUrl(bytes, mime);
  await audioDuration(src);
  return { src };
}
