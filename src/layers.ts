import type { SlideElement } from "./types";
import { stringValue } from "./validation";

export const isElementHidden = (element: SlideElement) =>
  !!element.hidden || !!element.groupHidden?.some(Boolean);
export interface LayerNode {
  key: string;
  name: string;
  elementId?: string;
  groupId?: string;
  parentKey?: string;
  path: string[];
  depth: number;
  members: string[];
  children: LayerNode[];
  ownHidden: boolean;
  inheritedHidden: boolean;
  hidden: boolean;
  locked: boolean;
  type?: SlideElement["type"];
}
export function elementName(element: SlideElement, index: number) {
  if (element.name) return element.name;
  if (element.type === "text" && element.text?.trim())
    return element.text.split("\n")[0].slice(0, 80);
  if ((element.type === "image" || element.type === "video") && element.alt)
    return element.alt.slice(0, 80);
  const shape = (
    {
      rect: "사각형",
      roundRect: "둥근 사각형",
      ellipse: "타원",
      triangle: "삼각형",
      line: "선",
      arrow: "화살표",
      custom: "도형",
    } as const
  )[element.shape ?? "custom"];
  return `${({ text: "텍스트", image: "그림", video: "동영상", chart: "차트", table: "표", shape } as const)[element.type]} ${index + 1}`;
}
export function layerTree(elements: SlideElement[]): LayerNode[] {
  const roots: LayerNode[] = [],
    groups = new Map<string, LayerNode>();
  let groupCount = 0;
  elements.forEach((element, index) => {
    let siblings = roots,
      parent: LayerNode | undefined;
    for (const [depth, id] of (element.groups ?? []).entries()) {
      const path = element.groups!.slice(0, depth + 1),
        key = JSON.stringify(["group", ...path]);
      let group = groups.get(key);
      if (!group) {
        group = {
          key,
          name: element.groupNames?.[depth] || `그룹 ${++groupCount}`,
          groupId: id,
          parentKey: parent?.key,
          path,
          depth,
          members: [],
          children: [],
          ownHidden: !!element.groupHidden?.[depth],
          inheritedHidden: false,
          hidden: false,
          locked: false,
        };
        siblings.push(group);
        groups.set(key, group);
      }
      group.ownHidden ||= !!element.groupHidden?.[depth];
      group.locked ||= !!element.locked;
      group.members.push(element.id);
      parent = group;
      siblings = group.children;
    }
    siblings.push({
      key: JSON.stringify(["element", element.id]),
      name: elementName(element, index),
      elementId: element.id,
      parentKey: parent?.key,
      path: element.groups ?? [],
      depth: element.groups?.length ?? 0,
      members: [element.id],
      children: [],
      type: element.type,
      ownHidden: !!element.hidden,
      inheritedHidden: false,
      hidden: false,
      locked: !!element.locked,
    });
  });
  const visibility = (nodes: LayerNode[], inherited = false) => {
    for (const node of nodes) {
      node.inheritedHidden = inherited;
      node.hidden = inherited || node.ownHidden;
      visibility(node.children, node.hidden);
    }
  };
  visibility(roots);
  return roots;
}
export function flattenLayers(
  nodes: LayerNode[],
  collapsed = new Set<string>(),
): LayerNode[] {
  return [...nodes]
    .reverse()
    .flatMap((node) => [
      node,
      ...(collapsed.has(node.key)
        ? []
        : flattenLayers(node.children, collapsed)),
    ]);
}
export function selectedLayerNodes(
  nodes: LayerNode[],
  ids: string[],
): LayerNode[] {
  const selected = new Set(ids);
  const walk = (items: LayerNode[]): LayerNode[] =>
    items.flatMap((node) =>
      node.members.every((id) => selected.has(id))
        ? [node]
        : walk(node.children),
    );
  return walk(nodes);
}
function findLayer(elements: SlideElement[], key: string) {
  return flattenLayers(layerTree(elements)).find((node) => node.key === key);
}
const inGroup = (element: SlideElement, node: LayerNode) =>
  node.path.every((id, i) => element.groups?.[i] === id);
export function renameLayer(
  elements: SlideElement[],
  key: string,
  value: string,
) {
  const node = findLayer(elements, key);
  if (!node) return elements;
  const name = stringValue(value.trim(), "개체 이름", 160, false);
  if (name === node.name) return elements;
  return elements.map((element) => {
    if (node.elementId)
      return element.id === node.elementId ? { ...element, name } : element;
    if (!inGroup(element, node)) return element;
    const names = element.groups!.map((_, i) =>
      i === node.depth ? name : (element.groupNames?.[i] ?? ""),
    );
    return { ...element, groupNames: names };
  });
}
export function setLayerHidden(
  elements: SlideElement[],
  key: string,
  hidden: boolean,
) {
  const node = findLayer(elements, key);
  if (!node || node.ownHidden === hidden) return elements;
  return elements.map((element) => {
    if (node.elementId)
      return element.id === node.elementId
        ? { ...element, hidden: hidden || undefined }
        : element;
    if (!inGroup(element, node)) return element;
    const flags = element.groups!.map((_, i) =>
      i === node.depth ? hidden : (element.groupHidden?.[i] ?? false),
    );
    return { ...element, groupHidden: flags.some(Boolean) ? flags : undefined };
  });
}
export function showAllLayers(elements: SlideElement[]) {
  return elements.map((element) =>
    isElementHidden(element)
      ? { ...element, hidden: undefined, groupHidden: undefined }
      : element,
  );
}
export function hideAllLayers(elements: SlideElement[]) {
  return elements.map((element) => {
    if (!element.groups?.length)
      return element.hidden ? element : { ...element, hidden: true };
    if (element.groupHidden?.[0]) return element;
    return {
      ...element,
      groupHidden: element.groups.map(
        (_, i) => !i || (element.groupHidden?.[i] ?? false),
      ),
    };
  });
}
function flattenArtwork(nodes: LayerNode[], elements: SlideElement[]) {
  const source = new Map(elements.map((element) => [element.id, element]));
  const walk = (items: LayerNode[]): SlideElement[] =>
    items.flatMap((node) =>
      node.elementId ? [source.get(node.elementId)!] : walk(node.children),
    );
  return walk(nodes);
}
function parentItems(roots: LayerNode[], parent?: string) {
  return parent
    ? flattenLayers(roots).find((node) => node.key === parent)!.children
    : roots;
}
function movableNodes(roots: LayerNode[], ids: string[]) {
  const nodes = selectedLayerNodes(roots, ids);
  if (!nodes.length) return [];
  if (nodes.some((node) => node.locked))
    throw new Error("잠긴 개체의 순서는 바꿀 수 없습니다.");
  if (nodes.some((node) => node.parentKey !== nodes[0].parentKey))
    throw new Error(
      "같은 그룹 단계의 개체를 선택해 주세요. 다른 그룹으로 옮기려면 먼저 그룹을 해제하세요.",
    );
  return nodes;
}
export function reorderLayers(
  elements: SlideElement[],
  ids: string[],
  targetKey: string,
  edge: "above" | "below",
) {
  const roots = layerTree(elements),
    nodes = movableNodes(roots, ids);
  if (!nodes.length) return elements;
  const target = flattenLayers(roots).find((node) => node.key === targetKey);
  if (!target || nodes.some((node) => node.key === targetKey)) return elements;
  if (target.parentKey !== nodes[0].parentKey)
    throw new Error("같은 그룹 단계에서 순서를 바꿔 주세요.");
  const siblings = parentItems(roots, target.parentKey),
    moving = new Set(nodes.map((node) => node.key));
  const chosen = siblings.filter((node) => moving.has(node.key)),
    rest = siblings.filter((node) => !moving.has(node.key));
  rest.splice(rest.indexOf(target) + (edge === "above" ? 1 : 0), 0, ...chosen);
  siblings.splice(0, siblings.length, ...rest);
  return flattenArtwork(roots, elements);
}
export function moveLayers(
  elements: SlideElement[],
  ids: string[],
  direction: "up" | "down",
) {
  const roots = layerTree(elements),
    nodes = movableNodes(roots, ids);
  if (!nodes.length) return elements;
  const siblings = parentItems(roots, nodes[0].parentKey),
    moving = new Set(nodes.map((node) => node.key));
  const indices = siblings.flatMap((node, i) =>
    moving.has(node.key) ? [i] : [],
  );
  if (direction === "up") indices.reverse();
  for (const index of indices) {
    const next = index + (direction === "up" ? 1 : -1);
    if (next >= 0 && next < siblings.length && !moving.has(siblings[next].key))
      [siblings[index], siblings[next]] = [siblings[next], siblings[index]];
  }
  return flattenArtwork(roots, elements);
}
