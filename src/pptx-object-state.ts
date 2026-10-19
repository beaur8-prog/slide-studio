import type { SlideElement } from "./types";

const SS = "urn:slide-studio:object-state:v1";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const child = (node: Element | undefined, name: string) =>
  Array.from(node?.children ?? []).find((n) => n.localName === name);
const properties = (node: Element) =>
  Array.from(node.children)
    .flatMap((n) => Array.from(n.children))
    .find((n) => n.localName === "cNvPr");

function extension(props: Element, name: string): Element {
  const doc = props.ownerDocument;
  let list = child(props, "extLst");
  if (!list) {
    list = doc.createElementNS(A, "a:extLst");
    props.appendChild(list);
  }
  const ext = doc.createElementNS(A, "a:ext");
  ext.setAttribute("uri", SS);
  list.appendChild(ext);
  const state = doc.createElementNS(SS, "ss:" + name);
  ext.appendChild(state);
  return state;
}

// Keep composite borders editable on reimport; their standard DrawingML lines
// still render in PowerPoint and readers that do not understand this metadata.
export function writeObjectState(doc: Document, elements: SlideElement[]) {
  const names = new Map(
    Array.from(doc.getElementsByTagNameNS("*", "cNvPr")).map((p) => [
      p.getAttribute("name"),
      p,
    ]),
  );
  for (const el of elements) {
    const props = names.get(el.id);
    if (!props) continue;
    const node = props.parentElement?.parentElement;
    if (!node) continue;
    if (el.type === "text") {
      const state = extension(props, "state");
      state.setAttribute("textBox", "1");
      if (el.borders) {
        state.setAttribute("borders", JSON.stringify(el.borders));
        el.borders.forEach((_, i) => {
          const edge = names.get(`${el.id}-edge-${i}`);
          if (edge) {
            const meta = extension(edge, "border");
            meta.setAttribute("owner", el.id);
            meta.setAttribute("side", String(i));
          }
        });
      }
    }
    if (el.locked) {
      const nv =
        child(node, "nvSpPr") ??
        child(node, "nvCxnSpPr") ??
        child(node, "nvPicPr") ??
        child(node, "nvGraphicFramePr");
      const specific =
        nv &&
        Array.from(nv.children).find((n) =>
          /^cNv(?:Sp|CxnSp|Pic|GraphicFrame)Pr$/.test(n.localName),
        );
      if (specific) {
        const name =
          el.type === "image" || el.type === "video"
            ? "picLocks"
            : el.type === "table"
              ? "graphicFrameLocks"
              : el.shape === "line" || el.shape === "arrow"
                ? "cxnSpLocks"
                : "spLocks";
        let locks = child(specific, name);
        if (!locks) {
          locks = doc.createElementNS(A, "a:" + name);
          specific.appendChild(locks);
        }
        for (const key of ["noMove", "noResize", "noRot"])
          locks.setAttribute(key, "1");
      }
    }
  }
}

export function readObjectState(node: Element): {
  preserveBox: boolean;
  borders?: SlideElement["borders"];
  locked?: boolean;
} {
  const props = properties(node);
  const state = props?.getElementsByTagNameNS(SS, "state")[0];
  let borders: SlideElement["borders"];
  try {
    const value: unknown = JSON.parse(state?.getAttribute("borders") ?? "null");
    if (
      Array.isArray(value) &&
      value.length === 4 &&
      value.every(
        (b) =>
          b &&
          typeof b === "object" &&
          typeof b.color === "string" &&
          /^(?:#[\da-f]{6}|transparent)$/i.test(b.color) &&
          typeof b.width === "number" &&
          Number.isFinite(b.width) &&
          b.width >= 0 &&
          b.width <= 100,
      )
    )
      borders = value as SlideElement["borders"];
  } catch {
    /* Ignore malformed optional metadata; visible OOXML remains readable. */
  }
  const locks = [
    "spLocks",
    "cxnSpLocks",
    "picLocks",
    "graphicFrameLocks",
  ].flatMap((name) => Array.from(node.getElementsByTagNameNS(A, name)));
  return {
    preserveBox: state?.getAttribute("textBox") === "1",
    ...(borders ? { borders } : {}),
    ...(locks.some((n) =>
      ["noMove", "noResize", "noRot"].some((k) =>
        ["1", "true"].includes(n.getAttribute(k) ?? ""),
      ),
    )
      ? { locked: true }
      : {}),
  };
}

export function compositeBorderNodes(doc: Document): Set<Element> {
  const owners = new Map(
    Array.from(doc.getElementsByTagNameNS("*", "sp")).flatMap((node) => {
      const state = readObjectState(node),
        name = properties(node)?.getAttribute("name");
      return state.borders && name ? [[name, state.borders] as const] : [];
    }),
  );
  return new Set(
    Array.from(doc.getElementsByTagNameNS("*", "cxnSp")).filter((node) => {
      const marker = properties(node)?.getElementsByTagNameNS(SS, "border")[0];
      const side = Number(marker?.getAttribute("side"));
      return (
        !!marker &&
        Number.isInteger(side) &&
        side >= 0 &&
        side < 4 &&
        !!owners.get(marker.getAttribute("owner") ?? "")?.[side]
      );
    }),
  );
}
