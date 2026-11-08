import { useEffect, useRef, useState, type RefObject } from "react";
import {
  Hand,
  LogOut,
  MonitorOff,
  PenLine,
  Scan,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { PresentationInkHandle } from "./PresentationInk";
import { useAndroidPresentationGestures } from "./android-presentation-gestures";
import type { AndroidZoomBounds, AndroidZoomView } from "./android-zoom";

export default function AndroidPresentationControls({
  view,
  ink,
  index,
  total,
  ended,
  drawing,
  bounds,
  onZoom,
  onStep,
  onEnd,
  onBlack,
}: {
  view: RefObject<HTMLDivElement | null>;
  ink: RefObject<PresentationInkHandle | null>;
  index: number;
  total: number;
  ended: boolean;
  drawing: boolean;
  bounds: AndroidZoomBounds;
  onZoom(view: AndroidZoomView): void;
  onStep(direction: number): void;
  onEnd(): void;
  onBlack(): void;
}) {
  const [visible, setVisible] = useState(false);
  const controls = useRef<HTMLElement>(null);
  const gesture = useAndroidPresentationGestures({
    host: view,
    ink,
    index,
    ended,
    drawing,
    bounds,
    onZoom,
    onStep: (direction) => {
      setVisible(false);
      onStep(direction);
    },
    onTap: () => setVisible((value) => !value),
  });
  useEffect(() => {
    setVisible(ended || drawing);
  }, [index, ended, drawing]);
  useEffect(() => {
    if (!visible || ended || drawing) return;
    const timer = setTimeout(() => {
      if (!controls.current?.contains(document.activeElement))
        setVisible(false);
    }, 4000);
    return () => clearTimeout(timer);
  }, [visible, ended, drawing]);
  return (
    <>
      {gesture.laser && (
        <div
          className="android-touch-laser"
          data-testid="android-touch-laser"
          style={{ left: gesture.laser.x, top: gesture.laser.y }}
        />
      )}
      <nav
        ref={controls}
        className={`android-presentation-controls ${visible || ended || drawing ? "" : "android-controls-hidden"}`}
        aria-label="터치 발표 도구"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          aria-label="화면 이동 모드"
          aria-pressed={!drawing}
          onClick={() => ink.current?.command("arrow")}
        >
          <Hand />
          <span>화면 이동</span>
        </button>
        <button
          aria-label="포인터와 판서 도구"
          onClick={() => ink.current?.openMenu(12, 72)}
        >
          <PenLine />
          <span>펜·레이저</span>
        </button>
        <button aria-label="검은 화면 전환" onClick={onBlack}>
          <MonitorOff />
          <span>검은 화면</span>
        </button>
        <button aria-label="발표 종료" onClick={onEnd}>
          <LogOut />
          <span>발표 종료</span>
        </button>
        <button
          aria-label="발표 화면 축소"
          disabled={ended || gesture.view.zoom <= 1}
          onClick={() => gesture.zoomBy(-0.5)}
        >
          <ZoomOut />
          <span>축소</span>
        </button>
        <button
          aria-label="발표 화면 맞춤"
          disabled={ended}
          onClick={gesture.fit}
        >
          <Scan />
          <span>화면 맞춤 · {Math.round(gesture.view.zoom * 100)}%</span>
        </button>
        <button
          aria-label="발표 화면 확대"
          disabled={ended || gesture.view.zoom >= 5}
          onClick={() => gesture.zoomBy(0.5)}
        >
          <ZoomIn />
          <span>확대</span>
        </button>
        <span
          className="android-presentation-position"
          aria-label={`슬라이드 ${index + 1} / ${total}`}
        >
          {index + 1} / {total}
        </span>
      </nav>
      <button
        className="android-screenreader-trigger"
        aria-label="발표 도구 열기"
        onClick={() => setVisible(true)}
      >
        발표 도구 열기
      </button>
    </>
  );
}
