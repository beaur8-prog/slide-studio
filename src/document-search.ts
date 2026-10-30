import type {
  Deck,
  Slide,
  SlideElement,
  TextParagraph,
  TextRun,
} from "./types";
import { visibleTableCells, validateTable } from "./table";
import { fitTableRows } from "./table-layout";
import { paragraphText } from "./text-layout";
import { validateParagraphs } from "./text-validation";
import { stringValue } from "./validation";

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  includeNotes: boolean;
}
export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  includeNotes: false,
};
export interface SearchMatch {
  id: string;
  slideId: string;
  slideIndex: number;
  elementId?: string;
  row?: number;
  column?: number;
  start: number;
  end: number;
  value: string;
  before: string;
  after: string;
  editable: boolean;
}
export interface SearchResults {
  matches: SearchMatch[];
  truncated: boolean;
}
// Keep pathological one-character searches bounded, with an explicit warning
// and no partial Replace All. Ordinary decks can expose every result.
export const MAX_SEARCH_RESULTS = 20000;

type Field = Pick<SearchMatch, "elementId" | "row" | "column" | "editable"> & {
  text: string;
};
function* fields(slide: Slide, notes = false): Generator<Field> {
  for (const element of slide.elements) {
    if (element.table) {
      for (const { row, column } of visibleTableCells(element.table))
        yield {
          elementId: element.id,
          row,
          column,
          text: element.table.cells[row][column],
          editable: !element.locked,
        };
    } else if (element.text !== undefined) {
      yield {
        elementId: element.id,
        text: element.text,
        editable: !element.locked && !element.field,
      };
    }
  }
  if (notes) yield { text: slide.notes, editable: true };
}
export function slideSearchText(slide: Slide): string {
  return Array.from(fields(slide), (field) => field.text).join("\n");
}
function expression(query: string, options: SearchOptions) {
  return new RegExp(
    query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    options.caseSensitive ? "gu" : "giu",
  );
}
export function findDocumentText(
  deck: Deck,
  query: string,
  options = DEFAULT_SEARCH_OPTIONS,
): SearchResults {
  const matches: SearchMatch[] = [];
  if (!query || /[\r\n]/.test(query)) return { matches, truncated: false };
  const pattern = expression(query, options);
  for (const [slideIndex, slide] of deck.slides.entries()) {
    for (const field of fields(slide, options.includeNotes)) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(field.text))) {
        const start = match.index,
          end = start + match[0].length;
        if (
          options.wholeWord &&
          (/[\p{L}\p{N}_]$/u.test(
            field.text.slice(Math.max(0, start - 2), start),
          ) ||
            /^[\p{L}\p{N}_]/u.test(field.text.slice(end, end + 2)))
        )
          continue;
        if (matches.length === MAX_SEARCH_RESULTS)
          return { matches, truncated: true };
        matches.push({
          id: JSON.stringify([
            slide.id,
            field.elementId ?? null,
            field.row ?? null,
            field.column ?? null,
            start,
            end,
          ]),
          slideId: slide.id,
          slideIndex,
          elementId: field.elementId,
          row: field.row,
          column: field.column,
          start,
          end,
          value: match[0],
          editable: field.editable,
          before:
            (start > 30 ? "…" : "") +
            field.text
              .slice(Math.max(0, start - 30), start)
              .replace(/\n/g, " "),
          after:
            field.text.slice(end, end + 45).replace(/\n/g, " ") +
            (end + 45 < field.text.length ? "…" : ""),
        });
      }
    }
  }
  return { matches, truncated: false };
}

function replaceRuns(
  runs: TextRun[],
  matches: SearchMatch[],
  replacement: string,
): TextRun[] {
  const spans: { run: TextRun; start: number; end: number }[] = [];
  let offset = 0;
  for (const run of runs) {
    spans.push({ run, start: offset, end: offset + run.text.length });
    offset += run.text.length;
  }
  const result: TextRun[] = [];
  let index = 0;
  const append = (run: TextRun) => {
    if (!run.text) return;
    const previous = result.at(-1);
    if (
      previous &&
      JSON.stringify({ ...previous, text: undefined }) ===
        JSON.stringify({ ...run, text: undefined })
    )
      previous.text += run.text;
    else result.push(run);
  };
  const original = (from: number, to: number) => {
    while (index < spans.length && spans[index].end <= from) index++;
    for (let i = index; i < spans.length && spans[i].start < to; i++) {
      const span = spans[i];
      append({
        ...span.run,
        text: span.run.text.slice(
          Math.max(0, from - span.start),
          Math.min(to, span.end) - span.start,
        ),
      });
      if (span.end <= to) index = i + 1;
    }
  };
  let at = 0;
  for (const match of matches) {
    original(at, match.start);
    while (index < spans.length && spans[index].end <= match.start) index++;
    // Replacement text inherits the first matched character's style. Styles,
    // paragraph spacing and links outside the replaced range stay untouched.
    append({ ...(spans[index]?.run ?? runs.at(-1)), text: replacement });
    at = match.end;
  }
  original(at, offset);
  return result.length ? result : [{ ...(runs[0] ?? {}), text: "" }];
}
function replaceField(
  text: string,
  paragraphs: TextParagraph[] | undefined,
  input: SearchMatch[],
  replacement: string,
  limit = 100000,
) {
  const matches = input
    .filter((match) => match.value !== replacement)
    .sort((a, b) => a.start - b.start);
  let previous = 0;
  for (const match of matches) {
    if (
      match.start < previous ||
      text.slice(match.start, match.end) !== match.value
    )
      throw new Error("검색 결과가 바뀌었습니다. 다시 검색한 뒤 바꿔 주세요.");
    previous = match.end;
  }
  if (!matches.length) return { text, paragraphs, count: 0 };
  const pieces: string[] = [];
  let at = 0;
  for (const match of matches) {
    pieces.push(text.slice(at, match.start), replacement);
    at = match.end;
  }
  pieces.push(text.slice(at));
  const next = stringValue(pieces.join(""), "바꾼 텍스트", limit);
  if (!paragraphs) return { text: next, paragraphs, count: matches.length };
  let offset = 0,
    index = 0;
  const updated = paragraphs.map((paragraph) => {
    const value = paragraph.runs.map((run) => run.text).join(""),
      end = offset + value.length;
    const within: SearchMatch[] = [];
    while (index < matches.length && matches[index].start < end) {
      const match = matches[index++];
      if (match.start < offset || match.end > end)
        throw new Error("여러 문단에 걸친 바꾸기는 지원하지 않습니다.");
      within.push({
        ...match,
        start: match.start - offset,
        end: match.end - offset,
      });
    }
    offset = end + 1;
    if (!within.length) return paragraph;
    const result = {
      ...paragraph,
      runs: replaceRuns(paragraph.runs, within, replacement),
    };
    if (
      result.bulletPrefix &&
      !result.runs
        .map((run) => run.text)
        .join("")
        .startsWith(result.bulletPrefix)
    ) {
      result.bulletPrefix = undefined;
      result.numbering = undefined;
    }
    return result;
  });
  if (paragraphText(updated) !== next)
    throw new Error("바꾼 텍스트의 문단을 확인하지 못했습니다.");
  validateParagraphs(updated, next);
  return { text: next, paragraphs: updated, count: matches.length };
}

export function replaceDocumentMatches(
  deck: Deck,
  matches: SearchMatch[],
  replacement: string,
) {
  if (/[\r\n]/.test(replacement))
    throw new Error("바꿀 내용은 한 줄로 입력해 주세요.");
  const grouped = new Map<string, SearchMatch[]>();
  for (const match of matches) {
    const key = JSON.stringify([match.slideId, match.elementId ?? null]);
    const group = grouped.get(key) ?? [];
    group.push(match);
    grouped.set(key, group);
  }
  let count = 0,
    skipped = 0;
  const slides = deck.slides.map((slide) => {
    let notes = slide.notes;
    const noteMatches = grouped.get(JSON.stringify([slide.id, null]));
    if (noteMatches) {
      const result = replaceField(
        notes,
        undefined,
        noteMatches,
        replacement,
        500000,
      );
      notes = result.text;
      count += result.count;
    }
    let changed = notes !== slide.notes;
    const elements = slide.elements.map((element) => {
      const group = grouped.get(JSON.stringify([slide.id, element.id]));
      if (!group) return element;
      if (element.locked || element.field) {
        skipped += group.length;
        return element;
      }
      if (element.table) {
        const table = element.table;
        const cellGroups = new Map<string, SearchMatch[]>();
        for (const match of group) {
          const key = `${match.row}:${match.column}`;
          const list = cellGroups.get(key) ?? [];
          list.push(match);
          cellGroups.set(key, list);
        }
        let cellCount = 0;
        const styles = table.cells.map((row, r) =>
          row.map((_, c) => table.cellStyles?.[r]?.[c] ?? null),
        );
        const cells = table.cells.map((row, r) =>
          row.map((text, c) => {
            const cellMatches = cellGroups.get(`${r}:${c}`) ?? [];
            if (!cellMatches.length) return text;
            const result = replaceField(
              text,
              styles[r][c]?.paragraphs,
              cellMatches,
              replacement,
              2000,
            );
            if (result.count && result.paragraphs)
              styles[r][c] = { ...styles[r][c], paragraphs: result.paragraphs };
            cellCount += result.count;
            return result.text;
          }),
        );
        if (!cellCount) return element;
        count += cellCount;
        changed = true;
        const updated = {
          ...table,
          cells,
          ...(table.cellStyles ? { cellStyles: styles } : {}),
        };
        return fitTableRows({ ...element, table: validateTable(updated) });
      }
      const result = replaceField(
        element.text ?? "",
        element.paragraphs,
        group,
        replacement,
      );
      if (!result.count) return element;
      count += result.count;
      changed = true;
      return {
        ...element,
        text: result.text,
        ...(element.paragraphs ? { paragraphs: result.paragraphs } : {}),
      } as SlideElement;
    });
    return changed ? { ...slide, notes, elements } : slide;
  });
  return { deck: count ? { ...deck, slides } : deck, count, skipped };
}
