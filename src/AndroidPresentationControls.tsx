import { useEffect, useRef, useState, type RefObject } from "react";
import { ChevronLeft, ChevronRight, MoreHorizontal, X } from "lucide-react";
import type { PresentationInkHandle } from "./PresentationInk";

export default function AndroidPresentationControls({
  view,
  ink,
  index,
  total,
  ended,
  onStep,
  onJump,
  onEnd,
  onBlack,
}: {
  view: RefObject<HTMLDivElement | null>;
  ink: RefObject<PresentationInkHandle | null>;
  index: number;
  total: number;
  ended: boolean;
  onStep(direction: number): void;
  onJump(index: number): void;
  onEnd(): void;
  onBlack(): void;
}) {
  const [visible, setVisible] = useState(true);
  const [jump, setJump] = useState(false);
  const [page, setPage] = useState("");
  const [error, setError] = useState("");
  const [laser, setLaser] = useState<{ x: number; y: number } | null>(null);
  const latest = useRef({ onStep, ended, jump });
  latest.current = { onStep, ended, jump };
  useEffect(() => {
    const node = view.current;
    if (!node) return;
    let pointer: {
      id: number;
      x: number;
      y: number;
      laser: boolean;
      cancelled: boolean;
    } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => {
      clearTimeout(timer);
      pointer = null;
      setLaser(null);
    };
    const excluded = (target: EventTarget | null) =>
      target instanceof Element &&
      target.closest(
        "button,a,input,.presentation-tools,.video-visual,.audio-visual,.android-presentation-controls,.android-presentation-jump",
      );
    const down = (event: PointerEvent) => {
      if (excluded(event.target) || latest.current.jump || event.button !== 0)
        return;
      if (!event.isPrimary || pointer) {
        cancel();
        return;
      }
      if (
        event.target instanceof Element &&
        event.target.closest(".presentation-ink:not(.tool-arrow)")
      )
        return;
      const bounds = node.getBoundingClientRect();
      if (event.clientX - bounds.left < 16 || bounds.right - event.clientX < 16)
        return;
      pointer = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        laser: false,
        cancelled: false,
      };
      node.setPointerCapture(event.pointerId);
      timer = setTimeout(() => {
        if (!pointer || pointer.cancelled || latest.current.ended) return;
        pointer.laser = true;
        setLaser({ x: pointer.x, y: pointer.y });
      }, 500);
    };
    const move = (event: PointerEvent) => {
      if (!pointer || event.pointerId !== pointer.id) return;
      if (pointer.laser) setLaser({ x: event.clientX, y: event.clientY });
      else if (
        Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 10
      ) {
        clearTimeout(timer);
        pointer.cancelled = true;
      }
    };
    const up = (event: PointerEvent) => {
      if (!pointer || event.pointerId !== pointer.id) return;
      const g = pointer;
      cancel();
      if (g.laser) return;
      const dx = event.clientX - g.x,
        dy = event.clientY - g.y;
      if (Math.abs(dx) >= 44 && Math.abs(dx) > Math.abs(dy) * 1.4)
        latest.current.onStep(dx < 0 ? 1 : -1);
      else if (!g.cancelled) setVisible((value) => !value);
    };
    node.addEventListener("pointerdown", down);
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    document.addEventListener("visibilitychange", cancel);
    return () => {
      cancel();
      node.removeEventListener("pointerdown", down);
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
      document.removeEventListener("visibilitychange", cancel);
    };
  }, [view, index, ended]);
  useEffect(() => {
    setLaser(null);
    setVisible(true);
  }, [index, ended]);
  return (
    <>
      {laser && (
        <div
          className="android-touch-laser"
          data-testid="android-touch-laser"
          style={{ left: laser.x, top: laser.y }}
        />
      )}
      <nav
        className={`android-presentation-controls ${visible || jump || ended ? "" : "android-controls-hidden"}`}
        aria-label="터치 발표 도구"
        onClick={(event) => event.stopPropagation()}
      >
        <button aria-label="이전 발표 슬라이드" onClick={() => onStep(-1)}>
          <ChevronLeft />
        </button>
        <button
          aria-label="발표 페이지로 이동"
          onClick={() => {
            setPage(String(index + 1));
            setError("");
            setJump(true);
          }}
        >
          {index + 1} / {total}
        </button>
        <button aria-label="다음 발표 슬라이드" onClick={() => onStep(1)}>
          <ChevronRight />
        </button>
        <button
          aria-label="포인터와 판서 도구"
          onClick={() => ink.current?.openMenu(12, 72)}
        >
          <MoreHorizontal />
        </button>
        <button aria-label="검은 화면 전환" onClick={onBlack}>
          검은 화면
        </button>
        <button aria-label="발표 종료" onClick={onEnd}>
          <X />
        </button>
      </nav>
      {jump && (
        <form
          className="android-presentation-jump"
          role="dialog"
          aria-modal="true"
          aria-label="발표 페이지로 이동"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              setJump(false);
            }
          }}
          onSubmit={(event) => {
            event.preventDefault();
            if (
              !/^\d+$/.test(page) ||
              Number(page) < 1 ||
              Number(page) > total
            ) {
              setError(`1~${total} 사이의 번호를 입력하세요.`);
              return;
            }
            onJump(Number(page) - 1);
            setJump(false);
          }}
        >
          <label>
            슬라이드 번호
            <input
              autoFocus
              inputMode="numeric"
              value={page}
              onChange={(event) => setPage(event.target.value)}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <button type="submit">이동</button>
          <button type="button" onClick={() => setJump(false)}>
            취소
          </button>
        </form>
      )}
    </>
  );
}
