import { memo, useLayoutEffect, useRef, useState } from "react";
import { SlideVisual } from "./SlideCanvas";
import type { Slide } from "./types";

type Point = { x: number; y: number };
type View = { zoom: number; x: number; y: number };
const fitView: View = { zoom: 1, x: 0, y: 0 };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point) => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

export default memo(function AndroidSlideViewport({
  slide,
  width,
  height,
  onStep,
  onZoom,
  resetVersion = 0,
  requestedZoom = 1,
}: {
  slide: Slide;
  width: number;
  height: number;
  onStep: (direction: number) => void;
  onZoom: (zoom: number) => void;
  resetVersion?: number;
  requestedZoom?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [view, setView] = useState(fitView);
  const current = useRef(view);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<
    | {
        origin: Point;
        view: View;
        pinch?: { distance: number; center: Point };
        multi: boolean;
      }
    | undefined
  >(undefined);
  const lastTap = useRef<{ time: number; point: Point } | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const fit = Math.min(
    Math.max(1, size.width - 24) / width,
    Math.max(1, size.height - 24) / height,
  );
  const apply = (next: View) => {
    const zoom = Math.max(1, Math.min(5, next.zoom));
    const maxX = Math.max(0, (width * fit * zoom - size.width + 24) / 2);
    const maxY = Math.max(0, (height * fit * zoom - size.height + 24) / 2);
    const value = {
      zoom,
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
    current.current = value;
    setView(value);
    onZoom(zoom);
  };
  const cancel = () => {
    pointers.current.clear();
    gesture.current = undefined;
  };
  useLayoutEffect(() => {
    const node = host.current!;
    const observer = new ResizeObserver(() => {
      cancel();
      setSize({ width: node.clientWidth, height: node.clientHeight });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    cancel();
    lastTap.current = undefined;
    current.current = fitView;
    setView(fitView);
    onZoom(1);
    setFailed(false);
  }, [slide.id, width, height, size.width, size.height]);
  useLayoutEffect(() => {
    cancel();
    apply({ zoom: requestedZoom, x: 0, y: 0 });
  }, [resetVersion]);
  const local = (x: number, y: number): Point => {
    const rect = host.current!.getBoundingClientRect();
    return {
      x: x - rect.left - rect.width / 2,
      y: y - rect.top - rect.height / 2,
    };
  };
  return (
    <div
      ref={host}
      className="android-slide-viewport"
      data-testid="android-slide-viewport"
      data-zoom={view.zoom.toFixed(2)}
      tabIndex={0}
      role="region"
      aria-label="슬라이드 보기 · 두 손가락으로 확대"
      onErrorCapture={() => setFailed(true)}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const point = local(event.clientX, event.clientY);
        pointers.current.set(event.pointerId, point);
        event.currentTarget.setPointerCapture(event.pointerId);
        const values = [...pointers.current.values()];
        if (values.length === 1)
          gesture.current = {
            origin: point,
            view: current.current,
            multi: false,
          };
        else if (values.length === 2) {
          lastTap.current = undefined;
          gesture.current = {
            origin: point,
            view: current.current,
            multi: true,
            pinch: {
              distance: Math.max(1, distance(values[0], values[1])),
              center: midpoint(values[0], values[1]),
            },
          };
        }
      }}
      onPointerMove={(event) => {
        if (!pointers.current.has(event.pointerId)) return;
        pointers.current.set(
          event.pointerId,
          local(event.clientX, event.clientY),
        );
        const g = gesture.current,
          values = [...pointers.current.values()];
        if (!g) return;
        if (values.length === 2 && g.pinch) {
          const center = midpoint(values[0], values[1]);
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
            x: center.x - (g.pinch.center.x - g.view.x) * ratio,
            y: center.y - (g.pinch.center.y - g.view.y) * ratio,
          });
        } else if (values.length === 1 && g.view.zoom > 1) {
          apply({
            ...g.view,
            x: g.view.x + values[0].x - g.origin.x,
            y: g.view.y + values[0].y - g.origin.y,
          });
        }
      }}
      onPointerUp={(event) => {
        const g = gesture.current,
          point = local(event.clientX, event.clientY);
        pointers.current.delete(event.pointerId);
        if (!g) return;
        if (pointers.current.size) {
          gesture.current = {
            origin: [...pointers.current.values()][0],
            view: current.current,
            multi: true,
          };
          return;
        }
        gesture.current = undefined;
        if (g.multi) return;
        const dx = point.x - g.origin.x,
          dy = point.y - g.origin.y;
        if (
          g.view.zoom <= 1.01 &&
          Math.abs(dx) >= 44 &&
          Math.abs(dx) > Math.abs(dy) * 1.4
        ) {
          lastTap.current = undefined;
          onStep(dx < 0 ? 1 : -1);
          return;
        }
        if (Math.hypot(dx, dy) > 10) {
          lastTap.current = undefined;
          return;
        }
        const previous = lastTap.current,
          now = performance.now();
        if (
          previous &&
          now - previous.time < 320 &&
          distance(previous.point, point) < 32
        ) {
          const zoom = current.current.zoom > 1 ? 1 : 2;
          apply({ zoom, x: -point.x * (zoom - 1), y: -point.y * (zoom - 1) });
          lastTap.current = undefined;
        } else lastTap.current = { time: now, point };
      }}
      onPointerCancel={() => {
        cancel();
        lastTap.current = undefined;
      }}
      onLostPointerCapture={(event) => {
        if (pointers.current.has(event.pointerId)) cancel();
      }}
    >
      <div
        className="android-slide-position"
        style={{
          width: width * fit,
          height: height * fit,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
        }}
      >
        <SlideVisual slide={slide} width={width} height={height} scale={fit} />
      </div>
      {failed && (
        <p className="android-image-error" role="status">
          일부 그림을 표시하지 못했습니다. 표시 안내와 원본 파일을 확인해
          주세요.
        </p>
      )}
    </div>
  );
});
