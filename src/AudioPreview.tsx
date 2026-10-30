import { useEffect, useRef } from "react";
import type { SlideElement } from "./types";

export function AudioPreview({
  element: e,
  suspended,
}: {
  element: SlideElement;
  suspended: boolean;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.volume = e.volume ?? 1;
      if (suspended) ref.current.pause();
    }
  }, [e.volume, suspended]);
  useEffect(() => {
    const audio = ref.current;
    if (audio && audio.getAttribute("src") !== e.src) audio.src = e.src ?? "";
    return () => {
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
    };
  }, [e.src]);
  return (
    <audio
      ref={ref}
      className="audio-preview"
      controls
      preload="metadata"
      src={e.src}
      muted={e.muted === true}
      aria-label="선택한 오디오 미리 듣기"
    />
  );
}
