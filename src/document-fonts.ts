import { fontFamilyNames, scriptRuns } from "./text-layout";
import { localFontAlias } from "./local-fonts";
import { visibleTableCells } from "./table";
import type { Deck, TextParagraph } from "./types";

export interface DocumentFontUsage {
  family: string;
  slides: number;
}
export interface DocumentFontStatus extends DocumentFontUsage {
  kind: "installed" | "local" | "bundled" | "office" | "substitute" | "unknown";
  label: string;
  detail?: string;
}

/** Actual text and visible table cells only; unused theme faces are not usage. */
export function documentFontUsage(deck: Deck): DocumentFontUsage[] {
  const used = new Map<string, { family: string; slides: Set<number> }>();
  deck.slides.forEach((slide, index) => {
    const add = (family: string | undefined, text: string) => {
      if (!text.trim()) return;
      // Keep the exact requested name. Trimming a malformed/intentional family
      // here would diagnose a different family than the text renderer uses.
      const name = family?.trim() ? family : "Arial";
      const key = name.toLowerCase();
      if (!used.has(key)) used.set(key, { family: name, slides: new Set() });
      used.get(key)!.slides.add(index);
    };
    const paragraphs = (
      items: TextParagraph[],
      fallback: string | undefined,
    ) => {
      for (const p of items)
        for (const run of p.runs)
          for (const part of scriptRuns(run))
            add(part.fontFamily || fallback, part.text);
    };
    for (const element of slide.elements) {
      if (element.paragraphs)
        paragraphs(element.paragraphs, element.fontFamily);
      else if (element.text) add(element.fontFamily, element.text);
      const table = element.table;
      if (!table) continue;
      for (const { row, column } of visibleTableCells(table)) {
        const style = table.cellStyles?.[row]?.[column];
        const fallback = style?.fontFamily || table.fontFamily;
        if (style?.paragraphs) paragraphs(style.paragraphs, fallback);
        else add(fallback, table.cells[row][column]);
      }
    }
  });
  return Array.from(used.values(), ({ family, slides }) => ({
    family,
    slides: slides.size,
  })).sort((a, b) => a.family.localeCompare(b.family));
}

// FontFace(local(...)) resolves only local fonts; document.fonts.check() can
// return true for missing families and must not be used as an installed test.
// Keep probes bounded and cached. A manual refresh clears negative results
// after the user installs a font while the app remains open.
const localProbes = new Map<string, Promise<boolean>>();
export function refreshDocumentFonts() {
  localProbes.clear();
}
function installedFamily(name: string): Promise<boolean> {
  const key = name.toLowerCase();
  const cached = localProbes.get(key);
  if (cached) return cached;
  if (localProbes.size >= 128)
    localProbes.delete(localProbes.keys().next().value!);
  const probe = (async () => {
    if (typeof FontFace === "undefined") return false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      // JSON string escaping is also valid CSS string escaping for these
      // validated family names. No URL or font bytes are fetched here.
      return await Promise.race([
        new FontFace(
          "Slide Studio font availability probe",
          `local(${JSON.stringify(name)})`,
        )
          .load()
          .then(() => true),
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => resolve(false), 3000);
        }),
      ]);
    } catch {
      return false;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  })();
  localProbes.set(key, probe);
  return probe;
}

function registeredFamilies(): Set<string> {
  const families = new Set<string>();
  document.fonts.forEach((face) => {
    if (face.status === "loaded")
      families.add(face.family.replace(/^["']|["']$/g, "").toLowerCase());
  });
  return families;
}

export async function diagnoseDocumentFonts(
  usage: DocumentFontUsage[],
  signal?: AbortSignal,
): Promise<DocumentFontStatus[]> {
  if (signal?.aborted || !usage.length) return [];
  const registered = registeredFamilies();
  let timedOut = false;
  const unconfirmed = (item: DocumentFontUsage): DocumentFontStatus => ({
    ...item,
    kind: "unknown",
    label: timedOut ? "확인 필요 · 조회 시간 초과" : "원본 글꼴 확인 필요",
    detail:
      "이 기기에서 원본 이름을 확인하지 못했습니다. 대체 글꼴로 표시될 수 있습니다.",
  });
  const diagnose = async (
    item: DocumentFontUsage,
  ): Promise<DocumentFontStatus> => {
    const names = fontFamilyNames(item.family);
    const family = names[0];
    for (const name of names) {
      if (timedOut || signal?.aborted) return unconfirmed(item);
      if (await installedFamily(name))
        return {
          ...item,
          kind: "installed",
          label: "설치된 원본 이름 확인",
          ...(name.toLowerCase() !== item.family.toLowerCase()
            ? { detail: `동일 글꼴 이름: ${name}` }
            : {}),
        };
      if (registered.has(localFontAlias(name).toLowerCase()))
        return {
          ...item,
          kind: "local",
          label: "직접 추가한 글꼴",
          ...(name.toLowerCase() !== item.family.toLowerCase()
            ? { detail: `동일 글꼴 이름: ${name}` }
            : {}),
        };
    }
    if (/^(?:나눔바른고딕|Nanum\s*Barun\s*Gothic)$/i.test(family))
      return {
        ...item,
        kind: "bundled",
        label: "앱에 포함된 원본 글꼴",
      };
    if (/^Calibri(?: Light)?$/i.test(family)) {
      if (registered.has(`slide studio office ${family}`.toLowerCase()))
        return {
          ...item,
          kind: "office",
          label: "이 기기의 Office 글꼴",
        };
      return { ...item, kind: "substitute", label: "대체 글꼴 사용 · Carlito" };
    }
    return unconfirmed(item);
  };
  const results: DocumentFontStatus[] = new Array(usage.length);
  let next = 0;
  // A presentation can contain many distinct fonts. Do not launch unbounded
  // native font lookups or stall the dialog while waiting for all of them.
  const workers = Promise.all(
    Array.from({ length: Math.min(4, usage.length) }, async () => {
      while (!timedOut && !signal?.aborted && next < usage.length) {
        const index = next++;
        const status: DocumentFontStatus =
          index < 128
            ? await diagnose(usage[index])
            : {
                ...usage[index],
                kind: "unknown",
                label: "확인 필요 · 128개 확인 한도",
              };
        if (timedOut || signal?.aborted) return;
        results[index] = status;
      }
    }),
  );
  // Bound the entire check as well as each native probe. A stalled platform
  // font service must not turn many missing families into minutes of waiting.
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const checked = await Promise.race([
      workers.then(() => results),
      new Promise<DocumentFontStatus[]>((resolve) => {
        timeout = setTimeout(() => {
          timedOut = true;
          resolve(
            usage.map((item, index) => results[index] ?? unconfirmed(item)),
          );
        }, 5000);
      }),
    ]);
    return signal?.aborted ? [] : checked;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
