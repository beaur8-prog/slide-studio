const DRAWING_NS =
  "http://schemas.openxmlformats.org/drawingml/2006/main";

function child(node: Element | undefined, name: string) {
  return Array.from(node?.children ?? []).find((n) => n.localName === name);
}

export function placeholder(node: Element):
  | { type: string; index: string }
  | undefined {
  const properties = Array.from(node.children).find((n) =>
    ["nvSpPr", "nvPicPr", "nvGrpSpPr", "nvGraphicFramePr", "nvCxnSpPr"].includes(
      n.localName,
    ),
  );
  const ph = properties?.getElementsByTagNameNS("*", "ph")[0];
  const rawIndex = ph?.getAttribute("idx") ?? "0";
  const index = /^\+?\d+$/.test(rawIndex) && Number(rawIndex) <= 0xffffffff
    ? String(Number(rawIndex))
    : rawIndex;
  return ph
    ? {
        type: ph.getAttribute("type") ?? "obj",
        // CT_Placeholder defaults idx to zero. A missing index must not match
        // an unrelated placeholder merely because it has the same type.
        index,
      }
    : undefined;
}

export function inheritedShape(
  node: Element,
  document: Document | undefined,
): Element | undefined {
  const ph = placeholder(node);
  if (!ph || !document) return undefined;
  const candidates = ["sp", "pic", "graphicFrame"].flatMap((name) =>
    Array.from(document.getElementsByTagNameNS("*", name)),
  );
  if (document.documentElement.localName === "sldLayout") {
    // Slides inherit from the layout placeholder with the same idx. Falling
    // back to a different idx steals its geometry and paragraph defaults.
    const indexed = candidates.filter((candidate) => placeholder(candidate)?.index === ph.index);
    // Some producers omit idx on several title/date/footer placeholders.
    // Their shared default zero is disambiguated by type, never by source
    // order. An explicit unmatched idx still must not fall back to another.
    const title = (type: string | undefined) => type === "title" || type === "ctrTitle";
    return indexed.find((candidate) => {
      const type = placeholder(candidate)?.type;
      return type === ph.type || (title(type) && title(ph.type));
    }) ?? (indexed.length === 1 ? indexed[0] : undefined);
  }
  // Layout placeholders inherit from the corresponding master type. Content
  // containers all share the body master, while centered titles use title.
  const type = ["obj", "body", "subTitle", "pic", "chart", "tbl", "dgm", "clipArt", "media"].includes(ph.type)
    ? "body"
    : ph.type === "ctrTitle"
      ? "title"
      : ph.type;
  return candidates.find((candidate) => placeholder(candidate)?.type === type);
}

function shapeTransform(node: Element | undefined) {
  return node?.localName === "graphicFrame"
    ? child(node, "xfrm")
    : child(child(node, "spPr"), "xfrm");
}

export function inheritedTransform(
  chain: (Element | undefined)[],
): Element | undefined {
  const transforms = chain.map(shapeTransform).filter((n): n is Element => !!n);
  if (!transforms.length) return undefined;
  const owner = transforms[0].ownerDocument;
  const resolved = owner.createElementNS(DRAWING_NS, "a:xfrm");
  // A placeholder may override its position without overriding its size (or
  // vice versa). Merge those properties independently, preserving explicit
  // zeros and explicit false reflection flags.
  for (const name of ["rot", "flipH", "flipV"]) {
    const source = transforms.find((n) => n.hasAttribute(name));
    if (source) resolved.setAttribute(name, source.getAttribute(name)!);
  }
  for (const [name, attributes] of [
    ["off", ["x", "y"]],
    ["ext", ["cx", "cy"]],
  ] as const) {
    const sources = transforms.map((t) => child(t, name)).filter((n): n is Element => !!n);
    if (!sources.length) continue;
    const element = owner.createElementNS(DRAWING_NS, "a:" + name);
    for (const attribute of attributes) {
      const source = sources.find((n) => n.hasAttribute(attribute));
      if (source) element.setAttribute(attribute, source.getAttribute(attribute)!);
    }
    resolved.append(element);
  }
  return resolved;
}
