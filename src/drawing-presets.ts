import definitions from "./assets/preset-shapes.xml?raw";
let presets: Map<string, Element> | undefined;
export function presetGeometry(
  name: string,
  adjustments?: Element,
): Element | undefined {
  if (!presets) {
    const doc = new DOMParser().parseFromString(definitions, "application/xml");
    presets = new Map(
      Array.from(doc.documentElement.children).map((e) => [e.localName, e]),
    );
  }
  const preset = presets.get(name);
  if (!preset) return;
  const copy = preset.cloneNode(true) as Element;
  const list = Array.from(copy.children).find((e) => e.localName === "avLst");
  if (list && adjustments)
    for (const gd of Array.from(adjustments.children)) {
      const old = Array.from(list.children).find(
        (e) => e.getAttribute("name") === gd.getAttribute("name"),
      );
      if (old) old.setAttribute("fmla", gd.getAttribute("fmla") ?? "");
    }
  return copy;
}
export function presetNames() {
  presetGeometry("rect");
  return [...presets!.keys()];
}
