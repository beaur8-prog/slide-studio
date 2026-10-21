import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

const MIN_HEIGHT = 73;
const STORAGE_KEY = "slide-studio-notes-height";
function savedHeight() {
  try {
    const height = Number(localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(height) && height >= MIN_HEIGHT && height <= 4000)
      return height;
  } catch {}
  return MIN_HEIGHT;
}
function remember(height: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(height));
  } catch {}
}

export default function NotesPane({ children }: { children: ReactNode }) {
  const pane = useRef<HTMLDivElement>(null);
  const [preferred, setPreferred] = useState(savedHeight);
  const [maximum, setMaximum] = useState(
    Math.max(MIN_HEIGHT, innerHeight - 360),
  );
  const [resizing, setResizing] = useState(false);
  const drag = useRef<{
    pointer: number;
    y: number;
    height: number;
    original: number;
  } | null>(null);
  const height = Math.min(preferred, maximum);
  const heightRef = useRef(height);
  heightRef.current = height;
  const clamp = (value: number) =>
    Math.round(Math.max(MIN_HEIGHT, Math.min(maximum, value)));

  useLayoutEffect(() => {
    const column = pane.current?.parentElement;
    if (!column) return;
    // Leave room for the slide and its heading, including in short windows.
    const measure = () =>
      setMaximum(Math.max(MIN_HEIGHT, column.clientHeight - 180));
    const observer = new ResizeObserver(measure);
    observer.observe(column);
    measure();
    return () => observer.disconnect();
  }, []);

  const cancel = () => {
    if (drag.current) setPreferred(drag.current.original);
    drag.current = null;
    setResizing(false);
  };
  useEffect(() => {
    if (!resizing) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    };
    document.documentElement.classList.add("notes-resizing");
    window.addEventListener("keydown", escape, true);
    window.addEventListener("blur", cancel);
    return () => {
      document.documentElement.classList.remove("notes-resizing");
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("blur", cancel);
    };
  }, [resizing]);

  const setAndRemember = (value: number) => {
    const next = clamp(value);
    setPreferred(next);
    remember(next);
  };
  return (
    <div className="notes-pane" ref={pane} style={{ height }}>
      <span
        className="notes-resize-handle"
        role="separator"
        tabIndex={0}
        aria-label="발표자 노트 높이 조절"
        aria-orientation="horizontal"
        aria-valuemin={MIN_HEIGHT}
        aria-valuemax={maximum}
        aria-valuenow={height}
        aria-valuetext={`${height}px`}
        aria-controls="speaker-notes-editor"
        title="위아래로 끌어 노트 높이 조절 · 두 번 클릭하면 기본 높이"
        onPointerDown={(event) => {
          if (event.button !== 0 || drag.current) return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.focus({ preventScroll: true });
          drag.current = {
            pointer: event.pointerId,
            y: event.clientY,
            height,
            original: preferred,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          setResizing(true);
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.pointer !== event.pointerId) return;
          event.preventDefault();
          const next = clamp(current.height + current.y - event.clientY);
          heightRef.current = next;
          setPreferred(next);
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointer !== event.pointerId) return;
          drag.current = null;
          setResizing(false);
          remember(heightRef.current);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={cancel}
        onLostPointerCapture={() => {
          if (drag.current) cancel();
        }}
        onDoubleClick={() => setAndRemember(MIN_HEIGHT)}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 50 : 20;
          const next =
            event.key === "ArrowUp"
              ? height + step
              : event.key === "ArrowDown"
                ? height - step
                : event.key === "Home"
                  ? MIN_HEIGHT
                  : event.key === "End"
                    ? maximum
                    : null;
          if (next === null) return;
          event.preventDefault();
          event.stopPropagation();
          setAndRemember(next);
        }}
      />
      {children}
    </div>
  );
}
