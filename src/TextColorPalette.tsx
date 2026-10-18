import { useLayoutEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import type { TextMenuSelection } from "./text-selection";
import "./text-color-palette.css";

const COLORS = [
  "#000000",
  "#FFFFFF",
  "#233D35",
  "#D4613F",
  "#C00000",
  "#FF0000",
  "#FFC000",
  "#FFFF00",
  "#92D050",
  "#00B050",
  "#00B0F0",
  "#0070C0",
  "#002060",
  "#7030A0",
  "#808080",
  "#BFBFBF",
];
export default function TextColorPalette({
  x,
  y,
  color,
  selection,
  partial,
  onApply,
  onClose,
}: {
  x: number;
  y: number;
  color: string;
  selection?: TextMenuSelection;
  partial: boolean;
  onApply: (color: string) => void;
  onClose: (restore: boolean) => void;
}) {
  const [draft, setDraft] = useState(color);
  const host = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const valid = /^#[\da-f]{6}$/i.test(draft);
  const enabled =
    valid && (!partial || (selection && !selection.range.collapsed));
  useLayoutEffect(() => {
    const panel = host.current!;
    const bounds = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(x, innerWidth - bounds.width - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(y, innerHeight - bounds.height - 8))}px`;
    if (selection && "highlights" in CSS)
      CSS.highlights.set(
        "text-color-selection",
        new Highlight(selection.range),
      );
    input.current?.focus({ preventScroll: true });
    input.current?.select();
    const outside = (event: PointerEvent) => {
      if (!panel.contains(event.target as Node)) close.current(false);
    };
    const resize = () => close.current(false);
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", resize);
    return () => {
      CSS.highlights?.delete("text-color-selection");
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", resize);
    };
  }, [x, y, selection]);
  return (
    <form
      ref={host}
      role="dialog"
      aria-label="글자 색"
      className="text-color-palette"
      style={{ left: x, top: y }}
      onSubmit={(event) => {
        event.preventDefault();
        if (enabled) onApply(draft.toUpperCase());
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          onClose(true);
        }
      }}
    >
      <strong>글자 색</strong>
      <p>
        {partial
          ? selection && !selection.range.collapsed
            ? "선택한 글자에 적용합니다."
            : "글자를 먼저 선택해 주세요."
          : "선택한 텍스트 상자 전체에 적용합니다."}
      </p>
      <div className="text-color-swatches">
        {COLORS.map((value) => (
          <button
            key={value}
            type="button"
            aria-label={`색상 ${value}`}
            aria-pressed={draft.toUpperCase() === value}
            style={{ background: value }}
            onClick={() => setDraft(value)}
          >
            {draft.toUpperCase() === value && (
              <Check
                size={14}
                color={
                  ["#FFFFFF", "#FFFF00", "#FFC000", "#92D050"].includes(value)
                    ? "#202020"
                    : "#FFFFFF"
                }
              />
            )}
          </button>
        ))}
      </div>
      <label className="text-color-custom">
        사용자 지정
        <input
          type="color"
          aria-label="사용자 지정 글자 색"
          value={valid ? draft : "#000000"}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <label className="text-color-code">
        색상 코드
        <input
          ref={input}
          aria-label="색상 코드"
          value={draft}
          maxLength={7}
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <div className="text-color-actions">
        <button type="button" onClick={() => onClose(true)}>
          취소
        </button>
        <button type="submit" disabled={!enabled} className="apply">
          적용
        </button>
      </div>
    </form>
  );
}
