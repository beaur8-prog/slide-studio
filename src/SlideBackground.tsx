import { ImageVisual } from "./ImageVisual";
import type { Slide } from "./types";

export function SlideBackground({
  slide,
  width,
  height,
  playMedia = false,
}: {
  slide: Slide;
  width: number;
  height: number;
  playMedia?: boolean;
}) {
  if (!slide.backgroundImage) return null;
  return (
    <div
      className="slide-background-image"
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        opacity: slide.backgroundImage.opacity ?? 1,
      }}
    >
      <ImageVisual
        element={{
          id: "background",
          type: "image",
          x: 0,
          y: 0,
          width,
          height,
          rotation: 0,
          opacity: 1,
          ...slide.backgroundImage,
        }}
        playing={playMedia}
      />
    </div>
  );
}
