import { memo, useRef, useLayoutEffect, useEffect } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type {
  Deck,
  Slide,
  SlideElement,
  TextParagraph,
  TextRun,
} from "./types";
import {
  fontStack,
  editableText,
  paragraphBullet,
  paragraphLines,
  scriptRuns,
} from "./text-layout";
import { LineShape } from "./LineShape";
import { TableVisual } from "./TableEditor";
import type { TableCellRange } from "./table";
import { selectionRange, type TableCellSelection } from "./table-selection";

// Chromium does not implement CSS hanging-punctuation. Try letting the terminal
// stop/comma hang, and keep it only when that prevents an extra line. A sentence
// that already fits keeps its natural width, including center/right alignment.
function TextLine({
  line,
  paragraph: p,
  element: e,
  first,
  editing = false,
}: {
  line: TextRun[];
  paragraph: TextParagraph;
  element: SlideElement;
  first: boolean;
  editing?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const bullet = first ? paragraphBullet({ ...p, runs: line }) : undefined;
  const runs = bullet
    ? [{ ...line[0], text: bullet.label }, ...bullet.runs.flatMap(scriptRuns)]
    : line.flatMap(scriptRuns);
  useLayoutEffect(() => {
    const box = ref.current;
    const stop = box?.querySelector<HTMLElement>("[data-hanging-punctuation]");
    if (!box || !stop) return;
    const reset = () => {
      stop.style.display = "";
      stop.style.width = "";
      stop.style.whiteSpace = "";
    };
    let disposed = false;
    const layout = () => {
      if (disposed) return;
      reset();
      if (
        !p.hangingPunctuation ||
        e.wrap === false ||
        (e.writingMode && e.writingMode !== "horizontal")
      )
        return;
      const before = box.getBoundingClientRect().height;
      stop.style.display = "inline-block";
      stop.style.width = "0px";
      stop.style.whiteSpace = "pre";
      if (box.getBoundingClientRect().height >= before - 0.1) reset();
    };
    layout();
    void document.fonts.ready.then(layout);
    document.fonts.addEventListener("loadingdone", layout);
    const observer = new ResizeObserver(layout);
    observer.observe(box);
    window.addEventListener("beforeprint", layout);
    return () => {
      disposed = true;
      document.fonts.removeEventListener("loadingdone", layout);
      observer.disconnect();
      window.removeEventListener("beforeprint", layout);
    };
  }, [line, p, e]);
  return (
    <div
      ref={ref}
      data-text-line
      style={{
        fontSize: Math.max(
          ...line.map((r) => r.fontSize ?? p.fontSize ?? e.fontSize ?? 32),
          ...(line.length ? [] : [p.fontSize ?? e.fontSize ?? 32]),
        ),
        // An empty line has no inline box, but still occupies its full line
        // advance (including fixed spacing and the font size of this line).
        minBlockSize: line.every((r) => !r.text) ? "1lh" : undefined,
        textIndent: first ? (p.indent ?? 0) : 0,
      }}
    >
      {runs.map((r, j) => {
        const terminal =
          j === runs.length - 1 && p.hangingPunctuation
            ? r.text.match(
                /[,.\u060c\u06d4\u3001\u3002\uff0c\uff0e\ufe50\ufe51\ufe52\uff61\uff64]$/u,
              )?.[0]
            : undefined;
        return (
          <span
            key={j}
            lang={r.language}
            data-bullet={bullet && j === 0 ? "" : undefined}
            style={{
              ...(bullet && j === 0
                ? {
                    display: "inline-block",
                    minWidth: Math.max(0, -(p.indent ?? 0)),
                    textIndent: 0,
                  }
                : {}),
              letterSpacing: r.letterSpacing,
              overflowWrap:
                p.latinLineBreak === false &&
                !/[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(
                  r.text,
                )
                  ? "normal"
                  : undefined,
              fontKerning:
                r.kerning === undefined
                  ? "none"
                  : (r.fontSize ?? e.fontSize ?? 32) >= r.kerning
                    ? "normal"
                    : "none",
              wordBreak:
                p.latinLineBreak &&
                !/[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(
                  r.text,
                )
                  ? "break-all"
                  : undefined,
              fontFamily: r.fontFamily
                ? fontStack(r.fontFamily, r.bold ?? e.bold)
                : undefined,
              fontSize: r.baseline
                ? `${(r.fontSize ?? e.fontSize ?? 32) * 0.65}px`
                : r.fontSize,
              fontWeight:
                r.bold === undefined
                  ? undefined
                  : r.bold
                    ? 700
                    : /Light$/i.test(r.fontFamily ?? e.fontFamily ?? "")
                      ? 300
                      : 400,
              fontStyle:
                r.italic === undefined
                  ? undefined
                  : r.italic
                    ? "italic"
                    : "normal",
              textDecoration:
                r.underline === undefined
                  ? undefined
                  : r.underline
                    ? "underline"
                    : "none",
              color: r.color,
              verticalAlign: r.baseline ? `${r.baseline / 1000}%` : undefined,
            }}
          >
            {terminal ? (
              <>
                {r.text.slice(0, -terminal.length)}
                <span data-hanging-punctuation>{terminal}</span>
              </>
            ) : (
              r.text
            )}
            {editing && bullet && j === 0 ? (
              <span style={{ fontSize: 0 }}>
                {p.bulletPrefix!.slice(bullet.label.length)}
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

export function TextContent({
  element: e,
  editing = false,
}: {
  element: SlideElement;
  editing?: boolean;
}) {
  if (!e.paragraphs) return <>{e.text}</>;
  return (
    <>
      {e.paragraphs.map((p, i) => (
        <div
          key={i}
          data-text-paragraph
          style={{
            flexShrink: 0,
            fontSize: p.fontSize ?? e.fontSize,
            textAlign: p.align ?? e.align,
            lineHeight:
              p.lineSpacing !== undefined
                ? `${p.lineSpacing}px`
                : (p.lineHeight ?? 1.2),
            marginTop: p.spaceBefore ?? 0,
            marginBottom: p.spaceAfter ?? 0,
            paddingLeft: p.marginLeft ?? 0,
            paddingRight: p.marginRight ?? 0,
            tabSize: p.tabSize === undefined ? undefined : `${p.tabSize}px`,
            lineBreak: p.eastAsianLineBreak === false ? "auto" : "strict",
            wordBreak: p.eastAsianLineBreak === false ? "keep-all" : "normal",
          }}
        >
          {paragraphLines(p).map((line, lineIndex) => (
            <TextLine
              key={lineIndex}
              line={line}
              paragraph={p}
              element={e}
              first={lineIndex === 0}
              editing={editing}
            />
          ))}
        </div>
      ))}
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
            strokeWidth={b.width}
          />
        );
      })}
    </svg>
  );
}

export function ElementVisual({ element: e }: { element: SlideElement }) {
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
    return (
      <>
        <div className="element-text" style={textStyle(e)}>
          <TextContent element={e} />
        </div>
        <TextBorders element={e} />
      </>
    );
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
        {e.paths.map((p, i) => (
          <path
            key={i}
            d={p.d}
            transform={`scale(${e.width / p.width},${e.height / p.height})`}
            fill={p.fill ? e.fill : "none"}
            stroke={p.stroke ? e.stroke : "none"}
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
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: e.fill,
        border: `${e.strokeWidth || 0}px solid ${e.stroke || "transparent"}`,
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
export function textStyle(e: SlideElement): CSSProperties {
  return {
    fontFamily: fontStack(e.fontFamily, e.bold),
    fontSize: e.fontSize || 32,
    letterSpacing: e.letterSpacing,
    fontKerning:
      e.kerning === undefined
        ? undefined
        : (e.fontSize ?? 32) >= e.kerning
          ? "normal"
          : "none",
    fontWeight: e.bold ? 700 : /Light$/i.test(e.fontFamily ?? "") ? 300 : 400,
    fontStyle: e.italic ? "italic" : "normal",
    fontSynthesis: "style",
    textDecoration: e.underline ? "underline" : "none",
    color: e.color || "#233D35",
    textAlign: e.align || "left",
    whiteSpace: e.wrap === false ? "pre" : "pre-wrap",
    overflowWrap: e.wrap === false ? "normal" : "break-word",
    wordBreak: e.paragraphs ? "keep-all" : undefined,
    overflow: e.textOverflow ?? "hidden",
    background: e.fill,
    outline:
      e.strokeWidth && e.stroke !== "transparent"
        ? `${e.strokeWidth}px solid ${e.stroke}`
        : undefined,
    padding: e.textInsets?.map((v) => `${v}px`).join(" "),
    writingMode:
      e.writingMode === "vertical" || e.writingMode === "stacked"
        ? "vertical-rl"
        : e.writingMode === "vertical270"
          ? "vertical-lr"
          : undefined,
    textOrientation: e.writingMode === "stacked" ? "upright" : undefined,
    justifyContent:
      e.verticalAlign === "middle"
        ? "center"
        : e.verticalAlign === "bottom"
          ? "flex-end"
          : "flex-start",
  };
}
export function elementStyle(e: SlideElement): CSSProperties {
  return {
    left: e.x,
    top: e.y,
    width: e.width,
    height: e.height,
    transform: `rotate(${e.rotation}deg)`,
    opacity: e.opacity,
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
    <div
      className="slide-visual"
      style={{
        width,
        height,
        background: slide.background,
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
  );
});
function EditableText({
  element,
  onInput,
  onDone,
}: {
  element: SlideElement;
  onInput: (text: string) => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const initial = useRef(<TextContent element={element} editing />);
  useLayoutEffect(() => {
    if (!ref.current) return;
    ref.current.focus();
    const range = document.createRange();
    range.selectNodeContents(ref.current);
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
      aria-label="슬라이드 텍스트 편집"
      suppressContentEditableWarning
      spellCheck={false}
      style={textStyle(element)}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={onDone}
      onInput={(e) => onInput(editableText(e.currentTarget))}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      onPaste={(e) => {
        e.preventDefault();
        const text = e.clipboardData.getData("text/plain");
        document.execCommand("insertText", false, text);
      }}
    >
      {initial.current}
    </div>
  );
}
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
  scale: number;
  selected: string[];
  tableSelection: TableCellSelection | null;
  selectTableCells: (selection: TableCellSelection | null) => void;
  editing: string | null;
  select: (ids: string[]) => void;
  edit: (id: string | null) => void;
  editTable?: (id: string, range?: TableCellRange) => void;
  begin: () => void;
  preview: (elements: SlideElement[]) => void;
  finish: () => void;
  changeText: (id: string, text: string) => void;
  showGuides: boolean;
  grid: boolean;
}
export default function SlideCanvas({
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
  begin,
  preview,
  finish,
  changeText,
  showGuides,
  grid,
}: Props) {
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
    if (!handle && el.type === "table" && el.table && !el.locked) {
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
    let ids = selected.includes(el.id) ? selected : [el.id];
    if (ev.shiftKey && !handle) {
      ids = selected.includes(el.id)
        ? selected.filter((id) => id !== el.id)
        : [...selected, el.id];
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
    if (ev.shiftKey && !d.handle) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    preview(
      d.elements.map((e) => {
        if (!d.ids.includes(e.id) || e.locked) return e;
        if (!d.handle) {
          let x = e.x + dx,
            y = e.y + dy;
          if (grid) {
            x = Math.round(x / 10) * 10;
            y = Math.round(y / 10) * 10;
          }
          if (showGuides) {
            if (Math.abs(x + e.width / 2 - deck.width / 2) < 7 / scale)
              x = (deck.width - e.width) / 2;
            if (Math.abs(y + e.height / 2 - deck.height / 2) < 7 / scale)
              y = (deck.height - e.height) / 2;
          }
          return { ...e, x, y };
        }
        let { x, y, width, height } = e;
        const h = d.handle;
        if (h.includes("e")) width = Math.max(16, e.width + dx);
        if (h.includes("s")) height = Math.max(8, e.height + dy);
        if (h.includes("w")) {
          width = Math.max(16, e.width - dx);
          x = e.x + e.width - width;
        }
        if (h.includes("n")) {
          height = Math.max(8, e.height - dy);
          y = e.y + e.height - height;
        }
        if (ev.shiftKey && h.length === 2) {
          height = (width * e.height) / e.width;
          if (h.includes("n")) y = e.y + e.height - height;
        }
        return { ...e, x, y, width, height };
      }),
    );
  };
  const up = (ev: ReactPointerEvent) => {
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
          transform: `scale(${scale})`,
        }}
        onPointerDown={(e) => {
          if (
            e.target === e.currentTarget ||
            (e.target instanceof Element &&
              e.target.classList.contains("slide-artwork"))
          ) {
            stopCellDrag();
            tableSelectionRef.current = null;
            selectTableCells(null);
            select([]);
            edit(null);
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
              tabIndex={e.type === "table" ? -1 : undefined}
              className={`slide-element ${selected.includes(e.id) ? "selected" : ""} ${e.locked ? "locked" : ""} ${editing === e.id ? "editing" : ""}`}
              style={
                {
                  ...elementStyle(e),
                  "--inverse-scale": 1 / scale,
                } as CSSProperties
              }
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
                if (e.type === "text" && !e.locked) {
                  select([e.id]);
                  begin();
                  edit(e.id);
                }
              }}
            >
              {editing === e.id ? (
                <EditableText
                  element={e}
                  onInput={(text) => changeText(e.id, text)}
                  onDone={() => {
                    finish();
                    edit(null);
                  }}
                />
              ) : e.type === "table" ? (
                <TableVisual
                  element={e}
                  selection={
                    tableSelection?.elementId === e.id
                      ? selectionRange(tableSelection)
                      : undefined
                  }
                />
              ) : (
                <ElementVisual element={e} />
              )}
            </div>
          ))}
        </div>
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
                !editing &&
                ["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((h) => (
                  <span
                    key={h}
                    className={`resize-handle ${h}`}
                    data-testid={`resize-${h}`}
                    onPointerDown={(ev) => down(ev, e, h)}
                  />
                ))}
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
      </div>
    </div>
  );
}
