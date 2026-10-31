import { ImageVisual } from "./ImageVisual";
import type { Slide } from "./types";
import { ChartImageFill } from "./ChartImageFill";

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
      {slide.backgroundImage.placement ? (
        <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{display:"block"}}>
          <ChartImageFill fill={{ ...slide.backgroundImage.placement, src: slide.backgroundImage.src, crop: slide.backgroundImage.crop ?? [0,0,0,0], opacity: 1 }} width={width} height={height} playing={playMedia} />
        </svg>
      ) : <ImageVisual
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
      />}
    </div>
  );
}
