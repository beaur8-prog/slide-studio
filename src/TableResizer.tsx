import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { SlideElement, TableData } from "./types";
import { resizeTableBoundary, tableSizes, type TableCellRange } from "./table";
import { TableVisual, type TableInlineEditing } from "./TableEditor";

type Axis = "column" | "row";
type Resize = {
  pointer: number;
  handle: HTMLElement;
  host: HTMLElement;
  element: SlideElement;
  axis: Axis;
  index: number;
  start: number;
  next: TableData;
};

/** Resize tracks without changing the saved document until the gesture ends. */
export function TableResizer({
  element,
  scale,
  selected,
  enabled,
  selection,
  onStart,
  onCommit,
  inlineEditing,
}: {
  element: SlideElement;
  scale: number;
  selected: boolean;
  enabled: boolean;
  selection?: TableCellRange;
  onStart: () => void;
  onCommit: (before: TableData, after: TableData) => void;
  inlineEditing?: TableInlineEditing;
}) {
  const [preview, setPreview] = useState<TableData | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const resize = useRef<Resize | null>(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const table = preview ?? element.table!;

  const localPosition = (
    host: HTMLElement,
    original: SlideElement,
    axis: Axis,
    x: number,
    y: number,
  ) => {
    const rect = host.getBoundingClientRect();
    const angle = (original.rotation * Math.PI) / 180;
    const dx = x - (rect.left + rect.width / 2);
    const dy = y - (rect.top + rect.height / 2);
    return axis === "column"
      ? (dx * Math.cos(angle) + dy * Math.sin(angle)) / scale
      : (-dx * Math.sin(angle) + dy * Math.cos(angle)) / scale;
  };

  const stop = (commit = false, render = true) => {
    const current = resize.current;
    resize.current = null;
    if (!current) return;
    if (current.handle.hasPointerCapture(current.pointer))
      current.handle.releasePointerCapture(current.pointer);
    if (render) {
      setPreview(null);
      setActive(null);
    }
    if (commit && current.next !== current.element.table)
      commitRef.current(current.element.table!, current.next);
  };
  const update = (event: PointerEvent | ReactPointerEvent) => {
    const current = resize.current;
    if (!current || current.pointer !== event.pointerId) return;
    const delta =
      localPosition(
        current.host,
        current.element,
        current.axis,
        event.clientX,
        event.clientY,
      ) - current.start;
    current.next = resizeTableBoundary(
      current.element.table!,
      current.axis,
      current.index,
      Math.abs(delta) < 0.01 ? 0 : delta,
      current.axis === "column"
        ? current.element.width
        : current.element.height,
    );
    setPreview(current.next);
  };
  // The listeners use refs so the last pointer sample, including pointerup,
  // cannot be lost to React batching. Cancellation never enters undo/autosave.
  const updateRef = useRef(update);
  updateRef.current = update;
  useEffect(() => {
    const up = (event: PointerEvent) => {
      if (resize.current?.pointer !== event.pointerId) return;
      updateRef.current(event);
      stop(true);
    };
    const cancel = (event: PointerEvent) => {
      if (resize.current?.pointer === event.pointerId) stop();
    };
    const blur = () => stop();
    const key = (event: KeyboardEvent) => {
      if (!resize.current) return;
      // Do not let document shortcuts mutate the table underneath a gesture.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") stop();
    };
    const wheel = (event: WheelEvent) => {
      if (!resize.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", blur);
    window.addEventListener("keydown", key, true);
    window.addEventListener("wheel", wheel, { capture: true, passive: false });
    return () => {
      stop(false, false);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("wheel", wheel, true);
    };
  }, []);
  useEffect(() => {
    stop();
  }, [element, scale]);
  useEffect(() => {
    if (!selected || !enabled) stop();
  }, [selected, enabled]);

  const start = (event: ReactPointerEvent, axis: Axis, index: number) => {
    event.stopPropagation();
    if (event.button !== 0 || !enabled || element.locked || resize.current)
      return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    const host = handle.closest<HTMLElement>(".slide-element")!;
    onStart();
    host.focus({ preventScroll: true });
    resize.current = {
      pointer: event.pointerId,
      handle,
      host,
      element,
      axis,
      index,
      start: localPosition(host, element, axis, event.clientX, event.clientY),
      next: element.table!,
    };
    handle.setPointerCapture(event.pointerId);
    setActive(`${axis}-${index}`);
  };
  const boundaries = (axis: Axis) => {
    const sizes = tableSizes(
      axis === "column" ? table.columnWidths : table.rowHeights,
      axis === "column" ? table.cells[0].length : table.cells.length,
      100,
    );
    let offset = 0;
    return sizes.slice(0, -1).map((size, index) => {
      offset += size;
      const label = axis === "column" ? "열 너비" : "행 높이";
      return (
        <div
          key={`${axis}-${index}`}
          className={`table-${axis}-resize-handle${active === `${axis}-${index}` ? " resizing" : ""}`}
          data-boundary-index={index}
          role="separator"
          aria-label={`${index + 1}번째 ${label} 조절`}
          aria-orientation={axis === "column" ? "vertical" : "horizontal"}
          aria-valuenow={Math.round(offset)}
          aria-valuemin={0}
          aria-valuemax={100}
          tabIndex={selected ? 0 : -1}
          title={`${label} 조절 · 드래그 또는 방향키`}
          style={
            {
              [axis === "column" ? "left" : "top"]: `${offset}%`,
              // Keep a selectable cell interior even on a very small/zoomed-out table.
              [axis === "column" ? "width" : "height"]: Math.min(
                8 / scale,
                (Math.min(size, sizes[index + 1]) / 100) *
                  (axis === "column" ? element.width : element.height) *
                  0.4,
              ),
            } as CSSProperties
          }
          onPointerDown={(event) => start(event, axis, index)}
          onPointerMove={(event) => {
            if (!resize.current) return;
            event.stopPropagation();
            update(event);
          }}
          onPointerUp={(event) => {
            event.stopPropagation();
            if (resize.current?.pointer !== event.pointerId) return;
            update(event);
            stop(true);
          }}
          onPointerCancel={(event) => {
            event.stopPropagation();
            if (resize.current?.pointer === event.pointerId) stop();
          }}
          onLostPointerCapture={(event) => {
            if (resize.current?.pointer === event.pointerId) stop();
          }}
          onKeyDown={(event) => {
            if (!selected || !enabled || element.locked) return;
            const minus = axis === "column" ? "ArrowLeft" : "ArrowUp";
            const plus = axis === "column" ? "ArrowRight" : "ArrowDown";
            if (event.key !== minus && event.key !== plus) return;
            event.preventDefault();
            event.stopPropagation();
            const next = resizeTableBoundary(
              element.table!,
              axis,
              index,
              (event.key === minus ? -1 : 1) * (event.shiftKey ? 10 : 1),
              axis === "column" ? element.width : element.height,
            );
            if (next !== element.table) onCommit(element.table!, next);
          }}
        />
      );
    });
  };

  return (
    <>
      <TableVisual
        element={preview ? { ...element, table } : element}
        selection={selection}
        inlineEditing={inlineEditing}
      />
      {enabled && !element.locked && (
        <>
          {boundaries("column")}
          {boundaries("row")}
        </>
      )}
    </>
  );
}
