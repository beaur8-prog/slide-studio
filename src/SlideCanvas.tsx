import { memo, useRef, useLayoutEffect } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { Deck, Slide, SlideElement } from "./types";
import { fontStack, paragraphLines, scriptRuns } from "./text-layout";

export function TextContent({ element: e }: { element: SlideElement }) {
  if (!e.paragraphs) return <>{e.text}</>;
  return (
    <>
      {e.paragraphs.map((p, i) => (
        <div
          key={i}
          data-text-paragraph
          style={{
            flexShrink: 0,
            minHeight: p.runs.every((r) => !r.text) ? "1em" : undefined,
            fontSize: p.fontSize ?? e.fontSize,
            textAlign: p.align ?? e.align,
            lineHeight:
              p.lineSpacing !== undefined
                ? `${p.lineSpacing}px`
                : (p.lineHeight ?? "normal"),
            marginTop: p.spaceBefore ?? 0,
            marginBottom: p.spaceAfter ?? 0,
            paddingLeft: p.marginLeft ?? 0,
            paddingRight: p.marginRight ?? 0,
            tabSize: p.tabSize === undefined ? undefined : `${p.tabSize}px`,
            lineBreak: p.eastAsianLineBreak === false ? "auto" : "strict",
          }}
        >
          {paragraphLines(p).map((line, lineIndex) => (
            <div
              key={lineIndex}
              data-text-line
              style={{
                fontSize: Math.max(
                  ...line.map(
                    (r) => r.fontSize ?? p.fontSize ?? e.fontSize ?? 32,
                  ),
                ),
                minHeight: line.every((r) => !r.text) ? "1em" : undefined,
                textIndent: lineIndex === 0 ? (p.indent ?? 0) : 0,
              }}
            >
              {line.flatMap(scriptRuns).map((r, j) => (
                <span
                  key={j}
                  lang={r.language}
                  style={{
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
                      ? fontStack(r.fontFamily)
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
                    verticalAlign: r.baseline
                      ? `${r.baseline / 1000}%`
                      : undefined,
                  }}
                >
                  {r.text}
                </span>
              ))}
            </div>
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
          e.shape === "ellipse" ? "50%" : e.shape === "roundRect" ? 22 : 0,
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
    fontFamily: fontStack(e.fontFamily),
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
}: {
  slide: Slide;
  width: number;
  height: number;
  scale?: number;
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
  const initial = useRef(<TextContent element={element} />);
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
      onInput={(e) => onInput(e.currentTarget.innerText)}
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
interface Props {
  deck: Deck;
  slide: Slide;
  scale: number;
  selected: string[];
  editing: string | null;
  select: (ids: string[]) => void;
  edit: (id: string | null) => void;
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
  editing,
  select,
  edit,
  begin,
  preview,
  finish,
  changeText,
  showGuides,
  grid,
}: Props) {
  const drag = useRef<Drag | null>(null);
  const down = (ev: ReactPointerEvent, el: SlideElement, handle?: string) => {
    if (ev.button !== 0 || editing === el.id) return;
    ev.stopPropagation();
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
          if (e.target === e.currentTarget) {
            select([]);
            edit(null);
          }
        }}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        {showGuides && (
          <>
            <div className="guide vertical" style={{ left: deck.width / 2 }} />
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
            ) : (
              <ElementVisual element={e} />
            )}
            {selected.includes(e.id) &&
              !e.locked &&
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
                      : "도형"}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
