import type { SlideElement } from "./types";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const SS = "urn:slide-studio:insert-fields:v1";
const child = (node: Element | undefined, name: string) =>
  Array.from(node?.children ?? []).find((n) => n.localName === name);
const first = (node: Element | Document, name: string) =>
  node.getElementsByTagNameNS("*", name)[0] as Element | undefined;

/** Make a whole-object link survive rebuilding rich-text runs. */
export function preserveObjectLinks(
  doc: Document,
  elements: SlideElement[],
): void {
  for (const el of elements) {
    if (!el.hyperlink) continue;
    const props = Array.from(doc.getElementsByTagNameNS("*", "cNvPr")).find(
      (n) => n.getAttribute("name") === el.id,
    );
    const node = props?.parentElement?.parentElement;
    const link = node && first(node, "hlinkClick");
    if (props && link && !child(props, "hlinkClick"))
      props.appendChild(link.cloneNode(true));
  }
}

export function restoreInsertFields(
  doc: Document,
  elements: SlideElement[],
): void {
  for (const el of elements) {
    if (!el.field || el.type !== "text") continue;
    const props = Array.from(doc.getElementsByTagNameNS("*", "cNvPr")).find(
      (n) => n.getAttribute("name") === el.id,
    );
    const node = props?.parentElement?.parentElement;
    if (!props || !node) continue;
    let list = child(props, "extLst");
    if (!list) {
      list = doc.createElementNS(A, "a:extLst");
      props.appendChild(list);
    }
    const ext = doc.createElementNS(A, "a:ext");
    ext.setAttribute("uri", SS);
    const field = doc.createElementNS(SS, "ss:field");
    field.setAttribute("kind", el.field);
    ext.appendChild(field);
    list.appendChild(ext);
    if (el.field === "slideNumber") {
      const body = child(node, "txBody"),
        paragraph = child(body, "p"),
        run = child(paragraph, "r");
      if (run) {
        const fld = doc.createElementNS(A, "a:fld");
        fld.setAttribute("id", `{${crypto.randomUUID().toUpperCase()}}`);
        fld.setAttribute("type", "slidenum");
        for (const c of Array.from(run.children))
          fld.appendChild(c.cloneNode(true));
        run.replaceWith(fld);
      }
    }
  }
}

export function importedField(
  node: Element,
  slideNumbersStartAtOne = true,
): SlideElement["field"] {
  const props = first(node, "cNvPr");
  const field = props
    ?.getElementsByTagNameNS(SS, "field")[0]
    ?.getAttribute("kind");
  // PowerPoint can change the starting number after our metadata was written.
  // Without a deck-level offset, resolving either marker would replace the
  // native cached number with index + 1. Preserve that number as ordinary text.
  if (field === "slideNumber" && !slideNumbersStartAtOne) return undefined;
  if (["slideNumber", "date", "fixedDate", "footer"].includes(field || ""))
    return field as SlideElement["field"];
  const fields = Array.from(node.getElementsByTagNameNS(A, "fld"));
  if (
    slideNumbersStartAtOne &&
    fields.length === 1 &&
    fields[0].getAttribute("type") === "slidenum" &&
    node.getElementsByTagNameNS(A, "r").length === 0
  )
    return "slideNumber";
  return undefined;
}
