import {
  Copy,
  Scissors,
  ClipboardPaste,
  Trash2,
  Type,
  Square,
  Palette,
  Paintbrush,
} from "lucide-react";
import ObjectContextMenu from "./ObjectContextMenu";

import { useCallback } from "react";
import { restoreTextSelection, type TextMenuSelection } from "./text-selection";

let browserTextClipboard: string | null = null;
export default function TextContextMenu({
  x,
  y,
  selection,
  onClose,
  onObjectMenu,
  onColor,
  onError,
  onCopyFormat,
  onPasteFormat,
}: {
  x: number;
  y: number;
  selection: TextMenuSelection;
  onClose: (finishEditing?: boolean) => void;
  onObjectMenu: () => void;
  onColor: () => void;
  onError: (message: string) => void;
  onCopyFormat?: () => void;
  onPasteFormat?: () => void;
}) {
  const close = useCallback(
    (restore = true) => {
      if (restore) restoreTextSelection(selection);
      onClose(!restore);
    },
    [selection, onClose],
  );
  const clipboard = async (action: "copy" | "cut" | "paste") => {
    restoreTextSelection(selection);
    try {
      if (window.desktop?.editTextClipboard) {
        await window.desktop.editTextClipboard(action);
        return;
      }
      if (action === "paste") {
        const text = await navigator.clipboard
          .readText()
          .catch(() => browserTextClipboard);
        if (text === null) throw new Error("clipboard unavailable");
        // Restore after awaiting browser permission, but never paste into another editor.
        if (
          !selection.host.isConnected ||
          document.activeElement !== selection.host
        )
          return;
        restoreTextSelection(selection);
        document.execCommand("insertText", false, text);
      } else {
        browserTextClipboard = selection.range.toString();
        if (!document.execCommand(action)) {
          await navigator.clipboard.writeText(browserTextClipboard);
          if (
            action === "cut" &&
            selection.host.isConnected &&
            document.activeElement === selection.host
          ) {
            restoreTextSelection(selection);
            document.execCommand("delete");
          }
        }
      }
    } catch {
      onError(
        "텍스트 클립보드를 사용할 수 없습니다. 키보드의 복사·붙여넣기를 사용해 주세요.",
      );
    }
  };
  return (
    <ObjectContextMenu
      x={x}
      y={y}
      label="텍스트 편집"
      textSelection={selection}
      onClose={close}
      actions={[
        ...(onCopyFormat ? [{ label: "서식 복사", icon: <Paintbrush size={16} />, run: () => { restoreTextSelection(selection); onCopyFormat(); } }] : []),
        ...(onCopyFormat ? [{ label: "서식 붙여넣기", icon: <Paintbrush size={16} />, disabled: !onPasteFormat || selection.range.collapsed, run: () => { restoreTextSelection(selection); onPasteFormat?.(); } }] : []),
        {
          label: "잘라내기",
          icon: <Scissors size={16} />,
          disabled: selection.range.collapsed,
          run: () => {
            void clipboard("cut");
          },
        },
        {
          label: "복사",
          icon: <Copy size={16} />,
          disabled: selection.range.collapsed,
          run: () => {
            void clipboard("copy");
          },
        },
        {
          label: "붙여넣기",
          icon: <ClipboardPaste size={16} />,
          run: () => {
            void clipboard("paste");
          },
        },
        {
          label: "삭제",
          icon: <Trash2 size={16} />,
          disabled: selection.range.collapsed,
          run: () => {
            restoreTextSelection(selection);
            document.execCommand("delete");
          },
        },
        {
          label: "글자 색",
          icon: <Palette size={16} />,
          disabled: selection.range.collapsed,
          separator: true,
          run: onColor,
        },
        {
          label: "모두 선택",
          icon: <Type size={16} />,
          separator: true,
          run: () => {
            restoreTextSelection(selection);
            const range = document.createRange();
            range.selectNodeContents(selection.host);
            const current = getSelection();
            current?.removeAllRanges();
            current?.addRange(range);
          },
        },
        {
          label: "텍스트 상자 메뉴",
          icon: <Square size={16} />,
          separator: true,
          run: onObjectMenu,
        },
      ]}
    />
  );
}
