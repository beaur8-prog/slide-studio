import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  MousePointer2,
  CircleDot,
  PenLine,
  Highlighter,
  Eraser,
  Trash2,
  Undo2,
  Redo2,
  X,
} from "lucide-react";
import { SlideVisual } from "./SlideCanvas";
import type { Slide } from "./types";
import { touchesInk, type InkPoint, type InkStroke } from "./presentation-ink";
import "./presentation-ink.css";

type Tool = "arrow" | "laser" | "pen" | "highlighter" | "eraser";
type Drawing = {
  strokes: InkStroke[];
  undo: InkStroke[][];
  redo: InkStroke[][];
};
type Gesture = {
  pointerId: number;
  slideId: string;
  tool: Tool;
  points: InkPoint[];
  before: InkStroke[];
  color: string;
  width: number;
  opacity?: number;
};
export interface PresentationInkHandle {
  openMenu(x: number, y: number): void;
  handleKey(event: KeyboardEvent): boolean;
  command(action: string): void;
  consumeClick(): boolean;
  snapshot(): Record<string, InkStroke[]>;
}
const colors = [
  ["#FF3434", "빨강"],
  ["#FFC400", "노랑"],
  ["#35D875", "초록"],
  ["#3E8BFF", "파랑"],
  ["#FFFFFF", "흰색"],
  ["#111111", "검정"],
];
const tools = [
  ["arrow", "화살표", MousePointer2, "A"],
  ["laser", "레이저 포인터", CircleDot, "L"],
  ["pen", "펜", PenLine, "P"],
  ["highlighter", "형광펜", Highlighter, "H"],
  ["eraser", "지우개", Eraser, "E"],
] as const;

// Session-only ink is kept apart from the document and its edit/undo history.
// The component stays mounted across slides, including the end screen.
const PresentationInk = forwardRef<
  PresentationInkHandle,
  {
    slide: Slide;
    width: number;
    height: number;
    scale: number;
    ended: boolean;
    blackout: boolean;
    onSlideLink: (id: string) => void;
  }
>(function PresentationInk(
  { slide, width, height, scale, ended, blackout, onSlideLink },
  ref,
) {
  const [tool, setTool] = useState<Tool>("arrow");
  const toolRef = useRef<Tool>("arrow");
  const [color, setColor] = useState(colors[0][0]);
  const [penWidth, setPenWidth] = useState(4);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [message, setMessage] = useState("");
  const [, redraw] = useState(0);
  const drawings = useRef<Record<string, Drawing>>({});
  const gesture = useRef<Gesture | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const draft = useRef<SVGPolylineElement>(null);
  const laser = useRef<SVGCircleElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const drawing = (id = slide.id) =>
    (drawings.current[id] ??= { strokes: [], undo: [], redo: [] });
  const render = () => redraw((n) => n + 1);
  const focusView = () =>
    document
      .querySelector<HTMLElement>('[data-testid="presentation-view"]')
      ?.focus({ preventScroll: true });
  const hidePointer = () => laser.current?.setAttribute("visibility", "hidden");
  const remember = (d: Drawing, before: InkStroke[]) => {
    d.undo = [...d.undo.slice(-19), before];
    d.redo = [];
  };
  const finish = (cancel = false) => {
    const g = gesture.current;
    gesture.current = null;
    draft.current?.setAttribute("points", "");
    if (!g) return;
    if (svg.current?.hasPointerCapture(g.pointerId))
      svg.current.releasePointerCapture(g.pointerId);
    const d = drawing(g.slideId);
    if (g.tool === "eraser") {
      if (cancel) d.strokes = g.before;
      else if (d.strokes !== g.before) remember(d, g.before);
    } else if (!cancel && g.points.length) {
      const entries = Object.values(drawings.current);
      const count = entries.reduce((n, entry) => n + entry.strokes.length, 0);
      const points = entries.reduce(
        (n, entry) =>
          n + entry.strokes.reduce((s, stroke) => s + stroke.points.length, 0),
        0,
      );
      if (count >= 1000 || points + g.points.length > 100000)
        setMessage(
          "표시가 많습니다. 필요 없는 그리기를 지운 뒤 다시 시도하세요.",
        );
      else {
        remember(d, d.strokes);
        const p =
          g.points.length === 1
            ? [g.points[0], [g.points[0][0] + 0.01, g.points[0][1]] as InkPoint]
            : g.points;
        d.strokes = [
          ...d.strokes,
          { points: p, color: g.color, width: g.width, opacity: g.opacity },
        ];
      }
    }
    render();
  };
  const selectTool = (next: Tool) => {
    finish(true);
    toolRef.current = next;
    setTool(next);
    hidePointer();
    setMenu(null);
    setMessage("");
    focusView();
  };
  const undo = (redo = false) => {
    finish(true);
    const d = drawing(),
      source = redo ? d.redo : d.undo;
    if (!source.length) return;
    const next = source.pop()!;
    (redo ? d.undo : d.redo).push(d.strokes);
    d.strokes = next;
    render();
  };
  const clear = () => {
    finish(true);
    const d = drawing();
    if (d.strokes.length) {
      remember(d, d.strokes);
      d.strokes = [];
      render();
    }
  };
  const command = (action: string) => {
    if (ended || blackout) return;
    if (["arrow", "laser", "pen", "highlighter", "eraser"].includes(action))
      selectTool(action as Tool);
    else if (action === "undo" || action === "redo") undo(action === "redo");
    else if (action === "clear") clear();
  };
  const openMenu = (x: number, y: number) => {
    if (ended || blackout) return;
    finish(true);
    hidePointer();
    setMenu({
      x: Math.max(12, Math.min(x, window.innerWidth - 294)),
      y: Math.max(12, Math.min(y, window.innerHeight - 430)),
    });
  };
  useImperativeHandle(ref, () => ({
    openMenu,
    command,
    snapshot() {
      finish();
      return Object.fromEntries(
        Object.entries(drawings.current)
          .filter(([, d]) => d.strokes.length)
          .map(([id, d]) => [id, structuredClone(d.strokes)]),
      );
    },
    consumeClick() {
      if (menu) {
        setMenu(null);
        focusView();
        return true;
      }
      return !ended && !blackout && toolRef.current !== "arrow";
    },
    handleKey(event) {
      if (event.isComposing || event.altKey) return false;
      if (event.key === "Escape" && menu) {
        event.preventDefault();
        setMenu(null);
        focusView();
        return true;
      }
      const cmd = event.ctrlKey || event.metaKey,
        key = event.key.toLowerCase();
      if (cmd && ["a", "l", "p", "h", "e", "z", "y"].includes(key)) {
        event.preventDefault();
        if (!event.repeat)
          command(
            (
              {
                a: "arrow",
                l: "laser",
                p: "pen",
                h: "highlighter",
                e: "eraser",
                z: event.shiftKey ? "redo" : "undo",
                y: "redo",
              } as Record<string, string>
            )[key],
          );
        return true;
      }
      if (
        event.key === "F1" ||
        event.key === "ContextMenu" ||
        (event.key === "F10" && event.shiftKey)
      ) {
        event.preventDefault();
        openMenu(24, window.innerHeight - 440);
        return true;
      }
      if (!cmd && key === "e" && !menu && !ended && !blackout) {
        event.preventDefault();
        clear();
        return true;
      }
      return Boolean(menu);
    },
  }));
  useLayoutEffect(() => {
    finish(true);
    hidePointer();
    setMenu(null);
    // End, blackout, resize, and direct jumps must never retain a pointer grab.
  }, [slide.id, ended, blackout, scale]);
  useLayoutEffect(() => {
    if (!menu || !panel.current) return;
    const bounds = panel.current.getBoundingClientRect();
    const x = Math.max(
      12,
      Math.min(menu.x, window.innerWidth - bounds.width - 12),
    );
    const y = Math.max(
      12,
      Math.min(menu.y, window.innerHeight - bounds.height - 12),
    );
    if (Math.abs(x - menu.x) > 0.5 || Math.abs(y - menu.y) > 0.5)
      setMenu({ x, y });
    else panel.current.querySelector<HTMLButtonElement>("button")?.focus();
  }, [menu]);
  const point = (event: ReactPointerEvent): InkPoint => {
    const bounds = svg.current!.getBoundingClientRect();
    return [
      Math.max(
        0,
        Math.min(width, ((event.clientX - bounds.left) * width) / bounds.width),
      ),
      Math.max(
        0,
        Math.min(
          height,
          ((event.clientY - bounds.top) * height) / bounds.height,
        ),
      ),
    ];
  };
  const erase = (from: InkPoint, to: InkPoint) => {
    const d = drawing(),
      next = d.strokes.filter(
        (stroke) => !touchesInk(stroke, from, to, 10 / scale),
      );
    if (next.length !== d.strokes.length) {
      d.strokes = next;
      render();
    }
  };
  const move = (event: ReactPointerEvent) => {
    if (toolRef.current === "laser") {
      const p = point(event);
      laser.current?.setAttribute("cx", String(p[0]));
      laser.current?.setAttribute("cy", String(p[1]));
      laser.current?.setAttribute("visibility", "visible");
    }
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    const p = point(event),
      previous = g.points[g.points.length - 1];
    if (g.tool === "eraser") {
      erase(previous, p);
      g.points = [p];
    } else if (
      g.points.length < 4096 &&
      Math.hypot(p[0] - previous[0], p[1] - previous[1]) >= 0.5
    ) {
      g.points.push(p);
      draft.current?.setAttribute(
        "points",
        g.points.map((p) => p.join(",")).join(" "),
      );
    }
  };
  const d = drawing();
  return (
    <>
      {!ended && (
        <div
          key={slide.id}
          className={`present-slide ${slide.transition === "fade" ? "fade-in" : ""}`}
          style={{ width: width * scale, height: height * scale }}
        >
          <SlideVisual
            slide={slide}
            interactive={!blackout && tool === "arrow"}
            playMedia={!blackout}
            onSlideLink={onSlideLink}
            width={width}
            height={height}
            scale={scale}
          />
          <svg
            ref={svg}
            className={`presentation-ink tool-${tool}`}
            data-testid="presentation-ink"
            data-tool={tool}
            viewBox={`0 0 ${width} ${height}`}
            aria-hidden="true"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => {
              if (event.button !== 0 || !event.isPrimary || blackout) return;
              event.preventDefault();
              event.stopPropagation();
              if (menu) {
                setMenu(null);
                focusView();
                return;
              }
              if (
                gesture.current ||
                !["pen", "highlighter", "eraser"].includes(toolRef.current)
              )
                return;
              const p = point(event);
              gesture.current = {
                pointerId: event.pointerId,
                slideId: slide.id,
                tool: toolRef.current,
                points: [p],
                before: d.strokes,
                color,
                width:
                  toolRef.current === "highlighter" ? penWidth * 5 : penWidth,
                opacity: toolRef.current === "highlighter" ? 0.35 : 1,
              };
              svg.current!.setPointerCapture(event.pointerId);
              if (toolRef.current === "eraser") erase(p, p);
              else {
                draft.current?.setAttribute("stroke", color);
                draft.current?.setAttribute(
                  "stroke-width",
                  String(gesture.current.width),
                );
                draft.current?.setAttribute(
                  "opacity",
                  String(gesture.current.opacity ?? 1),
                );
                draft.current?.setAttribute(
                  "points",
                  `${p.join(",")} ${p[0] + 0.01},${p[1]}`,
                );
              }
            }}
            onPointerMove={move}
            onPointerUp={(event) => {
              if (gesture.current?.pointerId === event.pointerId) {
                move(event);
                finish();
              }
            }}
            onPointerCancel={() => finish(true)}
            onLostPointerCapture={() => finish(true)}
            onPointerLeave={hidePointer}
          >
            {d.strokes.map((stroke, i) => (
              <polyline
                key={i}
                data-testid="ink-stroke"
                points={stroke.points.map((p) => p.join(",")).join(" ")}
                fill="none"
                stroke={stroke.color}
                strokeWidth={stroke.width}
                opacity={stroke.opacity}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            <polyline
              ref={draft}
              data-testid="ink-draft"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle
              ref={laser}
              data-testid="laser-pointer"
              className="laser-pointer"
              visibility="hidden"
              r={6 / scale}
              fill={color}
              stroke="white"
              strokeWidth={1 / scale}
            />
          </svg>
        </div>
      )}
      {menu && !ended && !blackout && (
        <div
          ref={panel}
          className="presentation-tools"
          role="dialog"
          aria-label="발표 도구"
          style={{ left: menu.x, top: menu.y }}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setMenu(null);
              focusView();
            }
            if (event.key === "Tab") {
              const controls = Array.from(
                panel.current!.querySelectorAll<HTMLElement>(
                  "button:not(:disabled), select",
                ),
              );
              const index = controls.indexOf(
                document.activeElement as HTMLElement,
              );
              if (
                (event.shiftKey && index === 0) ||
                (!event.shiftKey && index === controls.length - 1)
              ) {
                event.preventDefault();
                controls[event.shiftKey ? controls.length - 1 : 0]?.focus();
              }
            }
          }}
        >
          <div className="presentation-tools-heading">
            <strong>발표 도구</strong>
            <button
              aria-label="발표 도구 닫기"
              onClick={() => {
                setMenu(null);
                focusView();
              }}
            >
              <X size={16} />
            </button>
          </div>
          {tools.map(([value, label, Icon, key]) => (
            <button
              key={value}
              className="presentation-tool-option"
              aria-label={label}
              aria-pressed={tool === value}
              onClick={() => selectTool(value)}
            >
              <Icon size={18} />
              <span>{label}</span>
              <kbd>
                {/Mac/.test(navigator.platform) ? "⌘" : "Ctrl+"}
                {key}
              </kbd>
            </button>
          ))}
          <div
            className="presentation-ink-colors"
            role="group"
            aria-label="표시 색상"
          >
            {colors.map(([value, label]) => (
              <button
                key={value}
                aria-label={`${label} 색상`}
                aria-pressed={color === value}
                style={{ background: value }}
                onClick={() => {
                  setColor(value);
                  hidePointer();
                }}
              />
            ))}
          </div>
          <label className="presentation-pen-width">
            펜 굵기
            <select
              aria-label="펜 굵기"
              value={penWidth}
              onChange={(event) => setPenWidth(Number(event.target.value))}
            >
              {[2, 4, 8].map((value) => (
                <option key={value} value={value}>
                  {value === 2 ? "가는 선" : value === 4 ? "보통" : "굵은 선"}
                </option>
              ))}
            </select>
          </label>
          <div className="presentation-ink-actions">
            <button
              aria-label="그리기 실행 취소"
              disabled={!d.undo.length}
              onClick={() => undo()}
            >
              <Undo2 size={17} />
            </button>
            <button
              aria-label="그리기 다시 실행"
              disabled={!d.redo.length}
              onClick={() => undo(true)}
            >
              <Redo2 size={17} />
            </button>
            <button disabled={!d.strokes.length} onClick={clear}>
              <Trash2 size={16} />이 슬라이드 지우기<kbd>E</kbd>
            </button>
          </div>
          <p>
            그리기는 슬라이드별로 유지되며
            <br />
            발표 종료 후 슬라이드에 보관할 수 있습니다.
          </p>
        </div>
      )}
      {message && (
        <div className="presentation-ink-message" role="status">
          {message}
        </div>
      )}
    </>
  );
});
export default PresentationInk;
