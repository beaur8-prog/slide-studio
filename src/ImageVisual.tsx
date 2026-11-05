import { useMemo } from "react";
import type { SlideElement } from "./types";
import { stillImageSource } from "./gif-preview";

export function ImageVisual({
  element: e,
  playing = false,
}: {
  element: SlideElement;
  playing?: boolean;
}) {
  const source = useMemo(
    () => (playing ? e.src : stillImageSource(e.src)),
    [e.src, playing],
  );
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflow: "visible",
        position: "relative",
        transform: `scale(${e.flipH ? -1 : 1},${e.flipV ? -1 : 1})`,
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <img
          className="element-image"
          src={source}
          alt={e.alt || ""}
          draggable={false}
          style={{
            opacity: e.opacity,
            ...(e.crop
              ? {
                  position: "absolute",
                  maxWidth: "none",
                  left: `${(-e.crop[3] / (1 - e.crop[3] - e.crop[1])) * 100}%`,
                  top: `${(-e.crop[0] / (1 - e.crop[0] - e.crop[2])) * 100}%`,
                  width: `${100 / (1 - e.crop[3] - e.crop[1])}%`,
                  height: `${100 / (1 - e.crop[0] - e.crop[2])}%`,
                }
              : {}),
          }}
        />
      </div>
      {e.stroke && e.stroke !== "transparent" && (e.strokeWidth ?? 0) > 0 && (
        <svg
          data-picture-outline
          aria-hidden="true"
          viewBox={`0 0 ${e.width} ${e.height}`}
          preserveAspectRatio="none"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: "100%",
            height: "100%",
            overflow: "visible",
            pointerEvents: "none",
          }}
        >
          <rect
            width={e.width}
            height={e.height}
            fill="none"
            stroke={e.stroke}
            strokeWidth={e.strokeWidth}
            strokeOpacity={e.strokeOpacity ?? 1}
            strokeDasharray={e.strokeDash?.join(" ")}
            strokeLinecap={e.strokeCap ?? "butt"}
          />
        </svg>
      )}
    </div>
  );
}
