import type { SlideElement, TextParagraph, TextRun } from "./types";
import { editableText, paragraphText } from "./text-layout";

function paragraphs(element: SlideElement): TextParagraph[] {
  return (
    element.paragraphs ??
    (element.text ?? "").split("\n").map((text) => ({ runs: [{ text }] }))
  );
}

function prefix(paragraph: TextParagraph): string {
  const text = paragraphText([paragraph]);
  // Also recognize bullets created by earlier versions, which only stored text.
  if (paragraph.bulletPrefix && text.startsWith(paragraph.bulletPrefix))
    return paragraph.bulletPrefix;
  return text.match(/^•[ \t]+/)?.[0] ?? "";
}

const isBulletPrefix = (value: string) =>
  /^[^\p{L}\p{N}\s][ \t]+$/u.test(value);

function withoutPrefix(runs: TextRun[], count: number): TextRun[] {
  const body = runs.flatMap((run) => {
    const skip = Math.min(count, run.text.length);
    count -= skip;
    return skip === run.text.length
      ? []
      : [{ ...run, text: run.text.slice(skip) }];
  });
  return body.length ? body : [{ ...runs.at(-1), text: "" }];
}

export function hasTextBullets(
  element: SlideElement,
  indices?: number[],
): boolean {
  return paragraphs(element)
    .filter((_, i) => !indices || indices.includes(i))
    .every((p) => isBulletPrefix(prefix(p)));
}

// Decide once for the whole selection, never invert individual paragraphs.
// Work on runs directly so adding/removing markers cannot redistribute styles.
export function toggleTextBullets(
  element: SlideElement,
  indices?: number[],
  enabled?: boolean,
): SlideElement {
  const enable = enabled ?? !hasTextBullets(element, indices);
  const next = paragraphs(element).map((p, i) => {
    if (indices && !indices.includes(i)) return p;
    const oldPrefix = prefix(p);
    const body = withoutPrefix(p.runs, oldPrefix.length);
    const oldHanging = oldPrefix ? Math.max(0, -(p.indent ?? 0)) : 0;
    const margin = Math.max(0, (p.marginLeft ?? 0) - oldHanging);
    if (!enable)
      return {
        ...p,
        bulletPrefix: undefined,
        marginLeft: margin,
        indent: 0,
        runs: body,
      };
    const hanging = oldHanging || (p.fontSize ?? element.fontSize ?? 32) * 0.8;
    return {
      ...p,
      bulletPrefix: "• ",
      marginLeft: margin + hanging,
      indent: -hanging,
      runs: [{ ...(oldPrefix ? p.runs[0] : body[0]), text: "• " }, ...body],
    };
  });
  return {
    ...element,
    text: paragraphText(next),
    paragraphs: next,
    field: undefined,
  };
}

export function textParagraphSelection(
  element: SlideElement,
  start: number,
  end: number,
): number[] {
  let offset = 0;
  const indices: number[] = [];
  paragraphs(element).forEach((p, i) => {
    const length = paragraphText([p]).length;
    if (
      start <= offset + length &&
      (end === start ? end >= offset : end > offset)
    )
      indices.push(i);
    offset += length + 1;
  });
  return indices;
}

export function remapBulletOffset(
  before: SlideElement,
  after: SlideElement,
  at: number,
): number {
  let offset = 0;
  const next = paragraphs(after);
  for (const [i, p] of paragraphs(before).entries()) {
    const length = paragraphText([p]).length;
    if (at <= length)
      return (
        offset + Math.max(0, at - prefix(p).length) + prefix(next[i]).length
      );
    at -= length + 1;
    offset += paragraphText([next[i]]).length + 1;
  }
  return after.text?.length ?? 0;
}

// Locate the caret in the same text representation used by editText, including
// blank blocks and invisible imported marker separators. Only mutate a clone.
function caretOffset(host: HTMLElement, range: Range): number {
  const path: number[] = [];
  let node = range.startContainer;
  while (node !== host) {
    const parent = node.parentNode!;
    path.unshift(Array.prototype.indexOf.call(parent.childNodes, node));
    node = parent;
  }
  const clone = host.cloneNode(true) as HTMLElement;
  let copy: Node = clone;
  for (const index of path) copy = copy.childNodes[index];
  const marker = "\uFDD0" + crypto.randomUUID() + "\uFDD1";
  const point = document.createRange();
  point.setStart(copy, range.startOffset);
  point.collapse(true);
  point.insertNode(document.createTextNode(marker));
  return editableText(clone).indexOf(marker);
}

export function continueTextBullet(
  host: HTMLElement,
  element: SlideElement,
): boolean {
  const source = paragraphs(element);
  if (!source.some((p) => isBulletPrefix(prefix(p)))) return false;
  const selection = getSelection();
  if (!selection?.rangeCount) return false;
  const range = selection.getRangeAt(0);
  if (
    !host.contains(range.startContainer) ||
    !host.contains(range.endContainer)
  )
    return false;
  let offset = caretOffset(host, range);
  for (const p of source) {
    const text = paragraphText([p]);
    if (offset > text.length) {
      offset -= text.length + 1;
      continue;
    }
    const marker = prefix(p);
    // This command continues bulleted paragraphs; imported numbering is separate.
    if (!isBulletPrefix(marker) || offset < marker.length) return false;
    // One native edit keeps selection, character formatting and undo/redo intact.
    return document.execCommand("insertText", false, "\n" + marker);
  }
  return false;
}
