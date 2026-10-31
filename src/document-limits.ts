import type { Deck, Slide, SlideElement } from "./types";

export const MAX_SLIDES = 500;
export const MAX_SLIDE_ELEMENTS = 1000;
export const MAX_ELEMENTS = 10000;

export type DocumentAddition = {
  slides?: readonly Slide[];
  /** Pass new objects to include their table cells; numeric layout deltas may be negative. */
  elements?: Readonly<Record<string, number | readonly SlideElement[]>>;
};

function tableCells(elements: readonly SlideElement[]): number {
  return elements.reduce(
    (total, element) =>
      total +
      (element.type === "table" && element.table
        ? element.table.cells.length * (element.table.cells[0]?.length ?? 0)
        : 0),
    0,
  );
}

/** Match the file parser's bounds before edits can create an unsavable deck. */
export function documentCapacityError(
  deck: Deck,
  addition: DocumentAddition = {},
): string | undefined {
  const slides = [...deck.slides, ...(addition.slides ?? [])];
  if (slides.length > MAX_SLIDES)
    return `슬라이드는 ${MAX_SLIDES}장까지 만들 수 있습니다.`;
  let total = 0,
    cells = 0;
  for (const slide of slides) {
    const added = addition.elements?.[slide.id] ?? 0;
    const objects = typeof added === "number" ? [] : added;
    const count =
      slide.elements.length +
      (typeof added === "number" ? added : objects.length);
    if (count > MAX_SLIDE_ELEMENTS)
      return "슬라이드에는 1,000개까지 개체를 넣을 수 있습니다.";
    total += count;
    cells += tableCells(slide.elements) + tableCells(objects);
  }
  if (total + cells > MAX_ELEMENTS)
    return cells
      ? "표 셀을 포함한 프로젝트 개체 수가 10,000개를 초과합니다."
      : "문서에는 10,000개까지 개체를 넣을 수 있습니다.";
}
