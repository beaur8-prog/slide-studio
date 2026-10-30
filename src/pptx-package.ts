import JSZip from "jszip";
import { fail } from "./validation";
export const MAX_ARCHIVE = 256 * 1024 * 1024;
export const MAX_EXPANDED = 200 * 1024 * 1024;
export const MAX_PART = 24 * 1024 * 1024;
export const MAX_XML = 8 * 1024 * 1024;
const MAX_ZIP_FILES = 5000;
export const REL_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const STRICT_PREFIX = "http://purl.oclc.org/ooxml/";
const strictNamespaces = new Map([
  ["presentationml/main", "presentationml/2006/main"],
  ["drawingml/main", "drawingml/2006/main"],
  ["drawingml/chart", "drawingml/2006/chart"],
  ["drawingml/chartDrawing", "drawingml/2006/chartDrawing"],
  ["drawingml/diagram", "drawingml/2006/diagram"],
  ["drawingml/picture", "drawingml/2006/picture"],
  ["drawingml/spreadsheetDrawing", "drawingml/2006/spreadsheetDrawing"],
  ["drawingml/wordprocessingDrawing", "drawingml/2006/wordprocessingDrawing"],
  ["officeDocument/relationships", "officeDocument/2006/relationships"],
  ["officeDocument/math", "officeDocument/2006/math"],
  ["officeDocument/docPropsVTypes", "officeDocument/2006/docPropsVTypes"],
  ["officeDocument/extendedProperties", "officeDocument/2006/extendedProperties"],
  ["spreadsheetml/main", "spreadsheetml/2006/main"],
  ["wordprocessingml/main", "wordprocessingml/2006/main"],
].map(([from, to]) => [STRICT_PREFIX + from, "http://schemas.openxmlformats.org/" + to]));
export const relsPath = (path: string) => {
  const bits = path.split("/"),
    name = bits.pop()!;
  return [...bits, "_rels", name + ".rels"].join("/");
};
/** Reject oversized/ambiguous ZIPs before JSZip allocates decompressed data. */
export function checkZip(bytes: Uint8Array): Map<string, number> {
  if (bytes.length > MAX_ARCHIVE) fail("PPTX 파일은 256 MiB 이하여야 합니다.");
  if (bytes.length < 22) fail("올바른 PPTX ZIP 파일이 아닙니다.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (
      view.getUint32(i, true) === 0x06054b50 &&
      i + 22 + view.getUint16(i + 20, true) === bytes.length
    ) {
      end = i;
      break;
    }
  }
  if (end < 0) fail("PPTX ZIP 디렉터리를 찾을 수 없습니다.");
  const count = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const start = view.getUint32(end + 16, true);
  if (
    view.getUint16(end + 4, true) !== 0 ||
    view.getUint16(end + 6, true) !== 0 ||
    view.getUint16(end + 8, true) !== count
  )
    fail("분할 ZIP은 지원하지 않습니다.");
  if (count === 65535 || start === 0xffffffff || centralSize === 0xffffffff)
    fail("ZIP64 PPTX는 지원하지 않습니다.");
  if (count > MAX_ZIP_FILES || start + centralSize > end)
    fail("PPTX 파일 수 또는 디렉터리 크기가 제한을 초과합니다.");
  const names = new Set<string>();
  const sizes = new Map<string, number>();
  const decoder = new TextDecoder();
  let at = start;
  let expanded = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50)
      fail("손상된 PPTX ZIP 디렉터리입니다.");
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    if (flags & 1 || (method !== 0 && method !== 8))
      fail("암호화되었거나 지원하지 않는 압축 형식의 PPTX입니다.");
    if (
      at + 46 + nameLength + extraLength + commentLength >
      start + centralSize
    )
      fail("손상된 PPTX ZIP 항목입니다.");
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (
      !name ||
      name.includes("\\") ||
      name.startsWith("/") ||
      name.includes("\0") ||
      name.split("/").some((p) => p === ".." || p === ".") ||
      names.has(name)
    )
      fail("PPTX에 잘못되거나 중복된 파일 경로가 있습니다.");
    names.add(name);
    sizes.set(name, size);
    expanded += size;
    if (size > MAX_PART || expanded > MAX_EXPANDED)
      fail("PPTX 압축 해제 크기가 제한을 초과합니다.");
    if ((name.endsWith(".xml") || name.endsWith(".rels")) && size > MAX_XML)
      fail("PPTX XML 항목이 너무 큽니다.");
    at += 46 + nameLength + extraLength + commentLength;
  }
  if (at !== start + centralSize)
    fail("PPTX ZIP 디렉터리 길이가 일치하지 않습니다.");
  return sizes;
}

export function xmlDocument(text: string, path: string): Document {
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    fail(`${path}: DTD/ENTITY XML은 지원하지 않습니다.`);
  const xml = new DOMParser().parseFromString(text, "application/xml");
  if (
    xml.getElementsByTagName("parsererror").length ||
    xml.documentElement.localName === "parsererror"
  )
    fail(`${path}: XML이 손상되었습니다.`);
  if (text.includes(STRICT_PREFIX)) {
    // The writer emits Transitional OOXML. Normalize actual namespaces and
    // relationship Type attributes before copying native parts; treating Strict
    // r:embed as an unrelated attribute silently drops its media dependency.
    // Walk a snapshot iteratively so deeply nested XML does not recurse here.
    for (const node of Array.from(xml.getElementsByTagName("*"))) {
      const converted = xml.createElementNS(
        strictNamespaces.get(node.namespaceURI ?? "") ?? node.namespaceURI,
        node.nodeName,
      );
      for (const attribute of Array.from(node.attributes)) {
        let value = attribute.value;
        if (attribute.namespaceURI === "http://www.w3.org/2000/xmlns/")
          value = strictNamespaces.get(value) ?? value;
        if (node.localName === "Relationship" &&
            node.namespaceURI === "http://schemas.openxmlformats.org/package/2006/relationships" &&
            attribute.name === "Type" && value.startsWith(STRICT_PREFIX + "officeDocument/relationships/"))
          value = REL_NS + value.slice((STRICT_PREFIX + "officeDocument/relationships").length);
        converted.setAttributeNS(
          strictNamespaces.get(attribute.namespaceURI ?? "") ?? attribute.namespaceURI,
          attribute.name,
          value,
        );
      }
      while (node.firstChild) converted.appendChild(node.firstChild);
      node.parentNode!.replaceChild(converted, node);
    }
  }
  return xml;
}
export function resolvePart(from: string, target: string): string | undefined {
  if (
    !target ||
    /^[a-z][a-z0-9+.-]*:/i.test(target) ||
    target.includes("\\") ||
    target.startsWith("//")
  )
    return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(target.split("#")[0]);
  } catch {
    return undefined;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return undefined;
  const stack = decoded.startsWith("/") ? [] : from.split("/").slice(0, -1);
  for (const item of decoded.split("/")) {
    if (item === "..") {
      if (!stack.length) return undefined;
      stack.pop();
    } else if (item && item !== ".") stack.push(item);
  }
  return stack.join("/");
}

export async function openPptxPackage(bytes: Uint8Array) {
  const partSizes = checkZip(bytes);
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes, { createFolders: false });
  } catch {
    throw Error(
      "PPTX 압축 파일을 읽을 수 없습니다. 암호화 또는 파일 손상을 확인하세요.",
    );
  }
  let readTotal = 0;
  const data = new Map<string, Promise<Uint8Array | undefined>>();
  const xml = new Map<string, Promise<Document | undefined>>();
  const readBytes = async (
    path: string,
    limit = MAX_PART,
  ): Promise<Uint8Array | undefined> => {
    const declared = partSizes.get(path);
    if (declared !== undefined && declared > limit)
      throw Error("PPTX 압축 해제 데이터가 허용 크기를 초과합니다.");
    if (!data.has(path))
      data.set(
        path,
        (async () => {
          const file = zip.file(path);
          if (!file) return undefined;
          return new Promise<Uint8Array>((resolve, reject) => {
            const pieces: Uint8Array[] = [];
            let total = 0,
              settled = false;
            const stream = (
              file as JSZip.JSZipObject & {
                internalStream(
                  type: "uint8array",
                ): JSZip.JSZipStreamHelper<Uint8Array>;
              }
            ).internalStream("uint8array");
            stream.on("data", (chunk) => {
              if (settled) return;
              total += chunk.length;
              readTotal += chunk.length;
              if (total > limit || readTotal > MAX_EXPANDED) {
                settled = true;
                stream.pause();
                reject(
                  Error("PPTX 압축 해제 데이터가 허용 크기를 초과합니다."),
                );
                return;
              }
              pieces.push(chunk);
            });
            stream.on("error", (error) => {
              if (!settled) {
                settled = true;
                reject(error);
              }
            });
            stream.on("end", () => {
              if (settled) return;
              settled = true;
              const result = new Uint8Array(total);
              let offset = 0;
              for (const piece of pieces) {
                result.set(piece, offset);
                offset += piece.length;
              }
              resolve(result);
            });
            stream.resume();
          });
        })(),
      );
    const result = await data.get(path)!;
    if (result && result.length > limit)
      throw Error("PPTX 압축 해제 데이터가 허용 크기를 초과합니다.");
    return result;
  };
  const readXml = async (
    path: string | undefined,
  ): Promise<Document | undefined> => {
    if (!path) return undefined;
    if (!xml.has(path))
      xml.set(
        path,
        readBytes(path, MAX_XML).then((raw) =>
          raw ? xmlDocument(new TextDecoder().decode(raw), path) : undefined,
        ),
      );
    return xml.get(path)!;
  };
  return { zip, partSizes, readBytes, readXml };
}
export type PptxPackage = Awaited<ReturnType<typeof openPptxPackage>>;
