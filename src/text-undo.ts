import type { Deck } from "./types";
export type TextUndoEntry = {
  snapshot: Deck;
  key: string;
  text: string;
  time: number;
  inputType: string;
  boundary: boolean;
};
export type TextUndoSession = {
  entries: TextUndoEntry[];
  cursor: number;
  atomic?: boolean;
};
export function textUndoKey(
  deck: Deck,
  id: string,
  row?: number,
  column?: number,
) {
  const el = deck.slides.flatMap((s) => s.elements).find((e) => e.id === id);
  if (row !== undefined && column !== undefined && el?.table)
    return {
      key: JSON.stringify([
        el.table.cells[row][column],
        el.table.cellStyles?.[row]?.[column],
      ]),
      text: el.table.cells[row][column],
    };
  return {
    key: JSON.stringify([el?.text, el?.paragraphs]),
    text: el?.text ?? "",
  };
}
export function recordTextUndo(
  session: TextUndoSession | undefined,
  before: Deck,
  after: Deck,
  id: string,
  inputType: string,
  row?: number,
  column?: number,
): TextUndoSession {
  const now = Date.now(),
    previous = textUndoKey(before, id, row, column),
    current = textUndoKey(after, id, row, column);
  const base = session ?? {
    entries: [
      {
        snapshot: before,
        ...previous,
        time: now,
        inputType: "",
        boundary: true,
      },
    ],
    cursor: 0,
  };
  if (current.key === previous.key) return base;
  if (inputType.startsWith("history")) {
    let index = -1;
    for (let i = base.entries.length - 1; i >= 0; i--)
      if (base.entries[i].key === current.key) {
        index = i;
        break;
      }
    return index >= 0 ? { ...base, cursor: index } : { ...base, atomic: true };
  }
  if (base.atomic || base.entries.length >= 240)
    return { ...base, atomic: true };
  const last = base.entries[base.cursor],
    category = (type: string) =>
      type.startsWith("delete")
        ? "delete"
        : type.startsWith("format")
          ? "format"
          : "insert";
  let at = 0;
  while (
    at < previous.text.length &&
    at < current.text.length &&
    previous.text[at] === current.text[at]
  )
    at++;
  const boundary =
    base.cursor > 0 &&
    (now - last.time > 1200 ||
      category(inputType) !== category(last.inputType) ||
      inputType.startsWith("format") ||
      /Paste|Paragraph|LineBreak/.test(inputType) ||
      /Paste|Paragraph|LineBreak/.test(last.inputType) ||
      (/\s/.test(previous.text[at - 1] ?? "") &&
        /\S/.test(current.text[at] ?? "")));
  const entries = [
    ...base.entries.slice(0, base.cursor + 1),
    { snapshot: after, ...current, time: now, inputType, boundary },
  ];
  return { entries, cursor: entries.length - 1 };
}
export function textUndoCheckpoints(session: TextUndoSession): Deck[] {
  if (session.atomic) return [session.entries[0].snapshot];
  const checkpoints = [session.entries[0].snapshot];
  for (let i = 1; i <= session.cursor; i++)
    if (session.entries[i].boundary)
      checkpoints.push(session.entries[i - 1].snapshot);
  return checkpoints.filter(
    (deck, i) => i === 0 || deck !== checkpoints[i - 1],
  );
}
