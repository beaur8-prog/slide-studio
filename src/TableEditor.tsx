import { alphaColor } from "./colors";
import { useEffect, useRef, useState } from "react";
import type {
  ClipboardEvent as ReactClipboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { SlideElement, TableCellFormat, TableData } from "./types";
import { fontStack } from "./text-layout";
import { TextContent } from "./TextContent";
import { tableBorderSegments } from "./table-borders";
import NumberInput from "./NumberInput";
import EditableText from "./EditableText";
import type { TextFormatRange } from "./text-formatting";
import type { TextEdit } from "./text-layout";
import { parseTableClipboard, pasteTableClipboard } from "./table-clipboard";
import {
  changeTableAxis,
  applyTableCellFormat,
  createTable,
  fitTableText,
  MAX_CELL_TEXT,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  resizeTable,
  tableCellStyle,
  tableElementSize,
  tableSizes,
  tableMerge,
  mergeTableCells,
  visibleTableCells,
  patchCellFormat,
  validateTable,
} from "./table";
import type { TableCellRange } from "./table";
import "./table.css";

export type TableInlineEditing = {
  row: number;
  column: number;
  onInput: (text: string, formats?: TextFormatRange[], edit?: TextEdit) => void;
  onDone: () => void;
  onNavigate: (backward: boolean) => void;
};

export function TableVisual({
  element,
  selection,
  inlineEditing,
}: {
  element: SlideElement;
  selection?: TableCellRange;
  inlineEditing?: TableInlineEditing;
}) {
  const table = element.table;
  if (!table) return null;
  const widths = tableSizes(table.columnWidths, table.cells[0].length, 100);
  const heights = tableSizes(table.rowHeights, table.cells.length, 100);
  const borders = tableBorderSegments(element);
  return (
    <div
      className="inserted-table"
      role="table"
      aria-label="표"
      aria-rowcount={table.cells.length}
      aria-colcount={table.cells[0].length}
      style={{
        position: "relative",
        display: "grid",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        gridTemplateColumns: widths.map((n) => `${n}fr`).join(" "),
        gridTemplateRows: heights.map((n) => `${n}fr`).join(" "),
        fontFamily: fontStack(table.fontFamily),
        fontSize: table.fontSize,
        lineHeight: 1.2,
      }}
    >
      {table.cells.map((row, r) => (
        <div role="row" key={r} style={{ display: "contents" }}>
          {row.map((text, c) => {
            const merge = tableMerge(table, r, c);
            if (merge && (merge.row !== r || merge.column !== c)) return null;
            const style = tableCellStyle(table, r, c);
            const overrides = table.cellStyles?.[r]?.[c];
            const borderOverride =
              overrides &&
              (overrides.borderColor !== undefined ||
                overrides.borderWidth !== undefined);
            // Retain the text's existing content box when borders move to the
            // separate overlay. Only base CSS borders previously consumed space.
            const border =
              borderOverride || style.borders ? 0 : style.borderWidth;
            const padding =
              style.padding +
              (borderOverride && !style.borders ? style.borderWidth : 0);
            const insets = style.textInsets ?? [
              padding,
              padding,
              padding,
              padding,
            ];
            const selected =
              selection &&
              r >= selection.startRow &&
              r <= selection.endRow &&
              c >= selection.startColumn &&
              c <= selection.endColumn;
            return (
              <div
                key={c}
                data-row={r}
                data-column={c}
                className={selected ? "table-cell-selected" : undefined}
                role={table.header && r === 0 ? "columnheader" : "cell"}
                aria-rowspan={merge?.rowSpan}
                aria-colspan={merge?.columnSpan}
                style={{
                  position: "relative",
                  gridRow: `${r + 1} / span ${merge?.rowSpan ?? 1}`,
                  gridColumn: `${c + 1} / span ${merge?.columnSpan ?? 1}`,
                  boxSizing: "border-box",
                  minWidth: 0,
                  minHeight: 0,
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent:
                    style.verticalAlign === "middle"
                      ? "center"
                      : style.verticalAlign === "bottom"
                        ? "flex-end"
                        : "flex-start",
                  padding: [
                    insets[0] + (r === 0 ? border : 0),
                    insets[1] + border,
                    insets[2] + border,
                    insets[3] + (c === 0 ? border : 0),
                  ]
                    .map((n) => `${n}px`)
                    .join(" "),
                  fontSize: style.fontSize,
                  fontFamily: fontStack(style.fontFamily),
                  background: alphaColor(style.fill, style.fillOpacity),
                  color: alphaColor(style.color, style.textOpacity),
                  fontWeight: style.bold ? 700 : 400,
                  fontStyle: style.italic ? "italic" : "normal",
                  textDecoration: style.underline ? "underline" : undefined,
                  textAlign: style.align,
                  border: 0,
                }}
              >
                <div
                  className="table-cell-text"
                  style={{
                    minHeight: 0,
                    flexShrink: 0,
                    overflow: "visible",
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                  }}
                >
                  {inlineEditing?.row === r && inlineEditing.column === c ? (
                    <EditableText
                      key={`${r}-${c}`}
                      element={{
                        ...element,
                        ...style,
                        type: "text",
                        text,
                        table: undefined,
                        paragraphs: style.paragraphs,
                        textInsets: undefined,
                        fill: "transparent",
                        strokeWidth: 0,
                        borders: undefined,
                        autoHeight: false,
                        verticalAlign: "top",
                      }}
                      label={`${r + 1}행 ${c + 1}열 셀 텍스트 편집`}
                      initialSelection="end"
                      onInput={inlineEditing.onInput}
                      onDone={inlineEditing.onDone}
                      onNavigate={inlineEditing.onNavigate}
                    />
                  ) : style.paragraphs ? (
                    <TextContent
                      element={{
                        ...element,
                        type: "text",
                        text,
                        paragraphs: style.paragraphs,
                        fontFamily: style.fontFamily,
                        fontSize: style.fontSize,
                        color: style.color,
                        textOpacity: style.textOpacity,
                        bold: style.bold,
                        italic: style.italic,
                        underline: style.underline,
                        align: style.align,
                      }}
                    />
                  ) : (
                    text
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
      {!!borders.length && (
        <svg
          className="table-border-overlay"
          aria-hidden="true"
          focusable="false"
          viewBox={`0 0 ${element.width} ${element.height}`}
          preserveAspectRatio="none"
        >
          {borders.map(({ key, color, opacity, width, ...line }) => (
            <line
              key={key}
              {...line}
              stroke={color}
              strokeOpacity={opacity}
              strokeWidth={width}
            />
          ))}
        </svg>
      )}
    </div>
  );
}

export default function TableEditor({
  initial,
  initialRange,
  slideWidth = 1280,
  slideHeight = 720,
  elementSize,
  onApply,
  onCancel,
}: {
  initial?: TableData;
  initialRange?: TableCellRange;
  slideWidth?: number;
  slideHeight?: number;
  elementSize?: { width: number; height: number };
  onApply: (table: TableData) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => {
    const table = validateTable(initial ?? createTable());
    if (initial) return table;
    const size = tableElementSize(table.cells.length, slideWidth, slideHeight);
    return fitTableText(table, size.width, size.height);
  });
  const [anchor, setAnchor] = useState({
    row: initialRange?.startRow ?? 0,
    column: initialRange?.startColumn ?? 0,
  });
  const originalDraft = useRef(JSON.stringify(draft));
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const requestClose = () => {
    if (JSON.stringify(draft) !== originalDraft.current) {
      setError(
        "변경 내용이 아직 적용되지 않았습니다. 적용 버튼으로 저장하거나 취소 버튼으로 변경을 버리세요.",
      );
      return;
    }
    onCancel();
  };
  const [selected, setSelected] = useState({
    row: initialRange?.endRow ?? 0,
    column: initialRange?.endColumn ?? 0,
  });
  const [formatTarget, setFormatTarget] = useState<"table" | "selection">(
    initialRange ? "selection" : "table",
  );
  const range = {
    startRow: Math.min(anchor.row, selected.row),
    endRow: Math.max(anchor.row, selected.row),
    startColumn: Math.min(anchor.column, selected.column),
    endColumn: Math.max(anchor.column, selected.column),
  };
  const selectionCount =
    (range.endRow - range.startRow + 1) *
    (range.endColumn - range.startColumn + 1);
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  const preserveFocusSelection = useRef(false);
  const [error, setError] = useState("");
  const [autoSizing, setAutoSizing] = useState(!initial);
  const dialogRef = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    preserveFocusSelection.current = true;
    dialogRef.current
      ?.querySelector<HTMLTextAreaElement>(
        `textarea[data-row="${initialRange?.startRow ?? 0}"][data-column="${initialRange?.startColumn ?? 0}"]`,
      )
      ?.focus();
    preserveFocusSelection.current = false;
    return () => {
      dragCleanup.current?.();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  const rows = draft.cells.length,
    columns = draft.cells[0].length;
  const size = elementSize ?? tableElementSize(rows, slideWidth, slideHeight);
  const cellHeight = Math.min(
    ...tableSizes(draft.rowHeights, rows, size.height),
  );
  const textMayClip =
    draft.fontSize * 1.2 + draft.padding * 2 + draft.borderWidth * 2 >
    cellHeight;
  const sizeDefaults = (table: TableData) => {
    if (!autoSizing) return table;
    const { width, height } = tableElementSize(
      table.cells.length,
      slideWidth,
      slideHeight,
    );
    return fitTableText({ ...table, fontSize: 24, padding: 10 }, width, height);
  };
  const patch = (value: Partial<TableData>) =>
    setDraft((table) => ({ ...table, ...value }));
  const format = tableCellStyle(draft, selected.row, selected.column);
  const patchFormat = (value: TableCellFormat) =>
    setDraft((table) => {
      if (["bold", "italic", "underline"].some((key) => key in value))
        return applyTableCellFormat(
          table,
          formatTarget === "selection"
            ? range
            : {
                startRow: 0,
                endRow: rows - 1,
                startColumn: 0,
                endColumn: columns - 1,
              },
          value,
        );
      if (formatTarget === "selection")
        return applyTableCellFormat(table, range, value);
      const keys = Object.keys(value) as (keyof TableCellFormat)[];
      const cellStyles = table.cellStyles?.map((row) =>
        row.map((style) => {
          if (!style) return null;
          const next = patchCellFormat(style, value);
          keys.forEach((key) => delete next[key]);
          return Object.keys(next).length ? next : null;
        }),
      );
      return { ...table, ...value, ...(cellStyles ? { cellStyles } : {}) };
    });
  const clearCells = () =>
    setDraft((table) => ({
      ...table,
      cells: table.cells.map((row, r) =>
        row.map((text, c) =>
          r >= range.startRow &&
          r <= range.endRow &&
          c >= range.startColumn &&
          c <= range.endColumn
            ? ""
            : text,
        ),
      ),
    }));
  const copyCells = (event: ReactClipboardEvent) => {
    if (selectionCount < 2 || composing.current) return;
    event.preventDefault();
    event.stopPropagation();
    const quote = (text: string) =>
      /[\t\n\r"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    event.clipboardData.setData(
      "text/plain",
      draft.cells
        .slice(range.startRow, range.endRow + 1)
        .map((row) =>
          row
            .slice(range.startColumn, range.endColumn + 1)
            .map(quote)
            .join("\t"),
        )
        .join("\n"),
    );
    event.clipboardData.setData("application/x-slide-studio-table", "1");
    if (event.type === "cut") clearCells();
  };
  const selectCell = (row: number, column: number) => {
    setAnchor({ row, column });
    setSelected({ row, column });
  };
  const startSelection = (
    event: ReactPointerEvent<HTMLTextAreaElement>,
    row: number,
    column: number,
  ) => {
    if (event.button !== 0 || composing.current) return;
    dragCleanup.current?.();
    const start = event.shiftKey ? anchor : { row, column };
    if (!event.shiftKey) selectCell(row, column);
    else {
      event.preventDefault();
      setSelected({ row, column });
      setFormatTarget("selection");
    }
    let multiple = event.shiftKey;
    let clientX = event.clientX,
      clientY = event.clientY,
      frame = 0;
    const pointer = event.pointerId;
    const hit = () => {
      const viewport = scrollRef.current?.getBoundingClientRect();
      if (!viewport) return;
      const x = Math.max(
        viewport.left + 3,
        Math.min(viewport.right - 3, clientX),
      );
      const y = Math.max(
        viewport.top + 3,
        Math.min(viewport.bottom - 3, clientY),
      );
      const cell = document
        .elementFromPoint(x, y)
        ?.closest<HTMLTextAreaElement>("textarea[data-row][data-column]");
      if (!cell || !gridRef.current?.contains(cell)) return;
      const next = {
        row: Number(cell.dataset.row),
        column: Number(cell.dataset.column),
      };
      if (multiple || next.row !== start.row || next.column !== start.column) {
        multiple = true;
        setAnchor(start);
        setSelected(next);
        setFormatTarget("selection");
        gridRef.current?.classList.add("selecting-cells");
        if (document.activeElement instanceof HTMLTextAreaElement) {
          const input = document.activeElement;
          input.setSelectionRange(input.selectionStart, input.selectionStart);
        }
      }
    };
    const scroll = () => {
      const viewport = scrollRef.current;
      if (!viewport || !multiple) {
        frame = requestAnimationFrame(scroll);
        return;
      }
      const rect = viewport.getBoundingClientRect();
      const speed = (position: number, low: number, high: number) =>
        position < low + 24 ? -12 : position > high - 24 ? 12 : 0;
      const dx = speed(clientX, rect.left, rect.right),
        dy = speed(clientY, rect.top, rect.bottom);
      if (dx || dy) {
        viewport.scrollBy(dx, dy);
        hit();
      }
      frame = requestAnimationFrame(scroll);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      clientX = e.clientX;
      clientY = e.clientY;
      hit();
      if (multiple) e.preventDefault();
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      window.removeEventListener("blur", stop);
      scrollRef.current?.removeEventListener("scroll", hit);
      gridRef.current?.classList.remove("selecting-cells");
      dragCleanup.current = null;
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId === pointer) stop();
    };
    dragCleanup.current = stop;
    window.addEventListener("pointermove", move, {
      capture: true,
      passive: false,
    });
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    window.addEventListener("blur", stop);
    scrollRef.current?.addEventListener("scroll", hit);
    frame = requestAnimationFrame(scroll);
  };
  const resize = (rowCount: number, columnCount: number) => {
    if (
      !Number.isInteger(rowCount) ||
      !Number.isInteger(columnCount) ||
      rowCount < 1 ||
      rowCount > MAX_TABLE_ROWS ||
      columnCount < 1 ||
      columnCount > MAX_TABLE_COLUMNS
    )
      return;
    setDraft((table) =>
      sizeDefaults(resizeTable(table, rowCount, columnCount)),
    );
    setSelected(({ row, column }) => ({
      row: Math.min(row, rowCount - 1),
      column: Math.min(column, columnCount - 1),
    }));
    setAnchor(({ row, column }) => ({
      row: Math.min(row, rowCount - 1),
      column: Math.min(column, columnCount - 1),
    }));
    dragCleanup.current?.();
  };
  const changeAxis = (
    axis: "row" | "column",
    remove = false,
    before = false,
  ) => {
    const index = axis === "row" ? selected.row : selected.column;
    setDraft((table) =>
      sizeDefaults(
        changeTableAxis(
          table,
          axis,
          index + (remove || before ? 0 : 1),
          remove,
        ),
      ),
    );
    const nextCell = {
      row:
        axis === "row"
          ? Math.min(
              remove || before ? index : index + 1,
              rows + (remove ? -2 : 0),
            )
          : selected.row,
      column:
        axis === "column"
          ? Math.min(
              remove || before ? index : index + 1,
              columns + (remove ? -2 : 0),
            )
          : selected.column,
    };
    selectCell(nextCell.row, nextCell.column);
    dragCleanup.current?.();
  };
  const apply = () => {
    try {
      onApply(validateTable(draftRef.current));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <div
      className="modal-backdrop table-editor-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        ref={dialogRef}
        className="dialog table-editor-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={initial ? "표 편집" : "표 삽입"}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(event) => {
          if (
            composing.current ||
            event.nativeEvent.isComposing ||
            event.keyCode === 229
          ) {
            // Escape may cancel the IME candidate; it must not reach App's close handler.
            if (event.key === "Escape") event.stopPropagation();
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            requestClose();
          } else if (event.key === "Tab") {
            const controls = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                'button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]',
              ),
            ).filter(
              (node) => node.tabIndex >= 0 && node.getClientRects().length > 0,
            );
            const first = controls[0],
              last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div className="table-editor-heading">
          <div>
            <div className="dialog-eyebrow">TABLE</div>
            <h2>{initial ? "표 편집" : "표 삽입"}</h2>
          </div>
          <button
            className="icon-button"
            aria-label="표 편집 닫기"
            onClick={requestClose}
          >
            ×
          </button>
        </div>
        <div className="table-editor-toolbar">
          <button
            type="button"
            disabled={selectionCount < 2}
            onClick={() => {
              try {
                setDraft(mergeTableCells(draft, range));
              } catch (error) {
                setError((error as Error).message);
              }
            }}
          >
            셀 병합
          </button>
          <button
            type="button"
            disabled={!draft.merges?.length}
            onClick={() =>
              setDraft((table) => mergeTableCells(table, range, true))
            }
          >
            셀 나누기
          </button>

          <label>
            행{" "}
            <NumberInput
              aria-label="표 행 수"
              min={1}
              max={MAX_TABLE_ROWS}
              value={rows}
              onChange={(n) => resize(n, columns)}
            />
          </label>
          <label>
            열{" "}
            <NumberInput
              aria-label="표 열 수"
              min={1}
              max={MAX_TABLE_COLUMNS}
              value={columns}
              onChange={(n) => resize(rows, n)}
            />
          </label>
          <button
            disabled={rows >= MAX_TABLE_ROWS}
            onClick={() => changeAxis("row")}
          >
            행 추가
          </button>
          <button disabled={rows <= 1} onClick={() => changeAxis("row", true)}>
            행 삭제
          </button>
          <button
            disabled={rows >= MAX_TABLE_ROWS}
            onClick={() => changeAxis("row", false, true)}
          >
            위에 행 삽입
          </button>
          <button
            disabled={columns >= MAX_TABLE_COLUMNS}
            onClick={() => changeAxis("column")}
          >
            열 추가
          </button>
          <button
            disabled={columns <= 1}
            onClick={() => changeAxis("column", true)}
          >
            열 삭제
          </button>
          <button
            disabled={columns >= MAX_TABLE_COLUMNS}
            onClick={() => changeAxis("column", false, true)}
          >
            왼쪽에 열 삽입
          </button>
          <button
            onClick={() => {
              setAnchor({ row: 0, column: 0 });
              setSelected({ row: rows - 1, column: columns - 1 });
              setFormatTarget("selection");
            }}
          >
            전체 셀 선택
          </button>
          <button onClick={clearCells}>선택한 셀 내용 지우기</button>
          <label>
            <input
              type="checkbox"
              aria-label="내용에 맞춰 행 높이 늘리기"
              checked={!!draft.autoRows}
              onChange={(e) =>
                setDraft((t) => ({ ...t, autoRows: e.target.checked }))
              }
            />
            내용에 맞춰 행 높이 늘리기
          </label>
        </div>
        <div
          className="table-selection-status"
          role="status"
          aria-live="polite"
        >
          {selectionCount}개 셀 선택 · {range.startRow + 1}행{" "}
          {range.startColumn + 1}열–{range.endRow + 1}행 {range.endColumn + 1}열
        </div>
        <div className="table-editor-body">
          <div className="table-editor-grid-scroll" ref={scrollRef}>
            <div
              ref={gridRef}
              className="table-editor-grid"
              onKeyDown={(event) => {
                if (
                  composing.current ||
                  event.nativeEvent.isComposing ||
                  event.keyCode === 229 ||
                  selectionCount < 2
                )
                  return;
                if (event.key === "Delete" || event.key === "Backspace") {
                  event.preventDefault();
                  event.stopPropagation();
                  clearCells();
                } else if (
                  (event.ctrlKey || event.metaKey) &&
                  event.key.toLowerCase() === "a"
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  setAnchor({ row: 0, column: 0 });
                  setSelected({ row: rows - 1, column: columns - 1 });
                }
              }}
              onCopy={copyCells}
              onCut={copyCells}
              style={{
                gridTemplateColumns: `repeat(${columns}, minmax(120px, 1fr))`,
              }}
            >
              {draft.cells.map((row, r) =>
                row.map((text, c) => {
                  const merge = tableMerge(draft, r, c);
                  if (merge && (merge.row !== r || merge.column !== c))
                    return null;
                  const style = tableCellStyle(draft, r, c);
                  return (
                    <textarea
                      key={`${r}-${c}`}
                      data-row={r}
                      data-column={c}
                      aria-label={`${r + 1}행 ${c + 1}열`}
                      maxLength={MAX_CELL_TEXT}
                      className={
                        r >= range.startRow &&
                        r <= range.endRow &&
                        c >= range.startColumn &&
                        c <= range.endColumn
                          ? "selected-cell"
                          : ""
                      }
                      style={{
                        gridColumn: `${c + 1} / span ${merge?.columnSpan ?? 1}`,
                        gridRow: `${r + 1} / span ${merge?.rowSpan ?? 1}`,
                        background: alphaColor(style.fill, style.fillOpacity),
                        color: alphaColor(style.color, style.textOpacity),
                        fontWeight: style.bold ? 700 : 400,
                        fontStyle: style.italic ? "italic" : "normal",
                        textDecoration: style.underline ? "underline" : "none",
                        textAlign: style.align,
                        borderColor: alphaColor(
                          style.borderColor,
                          style.strokeOpacity,
                        ),
                        fontFamily: fontStack(style.fontFamily),
                      }}
                      value={text}
                      onPaste={(event) => {
                        const text = event.clipboardData.getData("text/plain");
                        if (
                          !text.includes("\t") &&
                          !event.clipboardData
                            .getData("text/html")
                            .includes("<table") &&
                          !event.clipboardData.getData(
                            "application/x-slide-studio-table",
                          )
                        )
                          return;
                        event.preventDefault();
                        event.stopPropagation();
                        try {
                          const source = parseTableClipboard(text);
                          setDraft(pasteTableClipboard(draft, r, c, source));
                          setAnchor({ row: r, column: c });
                          setSelected({
                            row: r + source.length - 1,
                            column: c + source[0].length - 1,
                          });
                        } catch (error) {
                          setError(
                            error instanceof Error
                              ? error.message
                              : "표 데이터를 붙여넣지 못했습니다.",
                          );
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.nativeEvent.isComposing || composing.current)
                          return;
                        if (event.key === "F6") {
                          event.preventDefault();
                          dialogRef.current
                            ?.querySelector<HTMLElement>(
                              ".table-editor-options select",
                            )
                            ?.focus();
                          return;
                        }
                        if (
                          event.key !== "Tab" ||
                          event.ctrlKey ||
                          event.metaKey ||
                          event.altKey
                        )
                          return;
                        const visible = visibleTableCells(draft),
                          index = visible.findIndex(
                            (cell) => cell.row === r && cell.column === c,
                          ),
                          target = visible[index + (event.shiftKey ? -1 : 1)];
                        if (!target && event.shiftKey) return;
                        if (!target && rows >= MAX_TABLE_ROWS) return;
                        event.preventDefault();
                        event.stopPropagation();
                        const next = target ?? { row: rows, column: 0 };
                        if (!target)
                          setDraft((table) =>
                            changeTableAxis(table, "row", rows),
                          );
                        setAnchor(next);
                        setSelected(next);
                        requestAnimationFrame(() =>
                          gridRef.current
                            ?.querySelector<HTMLTextAreaElement>(
                              `textarea[data-row="${next.row}"][data-column="${next.column}"]`,
                            )
                            ?.focus(),
                        );
                      }}
                      onPointerDown={(event) => startSelection(event, r, c)}
                      onFocus={() => {
                        if (
                          !dragCleanup.current &&
                          !preserveFocusSelection.current
                        )
                          selectCell(r, c);
                      }}
                      onChange={(e) => {
                        if (selectionCount > 1) selectCell(r, c);
                        const value = e.target.value;
                        setDraft((table) => ({
                          ...table,
                          cells: table.cells.map((cells, rowIndex) =>
                            rowIndex === r
                              ? cells.map((cell, columnIndex) =>
                                  columnIndex === c ? value : cell,
                                )
                              : cells,
                          ),
                        }));
                      }}
                    />
                  );
                }),
              )}
            </div>
          </div>
          <div className="table-editor-options">
            <div className="table-inline-format-controls">
              {(
                [
                  ["bold", "셀 굵게"],
                  ["italic", "셀 기울임"],
                  ["underline", "셀 밑줄"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-label={label}
                  aria-pressed={format[key]}
                  onClick={() => patchFormat({ [key]: !format[key] })}
                >
                  {label}
                </button>
              ))}
            </div>

            <label>
              서식 적용 대상
              <select
                aria-label="서식 적용 대상"
                value={formatTarget}
                onChange={(event) =>
                  setFormatTarget(event.target.value as "table" | "selection")
                }
              >
                <option value="table">표 전체</option>
                <option value="selection">선택한 셀</option>
              </select>
            </label>
            <label className="table-option-check">
              <input
                type="checkbox"
                checked={draft.header}
                onChange={(e) => patch({ header: e.target.checked })}
              />
              머리글 행
            </label>
            <label className="table-option-check">
              <input
                type="checkbox"
                checked={draft.striped}
                onChange={(e) => patch({ striped: e.target.checked })}
              />
              줄무늬 행
            </label>
            {(
              [
                ["headerFill", "머리글 배경"],
                ["headerColor", "머리글 글자색"],
                ["fill", "셀 배경"],
                ["stripeFill", "줄무늬 색"],
                ["color", "셀 글자색"],
                ["borderColor", "테두리 색"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  aria-label={label}
                  type="color"
                  value={
                    formatTarget === "selection" &&
                    (key === "fill" || key === "color" || key === "borderColor")
                      ? format[key]
                      : draft[key]
                  }
                  onChange={(e) =>
                    key === "fill" || key === "color" || key === "borderColor"
                      ? patchFormat({ [key]: e.target.value })
                      : patch({ [key]: e.target.value })
                  }
                />
              </label>
            ))}
            <label>
              글꼴
              <select
                aria-label="표 글꼴"
                value={
                  formatTarget === "selection"
                    ? format.fontFamily
                    : draft.fontFamily
                }
                onChange={(e) => patchFormat({ fontFamily: e.target.value })}
              >
                {[
                  ...new Set([
                    draft.fontFamily,
                    format.fontFamily,
                    "Arial",
                    "Calibri",
                    "맑은 고딕",
                    "Segoe UI",
                    "Georgia",
                  ]),
                ].map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            {(
              [
                ["fontSize", "표 글자 크기", 6, 144],
                ["borderWidth", "테두리 두께", 0, 12],
                ["padding", "셀 안쪽 여백", 0, 60],
              ] as const
            ).map(([key, label, min, max]) => (
              <label key={key}>
                {label}
                <NumberInput
                  aria-label={label}
                  min={min}
                  max={max}
                  value={
                    formatTarget === "selection" ? format[key] : draft[key]
                  }
                  onChange={(value) => {
                    if (
                      Number.isFinite(value) &&
                      value >= min &&
                      value <= max
                    ) {
                      if (key === "fontSize" || key === "padding")
                        setAutoSizing(false);
                      patchFormat({ [key]: value });
                    }
                  }}
                />
              </label>
            ))}
            <button
              type="button"
              title="표 전체의 글자와 여백을 셀 크기에 맞춥니다"
              onClick={() => {
                setAutoSizing(false);
                setDraft((table) =>
                  fitTableText(table, size.width, size.height),
                );
              }}
            >
              셀에 맞게 줄이기
            </button>
            <label>
              가로 정렬
              <select
                aria-label="표 가로 정렬"
                value={
                  formatTarget === "selection" ? format.align : draft.align
                }
                onChange={(e) =>
                  patchFormat({ align: e.target.value as TableData["align"] })
                }
              >
                <option value="left">왼쪽</option>
                <option value="center">가운데</option>
                <option value="right">오른쪽</option>
              </select>
            </label>
            <label>
              세로 정렬
              <select
                aria-label="표 세로 정렬"
                value={
                  formatTarget === "selection"
                    ? format.verticalAlign
                    : draft.verticalAlign
                }
                onChange={(e) =>
                  patchFormat({
                    verticalAlign: e.target.value as TableData["verticalAlign"],
                  })
                }
              >
                <option value="top">위쪽</option>
                <option value="middle">가운데</option>
                <option value="bottom">아래쪽</option>
              </select>
            </label>
          </div>
        </div>
        <p className="table-editor-hint">
          다른 셀까지 드래그하거나 Shift+클릭으로 여러 셀을 선택하세요. 한 셀
          안에서는 글자를 선택할 수 있습니다. 행·열 추가는 선택한 마지막 셀 뒤에
          적용됩니다. 머리글·줄무늬와 셀에 맞게 줄이기는 표 전체에 적용됩니다.
          {!initial &&
            autoSizing &&
            " 새 표의 기본 글자 크기와 여백은 행·열 수에 맞춰 조정됩니다."}
          {textMayClip &&
            " 현재 크기에서는 글자가 잘릴 수 있습니다. 글자·여백을 줄이거나 표를 크게 조절하세요."}
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button
            className="button"
            onClick={onCancel}
            onPointerDown={(event) => {
              if (event.button === 0) {
                event.preventDefault();
                onCancel();
              }
            }}
          >
            취소
          </button>
          <button
            className="button primary"
            onClick={apply}
            onPointerDown={(event) => {
              // Keep pointerup/click on this button while a number-field blur
              // commits and recenters the dialog. Apply reads that new draft.
              if (event.button === 0)
                event.currentTarget.setPointerCapture(event.pointerId);
            }}
          >
            {initial ? "표 적용" : "표 삽입"}
          </button>
        </div>
      </div>
    </div>
  );
}
