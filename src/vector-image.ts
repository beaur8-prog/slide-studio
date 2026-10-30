import { svgImage } from "./svg-image";

export type VectorKind = "svg" | "emf" | "wmf";
export function vectorKind(bytes: Uint8Array): VectorKind | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length >= 88 &&
    view.getUint32(0, true) === 1 &&
    view.getUint32(40, true) === 0x464d4520
  )
    return "emf";
  if (bytes.length >= 22 && view.getUint32(0, true) === 0x9ac6cdd7)
    return "wmf";
  if (
    bytes.length >= 18 &&
    [1, 2].includes(view.getUint16(0, true)) &&
    view.getUint16(2, true) === 9 &&
    [0x100, 0x300].includes(view.getUint16(4, true))
  )
    return "wmf";
  const start = new TextDecoder()
    .decode(bytes.subarray(0, 1024))
    .replace(/^\uFEFF/, "")
    .trimStart();
  if (
    /^(?:<\?xml\s|<svg[\s>]|<!--|<!DOCTYPE)/i.test(start) ||
    (bytes[0] === 0xff && bytes[1] === 0xfe) ||
    (bytes[0] === 0xfe && bytes[1] === 0xff)
  )
    return "svg";
}

// Validate record envelopes before third-party playback. The worker adds an
// independent wall-clock limit, so corrupt/huge GDI records cannot freeze editing.
function validateMetafile(bytes: Uint8Array, kind: "emf" | "wmf") {
  if (bytes.length > 16 * 1024 * 1024) throw Error("벡터 그림이 너무 큽니다.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset =
    kind === "wmf" ? (view.getUint32(0, true) === 0x9ac6cdd7 ? 22 : 0) + 18 : 0;
  let count = 0,
    ended = false;
  while (offset < bytes.length) {
    if (++count > 50000 || offset + (kind === "emf" ? 8 : 6) > bytes.length)
      throw Error("벡터 그림이 너무 복잡하거나 손상되었습니다.");
    const type =
      kind === "emf"
        ? view.getUint32(offset, true)
        : view.getUint16(offset + 4, true);
    const size =
      kind === "emf"
        ? view.getUint32(offset + 4, true)
        : view.getUint32(offset, true) * 2;
    if (
      size < (kind === "emf" ? 8 : 6) ||
      size % (kind === "emf" ? 4 : 2) ||
      offset + size > bytes.length
    )
      throw Error("벡터 그림 레코드가 손상되었습니다.");
    offset += size;
    if (type === (kind === "emf" ? 14 : 0)) {
      ended = true;
      break;
    }
  }
  if (!ended) throw Error("벡터 그림의 끝을 찾을 수 없습니다.");
}

export async function vectorImage(bytes: Uint8Array, kind: VectorKind) {
  if (kind === "svg") return svgImage(bytes);
  validateMetafile(bytes, kind);
  // The converter is lazy-loaded, including its worker, only for EMF/WMF input.
  const { default: MetafileWorker } = await import(
    "./metafile.worker?worker&inline"
  );
  const worker = new MetafileWorker();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const text = await new Promise<string>((resolve, reject) => {
      timer = setTimeout(
        () => reject(Error("벡터 그림 변환 시간이 초과되었습니다.")),
        8000,
      );
      worker.onmessage = (event) => {
        clearTimeout(timer);
        event.data.svg
          ? resolve(event.data.svg)
          : reject(Error("이 벡터 그림을 변환할 수 없습니다."));
      };
      worker.onerror = (event) => {
        event.preventDefault();
        clearTimeout(timer);
        reject(Error("벡터 그림 변환기를 실행할 수 없습니다."));
      };
      const copy = new Uint8Array(bytes);
      worker.postMessage(copy, [copy.buffer]);
    });
    return svgImage(new TextEncoder().encode(text));
  } finally {
    clearTimeout(timer);
    worker.terminate();
  }
}
