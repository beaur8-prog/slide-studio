import type JSZip from "jszip";
import {
  MAX_EXPANDED,
  relsPath,
  resolvePart,
  xmlDocument,
} from "./pptx-package";

const MASTER =
  /presentationml\.(?:slideMaster|notesMaster|handoutMaster)\+xml$/;
const THEME = "application/vnd.openxmlformats-officedocument.theme+xml";
const CONTENT_TYPES =
  "http://schemas.openxmlformats.org/package/2006/content-types";
const all = (node: Document, name: string) =>
  Array.from(node.getElementsByTagNameNS("*", name));

/** Office web can repair cloned masters that share one theme part. Give each
 * master its own byte-identical theme; already-independent themes are reused. */
export async function separateMasterThemes(zip: JSZip): Promise<void> {
  const manifest = zip.file("[Content_Types].xml");
  if (!manifest) return;
  const types = xmlDocument(await manifest.async("string"), "content types");
  const overrides = all(types, "Override");
  const themes = new Set<string>();
  let copies = 0,
    expanded = 0;
  let fileCount = Object.keys(zip.files).length;
  const data = new Map<string, Promise<Uint8Array>>();
  const bytes = (path: string) => {
    if (!data.has(path)) {
      const file = zip.file(path);
      if (!file)
        throw Error("저장할 마스터의 테마 첨부 파일이 누락되었습니다.");
      data.set(path, file.async("uint8array"));
    }
    return data.get(path)!;
  };
  for (const entry of overrides) {
    if (!MASTER.test(entry.getAttribute("ContentType") ?? "")) continue;
    const owner = (entry.getAttribute("PartName") ?? "").replace(/^\//, "");
    const relationshipPath = relsPath(owner);
    const relationshipFile = zip.file(relationshipPath);
    if (!relationshipFile) continue;
    const relationships = xmlDocument(
      await relationshipFile.async("string"),
      relationshipPath,
    );
    const relationship = all(relationships, "Relationship").find(
      (node) =>
        node.getAttribute("Type")?.endsWith("/theme") &&
        node.getAttribute("TargetMode") !== "External",
    );
    if (!relationship) continue;
    const source = resolvePart(
      owner,
      relationship.getAttribute("Target") ?? "",
    );
    if (!source || !zip.file(source))
      throw Error("저장할 마스터의 테마 관계가 끊어졌습니다.");
    if (!themes.has(source)) {
      themes.add(source);
      continue;
    }
    let target: string;
    do {
      if (++copies > 5000)
        throw Error("저장할 마스터 테마 사본이 너무 많습니다.");
      target = source.replace(/\.xml$/i, "") + `-ss-owner-${copies}.xml`;
    } while (zip.files[target] || zip.files[relsPath(target)]);
    const xml = await bytes(source);
    const sourceRelationships = zip.file(relsPath(source));
    const rels = sourceRelationships
      ? await bytes(relsPath(source))
      : undefined;
    expanded += xml.length + (rels?.length ?? 0);
    if (expanded > MAX_EXPANDED || fileCount + (rels ? 2 : 1) > 5000)
      throw Error(
        "마스터 테마 사본을 포함한 PPTX 크기 또는 파일 수가 제한을 초과합니다.",
      );
    fileCount += rels ? 2 : 1;
    zip.file(target, xml);
    // The copy stays in the source directory, so every relative asset target
    // resolves to exactly the same part. Embedded font/image bytes stay shared.
    if (rels) zip.file(relsPath(target), rels);
    relationship.setAttribute("Target", "/" + target);
    zip.file(
      relationshipPath,
      new XMLSerializer().serializeToString(relationships),
    );
    const declaration = types.createElementNS(CONTENT_TYPES, "Override");
    declaration.setAttribute("PartName", "/" + target);
    declaration.setAttribute("ContentType", THEME);
    types.documentElement.append(declaration);
    themes.add(target);
  }
  if (copies)
    zip.file(
      "[Content_Types].xml",
      new XMLSerializer().serializeToString(types),
    );
}
