import { useEffect, useRef, useState } from "react";
import type { SlideElement, TableData } from "./types";
import { fontStack } from "./text-layout";
import {
  changeTableAxis,
  createTable,
  fitTableText,
  MAX_CELL_TEXT,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  resizeTable,
  tableCellStyle,
  tableElementSize,
  tableSizes,
  validateTable,
} from "./table";
import "./table.css";

export function TableVisual({ element }: { element: SlideElement }) {
  const table = element.table;
  if (!table) return null;
  const widths = tableSizes(table.columnWidths, table.cells[0].length, 100);
  const heights = tableSizes(table.rowHeights, table.cells.length, 100);
  return (
    <div
      className="inserted-table"
      role="table"
      aria-label="표"
      aria-rowcount={table.cells.length}
      aria-colcount={table.cells[0].length}
      style={{
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
            const style = tableCellStyle(table, r);
            return (
              <div
                key={c}
                role={table.header && r === 0 ? "columnheader" : "cell"}
                style={{
                  boxSizing: "border-box",
                  minWidth: 0,
                  minHeight: 0,
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent:
                    table.verticalAlign === "middle"
                      ? "center"
                      : table.verticalAlign === "bottom"
                        ? "flex-end"
                        : "flex-start",
                  padding: table.padding,
                  background: style.fill,
                  color: style.color,
                  fontWeight: style.bold ? 700 : 400,
                  textAlign: table.align,
                  borderColor: table.borderColor,
                  borderStyle: "solid",
                  borderWidth: `${r === 0 ? table.borderWidth : 0}px ${table.borderWidth}px ${table.borderWidth}px ${c === 0 ? table.borderWidth : 0}px`,
                }}
              >
                <div
                  style={{
                    minHeight: 0,
                    overflow: "hidden",
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                  }}
                >
                  {text}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default function TableEditor({
  initial,
  slideWidth = 1280,
  slideHeight = 720,
  elementSize,
  onApply,
  onCancel,
}: {
  initial?: TableData;
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
  const [selected, setSelected] = useState({ row: 0, column: 0 });
  const [error, setError] = useState("");
  const [autoSizing, setAutoSizing] = useState(!initial);
  const dialogRef = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialogRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    return () => {
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
  };
  const changeAxis = (axis: "row" | "column", remove = false) => {
    const index = axis === "row" ? selected.row : selected.column;
    setDraft((table) =>
      sizeDefaults(
        changeTableAxis(table, axis, index + (remove ? 0 : 1), remove),
      ),
    );
    setSelected((cell) => ({
      row:
        axis === "row"
          ? Math.min(remove ? index : index + 1, rows + (remove ? -2 : 0))
          : cell.row,
      column:
        axis === "column"
          ? Math.min(remove ? index : index + 1, columns + (remove ? -2 : 0))
          : cell.column,
    }));
  };
  const apply = () => {
    try {
      onApply(validateTable(draft));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <div
      className="modal-backdrop table-editor-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
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
            onCancel();
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
            onClick={onCancel}
          >
            ×
          </button>
        </div>
        <div className="table-editor-toolbar">
          <label>
            행{" "}
            <input
              aria-label="표 행 수"
              type="number"
              min="1"
              max={MAX_TABLE_ROWS}
              value={rows}
              onChange={(e) => resize(Number(e.target.value), columns)}
            />
          </label>
          <label>
            열{" "}
            <input
              aria-label="표 열 수"
              type="number"
              min="1"
              max={MAX_TABLE_COLUMNS}
              value={columns}
              onChange={(e) => resize(rows, Number(e.target.value))}
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
        </div>
        <div className="table-editor-body">
          <div className="table-editor-grid-scroll">
            <div
              className="table-editor-grid"
              style={{
                gridTemplateColumns: `repeat(${columns}, minmax(120px, 1fr))`,
              }}
            >
              {draft.cells.map((row, r) =>
                row.map((text, c) => {
                  const style = tableCellStyle(draft, r);
                  return (
                    <textarea
                      key={`${r}-${c}`}
                      aria-label={`${r + 1}행 ${c + 1}열`}
                      maxLength={MAX_CELL_TEXT}
                      className={
                        selected.row === r && selected.column === c
                          ? "selected-cell"
                          : ""
                      }
                      style={{
                        background: style.fill,
                        color: style.color,
                        fontWeight: style.bold ? 700 : 400,
                        textAlign: draft.align,
                        borderColor: draft.borderColor,
                      }}
                      value={text}
                      onFocus={() => setSelected({ row: r, column: c })}
                      onChange={(e) => {
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
                  value={draft[key]}
                  onChange={(e) => patch({ [key]: e.target.value })}
                />
              </label>
            ))}
            <label>
              글꼴
              <select
                aria-label="표 글꼴"
                value={draft.fontFamily}
                onChange={(e) => patch({ fontFamily: e.target.value })}
              >
                {[
                  ...new Set([
                    draft.fontFamily,
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
                <input
                  aria-label={label}
                  type="number"
                  min={min}
                  max={max}
                  value={draft[key]}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    if (
                      Number.isFinite(value) &&
                      value >= min &&
                      value <= max
                    ) {
                      if (key === "fontSize" || key === "padding")
                        setAutoSizing(false);
                      patch({ [key]: value });
                    }
                  }}
                />
              </label>
            ))}
            <button
              type="button"
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
                value={draft.align}
                onChange={(e) =>
                  patch({ align: e.target.value as TableData["align"] })
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
                value={draft.verticalAlign}
                onChange={(e) =>
                  patch({
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
          셀을 선택해 내용을 입력하세요. 행·열 추가는 선택한 셀 뒤에 적용됩니다.
          {!initial &&
            autoSizing &&
            " 새 표의 기본 글자 크기와 여백은 행·열 수에 맞춰 조정됩니다."}
          {textMayClip &&
            " 현재 크기에서는 글자가 잘릴 수 있습니다. 글자·여백을 줄이거나 표를 크게 조절하세요."}
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button className="button" onClick={onCancel}>
            취소
          </button>
          <button className="button primary" onClick={apply}>
            {initial ? "표 적용" : "표 삽입"}
          </button>
        </div>
      </div>
    </div>
  );
}
