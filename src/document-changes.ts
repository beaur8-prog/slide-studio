import type { Deck } from "./types";

// Documents are immutable plain data. Compare shared branches by identity and
// only walk changed branches; do not serialize/copy large embedded media.
export function sameValue(
  left: unknown,
  right: unknown,
  derived = false,
): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object")
    return false;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, i) => sameValue(value, right[i], derived))
    );
  const a = left as Record<string, unknown>,
    b = right as Record<string, unknown>;
  const automaticHeight = (value: Record<string, unknown>) =>
    value.type === "text" &&
    value.autoHeight === true &&
    (!value.writingMode || value.writingMode === "horizontal") &&
    (value.textColumns ?? 1) === 1;
  // Browser font metrics can resolve lazily while a slide is only being read.
  // Its measured height is derived. Width, text, formatting and turning off
  // automatic height (e.g. a manual vertical resize) remain authored changes.
  const measured = derived && automaticHeight(a) && automaticHeight(b);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (measured && key === "height") continue;
    // An omitted optional property and an explicit undefined serialize equally.
    if (!sameValue(a[key], b[key], derived)) return false;
  }
  return true;
}

export function sameDocument(left: Deck | null, right: Deck | null): boolean {
  return sameValue(left, right, true);
}
