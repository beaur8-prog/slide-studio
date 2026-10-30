import JSZip from "jszip";
import type {
  Deck,
  Slide,
  SlideElement,
  PptxSourcePackage,
  PptxSourceNode,
  PptxSlideSource,
} from "./types";
import { record, stringValue, numberValue, booleanValue } from "./validation";
import {
  openPptxPackage,
  xmlDocument,
  resolvePart,
  relsPath,
  REL_NS,
  MAX_EXPANDED,
  type PptxPackage,
} from "./pptx-package";

const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PR = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const SS = "urn:slide-studio:object-state:v1";
const all = (n: Element | Document | undefined | null, name: string) =>
  Array.from(n?.getElementsByTagNameNS("*", name) ?? []);
const child = (n: Element | Document | undefined, name: string) =>
  Array.from(n?.children ?? []).find((c) => c.localName === name);
const serial = (n: Node) => new XMLSerializer().serializeToString(n);
const props = (n: Element) =>
  Array.from(n.children)
    .flatMap((c) => Array.from(c.children))
    .find((c) => c.localName === "cNvPr");
const key = (n: Element) =>
  n.getElementsByTagNameNS(SS, "state")[0]?.getAttribute("key") ??
  n.getAttribute("name");
const shapeNames = new Set([
  "sp",
  "cxnSp",
  "pic",
  "grpSp",
  "graphicFrame",
  "AlternateContent",
  "contentPart",
]);
const nodeKey = (part: string, index: number) => part + "#" + index;
const b64 = (bytes: Uint8Array) => {
  let raw = "";
  for (let i = 0; i < bytes.length; i += 32768)
    raw += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(raw);
};
const decode = (data: string) =>
  Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
function pathValue(input: unknown) {
  const path = stringValue(input, "원본 PPTX 경로", 1000, false);
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((p) => !p || p === "." || p === "..") ||
    /[\x00-\x1f?#]/.test(path)
  )
    throw Error("잘못된 원본 PPTX 경로입니다.");
  return path;
}
const digestValue = (value: unknown) => {
  if (typeof value !== "string" || !/^[a-f\d]{64}$/.test(value))
    throw Error("잘못된 원본 PPTX 변경 정보입니다.");
  return value;
};
function indexValue(value: unknown) {
  const result = numberValue(value, "원본 순서·개수", 0, 10000);
  if (!Number.isInteger(result))
    throw Error("원본 순서·개수는 정수여야 합니다.");
  return result;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export async function signature(value: unknown) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(canonical(value))),
  );
  return Array.from(new Uint8Array(bytes), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
}
export async function elementSignature(elements: SlideElement[]) {
  const groups = new Map<string, number>();
  return signature(
    elements.map(({ id, pptxRef, ...e }) => ({
      ...e,
      ...(e.groups
        ? {
            groups: e.groups.map((g) => {
              if (!groups.has(g)) groups.set(g, groups.size);
              return groups.get(g);
            }),
          }
        : {}),
    })),
  );
}
const paint = (e: SlideElement) =>
  Object.fromEntries(
    [
      "shape",
      "paths",
      "cornerRadius",
      "fill",
      "fillOpacity",
      "stroke",
      "strokeWidth",
      "strokeOpacity",
      "strokeDash",
      "strokeCap",
      "gradient",
      "shadow",
      "lineStart",
      "lineEnd",
      "opacity",
      "borders",
    ].map((k) => [k, e[k as keyof SlideElement]]),
  );
const textModel = (e: SlideElement) =>
  Object.fromEntries(
    [
      "text",
      "paragraphs",
      "fontFamily",
      "fontFamilyEastAsian",
      "fontSize",
      "letterSpacing",
      "kerning",
      "language",
      "bold",
      "italic",
      "underline",
      "color",
      "align",
      "verticalAlign",
      "wrap",
      "autoHeight",
      "textColumns",
      "textColumnGap",
      "textOverflow",
      "writingMode",
      "textInsets",
      "textFrame",
      "textOpacity",
    ].map((k) => [k, e[k as keyof SlideElement]]),
  );
const playback = (e: SlideElement) => ({
  type: e.type,
  autoPlay: e.autoPlay,
  loop: e.loop,
  muted: e.muted,
});
const content = (e: SlideElement) => ({
  type: e.type,
  src: e.src,
  chart: e.chart,
  table: e.table,
  poster: e.poster,
});
function unmodeledText(root: Element | Document) {
  return (
    all(root, "buBlip").length > 0 ||
    all(root, "pPr").some((n) =>
      ["just", "dist", "thaiDist", "justLow"].includes(
        n.getAttribute("algn") ?? "",
      ),
    ) ||
    ["rPr", "defRPr", "endParaRPr"].some((name) =>
      all(root, name).some(
        (n) =>
          ["strike", "cap"].some(
            (a) =>
              n.hasAttribute(a) &&
              !["noStrike", "none"].includes(n.getAttribute(a)!),
          ) ||
          (n.hasAttribute("u") &&
            !["none", "sng"].includes(n.getAttribute("u")!)) ||
          [
            "highlight",
            "gradFill",
            "blipFill",
            "pattFill",
            "ln",
            "effectLst",
            "effectDag",
            "uLn",
            "uFill",
          ].some((name) => !!child(n, name)),
      ),
    )
  );
}
export const backgroundSignature = (s: Slide) =>
  signature({
    color: s.background,
    gradient: s.backgroundGradient,
    image: s.backgroundImage,
  });
export function preservationRequired(doc?: Document) {
  if (!doc) return false;
  return (
    [
      "timing",
      "svgBlip",
      "buBlip",
      "prstTxWarp",
      "AlternateContent",
      "audioFile",
      "wavAudioFile",
      "oleObj",
      "contentPart",
      "pattFill",
      "scene3d",
      "sp3d",
      "innerShdw",
      "glow",
      "reflection",
      "relIds",
    ].some((n) => all(doc, n).length) ||
    all(doc, "transition").some(
      (n) => !child(n, "fade") || n.hasAttribute("advTm"),
    ) ||
    unmodeledText(doc) ||
    all(doc, "blipFill").some((n) => n.parentElement?.localName === "spPr") ||
    all(doc, "ext").some((n) =>
      Array.from(n.children).some(
        (c) =>
          c.namespaceURI &&
          !c.namespaceURI.startsWith("urn:slide-studio:") &&
          !c.namespaceURI.startsWith("https://slide-studio.local/"),
      ),
    )
  );
}
export function validatePptxRef(
  value: unknown,
): NonNullable<SlideElement["pptxRef"]> {
  const r = record(value, "원본 개체 정보");
  return {
    source: stringValue(r.source, "원본 ID", 160, false),
    part: pathValue(r.part),
    index: indexValue(r.index),
    shape: stringValue(r.shape, "원본 도형 ID", 160),
    ...(r.instance !== undefined
      ? { instance: stringValue(r.instance, "원본 개체 ID", 160, false) }
      : {}),
    ...(r.playback !== undefined ? { playback: digestValue(r.playback) } : {}),
    ...(r.text !== undefined ? { text: digestValue(r.text) } : {}),
    ...(r.paint !== undefined ? { paint: digestValue(r.paint) } : {}),
    ...(r.content !== undefined ? { content: digestValue(r.content) } : {}),
    ...(r.geometry !== undefined
      ? {
          geometry: (() => {
            if (!Array.isArray(r.geometry) || r.geometry.length !== 4)
              throw Error("잘못된 원본 개체 위치입니다.");
            return r.geometry.map((v) =>
              numberValue(v, "원본 개체 위치", -100000, 100000),
            ) as [number, number, number, number];
          })(),
        }
      : {}),
  };
}
function validateNode(value: unknown): PptxSourceNode {
  const n = record(value, "원본 노드");
  return {
    part: pathValue(n.part),
    index: indexValue(n.index),
    count: indexValue(n.count),
    signature: digestValue(n.signature),
    ...(n.derived !== undefined
      ? { derived: booleanValue(n.derived, "원본 파생 개체") }
      : {}),
    ...(n.shapes !== undefined
      ? {
          shapes: (() => {
            if (!Array.isArray(n.shapes) || n.shapes.length > 1000)
              throw Error("원본 도형 목록이 너무 큽니다.");
            return n.shapes.map((v) => stringValue(v, "원본 도형 ID", 160));
          })(),
        }
      : {}),
  };
}
export function validateSlideSource(value: unknown): PptxSlideSource {
  const s = record(value, "원본 슬라이드");
  if (!Array.isArray(s.nodes) || s.nodes.length > 10000)
    throw Error("원본 슬라이드 정보가 너무 큽니다.");
  return {
    source: stringValue(s.source, "원본 ID", 160, false),
    path: pathValue(s.path),
    nodes: s.nodes.map(validateNode),
    background: digestValue(s.background),
    transition: digestValue(s.transition),
    notes: digestValue(s.notes),
    ...(s.nativeTransition !== undefined
      ? { nativeTransition: booleanValue(s.nativeTransition, "원본 전환 설정") }
      : {}),
    ...(s.transitionEdited !== undefined
      ? { transitionEdited: booleanValue(s.transitionEdited, "전환 설정 변경") }
      : {}),
  };
}
export function validateSources(value: unknown): PptxSourcePackage[] {
  if (!Array.isArray(value) || value.length > 500)
    throw Error("원본 PPTX 파일 수가 너무 많습니다.");
  const ids = new Set<string>();
  let bytes = 0;
  return value.map((v) => {
    const s = record(v, "원본 PPTX"),
      id = stringValue(s.id, "원본 ID", 160, false);
    if (ids.has(id)) throw Error("원본 PPTX ID가 중복되었습니다.");
    ids.add(id);
    const data = stringValue(s.data, "원본 PPTX 데이터", MAX_EXPANDED, false);
    bytes += data.length;
    if (
      bytes > MAX_EXPANDED ||
      data.length % 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
    )
      throw Error("원본 PPTX 데이터가 잘못되었거나 너무 큽니다.");
    if (
      !Array.isArray(s.slides) ||
      s.slides.length > 500 ||
      !Array.isArray(s.nodes) ||
      s.nodes.length > 10000
    )
      throw Error("잘못된 원본 PPTX 목록입니다.");
    return {
      id,
      ...(s.deckId !== undefined
        ? { deckId: stringValue(s.deckId, "원본 문서 ID", 160, false) }
        : {}),
      data,
      slides: s.slides.map((v) => {
        const slide = record(v, "원본 슬라이드");
        return {
          path: pathValue(slide.path),
          id: stringValue(slide.id, "슬라이드 ID", 160, false),
        };
      }),
      nodes: s.nodes.map(validateNode),
    };
  });
}
export function mergePptxSources(
  deck: Deck,
  incoming?: PptxSourcePackage[],
): Deck {
  if (!incoming?.length) return deck;
  const sources = new Map((deck.pptxSources ?? []).map((s) => [s.id, s]));
  for (const source of incoming) {
    const previous = sources.get(source.id);
    if (previous && previous.data !== source.data)
      throw Error("서로 다른 원본 PPTX의 ID가 충돌했습니다.");
    sources.set(source.id, source);
  }
  return { ...deck, pptxSources: [...sources.values()] };
}
export function replaceSlideTransition(
  slide: Slide,
  transition: Slide["transition"],
): Slide {
  return {
    ...slide,
    transition,
    ...(slide.pptxSource?.nativeTransition
      ? { pptxSource: { ...slide.pptxSource, transitionEdited: true } }
      : {}),
  };
}
export async function finalizeSource(
  deck: Deck,
  bytes: Uint8Array,
  required: boolean,
  availableChars = MAX_EXPANDED,
) {
  if (!required) {
    for (const s of deck.slides) {
      delete s.pptxSource;
      for (const e of s.elements) delete e.pptxRef;
    }
    return;
  }
  if (Math.ceil(bytes.length / 3) * 4 > availableChars) {
    for (const s of deck.slides) {
      delete s.pptxSource;
      for (const e of s.elements) delete e.pptxRef;
    }
    deck.pptxLosses = [
      "원본 보존 데이터가 200 MiB 문서 제한을 넘어, 편집기가 지원하지 않는 원본 요소를 저장할 수 없습니다.",
    ];
    return;
  }
  const source = deck.slides[0].pptxSource!.source;
  const nodes: PptxSourceNode[] = [];
  for (const s of deck.slides) {
    const meta = s.pptxSource!;
    for (const node of meta.nodes) {
      const elements = s.elements.filter(
        (e) => e.pptxRef?.part === node.part && e.pptxRef.index === node.index,
      );
      node.count = elements.length;
      node.signature = await elementSignature(elements);
      node.shapes = [...new Set(elements.map((e) => e.pptxRef!.shape))];
      // Geometry-only changes must retain original picture fills, paths,
      // native audio properties and all other unmodeled shape properties.
      for (const e of elements)
        e.pptxRef = {
          ...e.pptxRef!,
          paint: await signature(paint(e)),
          content: await signature(content(e)),
          playback: await signature(playback(e)),
          text: await signature(textModel(e)),
          geometry: [e.x, e.y, e.width, e.height],
        };
      if (!nodes.some((n) => n.part === node.part && n.index === node.index))
        nodes.push(node);
    }
    meta.background = await backgroundSignature(s);
    meta.transition = await signature(s.transition);
    meta.notes = await signature(s.notes);
  }
  const data = b64(bytes);
  deck.pptxSources = [
    {
      id: source,
      deckId: deck.id,
      data,
      nodes,
      slides: deck.slides.map((s) => ({ path: s.pptxSource!.path, id: s.id })),
    },
  ];
}

// Only passive Office relationships are copied. Office macros, ActiveX and
// embedded OLE executables never become newly enabled through a PPTX save.
const allowed = (type: string, target: string) =>
  /\/(?:slideLayout|slideMaster|notesSlide|notesMaster|theme|themeOverride|image|audio|video|media|chart|chartUserShapes|chartStyle|chartColorStyle|diagramData|diagramLayout|diagramQuickStyle|diagramColors|diagramDrawing|tags|comments|commentAuthors|hyperlink|slide|font|presProps|viewProps)$/.test(
    type,
  ) ||
  (/\/package$/.test(type) && /\.xlsx$/i.test(target));
const active = (path: string, type = "") =>
  /(?:vbaProject|activeX|oleObject|control|attachedTemplate|customUI|macroEnabled)/i.test(
    path + " " + type,
  );
interface Source {
  meta: PptxSourcePackage;
  pkg: PptxPackage;
  types: Map<string, string>;
  styles: Map<string, string>;
}
function typeMap(doc: Document) {
  const defaults = new Map(
    all(doc, "Default").map((n) => [
      n.getAttribute("Extension")!.toLowerCase(),
      n.getAttribute("ContentType")!,
    ]),
  );
  const overrides = new Map(
    all(doc, "Override").map((n) => [
      n.getAttribute("PartName")!.replace(/^\//, ""),
      n.getAttribute("ContentType")!,
    ]),
  );
  return { defaults, overrides };
}
function cleanActive(root: Element, warn: (message: string) => void) {
  let keep = true;
  for (const node of [root, ...all(root, "oleObj"), ...all(root, "control")]) {
    if (!["oleObj", "control"].includes(node.localName)) continue;
    let outer = node;
    while (
      outer.parentElement &&
      !["spTree", "grpSp"].includes(outer.parentElement.localName)
    )
      outer = outer.parentElement;
    if (outer === root) keep = false;
    outer.remove();
    warn("매크로·ActiveX·OLE 개체는 저장 파일에 포함하지 않습니다.");
  }
  return keep;
}
function dropReference(node: Element, attribute: Attr): Element | undefined {
  if (attribute.ownerElement !== node) return;
  node.removeAttributeNode(attribute);
  let removed: Element | undefined;
  if (
    [
      "hlinkClick",
      "hlinkMouseOver",
      "audioFile",
      "videoFile",
      "svgBlip",
      "contentPart",
      "sld",
    ].includes(node.localName)
  )
    removed = node;
  else if (["sndTgt", "snd"].includes(node.localName)) {
    let parent: Element | null = node;
    while (parent && !["audio", "sndAc"].includes(parent.localName))
      parent = parent.parentElement;
    removed = parent ?? node;
  } else if (node.localName === "blip") {
    if (Array.from(node.attributes).some((a) => a.namespaceURI === REL_NS))
      return;
    let parent: Element | null = node;
    while (parent && !["pic", "blipFill"].includes(parent.localName))
      parent = parent.parentElement;
    removed = parent ?? node;
  } else {
    let parent: Element | null = node;
    while (parent && !shapeNames.has(parent.localName))
      parent = parent.parentElement;
    removed = parent ?? node;
  }
  removed.remove();
  return removed;
}

function sourceNode(doc: Document, index: number) {
  return all(doc, "spTree")[0]?.children[index];
}
function setChild(parent: Element, name: string, replacement?: Element) {
  const previous = child(parent, name);
  if (previous) {
    if (replacement) previous.replaceWith(replacement);
    else previous.remove();
  } else if (replacement) {
    const before =
      name === "xfrm"
        ? parent.firstChild
        : name === "srcRect"
          ? (child(parent, "tile") ?? child(parent, "stretch"))
          : name === "bg"
            ? child(parent, "spTree")
            : null;
    parent.insertBefore(replacement, before ?? null);
  }
}
function remapTargets(root: Element, ids: Map<string, string>) {
  for (const n of [root, ...Array.from(root.getElementsByTagName("*"))]) {
    if (n.hasAttribute("spid")) {
      const id = ids.get(n.getAttribute("spid")!);
      if (id) n.setAttribute("spid", id);
    }
    if (["stCxn", "endCxn"].includes(n.localName)) {
      const id = ids.get(n.getAttribute("id")!);
      if (id) n.setAttribute("id", id);
      else n.remove();
    }
  }
}
function pruneTiming(
  root: Element,
  ids: Map<string, string>,
  warn: (message: string) => void,
) {
  for (const target of Array.from(root.getElementsByTagName("*"))) {
    if (!target.hasAttribute("spid")) continue;
    const id = ids.get(target.getAttribute("spid")!);
    if (id) {
      target.setAttribute("spid", id);
      continue;
    }
    // Remove the action, build entry or condition belonging to a deleted
    // object, without deleting unrelated sibling animations or audio.
    let action: Element | null = target;
    while (
      action &&
      action !== root &&
      !/^(?:anim.*|set|cmd|video|audio|bld.*|cond)$/.test(action.localName)
    )
      action = action.parentElement;
    if (action && action !== root) action.remove();
    else {
      target.remove();
      warn("삭제되거나 분리된 개체를 가리키는 애니메이션 참조를 제외했습니다.");
    }
  }
}

/** Transplant native source objects and their reachable OPC parts into the
 * generated package. The result contains standard Office parts, never a
 * hidden copy of the editor document or the original archive. */
export async function writePreservedPptx(
  zip: JSZip,
  deck: Deck,
  warn: (message: string) => void,
) {
  for (const loss of deck.pptxLosses ?? []) warn(loss);
  if (!deck.pptxSources?.length) return;
  const sources = new Map<string, Source>();
  for (const meta of deck.pptxSources) {
    const pkg = await openPptxPackage(decode(meta.data));
    const ct = await pkg.readXml("[Content_Types].xml");
    if (!ct) throw Error("보관한 원본 PPTX의 파일 형식이 누락되었습니다.");
    const { defaults, overrides } = typeMap(ct);
    const types = new Map(
      [...pkg.partSizes.keys()].map((path) => [
        path,
        overrides.get(path) ??
          defaults.get(path.split(".").pop()!.toLowerCase()) ??
          "",
      ]),
    );
    sources.set(meta.id, { meta, pkg, types, styles: new Map() });
  }
  const ct = xmlDocument(
    await zip.file("[Content_Types].xml")!.async("string"),
    "[Content_Types].xml",
  );
  const presentation = xmlDocument(
    await zip.file("ppt/presentation.xml")!.async("string"),
    "ppt/presentation.xml",
  );
  const presentationRels = xmlDocument(
    await zip.file("ppt/_rels/presentation.xml.rels")!.async("string"),
    "presentation relationships",
  );
  // Table style IDs belong to the presentation, rather than a slide graph.
  // Merge native definitions and remap collisions between different sources.
  const tableStylePath = "ppt/tableStyles.xml";
  const tableStyleFile = zip.file(tableStylePath);
  const tableStyles = tableStyleFile
    ? xmlDocument(await tableStyleFile.async("string"), tableStylePath)
    : xmlDocument(
        `<a:tblStyleLst xmlns:a="${A}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`,
        tableStylePath,
      );
  let addedTableStyles = false;
  for (const source of sources.values()) {
    const rootRels = await source.pkg.readXml("_rels/.rels");
    const office = all(rootRels, "Relationship").find((r) =>
      r.getAttribute("Type")?.endsWith("/officeDocument"),
    );
    const main = office && resolvePart("", office.getAttribute("Target")!);
    const mainRels = main && (await source.pkg.readXml(relsPath(main)));
    const styleRel = all(mainRels || undefined, "Relationship").find((r) =>
      r.getAttribute("Type")?.endsWith("/tableStyles"),
    );
    const stylePart =
      styleRel && main && resolvePart(main, styleRel.getAttribute("Target")!);
    const styles = stylePart && (await source.pkg.readXml(stylePart));
    for (const style of all(styles || undefined, "tblStyle")) {
      const old = style.getAttribute("styleId");
      if (!old) continue;
      const existing = all(tableStyles, "tblStyle").find(
        (n) => n.getAttribute("styleId") === old,
      );
      let id = old;
      if (existing && serial(existing) !== serial(style))
        id = "{" + crypto.randomUUID().toUpperCase() + "}";
      source.styles.set(old, id);
      if (!existing || id !== old) {
        const copy = tableStyles.importNode(style, true);
        copy.setAttribute("styleId", id);
        tableStyles.documentElement.append(copy);
        addedTableStyles = true;
      }
    }
  }
  if (addedTableStyles) {
    zip.file(tableStylePath, serial(tableStyles));
    if (
      !all(presentationRels, "Relationship").some((r) =>
        r.getAttribute("Type")?.endsWith("/tableStyles"),
      )
    ) {
      const r = presentationRels.createElementNS(PR, "Relationship");
      r.setAttribute("Id", "rIdPreservedTableStyles");
      r.setAttribute("Type", REL_NS + "/tableStyles");
      r.setAttribute("Target", "tableStyles.xml");
      presentationRels.documentElement.append(r);
      const type = ct.createElementNS(CT, "Override");
      type.setAttribute("PartName", "/" + tableStylePath);
      type.setAttribute(
        "ContentType",
        "application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml",
      );
      ct.documentElement.append(type);
    }
  }
  const remapStyles = (node: Element | Document, id: string) => {
    for (const n of all(node, "tableStyleId")) {
      const mapped = sources.get(id)?.styles.get(n.textContent ?? "");
      if (mapped) n.textContent = mapped;
    }
  };
  const media = new Map<string, string>();
  const templates = new Map<string, string>();
  const globalsCopied = new Set<string>();
  let partCount = 0,
    expanded = 0;
  const addType = (path: string, type: string) => {
    const n = ct.createElementNS(CT, "Override");
    n.setAttribute("PartName", "/" + path);
    n.setAttribute("ContentType", type);
    ct.documentElement.append(n);
  };
  const registerMaster = (path: string) => {
    if (
      all(presentationRels, "Relationship").some(
        (r) => r.getAttribute("Target") === "/" + path,
      )
    )
      return;
    const rid = "rIdPreservedMaster" + crypto.randomUUID();
    const r = presentationRels.createElementNS(PR, "Relationship");
    r.setAttribute("Id", rid);
    r.setAttribute("Type", REL_NS + "/slideMaster");
    r.setAttribute("Target", "/" + path);
    presentationRels.documentElement.append(r);
    let list = child(presentation.documentElement, "sldMasterIdLst");
    if (!list) {
      list = presentation.createElementNS(P, "p:sldMasterIdLst");
      presentation.documentElement.insertBefore(
        list,
        presentation.documentElement.firstChild,
      );
    }
    const n = presentation.createElementNS(P, "p:sldMasterId");
    const max = Math.max(
      2147483647,
      ...all(presentation, "sldMasterId").map((n) =>
        Number(n.getAttribute("id")),
      ),
    );
    n.setAttribute("id", String(max + 1));
    n.setAttributeNS(REL_NS, "r:id", rid);
    list.append(n);
  };
  for (const [slideIndex, slide] of deck.slides.entries()) {
    const meta = slide.pptxSource;
    const relevant = new Set(
      [meta?.source, ...slide.elements.map((e) => e.pptxRef?.source)].filter(
        (s): s is string => !!s,
      ),
    );
    if (!relevant.size) continue;
    const path = `ppt/slides/slide${slideIndex + 1}.xml`;
    const generated = xmlDocument(await zip.file(path)!.async("string"), path);
    const generatedRels = xmlDocument(
      await zip.file(relsPath(path))!.async("string"),
      relsPath(path),
    );
    const tree = all(generated, "spTree")[0];
    const originalIds = new Map<Element, string>(),
      originalPriority = new Map<Element, number>(),
      genIds = new Map<Element, string>();
    for (const p of all(generated, "cNvPr"))
      genIds.set(p, p.getAttribute("id")!);
    const generatedTiming = child(
      generated.documentElement,
      "timing",
    )?.cloneNode(true) as Element | undefined;
    child(generated.documentElement, "timing")?.remove();
    const sourceIds = new Map<string, string>();
    const removed = new Map<string, Set<number>>();
    const sourceDocs = new Map<string, Document>();
    const copied = new Map<string, string>();
    const relationshipIds = new Map<string, string>();
    const prefix = `ppt/retained/${crypto.randomUUID()}`;
    let relIndex = 0;
    const sourceAt = (id: string) => {
      const s = sources.get(id);
      if (!s)
        throw Error("원본 PPTX 데이터가 없어 안전하게 저장할 수 없습니다.");
      return s;
    };
    const docAt = async (id: string, path: string) => {
      const k = id + ":" + path;
      if (!sourceDocs.has(k)) {
        const doc = await sourceAt(id).pkg.readXml(path);
        if (!doc) throw Error("보관한 원본 PPTX의 일부가 누락되었습니다.");
        sourceDocs.set(k, doc.cloneNode(true) as Document);
      }
      return sourceDocs.get(k)!;
    };
    const nativeSlideTarget = (
      source: Source,
      target: string,
      preferCurrent = true,
    ) => {
      if (
        preferCurrent &&
        meta?.source === source.meta.id &&
        meta.path === target
      )
        return `ppt/slides/slide${slideIndex + 1}.xml`;
      const original = source.meta.slides.find((s) => s.path === target);
      let index = deck.slides.findIndex((s) => s.id === original?.id);
      if (index < 0)
        index = deck.slides.findIndex(
          (s) =>
            s.pptxSource?.source === source.meta.id &&
            s.pptxSource.path === target,
        );
      return index < 0 ? undefined : `ppt/slides/slide${index + 1}.xml`;
    };
    const nativeRootRels = meta
      ? await sourceAt(meta.source).pkg.readXml(relsPath(meta.path))
      : undefined;
    const nativeLayout = all(nativeRootRels, "Relationship").find((r) =>
      r.getAttribute("Type")?.endsWith("/slideLayout"),
    );
    const templateScope =
      meta && nativeLayout
        ? (resolvePart(meta.path, nativeLayout.getAttribute("Target") ?? "") ??
          "")
        : "";
    const clonePart = async (
      id: string,
      part: string,
    ): Promise<string | undefined> => {
      const source = sourceAt(id),
        cacheKey = id + ":" + part;
      if (copied.has(cacheKey)) return copied.get(cacheKey)!;
      if (active(part, source.types.get(part))) {
        warn("매크로·ActiveX·OLE 첨부 파일은 저장 파일에 포함하지 않습니다.");
        return;
      }
      const type = source.types.get(part);
      if (!type)
        throw Error("원본 PPTX 첨부 파일의 형식을 찾을 수 없습니다: " + part);
      const binaryMedia = /^(?:image|audio|video)\//.test(type);
      if (binaryMedia && media.has(cacheKey)) return media.get(cacheKey)!;
      const template =
        /presentationml\.(?:slideMaster|slideLayout|notesMaster)\+xml$/.test(
          type,
        );
      const theme = /(?:officedocument\.theme|themeOverride)\+xml$/.test(type);
      const templateKey =
        template || theme
          ? cacheKey +
            (theme || type.includes("notesMaster")
              ? ""
              : ":" +
                templateScope +
                ":" +
                [...removed]
                  .map(([k, v]) => k + "=" + [...v].sort().join(","))
                  .sort()
                  .join(";"))
          : undefined;
      if (templateKey && templates.has(templateKey))
        return templates.get(templateKey)!;
      const target =
        prefix + "/part" + partCount + "." + (part.split(".").pop() ?? "bin");
      copied.set(cacheKey, target);
      if (templateKey) templates.set(templateKey, target);
      if (++partCount > 5000)
        throw Error("보존할 원본 PPTX 첨부 파일이 너무 많습니다.");
      const bytes = await source.pkg.readBytes(part);
      if (!bytes) throw Error("원본 PPTX 첨부 파일이 누락되었습니다: " + part);
      expanded += bytes.length;
      if (expanded > MAX_EXPANDED)
        throw Error("보존할 원본 PPTX 데이터가 200 MiB를 초과합니다.");
      let doc: Document | undefined;
      if (!binaryMedia && (/\.xml$/i.test(part) || /\+xml$/.test(type))) {
        doc = await docAt(id, part);
        const sourceTree = all(doc, "spTree")[0];
        const indexes = removed.get(cacheKey);
        if (sourceTree && indexes)
          Array.from(sourceTree.children).forEach((n, i) => {
            if (indexes.has(i)) n.remove();
          });
        cleanActive(doc.documentElement, warn);
        remapStyles(doc, id);
      }
      const relDoc = await source.pkg.readXml(relsPath(part));
      if (relDoc) {
        const result = xmlDocument(
          `<Relationships xmlns="${PR}"/>`,
          "preserved relationships",
        );
        for (const old of all(relDoc, "Relationship")) {
          const rel = old.cloneNode(true) as Element,
            relType = rel.getAttribute("Type") ?? "",
            raw = rel.getAttribute("Target") ?? "";
          if (!allowed(relType, raw) || active(raw, relType)) {
            warn(
              "지원하지 않는 첨부 관계를 제외했습니다: " +
                relType.split("/").pop(),
            );
            continue;
          }
          if (rel.getAttribute("TargetMode") === "External") {
            let url: URL;
            try {
              url = new URL(raw);
            } catch {
              warn("지원하지 않는 외부 주소의 첨부 관계를 제외했습니다.");
              continue;
            }
            if (
              !relType.endsWith("/hyperlink") ||
              !["http:", "https:"].includes(url.protocol) ||
              url.username ||
              url.password
            ) {
              warn(
                "외부 연결 미디어·첨부 파일은 저장 파일에 포함하지 않습니다.",
              );
              continue;
            }
          } else {
            const resolved = resolvePart(part, raw);
            if (!resolved) throw Error("원본 PPTX 첨부 경로가 잘못되었습니다.");
            // Keep only the current layout in a cloned master's layout list.
            if (relType.endsWith("/slideLayout") && meta) {
              const layoutRel = await sourceAt(meta.source).pkg.readXml(
                relsPath(meta.path),
              );
              const layout = all(layoutRel, "Relationship").find((r) =>
                r.getAttribute("Type")?.endsWith("/slideLayout"),
              );
              const current =
                layout &&
                resolvePart(meta.path, layout.getAttribute("Target")!);
              if (current && resolved !== current) {
                for (const n of all(doc, "sldLayoutId"))
                  if (n.getAttributeNS(REL_NS, "id") === rel.getAttribute("Id"))
                    n.remove();
                continue;
              }
            }
            const destination = relType.endsWith("/slide")
              ? nativeSlideTarget(source, resolved)
              : await clonePart(id, resolved);
            if (!destination) {
              warn(
                "삭제되었거나 보존할 수 없는 첨부 대상을 가리키는 관계를 제외했습니다.",
              );
              continue;
            }
            rel.setAttribute("Target", "/" + destination);
          }
          result.documentElement.append(result.importNode(rel, true));
        }
        if (doc) {
          const ids = new Set(
            all(result, "Relationship").map((r) => r.getAttribute("Id")),
          );
          for (const n of Array.from(doc.getElementsByTagName("*")))
            for (const a of Array.from(n.attributes))
              if (a.namespaceURI === REL_NS && !ids.has(a.value))
                dropReference(n, a);
        }
        zip.file(relsPath(target), serial(result));
      }
      zip.file(target, doc ? serial(doc) : bytes);
      addType(target, type);
      if (binaryMedia) media.set(cacheKey, target);
      if (
        /\/slideMaster\+xml$/.test(type) ||
        /presentationml\.slideMaster\+xml$/.test(type)
      )
        registerMaster(target);
      return target;
    };
    const copyRelationships = async (
      root: Element,
      id: string,
      part: string,
      destinationRels: Document = generatedRels,
    ) => {
      const source = sourceAt(id),
        rels = all(await source.pkg.readXml(relsPath(part)), "Relationship");
      remapStyles(root, id);
      let keep = true;
      const drop = (node: Element, attribute: Attr) => {
        if (dropReference(node, attribute) === root) keep = false;
      };
      for (const node of [
        root,
        ...Array.from(root.getElementsByTagName("*")),
      ]) {
        for (const attribute of Array.from(node.attributes)) {
          if (attribute.namespaceURI !== REL_NS) continue;
          const rid = attribute.value,
            cacheKey =
              id +
              ":" +
              part +
              ":" +
              rid +
              (destinationRels === presentationRels ? ":presentation" : "");
          if (relationshipIds.has(cacheKey)) {
            node.setAttributeNS(
              REL_NS,
              attribute.name,
              relationshipIds.get(cacheKey)!,
            );
            continue;
          }
          const old = rels.find((r) => r.getAttribute("Id") === rid);
          if (!old) {
            drop(node, attribute);
            warn("대상 파일이 없는 원본 관계를 제외했습니다.");
            continue;
          }
          const rel = old.cloneNode(true) as Element,
            type = rel.getAttribute("Type") ?? "",
            raw = rel.getAttribute("Target") ?? "";
          let target: string | undefined;
          if (!allowed(type, raw) || active(raw, type)) {
            drop(node, attribute);
            warn(
              "매크로·ActiveX·OLE 및 지원하지 않는 첨부 관계를 제외했습니다.",
            );
            continue;
          }
          if (rel.getAttribute("TargetMode") === "External") {
            let url: URL;
            try {
              url = new URL(raw);
            } catch {
              drop(node, attribute);
              warn("지원하지 않는 외부 주소의 첨부 관계를 제외했습니다.");
              continue;
            }
            if (
              !type.endsWith("/hyperlink") ||
              !["http:", "https:"].includes(url.protocol) ||
              url.username ||
              url.password
            ) {
              drop(node, attribute);
              warn(
                "외부 연결 미디어·첨부 파일은 저장 파일에 포함하지 않습니다.",
              );
              continue;
            }
            target = raw;
          } else {
            const resolved = resolvePart(part, raw);
            if (resolved)
              target = type.endsWith("/slide")
                ? nativeSlideTarget(
                    source,
                    resolved,
                    destinationRels !== presentationRels,
                  )
                : await clonePart(id, resolved);
            if (target) target = "/" + target;
          }
          if (!target) {
            const deletedShowEntry =
              type.endsWith("/slide") &&
              node.localName === "sld" &&
              node.parentElement?.localName === "sldLst";
            drop(node, attribute);
            if (!deletedShowEntry)
              warn("대상을 보존할 수 없는 원본 첨부 관계를 제외했습니다.");
            continue;
          }
          let newId: string;
          do {
            newId = "rIdPreserved" + ++relIndex;
          } while (
            all(destinationRels, "Relationship").some(
              (r) => r.getAttribute("Id") === newId,
            )
          );
          rel.setAttribute("Id", newId);
          rel.setAttribute("Target", target);
          destinationRels.documentElement.append(
            destinationRels.importNode(rel, true),
          );
          relationshipIds.set(cacheKey, newId);
          node.setAttributeNS(REL_NS, attribute.name, newId);
        }
      }
      return keep;
    };
    // Preserve presentation-level font embeddings, custom slide shows and
    // show settings only for their original document, not for pasted slides.
    const primary = [...sources.values()].find(
      (s) => s.meta.deckId === deck.id,
    );
    if (primary && !globalsCopied.has(primary.meta.id)) {
      globalsCopied.add(primary.meta.id);
      const rootRels = all(
        await primary.pkg.readXml("_rels/.rels"),
        "Relationship",
      );
      const office = rootRels.find((r) =>
        r.getAttribute("Type")?.endsWith("/officeDocument"),
      );
      const main = office && resolvePart("", office.getAttribute("Target")!);
      if (main) {
        const original = await primary.pkg.readXml(main);
        if (!original) throw Error("보관한 원본 프레젠테이션 정보가 없습니다.");
        for (const name of [
          "embeddedFontLst",
          "custShowLst",
          "photoAlbum",
          "kinsoku",
          "extLst",
        ]) {
          const native = child(original.documentElement, name);
          if (!native) continue;
          const copy = presentation.importNode(native, true);
          await copyRelationships(
            copy,
            primary.meta.id,
            main,
            presentationRels,
          );
          if (name === "custShowLst") {
            for (const show of all(copy, "custShow"))
              if (!all(show, "sld").length) show.remove();
            if (!all(copy, "custShow").length) continue;
          }
          if (name === "extLst") {
            const sourceRels = all(
              await primary.pkg.readXml(relsPath(main)),
              "Relationship",
            );
            const mapped = new Map<string, string>();
            for (const n of Array.from(
              child(original.documentElement, "sldIdLst")?.children ?? [],
            )) {
              const rel = sourceRels.find(
                  (r) =>
                    r.getAttribute("Id") === n.getAttributeNS(REL_NS, "id"),
                ),
                part =
                  rel && resolvePart(main, rel.getAttribute("Target") ?? "");
              const target = part && nativeSlideTarget(primary, part, false);
              const index = target
                ? Number(target.match(/slide(\d+)\.xml$/)?.[1]) - 1
                : -1;
              const newId =
                index >= 0
                  ? child(presentation.documentElement, "sldIdLst")?.children[
                      index
                    ]?.getAttribute("id")
                  : undefined;
              if (newId) mapped.set(n.getAttribute("id")!, newId);
            }
            for (const n of all(copy, "sldId")) {
              const id = mapped.get(n.getAttribute("id") ?? "");
              if (id) n.setAttribute("id", id);
              else n.remove();
            }
            for (const n of all(copy, "section"))
              if (!all(n, "sldId").length) n.remove();
            setChild(presentation.documentElement, "extLst", copy);
          } else {
            const next =
              child(presentation.documentElement, "defaultTextStyle") ??
              child(presentation.documentElement, "extLst");
            presentation.documentElement.insertBefore(copy, next ?? null);
          }
        }
        const rels = all(
          await primary.pkg.readXml(relsPath(main)),
          "Relationship",
        );
        for (const old of rels.filter((r) =>
          /\/(?:presProps|viewProps|commentAuthors)$/.test(
            r.getAttribute("Type") ?? "",
          ),
        )) {
          const type = old.getAttribute("Type")!,
            resolved = resolvePart(main, old.getAttribute("Target") ?? "");
          if (!resolved || old.getAttribute("TargetMode") === "External")
            continue;
          const target = await clonePart(primary.meta.id, resolved);
          if (!target) continue;
          for (const previous of all(presentationRels, "Relationship").filter(
            (r) => r.getAttribute("Type") === type,
          ))
            previous.remove();
          const rel = presentationRels.importNode(old, true);
          rel.setAttribute("Id", "rIdPreservedProperty" + crypto.randomUUID());
          rel.setAttribute("Target", "/" + target);
          presentationRels.documentElement.append(rel);
        }
      }
    }
    const nativeElements = new Map<Element, SlideElement>();
    const markNative = (
      node: Element,
      part: string,
      elements: SlideElement[] = [],
    ) => {
      if (part !== meta?.path) return;
      for (const p of all(node, "cNvPr")) {
        const shape = p.getAttribute("id")!;
        originalIds.set(p, shape);
        const e =
          elements.find((e) => e.pptxRef?.shape === shape) ??
          (p === props(node) ? elements[0] : undefined);
        if (e) nativeElements.set(p, e);
        originalPriority.set(p, e?.id === e?.pptxRef?.instance ? 2 : 1);
      }
    };
    const originals = new Map<
      string,
      { id: string; node: Element; metadata: PptxSourceNode }
    >();
    const requestedNodes = new Set(
      slide.elements.flatMap((e) =>
        e.pptxRef
          ? [e.pptxRef.source + ":" + nodeKey(e.pptxRef.part, e.pptxRef.index)]
          : [],
      ),
    );
    for (const id of relevant) {
      const source = sourceAt(id);
      for (const n of source.meta.nodes) {
        if (!requestedNodes.has(id + ":" + nodeKey(n.part, n.index))) continue;
        const raw = sourceNode(await docAt(id, n.part), n.index);
        if (raw)
          originals.set(id + ":" + nodeKey(n.part, n.index), {
            id,
            node: raw,
            metadata:
              meta?.source === id
                ? (meta.nodes.find(
                    (m) => m.part === n.part && m.index === n.index,
                  ) ?? n)
                : n,
          });
      }
    }
    const used = new Set<string>();
    const residuals = new Set<string>();
    const restoredCompounds = new Set<string>();
    for (const node of Array.from(tree.children)) {
      if (node.parentElement !== tree) continue;
      const elements = all(node, "cNvPr").flatMap((p) => {
        const e = slide.elements.find((e) => e.id === key(p));
        return e ? [e] : [];
      });
      if (!elements.length) continue;
      const ref = elements[0].pptxRef;
      const sourceKey = ref && ref.source + ":" + nodeKey(ref.part, ref.index),
        original = sourceKey && originals.get(sourceKey);
      if (
        !ref ||
        !original ||
        elements.some(
          (e) =>
            e.pptxRef?.source !== ref.source ||
            e.pptxRef.part !== ref.part ||
            e.pptxRef.index !== ref.index,
        )
      )
        continue;
      // SmartArt and some alternate-content fallbacks are exposed as several
      // editable siblings. Compare the whole binding before deciding that the
      // native compound object was edited; a single fragment is not that edit.
      if (
        original.metadata.count > elements.length &&
        !restoredCompounds.has(sourceKey!)
      ) {
        const full = slide.elements.filter(
          (e) =>
            e.pptxRef?.source === ref.source &&
            e.pptxRef.part === ref.part &&
            e.pptxRef.index === ref.index,
        );
        if (
          full.length === original.metadata.count &&
          (await elementSignature(full)) === original.metadata.signature
        ) {
          const siblings = Array.from(tree.children);
          const candidates = siblings.filter((sibling) => {
            const members = all(sibling, "cNvPr").flatMap((p) => {
              const e = slide.elements.find((e) => e.id === key(p));
              return e ? [e] : [];
            });
            return members.length > 0 && members.every((e) => full.includes(e));
          });
          const first = siblings.indexOf(candidates[0]),
            last = siblings.indexOf(candidates[candidates.length - 1]);
          if (candidates.length && last - first + 1 === candidates.length) {
            const inherited =
              meta?.source === ref.source && meta.path !== ref.part;
            if (inherited) {
              for (const sibling of candidates) sibling.remove();
            } else {
              const native = generated.importNode(original.node, true);
              if (
                !cleanActive(native, warn) ||
                !(await copyRelationships(native, ref.source, ref.part))
              )
                continue;
              markNative(native, ref.part, full);
              candidates[0].replaceWith(native);
              for (const sibling of candidates.slice(1)) sibling.remove();
            }
            used.add(sourceKey!);
            restoredCompounds.add(sourceKey!);
            continue;
          }
        }
      }
      const fixedFields = new Set(
        elements
          .filter((e) => {
            if (e.type !== "text" || e.field !== undefined) return false;
            const p = all(original.node, "cNvPr").find(
                (p) => p.getAttribute("id") === e.pptxRef?.shape,
              ),
              raw = p?.parentElement?.parentElement;
            return all(raw, "fld").some(
              (n) => n.getAttribute("type") === "slidenum",
            );
          })
          .map((e) => e.id),
      );
      if (fixedFields.size)
        warn(
          "1 이외의 시작 번호를 사용하는 슬라이드 번호는 자동 번호 대신 표시된 고정 텍스트로 저장합니다.",
        );
      const unchanged =
        !fixedFields.size &&
        elements.length === original.metadata.count &&
        !elements.some((e) => e.borders || e.type === "table") &&
        (await elementSignature(elements)) === original.metadata.signature;
      const inherited =
        !!meta && ref.source === meta.source && ref.part !== meta.path;
      if (unchanged) {
        if (inherited) {
          node.remove();
          used.add(sourceKey!);
          continue;
        }
        const native = generated.importNode(original.node, true);
        const keep = cleanActive(native, warn);
        markNative(native, ref.part, elements);
        if (keep && (await copyRelationships(native, ref.source, ref.part)))
          node.replaceWith(native);
        used.add(sourceKey!);
      } else {
        if (
          original.node.localName === "grpSp" &&
          node.localName === "grpSp" &&
          meta?.path === ref.part
        ) {
          const native = props(original.node),
            current = props(node);
          if (native && current) {
            originalIds.set(current, native.getAttribute("id")!);
            originalPriority.set(current, 2);
          }
        }
        if (inherited) {
          const k = ref.source + ":" + ref.part;
          if (!removed.has(k)) removed.set(k, new Set());
          removed.get(k)!.add(ref.index);
        }
        // Preserve unsupported paint/effects and vector/audio source bytes on
        // ordinary editable leaves while replacing authored text/geometry.
        for (const e of elements) {
          const p = all(node, "cNvPr").find((p) => key(p) === e.id),
            rawProps = all(original.node, "cNvPr").find(
              (p) => p.getAttribute("id") === e.pptxRef?.shape,
            );
          const target = p?.parentElement?.parentElement,
            raw = rawProps?.parentElement?.parentElement;
          if (!p || !target || !raw || target.localName !== raw.localName)
            continue;
          if (e.type === "table") {
            if (e.pptxRef?.content === (await signature(content(e)))) {
              const nativeGraphic = child(raw, "graphic"),
                currentGraphic = child(target, "graphic");
              if (nativeGraphic && currentGraphic) {
                const copy = generated.importNode(nativeGraphic, true);
                for (const name of ["gridCol", "tr"]) {
                  const old = all(copy, name),
                    current = all(currentGraphic, name),
                    attribute = name === "gridCol" ? "w" : "h";
                  old.forEach((n, i) => {
                    const value = current[i]?.getAttribute(attribute);
                    if (value) n.setAttribute(attribute, value);
                  });
                }
                await copyRelationships(copy, ref.source, ref.part);
                currentGraphic.replaceWith(copy);
              }
            } else if (
              unmodeledText(raw) ||
              ["blipFill", "pattFill", "effectLst", "effectDag"].some(
                (name) => all(raw, name).length,
              )
            ) {
              warn(
                "편집한 표의 특수 글자 서식·그림 글머리표·채우기 효과는 완전히 유지하지 못합니다. 원본 표를 확인하세요.",
              );
            }
          }
          // Retain foreign nonvisual extensions without copying our old stable
          // keys or border ownership onto the newly generated editable node.
          for (const attribute of Array.from(rawProps!.attributes))
            if (
              !["id", "name", "hidden"].includes(attribute.localName) &&
              !p.hasAttributeNS(attribute.namespaceURI, attribute.localName)
            )
              p.setAttributeNS(
                attribute.namespaceURI,
                attribute.name,
                attribute.value,
              );
          for (const rawList of Array.from(rawProps!.children).filter(
            (n) => n.localName === "extLst",
          )) {
            let dest = child(p, "extLst");
            for (const extra of Array.from(rawList.children).filter(
              (n) =>
                !Array.from(n.children).some((s) =>
                  s.namespaceURI?.startsWith("urn:slide-studio:"),
                ),
            )) {
              if (!dest) {
                dest = generated.createElementNS(A, "a:extLst");
                p.append(dest);
              }
              if (
                !Array.from(dest.children).some(
                  (n) => n.getAttribute("uri") === extra.getAttribute("uri"),
                )
              ) {
                const copy = generated.importNode(extra, true);
                await copyRelationships(copy, ref.source, ref.part);
                dest.append(copy);
              }
            }
          }
          for (const name of ["nvSpPr", "nvGraphicFramePr"]) {
            const nv = child(raw, name),
              dest = child(target, name),
              nvPr = child(nv, "nvPr");
            if (nvPr && dest) {
              const copy = generated.importNode(nvPr, true);
              await copyRelationships(copy, ref.source, ref.part);
              setChild(dest, "nvPr", copy);
            }
          }
          if (e.pptxRef && e.pptxRef.part === meta?.path) {
            originalIds.set(p, e.pptxRef.shape);
            originalPriority.set(p, e.id === e.pptxRef.instance ? 2 : 1);
          }
          if (e.pptxRef?.paint === (await signature(paint(e)))) {
            const sourcePr = child(raw, "spPr"),
              destPr = child(target, "spPr");
            if (sourcePr && destPr) {
              const preserved = generated.importNode(sourcePr, true);
              const transform = child(destPr, "xfrm");
              setChild(
                preserved,
                "xfrm",
                transform?.cloneNode(true) as Element | undefined,
              );
              await copyRelationships(preserved, ref.source, ref.part);
              destPr.replaceWith(preserved);
            }
          } else {
            const destPr = child(target, "spPr");
            for (const extra of Array.from(
              child(raw, "spPr")?.children ?? [],
            ).filter((n) =>
              ["effectLst", "effectDag", "scene3d", "sp3d", "extLst"].includes(
                n.localName,
              ),
            )) {
              if (destPr && !child(destPr, extra.localName)) {
                const copy = generated.importNode(extra, true);
                await copyRelationships(copy, ref.source, ref.part);
                destPr.append(copy);
              }
            }
          }
          if (
            !fixedFields.has(e.id) &&
            e.pptxRef?.text === (await signature(textModel(e)))
          ) {
            const rawText = child(raw, "txBody");
            if (rawText)
              setChild(target, "txBody", generated.importNode(rawText, true));
          } else {
            if (unmodeledText(raw))
              warn(
                "편집한 텍스트의 취소선·특수 밑줄·강조·그림 글머리표·양쪽 맞춤 등 일부 원본 서식을 유지하지 못합니다.",
              );
            const oldBodyPr = child(child(raw, "txBody"), "bodyPr"),
              newBodyPr = child(child(target, "txBody"), "bodyPr");
            if (oldBodyPr && newBodyPr) {
              for (const extra of Array.from(oldBodyPr.children).filter((n) =>
                ["prstTxWarp", "scene3d", "sp3d", "extLst"].includes(
                  n.localName,
                ),
              ))
                if (!child(newBodyPr, extra.localName))
                  newBodyPr.append(generated.importNode(extra, true));
            }
          }
          if (e.pptxRef?.content === (await signature(content(e)))) {
            const nativeFill = child(raw, "blipFill"),
              destFill = child(target, "blipFill");
            if (nativeFill && destFill) {
              const fill = generated.importNode(nativeFill, true);
              setChild(
                fill,
                "srcRect",
                child(destFill, "srcRect")?.cloneNode(true) as
                  | Element
                  | undefined,
              );
              await copyRelationships(fill, ref.source, ref.part);
              destFill.replaceWith(fill);
            }
            const nv = child(raw, "nvPicPr"),
              destNv = child(target, "nvPicPr");
            if (nv && destNv && child(nv, "nvPr")) {
              const copy = generated.importNode(child(nv, "nvPr")!, true);
              await copyRelationships(copy, ref.source, ref.part);
              setChild(destNv, "nvPr", copy);
            }
          }
        }
        if (original.node.localName === "grpSp" && !residuals.has(sourceKey!)) {
          residuals.add(sourceKey!);
          const residual = generated.importNode(original.node, true);
          const modeled = new Set(
            original.metadata.shapes ?? elements.map((e) => e.pptxRef!.shape),
          );
          const prune = (group: Element) => {
            for (const item of Array.from(group.children)) {
              if (item.localName === "grpSp") {
                prune(item);
                if (
                  !Array.from(item.children).some((n) =>
                    shapeNames.has(n.localName),
                  )
                )
                  item.remove();
              } else if (
                shapeNames.has(item.localName) &&
                modeled.has(props(item)?.getAttribute("id") ?? "")
              )
                item.remove();
            }
          };
          prune(residual);
          if (
            Array.from(residual.children).some((n) =>
              shapeNames.has(n.localName),
            )
          ) {
            markNative(residual, ref.part);
            await copyRelationships(residual, ref.source, ref.part);
            if (node.localName === "grpSp") node.append(residual);
            else tree.insertBefore(residual, node.nextSibling);
            if (
              elements.some(
                (e) =>
                  e.pptxRef?.geometry &&
                  [e.x, e.y, e.width, e.height].some(
                    (v, i) => Math.abs(v - e.pptxRef!.geometry![i]) > 0.01,
                  ),
              )
            )
              warn(
                "위치·크기를 바꾼 그룹 안의 편집 불가능한 개체는 원래 위치로 보존했습니다. 그룹 배치를 확인하세요.",
              );
          }
        } else if (
          ["AlternateContent", "graphicFrame"].includes(
            original.node.localName,
          ) &&
          original.node.localName !== node.localName
        ) {
          warn(
            "편집한 SmartArt·확장 개체는 편집 가능한 도형으로 저장되어, 원본의 자동 배치·확장 기능을 유지하지 못합니다.",
          );
        }
        used.add(sourceKey!);
      }
    }
    if (meta) {
      const source = sourceAt(meta.source),
        original = await docAt(meta.source, meta.path);
      // Native artwork with no editable counterpart is kept in its original
      // relative order; edits to neighboring objects cannot delete it.
      const rawTree = all(original, "spTree")[0];
      for (const [index, raw] of Array.from(rawTree.children).entries()) {
        if (!shapeNames.has(raw.localName)) continue;
        const metadata = meta.nodes.find(
          (n) => n.part === meta.path && n.index === index,
        );
        if (metadata?.count || metadata?.derived) continue;
        if (all(raw, "oleObj").length || all(raw, "control").length) {
          warn("매크로·ActiveX·OLE 개체는 저장 파일에 포함하지 않습니다.");
          continue;
        }
        const native = generated.importNode(raw, true);
        markNative(native, meta.path);
        if (!(await copyRelationships(native, meta.source, meta.path)))
          continue;
        const next = Array.from(tree.children).find((node) =>
          all(node, "cNvPr").some((p) => {
            const e =
              nativeElements.get(p) ??
              slide.elements.find((e) => e.id === key(p));
            return (
              e?.pptxRef?.source === meta.source &&
              e.pptxRef.part === meta.path &&
              e.pptxRef.index > index
            );
          }),
        );
        tree.insertBefore(native, next ?? null);
      }
      // Unchanged inherited art stays in its native layout/master. Modified or
      // deleted inherited art is removed only from this slide's cloned parts.
      for (const n of meta.nodes.filter((n) => n.part !== meta.path))
        if (!used.has(meta.source + ":" + nodeKey(n.part, n.index))) {
          const k = meta.source + ":" + n.part;
          if (!removed.has(k)) removed.set(k, new Set());
          removed.get(k)!.add(n.index);
        }
      const rawRelationships = all(
        await source.pkg.readXml(relsPath(meta.path)),
        "Relationship",
      );
      const layout = rawRelationships.find((r) =>
        r.getAttribute("Type")?.endsWith("/slideLayout"),
      );
      if (layout) {
        const layoutPath = resolvePart(
          meta.path,
          layout.getAttribute("Target")!,
        );
        const destination =
          layoutPath && (await clonePart(meta.source, layoutPath));
        if (destination) {
          all(generatedRels, "Relationship")
            .filter((r) => r.getAttribute("Type")?.endsWith("/slideLayout"))
            .forEach((r) => r.remove());
          const r = generatedRels.createElementNS(PR, "Relationship");
          r.setAttribute("Id", "rIdPreservedLayout");
          r.setAttribute("Type", REL_NS + "/slideLayout");
          r.setAttribute("Target", "/" + destination);
          generatedRels.documentElement.append(r);
        }
      }
      for (const name of ["clrMapOvr", "extLst"]) {
        const native = child(original.documentElement, name);
        if (native) {
          const copy = generated.importNode(native, true);
          await copyRelationships(copy, meta.source, meta.path);
          setChild(generated.documentElement, name, copy);
        }
      }
      for (const name of ["showMasterSp", "showMasterPhAnim"]) {
        if (original.documentElement.hasAttribute(name))
          generated.documentElement.setAttribute(
            name,
            original.documentElement.getAttribute(name)!,
          );
      }
      if (meta.background === (await backgroundSignature(slide))) {
        let bg = child(child(original.documentElement, "cSld"), "bg"),
          bgPart = meta.path;
        if (!bg && layout) {
          const layoutPath = resolvePart(
            meta.path,
            layout.getAttribute("Target")!,
          );
          if (layoutPath) {
            const layoutDoc = await docAt(meta.source, layoutPath);
            bg = child(child(layoutDoc.documentElement, "cSld"), "bg");
            bgPart = layoutPath;
            if (!bg) {
              const masterRel = all(
                await source.pkg.readXml(relsPath(layoutPath)),
                "Relationship",
              ).find((r) => r.getAttribute("Type")?.endsWith("/slideMaster"));
              const masterPath =
                masterRel &&
                resolvePart(layoutPath, masterRel.getAttribute("Target")!);
              if (masterPath) {
                const master = await docAt(meta.source, masterPath);
                bg = child(child(master.documentElement, "cSld"), "bg");
                bgPart = masterPath;
              }
            }
          }
        }
        if (bg) {
          const copy = generated.importNode(bg, true);
          await copyRelationships(copy, meta.source, bgPart);
          setChild(child(generated.documentElement, "cSld")!, "bg", copy);
        }
      }
      if (
        !meta.transitionEdited &&
        meta.transition === (await signature(slide.transition))
      ) {
        const transition = child(original.documentElement, "transition");
        child(generated.documentElement, "transition")?.remove();
        if (transition) {
          const copy = generated.importNode(transition, true);
          await copyRelationships(copy, meta.source, meta.path);
          generated.documentElement.insertBefore(
            copy,
            child(generated.documentElement, "extLst") ?? null,
          );
        }
      }
      if (meta.notes === (await signature(slide.notes))) {
        const notes = rawRelationships.find((r) =>
          r.getAttribute("Type")?.endsWith("/notesSlide"),
        );
        if (notes) {
          const resolved = resolvePart(
            meta.path,
            notes.getAttribute("Target")!,
          );
          const target = resolved && (await clonePart(meta.source, resolved));
          if (target) {
            all(generatedRels, "Relationship")
              .filter((r) => r.getAttribute("Type")?.endsWith("/notesSlide"))
              .forEach((r) => r.remove());
            const rel = generatedRels.importNode(notes, true);
            rel.setAttribute("Id", "rIdPreservedNotes");
            rel.setAttribute("Target", "/" + target);
            generatedRels.documentElement.append(rel);
          }
        }
      }
      const timing = child(original.documentElement, "timing");
      if (timing) {
        const copy = generated.importNode(timing, true);
        await copyRelationships(copy, meta.source, meta.path);
        generated.documentElement.insertBefore(
          copy,
          child(generated.documentElement, "extLst") ?? null,
        );
      }
    }
    const generatedIds = new Map<string, string>(),
      priorities = new Map<string, number>();
    all(generated, "cNvPr").forEach((p, i) => {
      const id = String(i + 1);
      const old = originalIds.get(p);
      if (
        old &&
        (originalPriority.get(p) ?? 0) >= (priorities.get(old) ?? -1)
      ) {
        sourceIds.set(old, id);
        priorities.set(old, originalPriority.get(p) ?? 0);
      }
      const gen = genIds.get(p);
      if (gen) generatedIds.set(gen, id);
      p.setAttribute("id", id);
    });
    remapTargets(tree, sourceIds);
    const timing = child(generated.documentElement, "timing");
    const changedVideos = new Set<string>();
    const generatedVideos = new Set<string>();
    for (const e of slide.elements.filter((e) => e.type === "video")) {
      const ref = e.pptxRef;
      if (
        !ref ||
        ref.playback !== (await signature(playback(e))) ||
        ref.content !== (await signature(content(e)))
      ) {
        const prop = all(generated, "cNvPr").find((p) => key(p) === e.id);
        if (prop) generatedVideos.add(prop.getAttribute("id")!);
        if (ref?.part === meta?.path) changedVideos.add(ref!.shape);
      }
    }
    if (timing) {
      for (const action of [...all(timing, "video"), ...all(timing, "cmd")])
        if (
          all(action, "spTgt").some((t) =>
            changedVideos.has(t.getAttribute("spid")!),
          )
        )
          action.remove();
      pruneTiming(timing, sourceIds, warn);
    }
    if (generatedTiming) {
      // Existing native video timelines remain untouched. Add only new videos;
      // changed playback values replace their old per-video timing action.
      const keep = generatedVideos;
      pruneTiming(generatedTiming, generatedIds, () => {});
      for (const video of all(generatedTiming, "video"))
        if (!all(video, "spTgt").some((t) => keep.has(t.getAttribute("spid")!)))
          video.remove();
      if (all(generatedTiming, "video").length) {
        const max = Math.max(
          0,
          ...all(timing, "cTn").map((n) => Number(n.getAttribute("id")) || 0),
        );
        all(generatedTiming, "cTn").forEach((n) =>
          n.setAttribute(
            "id",
            String((Number(n.getAttribute("id")) || 0) + max),
          ),
        );
        if (timing) {
          const sourceList = all(generatedTiming, "childTnLst")[0],
            destList = all(timing, "childTnLst")[0];
          if (destList && sourceList)
            for (const n of Array.from(sourceList.children)) destList.append(n);
        } else
          generated.documentElement.insertBefore(
            generatedTiming,
            child(generated.documentElement, "extLst") ?? null,
          );
      }
    }
    const referenced = new Set(
      Array.from(generated.getElementsByTagName("*")).flatMap((n) =>
        Array.from(n.attributes)
          .filter((a) => a.namespaceURI === REL_NS)
          .map((a) => a.value),
      ),
    );
    for (const rel of all(generatedRels, "Relationship"))
      if (
        /\/(?:image|chart|audio|video|media|hyperlink)$/.test(
          rel.getAttribute("Type") ?? "",
        ) &&
        !referenced.has(rel.getAttribute("Id")!)
      )
        rel.remove();
    zip.file(path, serial(generated));
    zip.file(relsPath(path), serial(generatedRels));
  }
  zip.file("[Content_Types].xml", serial(ct));
  zip.file("ppt/presentation.xml", serial(presentation));
  zip.file("ppt/_rels/presentation.xml.rels", serial(presentationRels));
  await pruneUnreachable(zip);
  await normalizeMasterIds(zip);
}

// Layout and master IDs share a presentation-wide numeric namespace. Source
// packages commonly reuse 2147483649, including across cloned master parts.
async function normalizeMasterIds(zip: JSZip) {
  let id = 2147483648;
  for (const [path, file] of Object.entries(zip.files)) {
    if (file.dir || !path.endsWith(".xml")) continue;
    const text = await file.async("string");
    if (!text.includes("sldMasterId") && !text.includes("sldLayoutId"))
      continue;
    const doc = xmlDocument(text, path);
    for (const n of [...all(doc, "sldMasterId"), ...all(doc, "sldLayoutId")])
      n.setAttribute("id", String(id++));
    zip.file(path, serial(doc));
  }
}

async function pruneUnreachable(zip: JSZip) {
  const reachable = new Set(["[Content_Types].xml"]),
    visited = new Set<string>();
  async function visit(path: string) {
    if (visited.has(path)) return;
    visited.add(path);
    if (path) {
      if (!zip.file(path))
        throw Error("저장할 PPTX의 첨부 관계가 끊어졌습니다: " + path);
      reachable.add(path);
    }
    const relPath = relsPath(path),
      file = zip.file(relPath);
    if (!file) return;
    reachable.add(relPath);
    const rels = xmlDocument(await file.async("string"), relPath);
    for (const rel of all(rels, "Relationship")) {
      if (rel.getAttribute("TargetMode") === "External") continue;
      const target = resolvePart(path, rel.getAttribute("Target") ?? "");
      if (!target) throw Error("저장할 PPTX의 첨부 경로가 잘못되었습니다.");
      await visit(target);
    }
  }
  await visit("");
  for (const [path, file] of Object.entries(zip.files))
    if (!file.dir && !reachable.has(path)) zip.remove(path);
  const ct = xmlDocument(
    await zip.file("[Content_Types].xml")!.async("string"),
    "content types",
  );
  for (const n of all(ct, "Override"))
    if (!reachable.has(n.getAttribute("PartName")!.replace(/^\//, "")))
      n.remove();
  zip.file("[Content_Types].xml", serial(ct));
}
