import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { PresentationInkHandle } from "./PresentationInk";
import {
  ANDROID_FIT_VIEW,
  constrainAndroidZoom,
  zoomAndroidAt,
  type AndroidZoomBounds,
  type AndroidZoomView,
} from "./android-zoom";

type Point = { x: number; y: number };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const center = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});
type Gesture = {
  start: Point;
  view: AndroidZoomView;
  kind: "navigate" | "ink" | "pinch";
  multi: boolean;
  moved: boolean;
  laser: boolean;
  pinch?: { distance: number; center: Point };
};

export function useAndroidPresentationGestures(options: {
  host: RefObject<HTMLDivElement | null>;
  ink: RefObject<PresentationInkHandle | null>;
  bounds: AndroidZoomBounds;
  index: number;
  ended: boolean;
  drawing: boolean;
  onStep(direction: number): void;
  onTap(): void;
  onZoom(view: AndroidZoomView): void;
}) {
  const [view, setView] = useState(ANDROID_FIT_VIEW);
  const [laser, setLaser] = useState<Point | null>(null);
  const current = useRef(ANDROID_FIT_VIEW),
    latest = useRef(options);
  latest.current = options;
  const cancelGesture = useRef<() => void>(() => {});
  const apply = (value: AndroidZoomView) => {
    const next = constrainAndroidZoom(value, latest.current.bounds);
    current.current = next;
    setView(next);
    latest.current.onZoom(next);
  };
  useLayoutEffect(() => {
    cancelGesture.current();
    current.current = ANDROID_FIT_VIEW;
    setView(ANDROID_FIT_VIEW);
    latest.current.onZoom(ANDROID_FIT_VIEW);
  }, [
    options.index,
    options.ended,
    options.bounds.width,
    options.bounds.height,
    options.bounds.slideWidth,
    options.bounds.slideHeight,
  ]);
  useEffect(() => {
    const node = options.host.current;
    if (!node) return;
    const pointers = new Map<number, Point>();
    let gesture: Gesture | undefined,
      lastTap: { time: number; point: Point } | undefined;
    let hold: ReturnType<typeof setTimeout> | undefined,
      tap: ReturnType<typeof setTimeout> | undefined;
    const point = (event: PointerEvent): Point => {
      const rect = node.getBoundingClientRect();
      return {
        x: event.clientX - rect.left - rect.width / 2,
        y: event.clientY - rect.top - rect.height / 2,
      };
    };
    const clearPointers = () => {
      clearTimeout(hold);
      pointers.clear();
      gesture = undefined;
      setLaser(null);
    };
    const cancel = () => {
      clearPointers();
      clearTimeout(tap);
      lastTap = undefined;
      latest.current.ink.current?.cancelGesture();
    };
    cancelGesture.current = cancel;
    const excluded = (target: EventTarget | null) =>
      target instanceof Element &&
      target.closest(
        "button,a,input,.presentation-tools,.video-visual,.audio-visual,.android-presentation-controls",
      );
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || excluded(event.target)) return;
      const at = point(event);
      pointers.set(event.pointerId, at);
      if (pointers.size > 2) {
        cancel();
        return;
      }
      if (pointers.size === 2 && !latest.current.ended) {
        clearTimeout(hold);
        clearTimeout(tap);
        lastTap = undefined;
        setLaser(null);
        latest.current.ink.current?.cancelGesture();
        const [a, b] = [...pointers.values()];
        gesture = {
          start: at,
          view: current.current,
          kind: "pinch",
          multi: true,
          moved: true,
          laser: false,
          pinch: {
            distance: Math.max(1, distance(a, b)),
            center: center(a, b),
          },
        };
        for (const id of pointers.keys()) node.setPointerCapture(id);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      gesture = {
        start: at,
        view: current.current,
        kind: latest.current.drawing ? "ink" : "navigate",
        multi: false,
        moved: false,
        laser: false,
      };
      if (gesture.kind === "ink") return;
      const rect = node.getBoundingClientRect();
      if (event.clientX - rect.left < 16 || rect.right - event.clientX < 16) {
        clearPointers();
        return;
      }
      node.setPointerCapture(event.pointerId);
      hold = setTimeout(() => {
        if (!gesture || gesture.moved || latest.current.ended) return;
        gesture.laser = true;
        clearTimeout(tap);
        lastTap = undefined;
        setLaser({ x: event.clientX, y: event.clientY });
      }, 500);
    };
    const move = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId) || !gesture) return;
      const at = point(event);
      pointers.set(event.pointerId, at);
      const values = [...pointers.values()],
        g = gesture;
      if (g.kind === "ink" && !g.multi) return;
      if (g.multi) {
        event.preventDefault();
        event.stopPropagation();
      }
      if (values.length === 2 && g.pinch) {
        const nextCenter = center(values[0], values[1]);
        const zoom = Math.max(
          1,
          Math.min(
            5,
            (g.view.zoom * distance(values[0], values[1])) / g.pinch.distance,
          ),
        );
        const ratio = zoom / g.view.zoom;
        apply({
          zoom,
          x: nextCenter.x - (g.pinch.center.x - g.view.x) * ratio,
          y: nextCenter.y - (g.pinch.center.y - g.view.y) * ratio,
        });
        return;
      }
      if (g.laser) {
        setLaser({ x: event.clientX, y: event.clientY });
        return;
      }
      if (distance(at, g.start) > 10) {
        clearTimeout(hold);
        clearTimeout(tap);
        lastTap = undefined;
        g.moved = true;
      }
      if (g.view.zoom > 1 && g.moved)
        apply({
          ...g.view,
          x: g.view.x + at.x - g.start.x,
          y: g.view.y + at.y - g.start.y,
        });
    };
    const up = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId) || !gesture) return;
      const at = point(event),
        g = gesture;
      pointers.delete(event.pointerId);
      if (g.kind === "ink" && !g.multi) {
        clearPointers();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (pointers.size) {
        gesture = {
          start: [...pointers.values()][0],
          view: current.current,
          kind: "pinch",
          multi: true,
          moved: true,
          laser: false,
        };
        return;
      }
      clearPointers();
      if (g.multi || g.laser) return;
      const dx = at.x - g.start.x,
        dy = at.y - g.start.y;
      if (
        g.view.zoom <= 1.01 &&
        Math.abs(dx) >= 44 &&
        Math.abs(dx) > Math.abs(dy) * 1.4
      ) {
        clearTimeout(tap);
        lastTap = undefined;
        latest.current.onStep(dx < 0 ? 1 : -1);
        return;
      }
      if (g.moved || distance(at, g.start) > 10) return;
      const now = performance.now();
      if (
        !latest.current.ended &&
        lastTap &&
        now - lastTap.time < 320 &&
        distance(lastTap.point, at) < 32
      ) {
        clearTimeout(tap);
        lastTap = undefined;
        apply(
          zoomAndroidAt(
            current.current,
            current.current.zoom > 1 ? 1 : 2,
            at,
            latest.current.bounds,
          ),
        );
      } else {
        lastTap = { time: now, point: at };
        tap = setTimeout(() => {
          lastTap = undefined;
          latest.current.onTap();
        }, 320);
      }
    };
    const lost = (event: PointerEvent) => {
      if (
        pointers.has(event.pointerId) &&
        !node.hasPointerCapture(event.pointerId)
      )
        cancel();
    };
    node.addEventListener("pointerdown", down, true);
    node.addEventListener("pointermove", move, true);
    node.addEventListener("pointerup", up, true);
    node.addEventListener("pointercancel", cancel, true);
    node.addEventListener("lostpointercapture", lost, true);
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", cancel);
    return () => {
      cancel();
      cancelGesture.current = () => {};
      node.removeEventListener("pointerdown", down, true);
      node.removeEventListener("pointermove", move, true);
      node.removeEventListener("pointerup", up, true);
      node.removeEventListener("pointercancel", cancel, true);
      node.removeEventListener("lostpointercapture", lost, true);
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", cancel);
    };
  }, [
    options.host,
    options.index,
    options.ended,
    options.drawing,
    options.bounds.width,
    options.bounds.height,
  ]);
  return {
    view,
    laser,
    fit: () => {
      cancelGesture.current();
      apply(ANDROID_FIT_VIEW);
    },
    zoomBy: (step: number) => {
      cancelGesture.current();
      apply(
        zoomAndroidAt(
          current.current,
          current.current.zoom + step,
          { x: 0, y: 0 },
          latest.current.bounds,
        ),
      );
    },
  };
}
