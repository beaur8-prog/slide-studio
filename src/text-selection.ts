export type TextMenuSelection = {
  host: HTMLElement;
  range: Range;
  backward?: boolean;
};

export function restoreTextSelection(selection: TextMenuSelection) {
  if (!selection.host.isConnected) return;
  selection.host.focus({ preventScroll: true });
  const current = getSelection();
  current?.removeAllRanges();
  const { range } = selection;
  if (selection.backward)
    current?.setBaseAndExtent(
      range.endContainer,
      range.endOffset,
      range.startContainer,
      range.startOffset,
    );
  else current?.addRange(range);
}

export function captureTextSelection(
  host: HTMLElement,
): TextMenuSelection | undefined {
  const selection = getSelection();
  if (
    !selection?.rangeCount ||
    !host.contains(selection.anchorNode) ||
    !host.contains(selection.focusNode)
  )
    return;
  const range = selection.getRangeAt(0).cloneRange();
  return {
    host,
    range,
    backward:
      !range.collapsed &&
      selection.anchorNode === range.endContainer &&
      selection.anchorOffset === range.endOffset,
  };
}

// execCommand can leave a selection boundary on the parent of a newly styled
// span. Read the first selected glyph, not the parent's inherited font size.
export function selectedTextElement(
  host: HTMLElement,
): HTMLElement | undefined {
  const selection = getSelection();
  if (
    !selection?.rangeCount ||
    !host.contains(selection.anchorNode) ||
    !host.contains(selection.focusNode)
  )
    return;
  const range = selection.getRangeAt(0);
  if (!range.collapsed) {
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!node.textContent || !range.intersectsNode(node)) continue;
      const overlap = range.cloneRange();
      if (range.comparePoint(node, 0) >= 0) overlap.setStart(node, 0);
      if (range.comparePoint(node, node.textContent.length) <= 0)
        overlap.setEnd(node, node.textContent.length);
      if (overlap.toString()) return node.parentElement ?? host;
    }
  }
  const node = range.startContainer;
  return node instanceof HTMLElement ? node : (node?.parentElement ?? host);
}
import { editableText } from "./text-layout";

export function textPointOffset(
  host: HTMLElement,
  node: Node,
  offset: number,
): number {
  const path: number[] = [];
  while (node !== host) {
    const parent = node.parentNode!;
    path.unshift(Array.prototype.indexOf.call(parent.childNodes, node));
    node = parent;
  }
  const clone = host.cloneNode(true) as HTMLElement;
  let copy: Node = clone;
  for (const index of path) copy = copy.childNodes[index];
  const marker = "\uFDD0" + crypto.randomUUID() + "\uFDD1",
    point = document.createRange();
  point.setStart(copy, offset);
  point.collapse(true);
  point.insertNode(document.createTextNode(marker));
  return editableText(clone).indexOf(marker);
}

export function textRangeAtOffsets(
  host: HTMLElement,
  start: number,
  end: number,
) {
  const clone = host.cloneNode(true) as HTMLElement;
  const originals = document.createTreeWalker(host, NodeFilter.SHOW_TEXT),
    copies = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [],
    prefix = "\uFDD0" + crypto.randomUUID() + ":";
  let node: Node | null;
  while ((node = originals.nextNode())) {
    const copy = copies.nextNode()!;
    if (!node.textContent) continue;
    copy.textContent = prefix + nodes.length + "\uFDD1" + node.textContent;
    nodes.push(node as Text);
  }
  const positions: number[] = [];
  let removed = 0;
  editableText(clone).replace(
    new RegExp(prefix + "(\\d+)\uFDD1", "g"),
    (marker, index, offset) => {
      positions[Number(index)] = offset - removed;
      removed += marker.length;
      return "";
    },
  );
  const point = (at: number): [Node, number] => {
    for (const line of host.querySelectorAll<HTMLElement>("[data-text-line]"))
      if (!editableText(line) && textPointOffset(host, line, 0) === at)
        return [line, 0];
    for (let i = 0; i < nodes.length; i++)
      if (at <= positions[i] + nodes[i].length)
        return [nodes[i], Math.max(0, at - positions[i])];
    return nodes.length ? [nodes.at(-1)!, nodes.at(-1)!.length] : [host, 0];
  };
  const range = document.createRange();
  range.setStart(...point(start));
  range.setEnd(...point(end));
  return range;
}

export function restoreTextOffsets(
  host: HTMLElement,
  start: number,
  end: number,
) {
  const range = textRangeAtOffsets(host, start, end);
  host.focus({ preventScroll: true });
  const selection = getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
