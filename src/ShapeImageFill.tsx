import type { SlideElement } from "./types";
import { ChartImageFill } from "./ChartImageFill";
import { stillImageSource } from "./gif-preview";

// Use the shape's coordinate space, rather than a path's bounding box: custom
// geometry can occupy only part of its extent or have several filled paths.
export function ShapeImageFill({
  element,
  id,
  width = element.width,
  height = element.height,
  playing = false,
}: {
  element: SlideElement;
  id: string;
  width?: number;
  height?: number;
  playing?: boolean;
}) {
  const fill = element.imageFill;
  if (!fill || !width || !height) return null;
  const crop = fill.crop ?? [0, 0, 0, 0];
  return (
    <defs>
      <pattern
        id={id}
        patternUnits="userSpaceOnUse"
        x={0}
        y={0}
        width={width}
        height={height}
        viewBox={`0 0 ${element.width} ${element.height}`}
        preserveAspectRatio="none"
      >
        {fill.placement ? (
          <ChartImageFill
            fill={{
              ...fill.placement,
              src: fill.src,
              crop,
              opacity: fill.opacity ?? 1,
            }}
            width={element.width}
            height={element.height}
            playing={playing}
          />
        ) : (
          <svg
            width={element.width}
            height={element.height}
            viewBox={`${crop[3]} ${crop[0]} ${1 - crop[1] - crop[3]} ${1 - crop[0] - crop[2]}`}
            preserveAspectRatio="none"
            overflow="hidden"
            opacity={fill.opacity ?? 1}
          >
            <image
              href={playing ? fill.src : stillImageSource(fill.src)}
              width={1}
              height={1}
              preserveAspectRatio="none"
            />
          </svg>
        )}
      </pattern>
    </defs>
  );
}
