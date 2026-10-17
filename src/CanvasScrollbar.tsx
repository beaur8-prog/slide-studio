import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { ChevronDown, ChevronUp, ChevronsDown, ChevronsUp } from "lucide-react";

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/** One scrollbar spans the deck, including the scrollable part of a zoomed slide. */
export default function CanvasScrollbar({
  areaRef,
  activeIndex,
  slideCount,
  onSelect,
}: {
  areaRef: RefObject<HTMLDivElement | null>;
  activeIndex: number;
  slideCount: number;
  onSelect: (index: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; grab: number } | null>(null);
  const pending = useRef<{ index: number; top: number } | null>(null);
  const [metrics, setMetrics] = useState({
    viewport: 1,
    content: 1,
    top: 0,
    track: 0,
  });
  const measure = useCallback(() => {
    const area = areaRef.current;
    if (!area) return;
    const next = {
      viewport: Math.max(1, area.clientHeight),
      content: Math.max(1, area.scrollHeight, area.clientHeight),
      top: area.scrollTop,
      track: track.current?.clientHeight ?? 0,
    };
    setMetrics((previous) =>
      Object.keys(next).every(
        (key) =>
          next[key as keyof typeof next] === previous[key as keyof typeof next],
      )
        ? previous
        : next,
    );
  }, [areaRef]);
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    if (area.firstElementChild) observer.observe(area.firstElementChild);
    if (track.current) observer.observe(track.current);
    area.addEventListener("scroll", measure);
    return () => {
      observer.disconnect();
      area.removeEventListener("scroll", measure);
    };
  }, [areaRef, measure]);
  useLayoutEffect(() => {
    if (pending.current?.index === activeIndex && areaRef.current) {
      areaRef.current.scrollTop = pending.current.top;
      pending.current = null;
    }
    measure();
  });

  const pan = Math.max(0, metrics.content - metrics.viewport);
  const total = metrics.content * slideCount;
  const maximum = Math.max(0, total - metrics.viewport);
  const position = clamp(
    activeIndex * metrics.content + metrics.top,
    0,
    maximum,
  );
  const thumbHeight = Math.min(
    metrics.track,
    Math.max(24, (metrics.track * metrics.viewport) / total),
  );
  const travel = Math.max(0, metrics.track - thumbHeight);
  const thumbTop = maximum ? (travel * position) / maximum : 0;
  const atStart = activeIndex === 0 && metrics.top <= 1;
  const atEnd = activeIndex === slideCount - 1 && metrics.top >= pan - 1;
  const navigate = (index: number, top: number) => {
    const area = areaRef.current;
    if (!area) return;
    index = clamp(index, 0, slideCount - 1);
    if (index !== activeIndex) {
      pending.current = { index, top };
      onSelect(index);
    }
    area.scrollTop = top;
    measure();
  };
  const step = (direction: number, page = false) => {
    const area = areaRef.current;
    if (!area) return;
    const top = area.scrollTop;
    if ((direction > 0 && top < pan - 1) || (direction < 0 && top > 1)) {
      area.scrollTop = clamp(
        top + direction * (page ? metrics.viewport * 0.9 : 60),
        0,
        pan,
      );
      measure();
    } else if (
      activeIndex + direction >= 0 &&
      activeIndex + direction < slideCount
    ) {
      navigate(activeIndex + direction, direction > 0 ? 0 : pan);
    }
  };
  const seek = (value: number) => {
    // The gap between adjacent slide viewports snaps to the nearest page edge.
    const index = clamp(
      Math.floor((value + metrics.viewport / 2) / metrics.content),
      0,
      slideCount - 1,
    );
    navigate(index, clamp(value - index * metrics.content, 0, pan));
  };

  return (
    <div className="canvas-scrollbar" aria-label="편집 영역 탐색">
      <button
        title="위로 스크롤"
        aria-label="편집 영역 위로 스크롤"
        disabled={atStart}
        onClick={() => step(-1)}
      >
        <ChevronUp />
      </button>
      <div
        ref={track}
        className="canvas-scroll-track"
        role="scrollbar"
        tabIndex={0}
        aria-label="슬라이드 편집 영역 스크롤"
        aria-controls="slide-workspace"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={Math.round(maximum)}
        aria-valuenow={Math.round(position)}
        aria-valuetext={`슬라이드 ${activeIndex + 1} / ${slideCount}`}
        onKeyDown={(event) => {
          const actions: Record<string, () => void> = {
            ArrowUp: () => step(-1),
            ArrowDown: () => step(1),
            PageUp: () => step(-1, true),
            PageDown: () => step(1, true),
            Home: () => navigate(0, 0),
            End: () => navigate(slideCount - 1, pan),
          };
          if (!actions[event.key]) return;
          event.preventDefault();
          event.stopPropagation();
          actions[event.key]();
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          if (
            event.target instanceof Element &&
            event.target.closest(".canvas-scroll-thumb")
          ) {
            drag.current = {
              pointer: event.pointerId,
              grab:
                event.clientY -
                event.currentTarget.getBoundingClientRect().top -
                thumbTop,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          } else {
            step(
              event.clientY <
                event.currentTarget.getBoundingClientRect().top + thumbTop
                ? -1
                : 1,
              true,
            );
          }
        }}
        onPointerMove={(event) => {
          if (drag.current?.pointer !== event.pointerId || !travel) return;
          const y =
            event.clientY -
            event.currentTarget.getBoundingClientRect().top -
            drag.current.grab;
          seek(clamp(y / travel, 0, 1) * maximum);
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointer !== event.pointerId) return;
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
      >
        <div
          className="canvas-scroll-thumb"
          aria-hidden="true"
          style={{ height: thumbHeight, top: thumbTop }}
          title={`슬라이드 ${activeIndex + 1} / ${slideCount}`}
        />
      </div>
      <button
        title="아래로 스크롤"
        aria-label="편집 영역 아래로 스크롤"
        disabled={atEnd}
        onClick={() => step(1)}
      >
        <ChevronDown />
      </button>
      <button
        title="이전 슬라이드"
        aria-label="이전 슬라이드"
        disabled={activeIndex === 0}
        onClick={() => navigate(activeIndex - 1, 0)}
      >
        <ChevronsUp />
      </button>
      <button
        title="다음 슬라이드"
        aria-label="다음 슬라이드"
        disabled={activeIndex === slideCount - 1}
        onClick={() => navigate(activeIndex + 1, 0)}
      >
        <ChevronsDown />
      </button>
    </div>
  );
}
