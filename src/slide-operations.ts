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
