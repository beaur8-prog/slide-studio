import type { SlideElement } from "./types";
import { Pause, Play, AlertCircle } from "lucide-react";
import { AUDIO_ICON } from "./audio-icon";
import { usePresentationAudio } from "./PresentationAudio";
import { stillImageSource } from "./gif-preview";
import "./audio.css";

export function AudioVisual({
  element: e,
  playing = false,
}: {
  element: SlideElement;
  playing?: boolean;
}) {
  const session = usePresentationAudio(),
    status = session?.status[e.id];
  const poster = stillImageSource(e.poster) || AUDIO_ICON;
  if (!playing || !session)
    return (
      <img
        className="element-image"
        src={poster}
        alt={e.alt || "오디오"}
        draggable={false}
      />
    );
  if (
    e.hideDuringShow &&
    e.autoPlay !== false &&
    !status?.blocked &&
    !status?.error
  )
    return null;
  const label = status?.playing ? "일시 정지" : "재생";
  return (
    <div
      className="audio-visual"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="audio-play-button"
        aria-label={`${label}: ${e.alt || "오디오"}`}
        title={
          status?.error
            ? "오디오를 재생할 수 없습니다. 다른 코덱으로 변환해 주세요."
            : `${label}: ${e.alt || "오디오"}`
        }
        onClick={() => session.toggle(e.id)}
      >
        <img className="element-image" src={poster} alt="" draggable={false} />
        <span>
          {status?.error ? (
            <AlertCircle />
          ) : status?.playing ? (
            <Pause />
          ) : (
            <Play />
          )}
        </span>
      </button>
      {status?.blocked && <small role="status">클릭하여 재생</small>}
      {status?.error && <small role="alert">재생할 수 없음</small>}
    </div>
  );
}
