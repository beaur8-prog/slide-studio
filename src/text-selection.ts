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
