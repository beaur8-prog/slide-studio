import { GradientDefs, gradientCss } from "./gradient";
import { SlideLinks } from "./slide-links";
import { alphaColor } from "./colors";
import EditableText from "./EditableText";
import {
  useTextHeight,
  textStyle,
  shapeTextElement,
  shapeTextFrame,
} from "./text-geometry";
export { textStyle } from "./text-geometry";
import {
  memo,
  useId,
  useRef,
  useLayoutEffect,
  useEffect,
  useState,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type {
  Deck,
  Slide,
  SlideElement,
  TableData,
  TextParagraph,
  TextRun,
} from "./types";
import {
  fontStack,
  editableText,
  paragraphBullet,
  paragraphLines,
  scriptRuns,
  type TextEdit,
} from "./text-layout";
import {
  editableTextFormatRanges,
  trackTextFormat,
  applyPendingFontSize,
  type TextFormatRange,
} from "./text-formatting";
import {
  textPointOffset,
  restoreTextOffsets,
  type TextMenuSelection,
} from "./text-selection";
import {
  continueTextBullet,
  toggleTextBullets,
  textParagraphSelection,
  remapBulletOffset,
  hasTextBullets,
} from "./text-bullets";
import { LineShape } from "./LineShape";
import {
  selectionBounds,
  resizeElements,
  rotateElements,
} from "./canvas-resize";
import { expandGroups } from "./object-groups";
import { snapMovement } from "./object-arrange";
import { TableVisual } from "./TableEditor";
import { TableResizer } from "./TableResizer";
import { tableMerge, visibleTableCells, MAX_TABLE_ROWS, type TableCellRange } from "./table";
import { selectionRange, type TableCellSelection } from "./table-selection";

import { TextContent } from "./TextContent";
export { TextContent } from "./TextContent";

function StaticText({
  element,
  onHeight,
}: {
  element: SlideElement;
  onHeight?: (id: string, height: number) => void;
}) {
  const ref = useTextHeight(element, onHeight);
  return (
    <>
      <div ref={ref} className="element-text" style={textStyle(element)}>
        <TextContent element={element} />
      </div>
      <TextBorders element={element} />
    </>
  );
}

function TextBorders({ element: e }: { element: SlideElement }) {
  if (!e.borders) return null;
  const [top, right, bottom, left] = e.borders;
  return (
    <svg
      className="text-borders"
      viewBox={`0 0 ${e.width} ${e.height}`}
      preserveAspectRatio="none"
    >
      {[
        [0, 0, e.width, 0, top],
        [e.width, 0, e.width, e.height, right],
        [0, e.height, e.width, e.height, bottom],
        [0, 0, 0, e.height, left],
      ].map((edge, i) => {
        const b = edge[4] as typeof top;
        return (
          <line
            key={i}
            x1={edge[0] as number}
            y1={edge[1] as number}
            x2={edge[2] as number}
            y2={edge[3] as number}
            stroke={b.color}
            strokeOpacity={b.opacity}
            strokeWidth={b.width}
          />
        );
      })}
    </svg>
  );
}

export function ElementVisual({
  element,
  onTextHeight,
}: {
  element: SlideElement;
  onTextHeight?: (id: string, height: number) => void;
}) {
  if (element.type !== "shape")
    return <ArtworkVisual element={element} onTextHeight={onTextHeight} />;
  return (
    <>
      <ArtworkVisual element={element} />
      {element.text !== undefined && (
        <div className="shape-text-frame" style={shapeTextFrame(element)}>
          <StaticText element={shapeTextElement(element)} />
        </div>
      )}
    </>
  );
}

function ArtworkVisual({
  element: e,
  onTextHeight,
}: {
  element: SlideElement;
  onTextHeight?: (id: string, height: number) => void;
}) {
  const gradientId = "fill-" + useId().replace(/[^a-z0-9]/gi, "");
  if (e.type === "table") return <TableVisual element={e} />;
  if (e.type === "image")
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          overflow: "hidden",
          position: "relative",
          transform: `scale(${e.flipH ? -1 : 1},${e.flipV ? -1 : 1})`,
        }}
      >
        <img
          className="element-image"
          src={e.src}
          alt={e.alt || ""}
          draggable={false}
          style={
            e.crop
              ? {
                  position: "absolute",
                  maxWidth: "none",
                  left: `${(-e.crop[3] / (1 - e.crop[3] - e.crop[1])) * 100}%`,
                  top: `${(-e.crop[0] / (1 - e.crop[0] - e.crop[2])) * 100}%`,
                  width: `${100 / (1 - e.crop[3] - e.crop[1])}%`,
                  height: `${100 / (1 - e.crop[0] - e.crop[2])}%`,
                }
              : undefined
          }
        />
      </div>
    );
  if (e.type === "text")
    return <StaticText element={e} onHeight={onTextHeight} />;
  if (e.shape === "custom" && e.paths)
    return (
      <svg
        className="element-svg"
        width="100%"
        height="100%"
        viewBox={`0 0 ${e.width} ${e.height}`}
        preserveAspectRatio="none"
        style={{ transform: `scale(${e.flipH ? -1 : 1},${e.flipV ? -1 : 1})` }}
      >
        <GradientDefs gradient={e.gradient} id={gradientId} />
        {e.paths.map((p, i) => (
          <path
            key={i}
            d={p.d}
            transform={`scale(${e.width / p.width},${e.height / p.height})`}
            fill={
              p.fill ? (e.gradient ? `url(#${gradientId})` : e.fill) : "none"
            }
            fillOpacity={e.fillOpacity}
            stroke={p.stroke ? e.stroke : "none"}
            strokeOpacity={e.strokeOpacity}
            strokeDasharray={e.strokeDash
              ?.map(
                (n) =>
                  n / Math.sqrt(((e.width / p.width) * e.height) / p.height),
              )
              .join(" ")}
            strokeLinecap={e.strokeCap}
            strokeWidth={
              (e.strokeWidth ?? 0) /
              Math.max(
                0.00001,
                Math.sqrt(((e.width / p.width) * e.height) / p.height),
              )
            }
          />
        ))}
      </svg>
    );
  if ((e.shape === "line" || e.shape === "arrow") && (e.lineStart || e.lineEnd))
    return <LineShape element={e} />;
  if (e.shape === "line" || e.shape === "arrow")
    return (
      <svg
        className="element-svg"
        width="100%"
        height={Math.max(1, e.height)}
        viewBox={`0 0 ${Math.max(1, e.width)} ${Math.max(1, e.height)}`}
        preserveAspectRatio="none"
      >
        <line
          x1="0"
          y1={e.height / 2}
          x2={e.shape === "arrow" ? Math.max(0, e.width - 12) : e.width}
          y2={e.height / 2}
          stroke={e.stroke && e.stroke !== "transparent" ? e.stroke : e.fill}
          strokeWidth={e.strokeWidth || 3}
        />
        {e.shape === "arrow" && (
          <polygon
            points={`${e.width},${e.height / 2} ${e.width - 16},${e.height / 2 - 8} ${e.width - 16},${e.height / 2 + 8}`}
            fill={e.stroke && e.stroke !== "transparent" ? e.stroke : e.fill}
          />
        )}
      </svg>
    );
  if (e.gradient || e.strokeDash)
    return (
      <svg
        className="element-svg"
        width="100%"
        height="100%"
        viewBox={`0 0 ${e.width} ${e.height}`}
        preserveAspectRatio="none"
        style={{ transform: `scale(${e.flipH ? -1 : 1},${e.flipV ? -1 : 1})` }}
      >
        <GradientDefs gradient={e.gradient} id={gradientId} />
        <g
          fill={e.gradient ? `url(#${gradientId})` : e.fill}
          fillOpacity={e.fillOpacity}
          stroke={e.stroke}
          strokeOpacity={e.strokeOpacity}
          strokeWidth={e.strokeWidth}
          strokeDasharray={e.strokeDash?.join(" ")}
          strokeLinecap={e.strokeCap}
        >
          {e.shape === "ellipse" ? (
            <ellipse
              cx={e.width / 2}
              cy={e.height / 2}
              rx={e.width / 2}
              ry={e.height / 2}
            />
          ) : e.shape === "triangle" ? (
            <polygon
              points={`${e.width / 2},0 ${e.width},${e.height} 0,${e.height}`}
            />
          ) : (
            <rect
              width={e.width}
              height={e.height}
              rx={e.shape === "roundRect" ? (e.cornerRadius ?? 22) : 0}
            />
          )}
        </g>
      </svg>
    );
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: alphaColor(e.fill, e.fillOpacity),
        transform: `scale(${e.flipH ? -1 : 1},${e.flipV ? -1 : 1})`,
        border: `${e.strokeWidth || 0}px solid ${alphaColor(e.stroke, e.strokeOpacity) || "transparent"}`,
        borderRadius:
          e.shape === "ellipse"
            ? "50%"
            : e.shape === "roundRect"
              ? (e.cornerRadius ?? 22)
              : 0,
        clipPath:
          e.shape === "triangle"
            ? "polygon(50% 0, 100% 100%, 0 100%)"
            : undefined,
      }}
    />
  );
}
export function elementStyle(e: SlideElement): CSSProperties {
  return {
    left: e.x,
    top: e.y,
    width: e.width,
    height: e.height,
    transform: `rotate(${e.rotation}deg)`,
    opacity: e.opacity,
    filter: e.shadow
      ? `drop-shadow(${e.shadow.dx}px ${e.shadow.dy}px ${e.shadow.blur / 2}px ${alphaColor(e.shadow.color, e.shadow.opacity)})`
      : undefined,
  };
}
export const SlideVisual = memo(function SlideVisual({
  slide,
  width,
  height,
  scale = 1,
  interactive = false,
  onSlideLink,
}: {
  slide: Slide;
  width: number;
  height: number;
  scale?: number;
  interactive?: boolean;
  onSlideLink?: (slideId: string) => void;
}) {
  return (
    <SlideLinks.Provider value={{ interactive, onSlideLink }}>
      <div
        className="slide-visual"
        style={{
          width,
          height,
          background: slide.background,
          backgroundImage:gradientCss(slide.backgroundGradient),
          transform: `scale(${scale})`,
        }}
      >
        {slide.elements.map((e) => (
          <div
            key={e.id}
            className="slide-element static"
            style={elementStyle(e)}
          >
            <ElementVisual element={e} />
            {interactive && e.hyperlink?.url && (
              <a
                className="presentation-link"
                href={e.hyperlink.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={e.text || e.alt || "웹 링크 열기"}
                onClick={(event) => event.stopPropagation()}
              />
            )}
            {interactive && e.hyperlink?.slideId && (
              <button
                className="presentation-link"
                aria-label={e.text || "연결한 슬라이드로 이동"}
                onClick={(event) => {
                  event.stopPropagation();
                  onSlideLink?.(e.hyperlink!.slideId!);
                }}
              />
            )}
          </div>
        ))}
      </div>
    </SlideLinks.Provider>
  );
});
type Drag = {
  pointer: number;
  startX: number;
  startY: number;
  elements: SlideElement[];
  ids: string[];
  handle?: string;
  moved: boolean;
};
type CellDrag = {
  pointer: number;
  host: HTMLElement;
  viewport: HTMLElement | null;
  selection: TableCellSelection;
  clientX: number;
  clientY: number;
  frame: number;
};

function cellAtPoint(host: HTMLElement, x: number, y: number) {
  const cell = document
    .elementFromPoint(x, y)
    ?.closest<HTMLElement>("[data-row][data-column]");
  const coordinates = (node: HTMLElement) => ({
    row: Number(node.dataset.row),
    column: Number(node.dataset.column),
  });
  if (cell && host.contains(cell)) return coordinates(cell);
  // Pointer capture retargets events to the initial cell. Actual DOM rectangles
  // also account for scrolling, custom row/column sizes, zoom and rotation.
  let nearest: HTMLElement | null = null,
    distance = Infinity;
  for (const candidate of host.querySelectorAll<HTMLElement>(
    "[data-row][data-column]",
  )) {
    const rect = candidate.getBoundingClientRect();
    const dx = Math.max(rect.left - x, 0, x - rect.right);
    const dy = Math.max(rect.top - y, 0, y - rect.bottom);
    const next = dx * dx + dy * dy;
    if (next < distance) {
      nearest = candidate;
      distance = next;
    }
  }
  return nearest ? coordinates(nearest) : null;
}
interface Props {
  deck: Deck;
  slide: Slide;
  contextMenu: (
    id: string,
    x: number,
    y: number,
    selection?: TextMenuSelection,
  ) => void;
  scale: number;
  selected: string[];
  tableSelection: TableCellSelection | null;
  selectTableCells: (selection: TableCellSelection | null) => void;
  editing: string | null;
  select: (ids: string[]) => void;
  edit: (id: string | null) => void;
  editTable?: (id: string, range?: TableCellRange) => void;
  resizeTable: (id: string, before: TableData, after: TableData) => void;
  appendTableRow: (id:string)=>void;
  tableResizeEnabled: boolean;
  begin: () => void;
  preview: (elements: SlideElement[]) => void;
  finish: () => void;
  changeText: (
    id: string,
    text: string,
    formats?: TextFormatRange[],
    edit?: TextEdit,
  ) => void;
  changeCell: (
    id: string,
    row: number,
    column: number,
    text: string,
    formats?: TextFormatRange[],
    edit?: TextEdit,
  ) => void;
  resizeText: (id: string, height: number) => void;
  showGuides: boolean;
  grid: boolean;
}
export default function SlideCanvas({
  contextMenu,
  deck,
  slide,
  scale,
  selected,
  tableSelection,
  selectTableCells,
  editing,
  select,
  edit,
  editTable,
  resizeTable,
  appendTableRow,
  tableResizeEnabled,
  begin,
  preview,
  finish,
  changeText,
  changeCell,
  resizeText,
  showGuides,
  grid,
}: Props) {
  const editPoint = useRef<{ id: string; x: number; y: number } | null>(null);
  const openContextMenu = (
    element: SlideElement,
    host: HTMLElement,
    x: number,
    y: number,
  ) => {
    const input =
      editing === element.id
        ? host.querySelector<HTMLElement>(".editing-text")
        : null;
    const selection = getSelection();
    if (
      input &&
      selection?.rangeCount &&
      input.contains(selection.anchorNode) &&
      input.contains(selection.focusNode)
    ) {
      const range = selection.getRangeAt(0).cloneRange();
      contextMenu(element.id, x, y, {
        host: input,
        range,
        backward:
          !range.collapsed &&
          selection.anchorNode === range.endContainer &&
          selection.anchorOffset === range.endOffset,
      });
    } else {
      host.focus({ preventScroll: true });
      contextMenu(element.id, x, y);
    }
  };
  const marqueeRef = useRef<{
    pointer: number;
    x: number;
    y: number;
    initial: string[];
  } | null>(null);
  const [marquee, setMarquee] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [snapLines, setSnapLines] = useState<{ axis: "x" | "y"; at: number }[]>(
    [],
  );
  const [inlineCell, setInlineCell] = useState<{
    id: string;
    row: number;
    column: number;
  } | null>(null);
  const startCell = (
    element: SlideElement,
    row: number,
    column: number,
    seed?: string,
  ) => {
    if (!element.table || element.locked) return;
    const merge = tableMerge(element.table, row, column),
      r = merge?.row ?? row,
      c = merge?.column ?? column;
    stopCellDrag();
    select([element.id]);
    begin();
    edit(element.id);
    selectTableCells({
      elementId: element.id,
      anchor: { row: r, column: c },
      focus: { row: r, column: c },
    });
    if (seed !== undefined) changeCell(element.id, r, c, seed);
    setInlineCell({ id: element.id, row: r, column: c });
  };
  const drag = useRef<Drag | null>(null);
  const cellDrag = useRef<CellDrag | null>(null);
  const tableSelectionRef = useRef(tableSelection);
  tableSelectionRef.current = tableSelection;
  const selectCellsRef = useRef(selectTableCells);
  selectCellsRef.current = selectTableCells;
  const finishRef = useRef(finish);
  finishRef.current = finish;
  const stopCellDrag = () => {
    const current = cellDrag.current;
    cellDrag.current = null;
    if (!current) return;
    cancelAnimationFrame(current.frame);
    if (current.host.hasPointerCapture(current.pointer))
      current.host.releasePointerCapture(current.pointer);
  };
  const updateCellDrag = () => {
    const current = cellDrag.current;
    if (!current) return;
    const focus = cellAtPoint(current.host, current.clientX, current.clientY);
    if (
      !focus ||
      (focus.row === current.selection.focus.row &&
        focus.column === current.selection.focus.column)
    )
      return;
    current.selection = { ...current.selection, focus };
    tableSelectionRef.current = current.selection;
    selectCellsRef.current(current.selection);
  };
  const scrollCellDrag = () => {
    const current = cellDrag.current;
    if (!current) return;
    if (!current.host.isConnected) {
      stopCellDrag();
      return;
    }
    const viewport = current.viewport;
    if (viewport) {
      const bounds = viewport.getBoundingClientRect();
      const speed = (position: number, start: number, end: number) =>
        position < start + 24
          ? -Math.min(18, (start + 24 - position) / 2)
          : position > end - 24
            ? Math.min(18, (position - end + 24) / 2)
            : 0;
      const left = viewport.scrollLeft,
        top = viewport.scrollTop;
      viewport.scrollLeft += speed(current.clientX, bounds.left, bounds.right);
      viewport.scrollTop += speed(current.clientY, bounds.top, bounds.bottom);
      if (left !== viewport.scrollLeft || top !== viewport.scrollTop)
        updateCellDrag();
    }
    current.frame = requestAnimationFrame(scrollCellDrag);
  };
  useEffect(() => {
    const pointerEnded = (event: PointerEvent) => {
      if (cellDrag.current?.pointer === event.pointerId) stopCellDrag();
    };
    const blur = () => {
      marqueeRef.current = null;
      setMarquee(null);
      setSnapLines([]);
      stopCellDrag();
      if (drag.current) {
        drag.current = null;
        finishRef.current();
      }
    };
    window.addEventListener("pointerup", pointerEnded);
    window.addEventListener("pointercancel", pointerEnded);
    window.addEventListener("blur", blur);
    document.addEventListener("scroll", updateCellDrag, true);
    return () => {
      stopCellDrag();
      window.removeEventListener("pointerup", pointerEnded);
      window.removeEventListener("pointercancel", pointerEnded);
      window.removeEventListener("blur", blur);
      document.removeEventListener("scroll", updateCellDrag, true);
    };
  }, []);
  useEffect(() => {
    stopCellDrag();
  }, [slide.id]);
  useEffect(() => {
    if (
      cellDrag.current &&
      tableSelection?.elementId !== cellDrag.current.selection.elementId
    )
      stopCellDrag();
  }, [tableSelection]);
  const down = (ev: ReactPointerEvent, el: SlideElement, handle?: string) => {
    if (ev.button !== 0 || editing === el.id) return;
    ev.stopPropagation();
    if (
      !handle &&
      el.type === "table" &&
      el.table &&
      !el.locked &&
      !(el.groups?.length && !ev.altKey)
    ) {
      const host = ev.currentTarget as HTMLElement;
      const cell =
        ev.target instanceof Element
          ? ev.target.closest<HTMLElement>("[data-row][data-column]")
          : null;
      if (cell && host.contains(cell)) {
        const rect = host.getBoundingClientRect(),
          angle = (el.rotation * Math.PI) / 180;
        const dx = ev.clientX - (rect.left + rect.width / 2),
          dy = ev.clientY - (rect.top + rect.height / 2);
        const x =
          (dx * Math.cos(angle) + dy * Math.sin(angle)) / scale + el.width / 2;
        const y =
          (-dx * Math.sin(angle) + dy * Math.cos(angle)) / scale +
          el.height / 2;
        const onEdge =
          x < 4 / scale ||
          y < 4 / scale ||
          el.width - x < 4 / scale ||
          el.height - y < 4 / scale;
        if (!onEdge) {
          ev.preventDefault();
          stopCellDrag();
          host.focus({ preventScroll: true });
          const focus = {
            row: Number(cell.dataset.row),
            column: Number(cell.dataset.column),
          };
          const previous = tableSelectionRef.current;
          const anchor =
            ev.shiftKey && previous?.elementId === el.id
              ? {
                  row: Math.max(
                    0,
                    Math.min(el.table.cells.length - 1, previous.anchor.row),
                  ),
                  column: Math.max(
                    0,
                    Math.min(
                      el.table.cells[0].length - 1,
                      previous.anchor.column,
                    ),
                  ),
                }
              : focus;
          const selection = { elementId: el.id, anchor, focus };
          select([el.id]);
          edit(null);
          tableSelectionRef.current = selection;
          selectTableCells(selection);
          host.setPointerCapture(ev.pointerId);
          cellDrag.current = {
            pointer: ev.pointerId,
            host,
            viewport: host.closest<HTMLElement>(".canvas-area"),
            selection,
            clientX: ev.clientX,
            clientY: ev.clientY,
            frame: requestAnimationFrame(scrollCellDrag),
          };
          return;
        }
      }
    }
    stopCellDrag();
    tableSelectionRef.current = null;
    selectTableCells(null);
    const members = ev.altKey ? [el.id] : expandGroups(slide.elements, [el.id]);
    let ids = selected.includes(el.id) ? selected : members;
    if (!ev.altKey) ids = expandGroups(slide.elements, ids);
    if ((ev.shiftKey || ev.ctrlKey || ev.metaKey) && !handle) {
      ids = members.every((id) => selected.includes(id))
        ? selected.filter((id) => !members.includes(id))
        : [...new Set([...selected, ...members])];
      select(ids);
      return;
    }
    select(ids);
    if (el.locked) return;
    begin();
    ev.currentTarget.setPointerCapture(ev.pointerId);
    drag.current = {
      pointer: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      elements: structuredClone(slide.elements),
      ids,
      handle,
      moved: false,
    };
  };
  const move = (ev: ReactPointerEvent) => {
    const rectangle = marqueeRef.current;
    if (rectangle?.pointer === ev.pointerId) {
      const canvas = ev.currentTarget.getBoundingClientRect();
      const x = (ev.clientX - canvas.left) / scale,
        y = (ev.clientY - canvas.top) / scale;
      const box = {
        x: Math.min(x, rectangle.x),
        y: Math.min(y, rectangle.y),
        width: Math.abs(x - rectangle.x),
        height: Math.abs(y - rectangle.y),
      };
      setMarquee(box);
      const contained = slide.elements.filter((e) => {
        const angle = (e.rotation * Math.PI) / 180;
        const w =
          Math.abs(e.width * Math.cos(angle)) +
          Math.abs(e.height * Math.sin(angle));
        const h =
          Math.abs(e.width * Math.sin(angle)) +
          Math.abs(e.height * Math.cos(angle));
        return (
          e.x + e.width / 2 - w / 2 >= box.x &&
          e.y + e.height / 2 - h / 2 >= box.y &&
          e.x + e.width / 2 + w / 2 <= box.x + box.width &&
          e.y + e.height / 2 + h / 2 <= box.y + box.height
        );
      });
      const ids = contained
        .filter(
          (e) =>
            !e.groups?.length ||
            expandGroups(slide.elements, [e.id]).every((id) =>
              contained.some((item) => item.id === id),
            ),
        )
        .map((e) => e.id);
      select([...new Set([...rectangle.initial, ...ids])]);
      return;
    }
    if (cellDrag.current?.pointer === ev.pointerId) {
      cellDrag.current.clientX = ev.clientX;
      cellDrag.current.clientY = ev.clientY;
      updateCellDrag();
      return;
    }
    const d = drag.current;
    if (!d || ev.pointerId !== d.pointer) return;
    let dx = (ev.clientX - d.startX) / scale,
      dy = (ev.clientY - d.startY) / scale;
    if (Math.abs(dx) + Math.abs(dy) < 2 && !d.moved) return;
    d.moved = true;
    if (d.handle === "rotate") {
      const canvas = ev.currentTarget.getBoundingClientRect();
      const bounds = selectionBounds(
        d.elements.filter((e) => d.ids.includes(e.id) && !e.locked),
      );
      const cx = canvas.left + (bounds.x + bounds.width / 2) * scale;
      const cy = canvas.top + (bounds.y + bounds.height / 2) * scale;
      let angle =
        ((Math.atan2(ev.clientY - cy, ev.clientX - cx) -
          Math.atan2(d.startY - cy, d.startX - cx)) *
          180) /
        Math.PI;
      if (ev.shiftKey) angle = Math.round(angle / 15) * 15;
      preview(rotateElements(d.elements, d.ids, angle));
      return;
    }
    if (ev.shiftKey && !d.handle) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    if (!d.handle) {
      const moving = d.elements.filter(
        (e) => d.ids.includes(e.id) && !e.locked,
      );
      const left = Math.min(...moving.map((e) => e.x)),
        top = Math.min(...moving.map((e) => e.y));
      const right = Math.max(...moving.map((e) => e.x + e.width)),
        bottom = Math.max(...moving.map((e) => e.y + e.height));
      // Snap the shared translation, preserving every relative position.
      if (grid) {
        dx = Math.round((left + dx) / 10) * 10 - left;
        dy = Math.round((top + dy) / 10) * 10 - top;
      }
      if (showGuides) {
        const snap = snapMovement(
          d.elements,
          d.ids,
          dx,
          dy,
          deck.width,
          deck.height,
          7 / scale,
          ev.shiftKey ? (Math.abs(dx) > Math.abs(dy) ? "x" : "y") : undefined,
        );
        dx = snap.dx;
        dy = snap.dy;
        setSnapLines(snap.guides);
      }
    }
    if (d.handle) {
      preview(resizeElements(d.elements, d.ids, d.handle, dx, dy, ev.shiftKey));
      return;
    }
    preview(
      d.elements.map((e) => {
        if (!d.ids.includes(e.id) || e.locked) return e;
        if (!d.handle) {
          let x = e.x + dx,
            y = e.y + dy;
          return { ...e, x, y };
        }
        return e;
      }),
    );
  };
  const up = (ev: ReactPointerEvent) => {
    if (snapLines.length) setSnapLines([]);
    if (marqueeRef.current?.pointer === ev.pointerId) {
      marqueeRef.current = null;
      setMarquee(null);
    }
    if (cellDrag.current?.pointer === ev.pointerId) stopCellDrag();
    if (drag.current?.pointer === ev.pointerId) {
      finish();
      drag.current = null;
    }
  };
  return (
    <div
      className="canvas-frame"
      data-testid="canvas-frame"
      style={{ width: deck.width * scale, height: deck.height * scale }}
    >
      <div
        className={`editable-slide ${grid ? "grid-visible" : ""}`}
        data-testid="slide-canvas"
        style={{
          width: deck.width,
          height: deck.height,
          backgroundColor: slide.background,
          backgroundImage: gradientCss(slide.backgroundGradient),
          transform: `scale(${scale})`,
        }}
        onPointerDown={(e) => {
          if (
            e.target === e.currentTarget ||
            (e.target instanceof Element &&
              e.target.classList.contains("slide-artwork"))
          ) {
            if (e.button !== 0) return;
            e.preventDefault();
            stopCellDrag();
            tableSelectionRef.current = null;
            selectTableCells(null);
            const initial =
              e.shiftKey || e.ctrlKey || e.metaKey ? selected : [];
            select(initial);
            edit(null);
            const rect = e.currentTarget.getBoundingClientRect();
            marqueeRef.current = {
              pointer: e.pointerId,
              x: (e.clientX - rect.left) / scale,
              y: (e.clientY - rect.top) / scale,
              initial,
            };
            e.currentTarget.setPointerCapture(e.pointerId);
          }
        }}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onLostPointerCapture={up}
        onWheelCapture={(event) => {
          if (cellDrag.current) event.stopPropagation();
        }}
      >
        <div className="slide-artwork">
          {snapLines.map((line, i) => (
            <div
              key={i}
              className={`guide ${line.axis === "x" ? "vertical" : "horizontal"}`}
              data-testid="object-snap-guide"
              style={line.axis === "x" ? { left: line.at } : { top: line.at }}
            />
          ))}
          {showGuides && (
            <>
              <div
                className="guide vertical"
                style={{ left: deck.width / 2 }}
              />
              <div
                className="guide horizontal"
                style={{ top: deck.height / 2 }}
              />
            </>
          )}
          {slide.elements.map((e) => (
            <div
              key={e.id}
              data-testid="slide-element"
              data-element-id={e.id}
              data-type={e.type}
              tabIndex={0}
              className={`slide-element ${selected.includes(e.id) ? "selected" : ""} ${e.locked ? "locked" : ""} ${editing === e.id ? "editing" : ""}`}
              style={
                {
                  ...elementStyle(e),
                  "--inverse-scale": 1 / scale,
                } as CSSProperties
              }
              onContextMenu={(ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                openContextMenu(e, ev.currentTarget, ev.clientX, ev.clientY);
              }}
              onKeyDown={(ev) => {
                if (
                  e.type === "table" &&
                  editing !== e.id &&
                  tableSelection?.elementId === e.id &&
                  !e.locked &&
                  !ev.ctrlKey &&
                  !ev.metaKey &&
                  !ev.altKey &&
                  (ev.key === "F2" ||
                    ev.key === "Enter" ||
                    ev.key.length === 1 ||
                    ev.nativeEvent.keyCode === 229)
                ) {
                  ev.stopPropagation();
                  const composing =
                    ev.nativeEvent.isComposing ||
                    ev.nativeEvent.keyCode === 229;
                  if (!composing) ev.preventDefault();
                  startCell(
                    e,
                    tableSelection.focus.row,
                    tableSelection.focus.column,
                    !composing && ev.key.length === 1 ? ev.key : undefined,
                  );
                  return;
                }
                if (
                  ev.key !== "ContextMenu" &&
                  !(ev.shiftKey && ev.key === "F10")
                )
                  return;
                ev.preventDefault();
                ev.stopPropagation();
                const bounds = ev.currentTarget.getBoundingClientRect();
                openContextMenu(
                  e,
                  ev.currentTarget,
                  bounds.left + bounds.width / 2,
                  bounds.top + bounds.height / 2,
                );
              }}
              onPointerDown={(ev) => down(ev, e)}
              onDoubleClick={(ev) => {
                ev.stopPropagation();
                if (e.type === "table" && !e.locked) {
                  select([e.id]);
                  const selection = tableSelectionRef.current;
                  editTable?.(
                    e.id,
                    selection?.elementId === e.id
                      ? selectionRange(selection)
                      : undefined,
                  );
                }
                if ((e.type === "text" || e.type === "shape") && !e.locked) {
                  select([e.id]);
                  editPoint.current = {
                    id: e.id,
                    x: ev.clientX,
                    y: ev.clientY,
                  };
                  begin();
                  edit(e.id);
                }
              }}
            >
              {editing === e.id && e.type !== "table" ? (
                <>
                  {e.type === "shape" && <ArtworkVisual element={e} />}
                  <div
                    style={
                      e.type === "shape"
                        ? shapeTextFrame(e)
                        : { width: "100%", height: "100%" }
                    }
                  >
                    <EditableText
                      element={e.type === "shape" ? shapeTextElement(e) : e}
                      initialPoint={
                        editPoint.current?.id === e.id
                          ? editPoint.current
                          : undefined
                      }
                      onHeight={e.type === "shape" ? undefined : resizeText}
                      onInput={(text, formats, edit) =>
                        changeText(e.id, text, formats, edit)
                      }
                      onDone={() => {
                        finish();
                        edit(null);
                        editPoint.current = null;
                      }}
                    />
                  </div>
                </>
              ) : e.type === "table" ? (
                <TableResizer
                  element={e}
                  scale={scale}
                  selected={selected.includes(e.id)}
                  enabled={tableResizeEnabled && !editing}
                  onStart={() => {
                    stopCellDrag();
                    if (tableSelectionRef.current?.elementId !== e.id) {
                      tableSelectionRef.current = null;
                      selectTableCells(null);
                    }
                    select([e.id]);
                    edit(null);
                  }}
                  onCommit={(before, after) => resizeTable(e.id, before, after)}
                  inlineEditing={
                    editing === e.id && inlineCell?.id === e.id
                      ? {
                          row: inlineCell.row,
                          column: inlineCell.column,
                          onInput: (text, formats, edit) =>
                            changeCell(
                              e.id,
                              inlineCell.row,
                              inlineCell.column,
                              text,
                              formats,
                              edit,
                            ),
                          onDone: () => {
                            finish();
                            edit(null);
                            setInlineCell(null);
                          },
                          onNavigate: (backward) => {
                            finish();
                            const cells = visibleTableCells(e.table!),
                              index = cells.findIndex(
                                (c) =>
                                  c.row === inlineCell.row &&
                                  c.column === inlineCell.column,
                              ),
                              next = cells[index + (backward ? -1 : 1)];
                            if (next) startCell(e, next.row, next.column);
                            else {
                              edit(null);
                              setInlineCell(null);
                              if(!backward&&e.table!.cells.length<MAX_TABLE_ROWS){const row=e.table!.cells.length;appendTableRow(e.id);selectTableCells({elementId:e.id,anchor:{row,column:0},focus:{row,column:0}});requestAnimationFrame(()=>document.querySelector<HTMLElement>('.editable-slide .slide-element.selected')?.focus());}
                            }
                          },
                        }
                      : undefined
                  }
                  selection={
                    tableSelection?.elementId === e.id
                      ? selectionRange(tableSelection)
                      : undefined
                  }
                />
              ) : (
                <ElementVisual element={e} onTextHeight={resizeText} />
              )}
            </div>
          ))}
        </div>
        {marquee && (
          <div
            className="canvas-marquee"
            data-testid="canvas-marquee"
            style={{
              left: marquee.x,
              top: marquee.y,
              width: marquee.width,
              height: marquee.height,
            }}
          />
        )}
        {slide.elements
          .filter((e) => selected.includes(e.id))
          .map((e) => (
            <div
              key={e.id}
              className={`slide-selection ${e.locked ? "locked" : ""} ${editing === e.id ? "editing" : ""}`}
              style={
                {
                  ...elementStyle(e),
                  "--inverse-scale": 1 / scale,
                } as CSSProperties
              }
            >
              {e.type === "table" && !e.locked && !editing && (
                <>
                  <div
                    className="table-canvas-toolbar"
                    style={{ pointerEvents: "auto" }}
                  >
                    <button
                      type="button"
                      className="table-move-handle"
                      data-testid="table-move-handle"
                      aria-label="표 이동"
                      title="드래그하여 표 전체 이동"
                      onPointerDown={(event) => {
                        event.preventDefault();
                        down(event, e);
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        selectTableCells(null);
                        select([e.id]);
                      }}
                    >
                      표 이동
                    </button>
                    {tableSelection?.elementId === e.id && (
                      <button
                        type="button"
                        data-testid="table-edit-selection"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          editTable?.(e.id, selectionRange(tableSelection));
                        }}
                      >
                        선택 셀 편집
                      </button>
                    )}
                  </div>
                  {(["n", "e", "s", "w"] as const).map((side) => (
                    <div
                      key={side}
                      className={`table-move-edge ${side}`}
                      data-testid={`table-move-edge-${side}`}
                      style={{ pointerEvents: "auto" }}
                      onPointerDown={(event) => down(event, e)}
                    />
                  ))}
                </>
              )}
              {!e.locked &&
                selected.length === 1 &&
                !editing &&
                ["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((h) => (
                  <span
                    key={h}
                    className={`resize-handle ${h}`}
                    data-testid={`resize-${h}`}
                    onPointerDown={(ev) => down(ev, e, h)}
                  />
                ))}
              {!e.locked && selected.length === 1 && !editing && (
                <button
                  type="button"
                  className="rotation-handle"
                  data-testid="rotate-handle"
                  aria-label="개체 회전"
                  title="회전 (Shift: 15° 단위)"
                  onPointerDown={(ev) => down(ev, e, "rotate")}
                >
                  ↻
                </button>
              )}
              {selected.includes(e.id) && (
                <span className="element-label">
                  {e.locked
                    ? "잠김"
                    : e.type === "text"
                      ? "텍스트"
                      : e.type === "image"
                        ? "이미지"
                        : e.type === "table"
                          ? "표 · 셀을 드래그하여 선택"
                          : "도형"}
                </span>
              )}
            </div>
          ))}
        {selected.length > 1 &&
          !editing &&
          (() => {
            const items = slide.elements.filter(
              (e) => selected.includes(e.id) && !e.locked,
            );
            if (items.length < 2) return null;
            const box = selectionBounds(items);
            return (
              <div
                className="slide-selection"
                data-testid="selection-group"
                style={
                  {
                    ...elementStyle({ ...items[0], ...box, rotation: 0 }),
                    "--inverse-scale": 1 / scale,
                  } as CSSProperties
                }
              >
                {["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((h) => (
                  <span
                    key={h}
                    className={`resize-handle ${h}`}
                    data-testid={`resize-${h}`}
                    onPointerDown={(ev) => down(ev, items[0], h)}
                  />
                ))}
                <button
                  type="button"
                  className="rotation-handle"
                  data-testid="rotate-handle"
                  aria-label="선택 개체 함께 회전"
                  title="함께 회전 (Shift: 15° 단위)"
                  onPointerDown={(ev) => down(ev, items[0], "rotate")}
                >
                  ↻
                </button>
              </div>
            );
          })()}
      </div>
    </div>
  );
}
