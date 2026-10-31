import type { CSSProperties } from "react";
import type { SlideElement } from "./types";

/** DrawingML's rotated Latin text needs opposite glyph rotation for vert270. */
export function textDirectionStyle(
  mode: SlideElement["writingMode"],
): CSSProperties {
  return {
    writingMode:
      mode === "vertical" || mode === "stacked"
        ? "vertical-rl"
        : mode === "vertical270"
          ? "sideways-lr"
          : undefined,
    textOrientation: mode === "stacked" ? "upright" : undefined,
  };
}
