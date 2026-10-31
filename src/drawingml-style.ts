const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const child = (node: Element | undefined, name: string) =>
  Array.from(node?.children ?? []).find((entry) => entry.localName === name);
export type DrawingmlColorReader = (
  node: Element | undefined,
) => { color: string; opacity: number } | undefined;

/** Resolve a DrawingML matrix reference without mutating theme or shape XML. */
export function resolveThemeStyleReference(
  reference: Element | undefined,
  formatScheme: Element | undefined,
  readColor: DrawingmlColorReader,
  kind: "fill" | "line",
): Element | undefined {
  if (!reference?.hasAttribute("idx")) return undefined;
  const index = Number(reference.getAttribute("idx"));
  if (!Number.isInteger(index) || index < 0) return undefined;
  const document = reference.ownerDocument;
  const list = child(
    formatScheme,
    kind === "line"
      ? "lnStyleLst"
      : index >= 1001
        ? "bgFillStyleLst"
        : "fillStyleLst",
  );
  const sourceIndex =
    kind === "line" || index < 1001 ? index - 1 : index - 1001;
  let appearance: Element | undefined;
  if (index === 0 || (kind === "fill" && index === 1000)) {
    appearance = document.createElementNS(
      A,
      kind === "line" ? "a:ln" : "a:noFill",
    );
    if (kind === "line") {
      appearance.setAttribute("w", "0");
      appearance.append(document.createElementNS(A, "a:noFill"));
    }
  } else
    appearance = list?.children[sourceIndex]
      ? document.importNode(list.children[sourceIndex], true)
      : undefined;
  if (!appearance) return undefined;
  const color = readColor(reference);
  if (color) {
    for (const placeholder of Array.from(
      appearance.getElementsByTagNameNS("*", "schemeClr"),
    )) {
      if (placeholder.getAttribute("val") !== "phClr") continue;
      const concrete = document.createElementNS(A, "a:srgbClr");
      concrete.setAttribute("val", color.color.slice(1));
      if (color.opacity !== 1) {
        const alpha = document.createElementNS(A, "a:alpha");
        alpha.setAttribute("val", String(Math.round(color.opacity * 100000)));
        concrete.append(alpha);
      }
      for (const transform of Array.from(placeholder.children))
        concrete.append(document.importNode(transform, true));
      placeholder.replaceWith(concrete);
    }
  }
  return appearance;
}

/** Explicit line attributes override the matrix without losing omitted parts. */
export function inheritDrawingmlLine(
  own: Element | undefined,
  inherited: Element | undefined,
): Element | undefined {
  if (!own) return inherited;
  if (!inherited) return own;
  const line = own.cloneNode(true) as Element;
  for (const attribute of Array.from(inherited.attributes))
    if (!line.hasAttribute(attribute.name))
      line.setAttribute(attribute.name, attribute.value);
  const choices = [
    ["noFill", "solidFill", "gradFill", "pattFill"],
    ["prstDash", "custDash"],
    ["round", "bevel", "miter"],
  ];
  for (const entry of Array.from(inherited.children)) {
    const choice = choices.find((names) => names.includes(entry.localName));
    const overridden = choice
      ? Array.from(own.children).some((n) => choice.includes(n.localName))
      : !!child(own, entry.localName);
    if (!overridden) line.append(line.ownerDocument.importNode(entry, true));
  }
  return line;
}
