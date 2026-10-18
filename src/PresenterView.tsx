import { useEffect, useRef, useState } from "react";
import { SlideVisual } from "./SlideCanvas";
import type { Slide } from "./types";
export type PresenterState = {
  slide: Slide;
  next?: Slide;
  width: number;
  height: number;
  index: number;
  total: number;
  ended: boolean;
  blackout: boolean;
  whiteout: boolean;
};
export type PresenterCommand = "next" | "previous" | "black" | "white" | "end";
export function usePresenterView(
  state: PresenterState,
  command: (value: PresenterCommand) => void,
) {
  const stateRef = useRef(state),
    commandRef = useRef(command),
    channel = useRef<BroadcastChannel | null>(null),
    viewer = useRef<Window | null>(null);
  stateRef.current = state;
  commandRef.current = command;
  useEffect(() => {
    channel.current?.postMessage({ type: "state", state });
  }, [
    state.slide,
    state.next,
    state.index,
    state.ended,
    state.blackout,
    state.whiteout,
  ]);
  useEffect(
    () => () => {
      channel.current?.close();
      viewer.current?.close();
    },
    [],
  );
  return () => {
    viewer.current?.close();
    channel.current?.close();
    const token = crypto.randomUUID(),
      bus = new BroadcastChannel("slide-studio-presenter-" + token);
    channel.current = bus;
    bus.onmessage = (e) => {
      if (e.data?.type === "ready")
        bus.postMessage({ type: "state", state: stateRef.current });
      if (
        e.data?.type === "command" &&
        ["next", "previous", "black", "white", "end"].includes(e.data.command)
      )
        commandRef.current(e.data.command);
    };
    const url = new URL(location.href);
    url.hash = "presenter=" + token;
    viewer.current = window.open(
      url.href,
      "slide-studio-presenter",
      "width=1180,height=780",
    );
    if (!viewer.current) {
      bus.close();
      channel.current = null;
      return false;
    }
    return true;
  };
}
export default function PresenterView({ token }: { token: string }) {
  const [state, setState] = useState<PresenterState | null>(null),
    [elapsed, setElapsed] = useState(0),
    bus = useRef<BroadcastChannel | null>(null),
    started = useRef(Date.now());
  useEffect(() => {
    document.title = "Slide Studio — 발표자 보기";
    const channel = new BroadcastChannel("slide-studio-presenter-" + token);
    bus.current = channel;
    channel.onmessage = (e) => {
      if (e.data?.type === "state") setState(e.data.state);
    };
    channel.postMessage({ type: "ready" });
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - started.current) / 1000)),
      1000,
    );
    return () => {
      clearInterval(timer);
      channel.close();
    };
  }, [token]);
  const command = (command: PresenterCommand) =>
    bus.current?.postMessage({ type: "command", command });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        command("next");
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        command("previous");
      }
      if (e.key === "Escape") command("end");
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  if (!state)
    return (
      <main className="presenter-window">
        <h1>발표 화면에 연결 중…</h1>
      </main>
    );
  const preview = (slide: Slide, max: number) => (
    <div
      style={{
        width: max,
        height: (max * state.height) / state.width,
        overflow: "hidden",
      }}
    >
      <SlideVisual
        slide={slide}
        width={state.width}
        height={state.height}
        scale={max / state.width}
      />
    </div>
  );
  return (
    <main className="presenter-window">
      <header>
        <h1>발표자 보기</h1>
        <span>
          경과 {Math.floor(elapsed / 60)}:
          {String(elapsed % 60).padStart(2, "0")}
        </span>
        <span>
          {state.index + 1} / {state.total}
        </span>
        <button onClick={() => command("end")}>발표 종료</button>
      </header>
      <div className="presenter-grid">
        <section>
          <h2>
            현재 슬라이드
            {state.blackout
              ? " · 검은 화면"
              : state.whiteout
                ? " · 흰 화면"
                : ""}
          </h2>
          {state.ended ? (
            <p>슬라이드 쇼가 끝났습니다.</p>
          ) : (
            preview(state.slide, Math.min(720, innerWidth * 0.62))
          )}
          <nav>
            <button onClick={() => command("previous")}>이전</button>
            <button onClick={() => command("next")}>다음</button>
            <button onClick={() => command("black")}>검은 화면</button>
            <button onClick={() => command("white")}>흰 화면</button>
          </nav>
        </section>
        <aside>
          <h2>다음 슬라이드</h2>
          {state.next ? (
            preview(state.next, Math.min(320, innerWidth * 0.28))
          ) : (
            <p>마지막 슬라이드입니다.</p>
          )}
          <h2>발표자 노트</h2>
          <div className="presenter-private-notes">
            {state.slide.notes || "이 슬라이드에 노트가 없습니다."}
          </div>
        </aside>
      </div>
      <p>
        이 창을 발표자가 보는 모니터로 옮기세요. 청중 화면에는 노트가 표시되지
        않습니다.
      </p>
    </main>
  );
}
