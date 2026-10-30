import DOMPurify from "dompurify";
import { rasterMime } from "./image-format";
import { bytesDataUrl } from "./video";

const SVG = "http://www.w3.org/2000/svg";
export const MAX_SVG_BYTES = 4 * 1024 * 1024;
const MAX_NODES = 20000;
const MAX_SIDE = 2048;
const MAX_CACHE_CHARS = 8 * 1024 * 1024;
const cache = new Map<string, string>();
let cacheChars = 0;

function remember(key: string, source: string) {
  const size = key.length + source.length;
  if (size > MAX_CACHE_CHARS) return source;
  while (
    cache.size &&
    (cacheChars + size > MAX_CACHE_CHARS || cache.size >= 32)
  ) {
    const oldest = cache.keys().next().value!;
    cacheChars -= oldest.length + cache.get(oldest)!.length;
    cache.delete(oldest);
  }
  cache.set(key, source);
  cacheChars += size;
  return source;
}

// CSS is limited to static SVG styling. Only document-local URL references are
// allowed; @rules, escaped URLs and external fonts/images cannot escape <img>.
function localValue(value: string) {
  if (/[\\\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) return false;
  const plain = value.replace(/\/\*[\s\S]*?\*\//g, "");
  if (/@|expression\s*\(|(?:https?|file|javascript|data|blob):/i.test(plain))
    return false;
  return !plain
    .replace(/url\(\s*(["']?)#[^\s"'()<>]+\1\s*\)/gi, "")
    .match(/url\s*\(/i);
}
function staticStyle(style: CSSStyleDeclaration) {
  const values: string[] = [];
  for (const name of Array.from(style)) {
    if (
      /^(?:animation|transition|behavior|cursor|content|-moz-binding)/i.test(
        name,
      )
    )
      continue;
    const value = style.getPropertyValue(name);
    if (localValue(value))
      values.push(
        `${name}:${value}${style.getPropertyPriority(name) ? " !important" : ""}`,
      );
  }
  return values.join(";");
}
function cssText(text: string) {
  if (text.length > 512 * 1024 || /[\\@]/.test(text)) return "";
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(text);
    return Array.from(sheet.cssRules)
      .flatMap((rule) => {
        if (!(rule instanceof CSSStyleRule) || !localValue(rule.selectorText))
          return [];
        const style = staticStyle(rule.style);
        return style ? [`${rule.selectorText}{${style}}`] : [];
      })
      .join("\n");
  } catch {
    return "";
  }
}
function localImage(value: string) {
  const match =
    /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(
      value,
    );
  if (!match || match[2].length % 4 || value.length > MAX_SVG_BYTES)
    return false;
  try {
    const head = atob(match[2].slice(0, 24));
    return (
      rasterMime(Uint8Array.from(head, (c) => c.charCodeAt(0))) ===
      match[1].toLowerCase()
    );
  } catch {
    return false;
  }
}
function length(value: string | null) {
  const match = /^([+]?(?:\d+(?:\.\d*)?|\.\d+))(px|pt|pc|in|cm|mm)?$/i.exec(
    value?.trim() ?? "",
  );
  if (!match) return undefined;
  const scale: Record<string, number> = {
    px: 1,
    pt: 96 / 72,
    pc: 16,
    in: 96,
    cm: 96 / 2.54,
    mm: 96 / 25.4,
  };
  const n = Number(match[1]) * (scale[match[2]?.toLowerCase()] ?? 1);
  return Number.isFinite(n) && n > 0 && n <= 1e9 ? n : undefined;
}

/** SVG is always an isolated image, never inserted into the application DOM.
 * Source PPTX bytes remain opaque in the preservation package; this canonical,
 * static copy alone is rendered, autosaved, pasted and newly exported. */
export function svgImage(bytes: Uint8Array): string {
  if (!bytes.length || bytes.length > MAX_SVG_BYTES)
    throw Error("SVG 그림은 4MB 이하여야 합니다.");
  let text: string;
  try {
    const encoding =
      bytes[0] === 0xff && bytes[1] === 0xfe
        ? "utf-16le"
        : bytes[0] === 0xfe && bytes[1] === 0xff
          ? "utf-16be"
          : "utf-8";
    text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw Error("SVG 문자 인코딩을 읽을 수 없습니다.");
  }
  const cached = cache.get(text);
  if (cached) return cached;
  // DOMParser does not load external entities. Reject declarations before any
  // parsing nevertheless, including entity-expansion payloads and XML stylesheets.
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(text))
    throw Error("외부 정의가 있는 SVG는 지원하지 않습니다.");
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = doc.documentElement;
  if (
    root.localName !== "svg" ||
    root.namespaceURI !== SVG ||
    doc.querySelector("parsererror")
  )
    throw Error("올바른 SVG 그림이 아닙니다.");
  if (root.getElementsByTagName("*").length > MAX_NODES)
    throw Error("SVG 그림이 너무 복잡합니다.");
  const clean = DOMPurify.sanitize(root, {
    USE_PROFILES: { svg: true, svgFilters: true },
    RETURN_DOM: true,
    FORBID_TAGS: [
      "foreignObject",
      "script",
      "animate",
      "animateMotion",
      "animateTransform",
      "set",
      "discard",
      "a",
    ],
    FORBID_ATTR: ["xml:base", "autofocus", "tabindex"],
    KEEP_CONTENT: true,
  }) as Element;
  const svg = clean.localName === "svg" ? clean : clean.querySelector("svg");
  if (!svg) throw Error("표시할 수 있는 SVG 그림이 아닙니다.");
  for (const node of [svg, ...Array.from(svg.getElementsByTagName("*"))]) {
    if (node.namespaceURI !== SVG) {
      node.remove();
      continue;
    }
    if (node.localName === "style") {
      node.textContent = cssText(node.textContent ?? "");
      continue;
    }
    for (const attribute of Array.from(node.attributes)) {
      const name = attribute.localName.toLowerCase(),
        value = attribute.value.trim();
      if (name.startsWith("on") || name === "base") {
        node.removeAttributeNode(attribute);
        continue;
      }
      if (name === "href") {
        if (
          !/^#[^\s"'<>\\]+$/.test(value) &&
          !(node.localName === "image" && localImage(value))
        )
          node.removeAttributeNode(attribute);
      } else if (name === "style") {
        const style = document.createElement("span").style;
        style.cssText = value;
        node.setAttribute("style", staticStyle(style));
      } else if (!localValue(value) && !name.startsWith("xmlns"))
        node.removeAttributeNode(attribute);
    }
    if (
      ["image", "use"].includes(node.localName) &&
      !node.getAttribute("href") &&
      !node.getAttributeNS("http://www.w3.org/1999/xlink", "href")
    )
      node.remove();
  }
  if (
    !svg.querySelector(
      "path,rect,circle,ellipse,line,polyline,polygon,text,image,use",
    )
  )
    throw Error("SVG에 표시할 수 있는 그림이 없습니다.");
  const box = svg
    .getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const view =
    box?.length === 4 &&
    box.every(Number.isFinite) &&
    box[2] > 0 &&
    box[3] > 0 &&
    box.every((n) => Math.abs(n) <= 1e9)
      ? box
      : undefined;
  let w = length(svg.getAttribute("width")),
    h = length(svg.getAttribute("height"));
  const ratio = view ? view[2] / view[3] : undefined;
  w ??= h && ratio ? h * ratio : (view?.[2] ?? 300);
  h ??= ratio ? w / ratio : 150;
  if (!view) svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  const scale = Math.min(1, MAX_SIDE / w, MAX_SIDE / h);
  svg.setAttribute("width", String(Math.max(1, w * scale)));
  svg.setAttribute("height", String(Math.max(1, h * scale)));
  svg.setAttribute("xmlns", SVG);
  const result = new XMLSerializer().serializeToString(svg);
  const encoded = new TextEncoder().encode(result);
  if (encoded.length > MAX_SVG_BYTES)
    throw Error("변환한 SVG 그림이 너무 큽니다.");
  return remember(text, bytesDataUrl(encoded, "image/svg+xml"));
}

export function safeSvgImage(source: string) {
  if (
    !/^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+={0,2}$/i.test(source) ||
    source.length > Math.ceil((MAX_SVG_BYTES * 4) / 3) + 100
  )
    throw Error("잘못된 SVG 그림 데이터입니다.");
  const raw = atob(source.slice(source.indexOf(",") + 1));
  return svgImage(Uint8Array.from(raw, (c) => c.charCodeAt(0)));
}
