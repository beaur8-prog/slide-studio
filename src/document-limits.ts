import type { Deck, Slide } from "./types";

export const MAX_SLIDES = 500;
export const MAX_SLIDE_ELEMENTS = 1000;
export const MAX_ELEMENTS = 10000;

export type DocumentAddition = {
  slides?: readonly Slide[];
  /** Counts may be negative when replacing a layout's existing objects. */
  elements?: Readonly<Record<string, number>>;
};

/** Match the file parser's bounds before edits can create an unsavable deck. */
export function documentCapacityError(
  deck: Deck,
  addition: DocumentAddition = {},
): string | undefined {
  const slides = [...deck.slides, ...(addition.slides ?? [])];
  if (slides.length > MAX_SLIDES)
    return `슬라이드는 ${MAX_SLIDES}장까지 만들 수 있습니다.`;
  let total = 0;
  for (const slide of slides) {
    const count = slide.elements.length + (addition.elements?.[slide.id] ?? 0);
    if (count > MAX_SLIDE_ELEMENTS)
      return "슬라이드에는 1,000개까지 개체를 넣을 수 있습니다.";
    total += count;
  }
  if (total > MAX_ELEMENTS)
    return "문서에는 10,000개까지 개체를 넣을 수 있습니다.";
}
