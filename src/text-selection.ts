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
