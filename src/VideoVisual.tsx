import { useEffect, useMemo, useRef, useState } from "react";
import type { SlideElement } from "./types";
import { stillImageSource } from "./gif-preview";

export function VideoVisual({
  element: e,
  playing = false,
}: {
  element: SlideElement;
  playing?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const poster = useMemo(() => stillImageSource(e.poster), [e.poster]);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    setError(false);
    setBlocked(false);
    if (playing && e.autoPlay !== false)
      void video.play().catch(() => setBlocked(true));
    else video.pause();
    return () => video.pause();
  }, [playing, e.src, e.autoPlay]);
  if (!playing)
    return (
      <img
        className="element-image"
        src={poster}
        alt={e.alt || "동영상"}
        draggable={false}
        style={{ transform: `scale(${e.flipH ? -1 : 1},${e.flipV ? -1 : 1})` }}
      />
    );
  return (
    <div
      className="video-visual"
      style={{ width: "100%", height: "100%", position: "relative" }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <video
        ref={ref}
        src={e.src}
        poster={poster}
        loop={e.loop !== false}
        muted={e.muted !== false}
        playsInline
        controls
        preload="auto"
        aria-label={e.alt || "동영상"}
        onError={() => setError(true)}
        onPlay={() => setBlocked(false)}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          objectFit: "fill",
          pointerEvents: "auto",
          transform: `scale(${e.flipH ? -1 : 1},${e.flipV ? -1 : 1})`,
        }}
      />
      {error ? (
        <span
          role="alert"
          style={{
            position: "absolute",
            inset: 0,
            background: "#151515",
            color: "white",
            padding: 16,
          }}
        >
          동영상을 재생할 수 없습니다. H.264 MP4 또는 VP8/VP9 WebM으로 변환해
          주세요.
        </span>
      ) : (
        blocked && (
          <button
            style={{
              position: "absolute",
              left: "35%",
              top: "40%",
              pointerEvents: "auto",
            }}
            onClick={() =>
              void ref.current?.play().catch(() => setBlocked(true))
            }
          >
            동영상 재생
          </button>
        )
      )}
    </div>
  );
}
