import { gradientCss } from "./gradient";
import { alphaColor } from "./colors";
import { useRef, useLayoutEffect } from "react";
import type { CSSProperties } from "react";
import type { SlideElement } from "./types";
import { fontStack } from "./text-layout";
import { textDirectionStyle } from "./text-direction";
export function useTextHeight(
  element: SlideElement,
  onHeight?: (id: string, height: number) => void,
) {
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(onHeight);
  callback.current = onHeight;
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host || !automaticTextHeight(element) || !onHeight || element.locked)
      return;
    const measure = () => {
      // offsetHeight is in slide pixels even inside a zoomed/rotated canvas.
      const height = Math.min(100000, Math.max(8, host.offsetHeight));
      if (Math.abs(height - element.height) >= 1)
        callback.current?.(element.id, height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [element, Boolean(onHeight)]);
  return ref;
}

export function automaticTextHeight(e: SlideElement) {
  return (
    e.autoHeight &&
    (!e.writingMode || e.writingMode === "horizontal") &&
    (e.textColumns ?? 1) === 1
  );
}

export function textStyle(e: SlideElement): CSSProperties {
  return {
    fontFamily: fontStack(e.fontFamily, e.bold),
    fontSize: e.fontSize || 32,
    letterSpacing: e.letterSpacing,
    fontKerning:
      e.kerning === undefined
        ? undefined
        : (e.fontSize ?? 32) >= e.kerning
          ? "normal"
          : "none",
    fontWeight: e.bold ? 700 : /Light$/i.test(e.fontFamily ?? "") ? 300 : 400,
    fontStyle: e.italic ? "italic" : "normal",
    fontSynthesis: "style",
    // Put underline on runs so it can be removed from a partial selection.
    // An ancestor's text decoration cannot be cancelled by a child span.
    textDecoration: "none",
    color: alphaColor(e.color || "#233D35", e.textOpacity),
    textAlign: e.align || "left",
    whiteSpace: e.wrap === false ? "pre" : "pre-wrap",
    overflowWrap: e.wrap === false ? "normal" : "break-word",
    wordBreak: e.paragraphs ? "keep-all" : undefined,
    overflow: automaticTextHeight(e) ? "visible" : (e.textOverflow ?? "hidden"),
    height: automaticTextHeight(e) ? "auto" : undefined,
    background: gradientCss(e.gradient) ?? alphaColor(e.fill, e.fillOpacity),
    outline:
      e.strokeWidth && e.stroke !== "transparent"
        ? `${e.strokeWidth}px solid ${alphaColor(e.stroke, e.strokeOpacity)}`
        : undefined,
    padding: e.textInsets?.map((v) => `${v}px`).join(" "),
    ...textDirectionStyle(e.writingMode),
    justifyContent:
      e.verticalAlign === "middle"
        ? "center"
        : e.verticalAlign === "bottom"
          ? "flex-end"
          : "flex-start",
  };
}

export function shapeTextElement(e: SlideElement): SlideElement {
  const f = e.textFrame ?? [0, 0, 1, 1];
  return {
    ...e,
    type: "text",
    width: e.width * f[2],
    height: e.height * f[3],
    autoHeight: false,
    text: e.text ?? "",
    gradient: undefined,
    fill: "transparent",
    strokeWidth: 0,
    borders: undefined,
  };
}
export function shapeTextFrame(e: SlideElement): CSSProperties {
  const f = e.textFrame ?? [0, 0, 1, 1];
  return {
    position: "absolute",
    left: `${f[0] * 100}%`,
    top: `${f[1] * 100}%`,
    width: `${f[2] * 100}%`,
    height: `${f[3] * 100}%`,
  };
}
