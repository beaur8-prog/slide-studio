import { richClipboardHtml } from "./rich-clipboard";
import { useRef, useEffect, useLayoutEffect } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SlideElement, TextParagraph } from "./types";
import { TextContent } from "./TextContent";
import { editableText, editText, type TextEdit } from "./text-layout";
import { useTextHeight, textStyle } from "./text-geometry";
import {
  applyTextFormatRanges,
  editableTextFormatRanges,
  trackTextFormat,
  applyPendingFontSize,
  type TextFormatRange,
} from "./text-formatting";
import { textPointOffset, restoreTextOffsets } from "./text-selection";
import { PAINT_TEXT_EVENT, paintTextRange, type PaintTextDetail } from "./format-painter";
import {
  continueTextBullet,
  toggleTextBullets,
  toggleTextNumbering,
  textParagraphSelection,
  remapBulletOffset,
  hasTextBullets,
} from "./text-bullets";
export default function EditableText({
  element,
  onInput,
  onDone,
  onHeight,
  label = "슬라이드 텍스트 편집",
  initialSelection = "all",
  initialPoint,
  onNavigate,
}: {
  element: SlideElement;
  onInput: (text: string, formats?: TextFormatRange[], edit?: TextEdit) => void;
  onDone: () => void;
  onHeight?: (id: string, height: number) => void;
  label?: string;
  initialSelection?: "all" | "end";
  initialPoint?: { x: number; y: number };
  onNavigate?: (backward: boolean) => void;
}) {
  const ref = useTextHeight(element, onHeight);
  const initial = useRef(<TextContent element={element} editing />);
  const inputEdit = useRef<TextEdit | undefined>(undefined);
  const pastedRange = useRef<{ start: number; length: number } | null>(null);
  const commandParagraphs = useRef<TextParagraph[] | undefined>(undefined);
  const listHistory = useRef(
    new Map<
      string,
      { paragraphs: TextParagraph[]; start: number; end: number }
    >(),
  );
  const listSelection = () => {
    const host = ref.current,
      selection = getSelection();
    if (!host || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (
      !host.contains(range.startContainer) ||
      !host.contains(range.endContainer)
    )
      return;
    const start = textPointOffset(
        host,
        range.startContainer,
        range.startOffset,
      ),
      end = textPointOffset(host, range.endContainer, range.endOffset);
    return {
      host,
      start,
      end,
      indices: textParagraphSelection(element, start, end),
    };
  };
  const applyList = (
    next: SlideElement,
    range: NonNullable<ReturnType<typeof listSelection>>,
  ) => {
    const { host, start, end } = range;
    const old =
      element.paragraphs ??
      (element.text ?? "").split("\n").map((text) => ({ runs: [{ text }] }));
    listHistory.current.set(host.innerHTML, { paragraphs: old, start, end });
    commandParagraphs.current = next.paragraphs;
    const selection = getSelection(),
      entire = document.createRange();
    entire.selectNodeContents(host);
    selection?.removeAllRanges();
    selection?.addRange(entire);
    document.execCommand(
      "insertHTML",
      false,
      renderToStaticMarkup(<TextContent element={next} editing />),
    );
    const nextStart = remapBulletOffset(element, next, start),
      nextEnd = remapBulletOffset(element, next, end);
    listHistory.current.set(host.innerHTML, {
      paragraphs: next.paragraphs!,
      start: nextStart,
      end: nextEnd,
    });
    if (listHistory.current.size > 20)
      listHistory.current.delete(listHistory.current.keys().next().value!);
    restoreTextOffsets(host, nextStart, nextEnd);
  };
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const toggle = () => {
      const range = listSelection();
      if (range) applyList(toggleTextBullets(element, range.indices), range);
    };
    const numbers = () => {
      const range = listSelection();
      if (range) applyList(toggleTextNumbering(element, range.indices), range);
    };
    const paint = (event: Event) => {
      const range = listSelection(), detail = (event as CustomEvent<PaintTextDetail>).detail;
      if (!range || range.end <= range.start || !detail?.sample.text || element.locked) return;
      const next = paintTextRange(element, detail.sample, range.start, range.end);
      detail.applied = true;
      if (next !== element) applyList(next, range);
    };
    host.addEventListener("slide-studio:toggle-numbering", numbers);
    host.addEventListener("slide-studio:toggle-bullets", toggle);
    host.addEventListener(PAINT_TEXT_EVENT, paint);
    return () => {
      host.removeEventListener("slide-studio:toggle-numbering", numbers);
      host.removeEventListener("slide-studio:toggle-bullets", toggle);
      host.removeEventListener(PAINT_TEXT_EVENT, paint);
    };
  }, [element]);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    const beforeInput = (event: InputEvent) => {
      const selection = getSelection();
      const source =
        event.getTargetRanges()[0] ??
        (selection?.rangeCount ? selection.getRangeAt(0) : undefined);
      inputEdit.current =
        source &&
        host.contains(source.startContainer) &&
        host.contains(source.endContainer)
          ? {
              start: textPointOffset(
                host,
                source.startContainer,
                source.startOffset,
              ),
              end: textPointOffset(host, source.endContainer, source.endOffset),
              softBreak: event.inputType === "insertLineBreak",
            }
          : undefined;
    };
    host.addEventListener("beforeinput", beforeInput);
    return () => host.removeEventListener("beforeinput", beforeInput);
  }, []);
  useLayoutEffect(() => {
    if (!ref.current) return;
    ref.current.focus();
    if (initialPoint) {
      const point = (
        document as Document & {
          caretRangeFromPoint?: (x: number, y: number) => Range | null;
        }
      ).caretRangeFromPoint?.(initialPoint.x, initialPoint.y);
      if (point && ref.current.contains(point.startContainer)) {
        const sel = getSelection();
        sel?.removeAllRanges();
        sel?.addRange(point);
        sel?.modify("move", "backward", "word");
        sel?.modify("extend", "forward", "word");
        return;
      }
    }
    const range = document.createRange();
    range.selectNodeContents(ref.current);
    if (initialSelection === "end") range.collapse(false);
    const sel = getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, []);
  return (
    <div
      ref={ref}
      className="element-text editing-text"
      contentEditable
      role="textbox"
      aria-label={label}
      suppressContentEditableWarning
      spellCheck={false}
      style={textStyle(element)}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.button === 2) e.preventDefault();
      }}
      onMouseDown={(e) => {
        if (e.button === 2) e.preventDefault();
      }}
      onBlur={(e) => {
        if (
          e.relatedTarget instanceof Element &&
          e.relatedTarget.closest(
            ".object-context-menu, .text-color-palette, [data-text-format-trigger], [data-text-selection-control]",
          )
        )
          return;
        onDone();
      }}
      onInput={(e) => {
        const host = e.currentTarget;
        const type = (e.nativeEvent as InputEvent).inputType || "";
        applyPendingFontSize(host);
        trackTextFormat(host, type);
        let edit = inputEdit.current;
        inputEdit.current = undefined;
        const history = type.startsWith("history")
          ? listHistory.current.get(host.innerHTML)
          : undefined;
        const paragraphs = commandParagraphs.current ?? history?.paragraphs;
        commandParagraphs.current = undefined;
        if (paragraphs)
          edit = {
            start: 0,
            end: element.text?.length ?? 0,
            softBreak: false,
            paragraphs,
          };
        const text = editableText(host),
          paste = pastedRange.current;
        let formats = host.dataset.textFormats
          ? editableTextFormatRanges(host)
          : undefined;
        if (paste) {
          pastedRange.current = null;
          const end = paste.start + paste.length;
          formats = formats
            ?.filter((f) => f.end > paste.start && f.start < end)
            .map((f) => ({
              ...f,
              start: Math.max(f.start, paste.start),
              end: Math.min(f.end, end),
            }));
          const next = applyTextFormatRanges(
            editText(element, text, edit?.softBreak, edit),
            formats ?? [],
          );
          listHistory.current.set(host.innerHTML, {
            paragraphs: next.paragraphs!,
            start: end,
            end,
          });
        }
        onInput(text, formats, {
          ...(edit ?? { start: -1, end: -1, softBreak: false }),
          inputType: type,
        });
        if (history) restoreTextOffsets(host, history.start, history.end);
      }}
      onKeyDown={(e) => {
        if (e.key === "Tab" && onNavigate && !e.nativeEvent.isComposing) {
          e.preventDefault();
          e.stopPropagation();
          onNavigate(e.shiftKey);
          return;
        }
        // Let the object wrapper handle the context-menu keyboard shortcut,
        // including while this contenteditable owns the selection.
        if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) return;
        e.stopPropagation();
        if (
          !e.nativeEvent.isComposing &&
          ["Tab", "Backspace", "Enter"].includes(e.key)
        ) {
          const range = listSelection();
          if (
            range?.indices.length &&
            (hasTextBullets(element, range.indices) ||
              range.indices.some((i) => element.paragraphs?.[i].numbering))
          ) {
            const paragraphs: TextParagraph[] =
                element.paragraphs ??
                (element.text ?? "")
                  .split("\n")
                  .map((text) => ({ bulletPrefix: "• ", runs: [{ text }] })),
              index = range.indices[0],
              p = paragraphs[index];
            const prefix = p.bulletPrefix ?? "• ";
            const text = p.runs.map((r) => r.text).join("");
            const before = paragraphs
              .slice(0, index)
              .reduce(
                (sum, p) => sum + p.runs.map((r) => r.text).join("").length + 1,
                0,
              );
            const atStart =
              range.start === range.end &&
              range.start === before + prefix.length;
            if (
              (e.key === "Enter" &&
                !e.shiftKey &&
                text.slice(prefix.length).trim() === "") ||
              (e.key === "Backspace" && atStart)
            ) {
              e.preventDefault();
              applyList(
                toggleTextBullets(element, range.indices, false),
                range,
              );
              return;
            }
            if (e.key === "Tab") {
              e.preventDefault();
              const next = {
                ...element,
                paragraphs: paragraphs.map((p, i) =>
                  range.indices.includes(i)
                    ? {
                        ...p,
                        level: Math.max(
                          0,
                          Math.min(8, (p.level ?? 0) + (e.shiftKey ? -1 : 1)),
                        ),
                        marginLeft: Math.max(
                          -(p.indent ?? 0),
                          (p.marginLeft ?? 0) + (e.shiftKey ? -24 : 24),
                        ),
                      }
                    : p,
                ),
              };
              applyList(next, range);
              return;
            }
          }
        }
        if (
          e.key === "Enter" &&
          !e.shiftKey &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey &&
          !e.nativeEvent.isComposing &&
          continueTextBullet(e.currentTarget, element)
        )
          e.preventDefault();
        if (e.key === "Escape") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      onPaste={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const host = e.currentTarget,
          html = richClipboardHtml(e.clipboardData.getData("text/html"));
        const range = listSelection();
        if (html && range) {
          const content = document.createElement("div");
          content.innerHTML = html;
          const previous = host.dataset.textFormats;
          const old =
            element.paragraphs ??
            (element.text ?? "")
              .split("\n")
              .map((text) => ({ runs: [{ text }] }));
          listHistory.current.set(host.innerHTML, {
            paragraphs: old,
            start: range.start,
            end: range.end,
          });
          pastedRange.current = {
            start: range.start,
            length: editableText(content).length,
          };
          host.dataset.textFormats =
            "bold italic underline color fontFamily fontSize align";
          document.execCommand("insertHTML", false, html);
          if (previous) host.dataset.textFormats = previous;
          else delete host.dataset.textFormats;
          return;
        }
        const text = e.clipboardData.getData("text/plain");
        document.execCommand("insertText", false, text);
      }}
    >
      {initial.current}
    </div>
  );
}
