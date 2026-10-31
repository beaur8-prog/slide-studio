import { useContext } from "react";
import { SlideLinks } from "./slide-links";
import { alphaColor } from "./colors";
import { useRef, useLayoutEffect } from "react";
import type { SlideElement, TextParagraph, TextRun } from "./types";
import {
  fontStack,
  paragraphBullet,
  paragraphLines,
  scriptRuns,
} from "./text-layout";
// Chromium does not implement CSS hanging-punctuation. Try letting the terminal
// stop/comma hang, and keep it only when that prevents an extra line. A sentence
// that already fits keeps its natural width, including center/right alignment.
function TextLine({
  line,
  paragraph: p,
  element: e,
  first,
  editing = false,
}: {
  line: TextRun[];
  paragraph: TextParagraph;
  element: SlideElement;
  first: boolean;
  editing?: boolean;
}) {
  const links = useContext(SlideLinks);
  const ref = useRef<HTMLDivElement>(null);
  const bullet = first ? paragraphBullet({ ...p, runs: line }) : undefined;
  const runs = bullet
    ? [{ ...line[0], text: bullet.label }, ...bullet.runs.flatMap(scriptRuns)]
    : line.flatMap(scriptRuns);
  useLayoutEffect(() => {
    const box = ref.current;
    const stop = box?.querySelector<HTMLElement>("[data-hanging-punctuation]");
    if (!box || !stop) return;
    const reset = () => {
      stop.style.display = "";
      stop.style.width = "";
      stop.style.whiteSpace = "";
    };
    let disposed = false;
    const layout = () => {
      if (disposed) return;
      reset();
      if (
        !p.hangingPunctuation ||
        e.wrap === false ||
        (e.writingMode && e.writingMode !== "horizontal")
      )
        return;
      const before = box.getBoundingClientRect().height;
      stop.style.display = "inline-block";
      stop.style.width = "0px";
      stop.style.whiteSpace = "pre";
      if (box.getBoundingClientRect().height >= before - 0.1) reset();
    };
    layout();
    void document.fonts.ready.then(layout);
    document.fonts.addEventListener("loadingdone", layout);
    window.addEventListener("slide-studio:fonts-changed", layout);
    const observer = new ResizeObserver(layout);
    observer.observe(box);
    window.addEventListener("beforeprint", layout);
    return () => {
      disposed = true;
      document.fonts.removeEventListener("loadingdone", layout);
      window.removeEventListener("slide-studio:fonts-changed", layout);
      observer.disconnect();
      window.removeEventListener("beforeprint", layout);
    };
  }, [line, p, e]);
  return (
    <div
      ref={ref}
      data-text-line
      style={{
        fontSize: Math.max(
          ...line.map((r) => r.fontSize ?? p.fontSize ?? e.fontSize ?? 32),
          ...(line.length ? [] : [p.fontSize ?? e.fontSize ?? 32]),
        ),
        // An empty line has no inline box, but still occupies its full line
        // advance (including fixed spacing and the font size of this line).
        minBlockSize: line.every((r) => !r.text) ? "1lh" : undefined,
        textIndent: first ? (p.indent ?? 0) : 0,
      }}
    >
      {runs.map((r, j) => {
        const terminal =
          j === runs.length - 1 && p.hangingPunctuation
            ? r.text.match(
                /[,.\u060c\u06d4\u3001\u3002\uff0c\uff0e\ufe50\ufe51\ufe52\uff61\uff64]$/u,
              )?.[0]
            : undefined;
        const Tag =
          links.interactive && r.hyperlink
            ? r.hyperlink.url
              ? "a"
              : "button"
            : "span";
        return (
          <Tag
            key={j}
            {...(Tag !== "span"
              ? {
                  className: "presentation-run-link",
                  href: r.hyperlink?.url,
                  target: r.hyperlink?.url ? "_blank" : undefined,
                  rel: "noopener noreferrer",
                  onClick: (event: React.MouseEvent) => {
                    event.stopPropagation();
                    if (r.hyperlink?.slideId)
                      links.onSlideLink?.(r.hyperlink.slideId);
                  },
                }
              : {})}
            lang={r.language}
            data-bullet={bullet && j === 0 ? "" : undefined}
            style={{
              ...(bullet && j === 0
                ? {
                    display: "inline-block",
                    minWidth: Math.max(0, -(p.indent ?? 0)),
                    marginRight: (p.indent ?? 0) >= 0 ? "0.25em" : undefined,
                    textIndent: 0,
                  }
                : {}),
              letterSpacing: r.letterSpacing,
              overflowWrap:
                p.latinLineBreak === false &&
                !/[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(
                  r.text,
                )
                  ? "normal"
                  : undefined,
              fontKerning:
                r.kerning === undefined
                  ? "none"
                  : (r.fontSize ?? e.fontSize ?? 32) >= r.kerning
                    ? "normal"
                    : "none",
              wordBreak:
                p.latinLineBreak &&
                !/[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(
                  r.text,
                )
                  ? "break-all"
                  : undefined,
              fontFamily: r.fontFamily
                ? fontStack(r.fontFamily, r.bold ?? e.bold)
                : undefined,
              fontSize: r.baseline
                ? `${(r.fontSize ?? e.fontSize ?? 32) * 0.65}px`
                : r.fontSize,
              fontWeight:
                r.bold === undefined
                  ? undefined
                  : r.bold
                    ? 700
                    : /Light$/i.test(r.fontFamily ?? e.fontFamily ?? "")
                      ? 300
                      : 400,
              fontStyle:
                r.italic === undefined
                  ? undefined
                  : r.italic
                    ? "italic"
                    : "normal",
              textTransform: r.caps === "all" ? "uppercase" : "none",
              fontVariantCaps: r.caps === "small" ? "small-caps" : "normal",
              // The parent disables synthetic weights. Allow small-cap glyph
              // synthesis only for runs which explicitly request that effect.
              fontSynthesis:
                r.caps === "small" ? "style small-caps" : undefined,
              textDecoration:
                (r.underline ?? e.underline) ? "underline" : "none",
              color: alphaColor(
                r.color ?? e.color,
                r.opacity ?? e.textOpacity ?? 1,
              ),
              verticalAlign: r.baseline ? `${r.baseline / 1000}%` : undefined,
            }}
          >
            {terminal ? (
              <>
                {r.text.slice(0, -terminal.length)}
                <span data-hanging-punctuation>{terminal}</span>
              </>
            ) : (
              r.text
            )}
            {editing && bullet && j === 0 ? (
              <span
                style={{
                  // An empty list has no body run for the native caret. Do not
                  // let the first typed characters inherit a zero font size.
                  fontSize: bullet.runs.some((r) => r.text)
                    ? 0
                    : (p.fontSize ?? e.fontSize ?? 32),
                }}
              >
                {p.bulletPrefix!.slice(bullet.label.length)}
              </span>
            ) : null}
          </Tag>
        );
      })}
    </div>
  );
}

export function TextContent({
  element: e,
  editing = false,
}: {
  element: SlideElement;
  editing?: boolean;
}) {
  let content;
  if (!e.paragraphs)
    // Keep native formatting spans inside one inline formatting context.
    // Direct children of the column-flex editor would become separate rows.
    content = (
      <div data-text-plain style={{ flexShrink: 0, minBlockSize: "1lh" }}>
        <span style={{ textDecoration: e.underline ? "underline" : "none" }}>
          {e.text}
        </span>
      </div>
    );
  else
    content = (
      <>
        {e.paragraphs.map((p, i) => (
          <div
            key={i}
            data-text-paragraph
            style={{
              flexShrink: 0,
              fontSize: p.fontSize ?? e.fontSize,
              textAlign: p.align ?? e.align,
              lineHeight:
                p.lineSpacing !== undefined
                  ? `${p.lineSpacing}px`
                  : (p.lineHeight ?? 1.2),
              marginTop: p.spaceBefore ?? 0,
              marginBottom: p.spaceAfter ?? 0,
              paddingLeft: p.marginLeft ?? 0,
              paddingRight: p.marginRight ?? 0,
              tabSize: p.tabSize === undefined ? undefined : `${p.tabSize}px`,
              lineBreak: p.eastAsianLineBreak === false ? "auto" : "strict",
              wordBreak: p.eastAsianLineBreak === false ? "keep-all" : "normal",
            }}
          >
            {paragraphLines(p).map((line, lineIndex) => (
              <TextLine
                key={lineIndex}
                line={line}
                paragraph={p}
                element={e}
                first={lineIndex === 0}
                editing={editing}
              />
            ))}
          </div>
        ))}
      </>
    );
  const body =
    (e.textColumns ?? 1) > 1 ? (
      <div
        data-text-columns
        style={{
          height: "100%",
          minHeight: 0,
          flexShrink: 0,
          columnCount: e.textColumns,
          columnGap: e.textColumnGap ?? 0,
          columnFill: "auto",
        }}
      >
        {content}
      </div>
    ) : (
      content
    );
  return e.textRotation ? (
    <div
      data-text-rotation={e.textRotation}
      style={{
        width: "100%",
        height: "100%",
        minHeight: 0,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent:
          e.verticalAlign === "middle"
            ? "center"
            : e.verticalAlign === "bottom"
              ? "flex-end"
              : "flex-start",
        transform: `rotate(${e.textRotation}deg)`,
        transformOrigin: "center",
      }}
    >
      {body}
    </div>
  ) : (
    body
  );
}
