import { collectionFaces } from "./font-collection";
// Fonts added here belong to this device. Never copy them into a deck/export.
export const MAX_LOCAL_FONT_BYTES = 64 * 1024 * 1024;
export type LocalFont = {
  id: string;
  family: string;
  aliases: string[];
  weight: number;
  style: "normal" | "italic";
  bytes: Uint8Array;
};
export const localFontAlias = (family: string) =>
  `Slide Studio Local ${family}`;

// Read only bounded OpenType metadata; FontFace performs the actual font validation.
export function fontMetadata(bytes: Uint8Array): Omit<LocalFont, "bytes"> {
  const invalid = () =>
    new Error("올바른 TTF·OTF·TTC·OTC 글꼴 파일을 선택하세요.");
  if (bytes.byteLength < 12 || bytes.byteLength > MAX_LOCAL_FONT_BYTES)
    throw invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = view.getUint32(0);
  if (signature !== 0x00010000 && signature !== 0x4f54544f) throw invalid();
  const count = view.getUint16(4);
  if (!count || count > 100 || 12 + count * 16 > bytes.length) throw invalid();
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    const name = String.fromCharCode(...bytes.subarray(at, at + 4));
    const offset = view.getUint32(at + 8),
      length = view.getUint32(at + 12);
    if (offset > bytes.length || length > bytes.length - offset)
      throw invalid();
    tables.set(name, { offset, length });
  }
  const names = tables.get("name"),
    os2 = tables.get("OS/2"),
    head = tables.get("head");
  if (!names || names.length < 6 || !os2 || os2.length < 6) throw invalid();
  const records = view.getUint16(names.offset + 2),
    storage = view.getUint16(names.offset + 4);
  if (
    records > 1000 ||
    6 + records * 12 > names.length ||
    storage < 6 + records * 12
  )
    throw invalid();
  const families: { name: string; score: number; id: number }[] = [];
  for (let i = 0; i < records; i++) {
    const at = names.offset + 6 + i * 12;
    const platform = view.getUint16(at),
      language = view.getUint16(at + 4),
      id = view.getUint16(at + 6);
    const length = view.getUint16(at + 8),
      offset = storage + view.getUint16(at + 10);
    // The legacy family distinguishes Calibri Light from Calibri Regular.
    if (
      ![1, 16].includes(id) ||
      ![0, 3].includes(platform) ||
      length % 2 ||
      offset + length > names.length
    )
      continue;
    let name = "";
    for (let j = 0; j < length; j += 2)
      name += String.fromCharCode(view.getUint16(names.offset + offset + j));
    name = name.trim();
    if (!name || name.length > 128 || /[\x00-\x1f\x7f"\\]/.test(name)) continue;
    families.push({
      name,
      id,
      score: (id === 1 ? 10 : 0) + (language === 0x409 ? 2 : 0),
    });
  }
  const family = families.sort((a, b) => b.score - a.score)[0]?.name;
  if (!family) throw invalid();
  const weight = view.getUint16(os2.offset + 4);
  if (weight < 1 || weight > 1000) throw invalid();
  const italic =
    os2.length >= 64
      ? !!(view.getUint16(os2.offset + 62) & 1)
      : !!(head && head.length >= 46 && view.getUint16(head.offset + 44) & 2);
  const style = italic ? "italic" : "normal";
  return {
    id: `${family.toLowerCase()}/${weight}/${style}`,
    family,
    aliases: [
      ...new Set(
        families
          .filter(
            (f) => f.id === 1 || !families.some((other) => other.id === 1),
          )
          .map((f) => f.name),
      ),
    ].slice(0, 8),
    weight,
    style,
  };
}

const active = new Map<string, { font: LocalFont; faces: FontFace[] }>();
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("slide-studio-local-fonts", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("fonts", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("글꼴 저장소를 열 수 없습니다."));
  });
}
async function storedFonts(): Promise<LocalFont[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("fonts").objectStore("fonts").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
async function write(font: LocalFont | string) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("fonts", "readwrite");
      if (typeof font === "string") tx.objectStore("fonts").delete(font);
      else tx.objectStore("fonts").put(font);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () =>
        reject(tx.error || new Error("글꼴 저장 실패"));
    });
  } finally {
    db.close();
  }
}
async function load(font: LocalFont) {
  const copy = new Uint8Array(font.bytes);
  return Promise.all(
    [...new Set([font.family, ...font.aliases])].map(async (family) => {
      const face = new FontFace(localFontAlias(family), copy.buffer, {
        weight: String(font.weight),
        style: font.style,
        display: "block",
      });
      await face.load();
      return face;
    }),
  );
}
function activate(font: LocalFont, faces: FontFace[]) {
  const previous = active.get(font.id);
  previous?.faces.forEach((face) => document.fonts.delete(face));
  faces.forEach((face) => document.fonts.add(face));
  active.set(font.id, { font, faces });
  window.dispatchEvent(new Event("slide-studio:fonts-changed"));
}
export const listLocalFonts = () =>
  Array.from(active.values(), ({ font }) => ({
    id: font.id,
    family: font.family,
    weight: font.weight,
    style: font.style,
  }));
export async function addLocalFont(bytes: Uint8Array) {
  const metadata = fontMetadata(bytes);
  const fonts = await storedFonts();
  const others = fonts.filter((f) => f.id !== metadata.id);
  if (
    others.length >= 24 ||
    others.reduce((n, f) => n + f.bytes.byteLength, bytes.byteLength) >
      256 * 1024 * 1024
  )
    throw new Error(
      "추가한 글꼴을 일부 제거한 뒤 다시 시도하세요. (최대 24개, 256MB)",
    );
  const font = { ...metadata, bytes: new Uint8Array(bytes) };
  const face = await load(font);
  await write(font);
  activate(font, face);
  return metadata;
}
export async function removeLocalFont(id: string) {
  await write(id);
  const previous = active.get(id);
  previous?.faces.forEach((face) => document.fonts.delete(face));
  active.delete(id);
  window.dispatchEvent(new Event("slide-studio:fonts-changed"));
}
export async function installLocalFonts() {
  try {
    const fonts = (await storedFonts()).slice(0, 24);
    for (const saved of fonts) {
      try {
        const font = { ...fontMetadata(saved.bytes), bytes: saved.bytes };
        activate(font, await load(font));
      } catch {
        /* One damaged face must not prevent the editor from opening. */
      }
    }
  } catch {
    /* Optional storage: editing remains available. */
  }
}

export async function addLocalFonts(bytes: Uint8Array) {
  const faces = collectionFaces(bytes, MAX_LOCAL_FONT_BYTES);
  const additions = faces.map((bytes) => ({
    ...fontMetadata(bytes),
    bytes: new Uint8Array(bytes),
  }));
  const unique = [
    ...new Map(additions.map((font) => [font.id, font])).values(),
  ];
  const fonts = await storedFonts(),
    others = fonts.filter((f) => !unique.some((a) => a.id === f.id));
  if (
    others.length + unique.length > 24 ||
    [...others, ...unique].reduce((n, f) => n + f.bytes.byteLength, 0) >
      256 * 1024 * 1024
  )
    throw new Error("최대 24개, 256MB까지 글꼴을 등록할 수 있습니다.");
  // Validate every face before changing the local collection.
  const loaded = await Promise.all(
    unique.map(async (font) => ({ font, faces: await load(font) })),
  );
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("fonts", "readwrite");
      for (const font of unique) tx.objectStore("fonts").put(font);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () =>
        reject(tx.error ?? new Error("글꼴 저장 실패"));
    });
  } finally {
    db.close();
  }
  for (const { font, faces } of loaded) activate(font, faces);
  return unique.map(({ bytes, ...metadata }) => metadata);
}
