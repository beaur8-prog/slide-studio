import type { Slide } from "./types";
import { duplicateSlide } from "./model";
export function duplicateSlides(slides: Slide[]): Slide[] {
  const copies = slides.map(duplicateSlide),
    ids = new Map(slides.map((s, i) => [s.id, copies[i].id]));
  for (const s of copies)
    for (const e of s.elements) {
      if (e.hyperlink?.slideId && ids.has(e.hyperlink.slideId))
        e.hyperlink = { slideId: ids.get(e.hyperlink.slideId)! };
      for (const p of e.paragraphs ?? [])
        for (const r of p.runs)
          if (r.hyperlink?.slideId && ids.has(r.hyperlink.slideId))
            r.hyperlink = { slideId: ids.get(r.hyperlink.slideId)! };
    }
  return copies;
}
/** Insert the selected block before the drop marker, preserving source order. */
export function moveSlides(
  slides: Slide[],
  ids: string[],
  before: string | null,
): Slide[] {
  if (before && ids.includes(before)) return slides;
  const selected = new Set(ids),
    moving = slides.filter((s) => selected.has(s.id)),
    rest = slides.filter((s) => !selected.has(s.id));
  if (!moving.length) return slides;
  const index = before ? rest.findIndex((s) => s.id === before) : rest.length;
  if (index < 0) return slides;
  return [...rest.slice(0, index), ...moving, ...rest.slice(index)];
}

/** Keyboard ordering moves selected slides without changing their identity or
 * relative order. At an edge it is a no-op, rather than wrapping the deck. */
export function stepSlides(
  slides: Slide[],
  ids: string[],
  direction: -1 | 1,
  edge = false,
): Slide[] {
  const selected = new Set(ids),
    moving = slides.filter((slide) => selected.has(slide.id));
  if (!moving.length) return slides;
  let next: Slide[];
  if (edge) {
    const rest = slides.filter((slide) => !selected.has(slide.id));
    next = direction === -1 ? [...moving, ...rest] : [...rest, ...moving];
  } else {
    next = [...slides];
    const indices = slides.flatMap((slide, index) =>
      selected.has(slide.id) ? [index] : [],
    );
    if (direction === 1) indices.reverse();
    for (const index of indices) {
      const neighbor = index + direction;
      if (
        neighbor >= 0 &&
        neighbor < next.length &&
        !selected.has(next[neighbor].id)
      )
        [next[index], next[neighbor]] = [next[neighbor], next[index]];
    }
  }
  return next.every((slide, index) => slide === slides[index]) ? slides : next;
}
