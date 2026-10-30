import type { SlideElement } from "./types";
import { writeGroupState } from "./pptx-object-state";

export function expandGroups(
  elements: SlideElement[],
  ids: string[],
): string[] {
  const roots = new Set(
    elements
      .filter((e) => ids.includes(e.id))
      .map((e) => e.groups?.[0])
      .filter(Boolean),
  );
  return elements
    .filter(
      (e) => ids.includes(e.id) || (e.groups?.[0] && roots.has(e.groups[0])),
    )
    .map((e) => e.id);
}

export function groupElements(
  elements: SlideElement[],
  ids: string[],
): SlideElement[] {
  const selected = new Set(expandGroups(elements, ids));
  const members = elements.filter((e) => selected.has(e.id));
  if (members.length < 2 || members.some((e) => e.locked)) return elements;
  const id = crypto.randomUUID();
  const last = Math.max(
    ...elements.map((e, i) => (selected.has(e.id) ? i : -1)),
  );
  return elements.flatMap((e, i) =>
    i === last
      ? members.map((item) => ({
          ...item,
          groups: [id, ...(item.groups ?? [])],
          ...(item.groupNames ? { groupNames: ["", ...item.groupNames] } : {}),
          ...(item.groupHidden ? { groupHidden: [false, ...item.groupHidden] } : {}),
        }))
      : selected.has(e.id)
        ? []
        : [e],
  );
}

export function ungroupElements(
  elements: SlideElement[],
  ids: string[],
): SlideElement[] {
  const roots = new Set(
    elements
      .filter((e) => ids.includes(e.id))
      .map((e) => e.groups?.[0])
      .filter(Boolean),
  );
  if (elements.some((e) => roots.has(e.groups?.[0]) && e.locked))
    return elements;
  return elements.map(e => {
    if (!roots.has(e.groups?.[0])) return e;
    const groups = e.groups!.slice(1), names = e.groupNames?.slice(1), hidden = e.groupHidden?.slice(1);
    return { ...e, groups: groups.length ? groups : undefined,
      groupNames: names?.some(Boolean) ? names : undefined,
      groupHidden: hidden?.some(Boolean) ? hidden : undefined,
      ...(e.groupHidden?.[0] ? { hidden: true } : {}),
    };
  });
}

export function copyElements(
  elements: SlideElement[],
  dx = 0,
  dy = 0,
): SlideElement[] {
  const groups = new Map<string, string>();
  return structuredClone(elements).map((e) => ({
    ...e,
    id: crypto.randomUUID(),
    x: e.x + dx,
    y: e.y + dy,
    ...(e.groups
      ? {
          groups: e.groups.map((id) => {
            if (!groups.has(id)) groups.set(id, crypto.randomUUID());
            return groups.get(id)!;
          }),
        }
      : {}),
  }));
}

// Standard DrawingML groups with identity child transforms retain hierarchy
// without applying the authored child coordinates/point sizes a second time.
export function writeGroups(doc: Document, elements: SlideElement[]) {
  const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const tree = doc.getElementsByTagNameNS(P, "spTree")[0];
  if (!tree) return;
  const byName = new Map(
    Array.from(tree.children).map((node) => [
      node.getElementsByTagNameNS(P, "cNvPr")[0]?.getAttribute("name"),
      node,
    ]),
  );
  let nextId =
    Math.max(
      0,
      ...Array.from(doc.getElementsByTagNameNS(P, "cNvPr")).map(
        (n) => Number(n.getAttribute("id")) || 0,
      ),
    ) + 1;
  function build(parent: Element, members: SlideElement[], depth: number) {
    const seen = new Set<string>();
    for (const e of members) {
      const group = e.groups?.[depth];
      if (!group) {
        const node = byName.get(e.id);
        if (node) parent.append(node);
        // Composite borders belong alongside the owning text box.
        for (let side = 0; side < 4; side++) {
          const edge = byName.get(`${e.id}-edge-${side}`);
          if (edge) parent.append(edge);
        }
        continue;
      }
      if (seen.has(group)) continue;
      seen.add(group);
      const children = members.filter((item) => item.groups?.[depth] === group);
      const node = doc.createElementNS(P, "p:grpSp");
      const nv = doc.createElementNS(P, "p:nvGrpSpPr");
      for (const name of ["cNvPr", "cNvGrpSpPr", "nvPr"]) {
        const prop = doc.createElementNS(P, "p:" + name);
        if (name === "cNvPr") {
          prop.setAttribute("id", String(nextId++));
          prop.setAttribute("name", group);
          const name = children.find(element => element.groupNames?.[depth])?.groupNames?.[depth];
          if (name) prop.setAttribute("name", name);
          if (children.some(element => element.groupHidden?.[depth])) prop.setAttribute("hidden", "1");
          writeGroupState(prop, group, !!name);
        }
        nv.append(prop);
      }
      node.append(nv);
      const sp = doc.createElementNS(P, "p:grpSpPr"),
        xf = doc.createElementNS(A, "a:xfrm");
      const x = Math.min(...children.map((e) => e.x)),
        y = Math.min(...children.map((e) => e.y));
      const width = Math.max(1, ...children.map((e) => e.x + e.width - x)),
        height = Math.max(1, ...children.map((e) => e.y + e.height - y));
      for (const name of ["off", "ext", "chOff", "chExt"]) {
        const n = doc.createElementNS(A, "a:" + name),
          offset = name.endsWith("Off") || name === "off";
        n.setAttribute(
          offset ? "x" : "cx",
          String(Math.round((offset ? x : width) * 9525)),
        );
        n.setAttribute(
          offset ? "y" : "cy",
          String(Math.round((offset ? y : height) * 9525)),
        );
        xf.append(n);
      }
      sp.append(xf);
      node.append(sp);
      parent.append(node);
      build(node, children, depth + 1);
    }
  }
  // Reappend only artwork; the spTree's own nonvisual/transform nodes stay first.
  build(tree, elements, 0);
}
