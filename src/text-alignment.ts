import type { SlideElement, TextAlignment, TextParagraph } from "./types";

export const TEXT_ALIGN_EVENT = "slide-studio:align-paragraphs";
export type TextAlignmentDetail = { align: TextAlignment; applied?: boolean };

/** Alignment belongs to a paragraph, even when the caret is after a soft break.
 * Preserve inline runs and inherited properties outside the selected paragraphs. */
export function alignTextParagraphs(
  element: SlideElement,
  indices: number[],
  align: TextAlignment,
): SlideElement {
  if (element.locked || !["left", "center", "right", "justify"].includes(align))
    return element;
  const source: TextParagraph[] = element.paragraphs ??
    (element.text ?? "").split("\n").map(text => ({ runs: [{ text }] }));
  let changed = false;
  const paragraphs = source.map((paragraph, index) => {
    if (!indices.includes(index) || (paragraph.align ?? element.align ?? "left") === align)
      return paragraph;
    changed = true;
    return { ...paragraph, align };
  });
  return changed ? { ...element, paragraphs } : element;
}
